# Server Socket Disconnect Lifecycle

## Listener ownership

The server binds disconnect lifecycle exactly once per Socket.IO namespace
Socket through `bindSocketDisconnectLifecycle()`:

| Event           | Count after initialization | Owner                       | Purpose                                         |
| --------------- | -------------------------: | --------------------------- | ----------------------------------------------- |
| `disconnecting` |                          1 | `SocketDisconnectLifecycle` | cleanup that still needs old room/owner context |
| `disconnect`    |                          1 | `SocketDisconnectLifecycle` | final owner clearing and one disconnect log     |

`createVoiceCallSignaling()`, `ViewChatRoomLifecycle`, presence, cursor, and
screen-share helpers do not register their own disconnect listeners. Rebinding
the lifecycle helper to the same socket returns the existing socket-local
lifecycle and does not add listeners.

Before this repair, the current checkout already measured one listener for each
phase on a real Socket.IO `Socket`. The historical repository did contain the
warning-producing pattern: `socket.on('disconnect')` was nested inside a join
callback, so repeated joins accumulated listeners and the eleventh registration
crossed EventEmitter's default threshold. The PM2 entry can therefore be from
an older deployed process or retained log. Fresh production logs are required
to distinguish that from a transport-level Node `Socket` warning.

## Phase responsibilities

Socket.IO 4.8 emits `disconnecting` before it removes rooms, then performs its
internal cleanup, and finally emits `disconnect`.

### `disconnecting`

1. Mark this socket's cleanup as started.
2. Emit the owned view cursor removal while the old view room still exists.
3. Clear screen-sharing state and voice ownership through
   `VoiceCallSignaling.leave()`; sharing false precedes peer removal.
4. Remove the owned presence member and broadcast only when the map changed.

### `disconnect`

1. Wait for the disconnecting pipeline to settle.
2. Clear remaining view/chat/voice/presence owner keys from `socket.data`.
3. Write one sanitized disconnect log entry.
4. Mark cleanup completed and release the two application listeners.

Chat history is room-owned and is not deleted. Socket.IO owns actual room
departure.

## Idempotency and error isolation

The guard and promises are stored per socket; there is no global teardown flag.
Repeated phase events, active voice leave followed by transport disconnect, and
accidental helper reinitialization all reuse the same cleanup result.

Named cleanup steps are invoked in order before Socket.IO removes rooms; their
asynchronous completion is then awaited together. A failed step is recorded and
reported once, but later steps still run. A logging failure cannot abort owner
cleanup. No listener limit is changed and `removeAllListeners()` is not used.

## Production verification

After deploying the server files, restart PM2, clear or rotate the old error
log, and exercise repeated chat/view switches, voice join/leave/rejoin, screen
share start/stop, refresh, and abrupt tab close. A new warning must not appear.
If it remains, capture a full `--trace-warnings` stack to identify whether
`[Socket]` is the Socket.IO namespace Socket or an underlying Node/Engine.IO
transport socket.
