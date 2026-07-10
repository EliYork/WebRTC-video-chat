const SOCKET_DISCONNECT_LIFECYCLE = Symbol('socketDisconnectLifecycle');

export const removeOwnedPresenceMember = (membersByRoom, socket) => {
    const roomId = socket?.data?.presenceRoomId;
    const members = membersByRoom?.get(roomId);
    if (!members) {
        return false;
    }

    const removed = members.delete(socket.id);
    if (members.size === 0) {
        membersByRoom.delete(roomId);
    }
    return removed;
};

const runCleanupSteps = async (steps, context, reportError) => {
    const pending = [];
    for (const step of steps) {
        try {
            pending.push(
                Promise.resolve(step.run(context)).catch((error) => {
                    context.errors.push({ error, step: step.name });
                    reportError(step.name, error);
                })
            );
        } catch (error) {
            context.errors.push({ error, step: step.name });
            reportError(step.name, error);
        }
    }
    await Promise.all(pending);
};

export const bindSocketDisconnectLifecycle = (
    socket,
    { disconnectSteps = [], disconnectingSteps = [], onError } = {}
) => {
    if (!socket || typeof socket.on !== 'function') {
        return undefined;
    }

    if (socket[SOCKET_DISCONNECT_LIFECYCLE]) {
        return socket[SOCKET_DISCONNECT_LIFECYCLE];
    }

    socket.data ||= {};
    const state = {
        completed: false,
        disconnectPromise: null,
        disconnectingPromise: null,
        errors: [],
        reason: undefined,
        started: false,
    };

    const reportError = (step, error) => {
        try {
            onError?.({ error, socket, step });
        } catch {
            // Logging failure must not interrupt socket cleanup.
        }
    };

    const runDisconnecting = (reason = 'transport-close') => {
        if (state.disconnectingPromise) {
            return state.disconnectingPromise;
        }

        state.reason = reason;
        state.started = true;
        socket.data.disconnectCleanupStarted = true;
        const context = {
            errors: state.errors,
            phase: 'disconnecting',
            reason,
            socket,
        };
        state.disconnectingPromise = runCleanupSteps(
            disconnectingSteps,
            context,
            reportError
        );
        return state.disconnectingPromise;
    };

    const releaseListeners = () => {
        socket.off?.('disconnecting', handleDisconnecting);
        socket.off?.('disconnect', handleDisconnect);
    };

    const runDisconnect = (reason = state.reason || 'transport-close') => {
        if (state.disconnectPromise) {
            return state.disconnectPromise;
        }

        state.disconnectPromise = Promise.resolve(runDisconnecting(reason))
            .then(() =>
                runCleanupSteps(
                    disconnectSteps,
                    {
                        errors: state.errors,
                        phase: 'disconnect',
                        reason,
                        socket,
                    },
                    reportError
                )
            )
            .finally(() => {
                state.completed = true;
                socket.data.disconnectCleanupCompleted = true;
                releaseListeners();
            });
        return state.disconnectPromise;
    };

    function handleDisconnecting(reason) {
        void runDisconnecting(reason);
    }

    function handleDisconnect(reason) {
        void runDisconnect(reason);
    }

    const lifecycle = {
        runDisconnect,
        runDisconnecting,
        state,
    };
    socket[SOCKET_DISCONNECT_LIFECYCLE] = lifecycle;
    socket.on('disconnecting', handleDisconnecting);
    socket.on('disconnect', handleDisconnect);
    return lifecycle;
};
