import fs from 'fs';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
dotenv.config();

import { createServer as createServerHttp } from 'http';
import { createServer as createServerHttps } from 'https';

import { Server as SocketServer } from 'socket.io';
import { ExpressPeerServer } from 'peer';

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import Logger from './utils/Log.js';

import { iceServers as iceServersList } from './utils/iceServers.js';
import { createChatRateLimiter } from './utils/ChatRateLimit.js';
import { createChatHistoryStore } from './utils/ChatHistoryStore.js';
import {
    emitViewCursorRemove,
    resolveOwnedViewChatRoom,
    switchViewChatRoom,
} from './utils/ViewChatRoomLifecycle.js';
import { createVoiceCallSignaling } from './utils/VoiceCallSignaling.js';
import {
    bindSocketDisconnectLifecycle,
    removeOwnedPresenceMember,
} from './utils/SocketDisconnectLifecycle.js';
// import { getMemoryUsageMessage, getCpuUsageMessage } from "./utils/LogMemoryUsage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 443;

const app = express();
let key;
let cert;
let httpServer;

const requestedHttps =
    process.env.USE_HTTPS === 'true'
        ? true
        : process.env.USE_HTTPS === 'false'
          ? false
          : undefined;
if (requestedHttps === undefined)
    throw new Error('Please set useHttps to either "true" or "false"');

let useHttps = requestedHttps;
if (requestedHttps) {
    try {
        key = fs.readFileSync(__dirname + '/../cert/selfsigned.key', 'utf8');
        cert = fs.readFileSync(__dirname + '/../cert/selfsigned.crt', 'utf8');
        httpServer = createServerHttps({ key, cert }, app);
    } catch (error) {
        useHttps = false;
        console.error(
            '[https] TLS certificate could not be loaded; falling back to HTTP.',
            error.message
        );
        httpServer = createServerHttp(app);
    }
} else {
    httpServer = createServerHttp(app);
}

const io = new SocketServer(httpServer);

const peerServer = ExpressPeerServer(httpServer, {
    path: '/',
    proxied: true,
    iceServers: [...iceServersList],
});

const Log = new Logger(process.env.ENV);

app.use((req, res, next) => {
    res.locals.cspNonce = randomUUID().replaceAll('-', '');
    next();
});
app.use((req, res, next) =>
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    `'nonce-${res.locals.cspNonce}'`,
                    'https://unpkg.com',
                    'https://kit.fontawesome.com',
                ],
                styleSrc: ["'self'", "'unsafe-inline'"],
                fontSrc: ["'self'", 'https://ka-f.fontawesome.com', 'data:'],
                connectSrc: [
                    "'self'",
                    'https://ka-f.fontawesome.com',
                    'ws:',
                    'wss:',
                ],
                imgSrc: ["'self'", 'data:', 'blob:'],
                mediaSrc: ["'self'", 'blob:'],
                workerSrc: ["'self'", 'blob:'],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: useHttps ? [] : null,
            },
        },
        crossOriginEmbedderPolicy: false,
        strictTransportSecurity: useHttps,
    })(req, res, next)
);
app.use('/peerjs', peerServer);

const CHANNELS = [
    {
        slug: 'lobby',
        name: '大厅',
        description: '日常集合和临时闲聊。',
    },
    {
        slug: 'game',
        name: '游戏开黑',
        description: '开局前集合，边玩边说。',
    },
    {
        slug: 'project',
        name: '项目讨论',
        description: '同步想法、排查问题和看屏幕。',
    },
    {
        slug: 'screen',
        name: '一起看屏幕',
        description: '专门用来共享屏幕和一起看内容。',
    },
    {
        slug: 'idle',
        name: '发呆挂机',
        description: '不一定说话，在线就行。',
    },
];

const getChannel = (slug) => CHANNELS.find((channel) => channel.slug === slug);
const voiceCallSignaling = createVoiceCallSignaling({
    io,
    logger: Log,
    onScreenShareChange: (event) => syncPresenceScreenSharing(event),
    resolveRoomId: (roomId) => getChannel(roomId)?.slug,
});
const CHAT_HISTORY_LIMIT = 50;
const CHAT_MESSAGE_MAX_LENGTH = 500;
const onlineMembersByRoom = new Map();
const chatRateLimiter = createChatRateLimiter({});
const chatHistoryStore = createChatHistoryStore({
    filePath:
        process.env.CHAT_HISTORY_FILE ||
        join(__dirname, '..', 'data', 'chat-history.json'),
    limit: CHAT_HISTORY_LIMIT,
    logger: Log,
});

const getChatHistory = (roomId) => chatHistoryStore.get(roomId);
const saveChatMessage = (message) => chatHistoryStore.append(message);

const createChatMessageId = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeSenderName = (senderName) => {
    const normalized = String(senderName || '')
        .trim()
        .slice(0, 32);
    return normalized || 'Guest';
};

const normalizeChatContent = (content) =>
    String(content || '')
        .trim()
        .slice(0, CHAT_MESSAGE_MAX_LENGTH);

const getOnlineMembers = (roomId) =>
    Array.from((onlineMembersByRoom.get(roomId) || new Map()).values());

const getPresenceSnapshot = () => ({
    channels: CHANNELS.map((channel) => ({
        slug: channel.slug,
        count: getOnlineMembers(channel.slug).length,
        members: getOnlineMembers(channel.slug),
    })),
});

const emitPresenceToSocket = (socket) => {
    const owner = voiceCallSignaling.getVoiceOwner(socket);
    socket.emit('presence:state', {
        ...getPresenceSnapshot(),
        clientSessionEpoch: owner?.clientSessionEpoch,
        voiceSessionGeneration: owner?.voiceSessionGeneration,
    });
};

let presenceBroadcastTimer;
const broadcastPresence = () => {
    if (presenceBroadcastTimer) {
        return;
    }
    presenceBroadcastTimer = setTimeout(() => {
        presenceBroadcastTimer = undefined;
        io.emit('presence:state', getPresenceSnapshot());
    }, 25);
    presenceBroadcastTimer.unref?.();
};

const samePresenceState = (left, right) =>
    [
        'peerId',
        'roomId',
        'senderName',
        'joinedVoice',
        'hasMic',
        'micPermissionDenied',
        'muted',
        'cameraOn',
        'screenSharing',
    ].every((key) => left?.[key] === right?.[key]);

const syncPresenceScreenSharing = ({ peerId, roomId, sharing, socket }) => {
    const members = onlineMembersByRoom.get(roomId);
    const member = members?.get(socket.id);

    if (!member || member.peerId !== peerId || member.roomId !== roomId) {
        return false;
    }

    const nextMember = {
        ...member,
        screenSharing: sharing,
        updatedAt: new Date().toISOString(),
    };
    members.set(socket.id, nextMember);
    broadcastPresence();
    return true;
};

const removePresenceMember = (socket) =>
    removeOwnedPresenceMember(onlineMembersByRoom, socket);

const getCursorColor = (seed) => {
    let hash = 0;

    String(seed || '')
        .split('')
        .forEach((char) => {
            hash = (hash * 31 + char.charCodeAt(0)) % 360;
        });

    return `hsl(${hash}, 78%, 58%)`;
};

const normalizeCursorPosition = (value) => {
    const position = Number(value);

    if (!Number.isFinite(position)) {
        return undefined;
    }

    return Math.min(1, Math.max(0, position));
};

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
['audio-worklet', 'js', 'styles', 'vendor', 'wasm'].forEach((directory) =>
    app.use(
        `/${directory}`,
        express.static(join(__dirname, 'views', directory), {
            dotfiles: 'deny',
            fallthrough: false,
            index: false,
        })
    )
);
app.get('/script.js', (_, res) =>
    res.sendFile(join(__dirname, 'views', 'script.js'))
);
app.get('/style.css', (_, res) =>
    res.sendFile(join(__dirname, 'views', 'style.css'))
);

/** Routes */
app.get('/', (_, res) => res.redirect('/room/lobby'));

app.get('/room/:channel', (req, res) => {
    const channel = getChannel(req.params.channel);

    if (!channel) {
        return res.redirect('/room/lobby');
    }

    res.render('room/index', {
        channels: CHANNELS,
        roomId: channel.slug,
        channelName: channel.name,
        roomBootstrap: JSON.stringify({
            iceServers: iceServersList,
            roomId: channel.slug,
        }).replace(
            /[<>&\u2028\u2029]/g,
            (character) =>
                `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
        ),
    });
});

app.use((_, res) => res.status(404).send('404 Not Found'));

/**
 * handleVoiceJoin
 *
 * Handles a user's request to join a voice room.
 *
 * @param {object} payload - The owned voice room and local PeerJS id.
 * @param {Socket} socket - The socket instance representing the user's connection.
 *
 * Behavior:
 * - Validates and stores voiceRoomId / voicePeerId on socket.data.
 * - Adds the user's socket to the fixed voice room.
 * - Tells only the new member which existing peers it must call.
 *
 * NOTE: disconnect handler is registered once in io.on('connection'),
 * not here, to avoid duplicate registrations.
 */
const handleVoiceJoin = async (payload, socket) => {
    const result = await voiceCallSignaling.join(payload, socket);

    if (result.ok) {
        Log.info(
            `[joinVoice] socket=${socket.id} peerId=${socket.data.voicePeerId} roomId=${socket.data.voiceRoomId}`
        );
    }

    return result;
};

/**
 * handleDisconnect
 *
 * Handles the disconnection of a user.
 * Reads voiceRoomId / voicePeerId from socket.data to avoid stale closured values.
 */
const handleDisconnectingVoice = (socket) =>
    voiceCallSignaling.leave(socket, { reason: 'socket-disconnecting' });

const handleVoicePeerLeft = (socket) => {
    void voiceCallSignaling.leave(socket, { reason: 'voicePeerLeft' });
};

const hasOnlyOptionalBooleans = (values) =>
    values.every((value) => value === undefined || typeof value === 'boolean');

const handlePresenceJoinVoice = (
    { senderName, hasMic, micPermissionDenied, muted, cameraOn } = {},
    socket
) => {
    const owner = voiceCallSignaling.getVoiceOwner(socket);
    const channel = getChannel(owner?.roomId);

    if (
        !channel ||
        !owner ||
        !hasOnlyOptionalBooleans([hasMic, micPermissionDenied, muted, cameraOn])
    ) {
        return;
    }

    const { peerId } = owner;

    if (
        socket.data.presenceRoomId &&
        socket.data.presenceRoomId !== channel.slug
    ) {
        removePresenceMember(socket);
    }

    const members = onlineMembersByRoom.get(channel.slug) || new Map();
    const member = members.get(socket.id);
    const nextMember = {
        socketId: socket.id,
        peerId,
        roomId: channel.slug,
        senderName: normalizeSenderName(senderName),
        joinedVoice: true,
        hasMic: hasMic === true,
        micPermissionDenied: micPermissionDenied === true,
        muted: muted === true,
        cameraOn: cameraOn === true,
        screenSharing: socket.data.voiceScreenSharing === true,
        updatedAt: new Date().toISOString(),
    };
    if (samePresenceState(member, nextMember)) {
        return;
    }
    members.set(socket.id, nextMember);

    onlineMembersByRoom.set(channel.slug, members);
    socket.data.presenceRoomId = channel.slug;
    broadcastPresence();
};

const handlePresenceUpdate = (
    { senderName, hasMic, micPermissionDenied, muted, cameraOn } = {},
    socket
) => {
    const owner = voiceCallSignaling.getVoiceOwner(socket);
    const channel = getChannel(owner?.roomId);

    if (
        !channel ||
        !owner ||
        !hasOnlyOptionalBooleans([hasMic, micPermissionDenied, muted, cameraOn])
    ) {
        return;
    }

    const { peerId } = owner;

    const members = onlineMembersByRoom.get(channel.slug) || new Map();
    const member = members.get(socket.id) || {};

    const nextMember = {
        ...member,
        socketId: socket.id,
        roomId: channel.slug,
        joinedVoice: true,
        senderName:
            senderName !== undefined
                ? normalizeSenderName(senderName)
                : member.senderName || 'Guest',
        peerId,
        hasMic: hasMic !== undefined ? hasMic : member.hasMic === true,
        micPermissionDenied:
            micPermissionDenied !== undefined
                ? micPermissionDenied
                : member.micPermissionDenied === true,
        muted: muted !== undefined ? muted : member.muted === true,
        cameraOn: cameraOn !== undefined ? cameraOn : member.cameraOn === true,
        screenSharing: socket.data.voiceScreenSharing === true,
        updatedAt: new Date().toISOString(),
    };
    if (samePresenceState(member, nextMember)) {
        return;
    }
    members.set(socket.id, nextMember);
    onlineMembersByRoom.set(channel.slug, members);
    socket.data.presenceRoomId = channel.slug;
    broadcastPresence();
};

const handlePresenceLeaveVoice = (socket) => {
    const removed = removePresenceMember(socket);
    delete socket.data.presenceRoomId;
    if (removed) {
        broadcastPresence();
    }
};

const handleChatJoin = async ({ roomId } = {}, socket) => {
    const transition = await switchViewChatRoom(socket, roomId, {
        isAllowedRoomId: (candidateRoomId) =>
            Boolean(getChannel(candidateRoomId)),
    });

    if (!transition.valid) {
        return;
    }

    const channel = getChannel(transition.roomId);
    socket.emit('chat:history', getChatHistory(channel.slug));
    emitPresenceToSocket(socket);
};

const handleChatSend = ({ roomId, senderName, content } = {}, socket) => {
    const ownedRoom = resolveOwnedViewChatRoom(socket, roomId, 'chatRoomId');
    const channel = getChannel(ownedRoom?.roomId);

    if (!channel) {
        return;
    }

    const normalizedContent = normalizeChatContent(content);

    if (!normalizedContent) {
        return;
    }

    if (!chatRateLimiter.allow(socket.id)) {
        return;
    }

    const message = {
        id: createChatMessageId(),
        roomId: channel.slug,
        senderName: normalizeSenderName(senderName),
        content: normalizedContent,
        createdAt: new Date().toISOString(),
    };

    saveChatMessage(message);
    io.to(ownedRoom.socketRoom).emit('chat:message', message);
};

const handleCursorMove = ({ roomId, x, y, senderName } = {}, socket) => {
    const ownedRoom = resolveOwnedViewChatRoom(socket, roomId, 'viewRoomId');
    const channel = getChannel(ownedRoom?.roomId);
    const normalizedX = normalizeCursorPosition(x);
    const normalizedY = normalizeCursorPosition(y);

    if (!channel) {
        return;
    }

    if (normalizedX === undefined || normalizedY === undefined) {
        return;
    }

    const now = Date.now();
    if (now - Number(socket.data.lastCursorMoveAt || 0) < 33) {
        return;
    }
    socket.data.lastCursorMoveAt = now;

    socket.to(ownedRoom.socketRoom).emit('cursor:move', {
        roomId: channel.slug,
        socketId: socket.id,
        x: normalizedX,
        y: normalizedY,
        senderName: normalizeSenderName(senderName),
        color: getCursorColor(socket.id),
    });
};

const handleCursorLeave = ({ roomId } = {}, socket) => {
    const ownedRoom = resolveOwnedViewChatRoom(socket, roomId, 'viewRoomId');
    const channel = getChannel(ownedRoom?.roomId);

    if (!channel) {
        return;
    }

    socket.to(ownedRoom.socketRoom).emit('cursor:leave', {
        roomId: channel.slug,
        socketId: socket.id,
    });
};

const handleCursorRemove = (socket) => emitViewCursorRemove(socket);

const handlePresenceRemove = (socket) => {
    const removed = removePresenceMember(socket);
    delete socket.data.presenceRoomId;
    if (removed) {
        broadcastPresence();
    }
};

const clearDisconnectedSocketOwners = (socket) => {
    [
        'chatRoomId',
        'presenceRoomId',
        'viewRoomId',
        'voicePeerId',
        'voiceRoomId',
        'voiceClientSessionEpoch',
        'voiceScreenSharing',
        'voiceSessionGeneration',
        'lastCursorMoveAt',
    ].forEach((key) => delete socket.data[key]);
};

/**
 * io.on('connection')
 *
 * Sets up socket event listeners for each new client connection.
 * - Logs when a user connects.
 * - Handles the owned voice signaling join event.
 */
io.on('connection', (socket) => {
    Log.info(`User with socket.id ${socket.id} has connected.`);

    bindSocketDisconnectLifecycle(socket, {
        disconnectingSteps: [
            {
                name: 'cursor-remove',
                run: () => handleCursorRemove(socket),
            },
            {
                name: 'voice-screen-share-leave',
                run: () => handleDisconnectingVoice(socket),
            },
            {
                name: 'presence-remove',
                run: () => handlePresenceRemove(socket),
            },
        ],
        disconnectSteps: [
            {
                name: 'clear-socket-owners',
                run: () => clearDisconnectedSocketOwners(socket),
            },
            {
                name: 'chat-rate-limit-cleanup',
                run: () => chatRateLimiter.clear(socket.id),
            },
            {
                name: 'disconnect-log',
                run: ({ reason }) =>
                    Log.info(
                        `[socket] disconnected socket=${socket.id} reason=${reason}`
                    ),
            },
        ],
        onError: ({ error, step }) =>
            Log.warn(
                `[socket-cleanup] socket=${socket.id} step=${step} error=${error?.message || error}`
            ),
    });

    socket.on('voice:join', async (payload, acknowledge) => {
        const result = await handleVoiceJoin(payload, socket);
        acknowledge?.(result);
    });
    socket.on('voice:snapshot', async (acknowledge) => {
        acknowledge?.(await voiceCallSignaling.getSnapshot(socket));
    });
    socket.on('chat:join', (payload) => handleChatJoin(payload, socket));
    socket.on('chat:send', (payload) => handleChatSend(payload, socket));
    socket.on('presence:joinVoice', (payload) =>
        handlePresenceJoinVoice(payload, socket)
    );
    socket.on('presence:leaveVoice', () => handlePresenceLeaveVoice(socket));
    socket.on('presence:update', (payload) =>
        handlePresenceUpdate(payload, socket)
    );
    socket.on('voicePeerLeft', () => handleVoicePeerLeft(socket));
    socket.on('cursor:move', (payload) => handleCursorMove(payload, socket));
    socket.on('cursor:leave', (payload) => handleCursorLeave(payload, socket));
    socket.on('screen:share', (payload) =>
        voiceCallSignaling.updateScreenShare(payload, socket)
    );
});

httpServer.listen(PORT, () =>
    // eslint-disable-next-line no-console
    console.log(
        `Listening at ${useHttps ? 'https' : 'http'}://${HOST}:${PORT} with PeerJS at /peerjs`
    )
);
