import fs from 'fs';
import express from 'express';

import dotenv from 'dotenv';
dotenv.config();

import { createServer as createServerHttp } from 'http';
import { createServer as createServerHttps } from 'https';

import { Server as SocketServer } from 'socket.io';
import { ExpressPeerServer } from 'peer';

import { dirname } from 'path';
import { fileURLToPath } from 'url';

import Logger from './utils/Log.js';

import { iceServers as iceServersList } from './utils/iceServers.js';
// import { getMemoryUsageMessage, getCpuUsageMessage } from "./utils/LogMemoryUsage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 443;

const app = express();
let key;
let cert;
let httpServer;

const useHttps =
    process.env.USE_HTTPS === 'true'
        ? true
        : process.env.USE_HTTPS === 'false'
          ? false
          : undefined;
if (useHttps === undefined)
    throw new Error('Please set useHttps to either "true" or "false"');

if (useHttps) {
    // 1. https server
    key = fs.readFileSync(__dirname + '/../cert/selfsigned.key', 'utf8');
    cert = fs.readFileSync(__dirname + '/../cert/selfsigned.crt', 'utf8');
    httpServer = createServerHttps({ key: key, cert: cert }, app);
} else {
    // 2. http server
    httpServer = createServerHttp(app);
}

const io = new SocketServer(httpServer);

const peerServer = ExpressPeerServer(httpServer, {
    path: '/',
    proxied: true,
    iceServers: [...iceServersList],
});

app.use('/peerjs', peerServer);

const Log = new Logger(process.env.ENV);

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
const CHAT_HISTORY_LIMIT = 50;
const CHAT_MESSAGE_MAX_LENGTH = 500;
const chatHistoryByRoom = new Map();
const onlineMembersByRoom = new Map();

const getChatHistory = (roomId) => chatHistoryByRoom.get(roomId) || [];

const saveChatMessage = (message) => {
    const history = getChatHistory(message.roomId);
    history.push(message);

    if (history.length > CHAT_HISTORY_LIMIT) {
        history.splice(0, history.length - CHAT_HISTORY_LIMIT);
    }

    chatHistoryByRoom.set(message.roomId, history);
};

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
    socket.emit('presence:state', getPresenceSnapshot());
};

const broadcastPresence = () => {
    io.sockets.sockets.forEach(emitPresenceToSocket);
};

const removePresenceMember = (socket) => {
    const roomId = socket.data.presenceRoomId;
    const members = onlineMembersByRoom.get(roomId);

    if (!members) {
        return;
    }

    members.delete(socket.id);

    if (members.size === 0) {
        onlineMembersByRoom.delete(roomId);
    }
};

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
app.use(express.static(__dirname + '/views'));
app.set('views', __dirname + '/views');

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
        iceServers: JSON.stringify(iceServersList),
    });
});

app.use((_, res) => res.status(404).send('404 Not Found'));

/**
 * handleJoinRoom
 *
 * Handles a user's request to join a voice room.
 *
 * @param {string} roomId - The ID of the room the user wants to join.
 * @param {string} peerId - The ID of the user joining the room.
 * @param {Socket} socket - The socket instance representing the user's connection.
 *
 * Behavior:
 * - Stores voiceRoomId and voicePeerId on socket.data.
 * - Adds the user's socket to the specified room.
 * - Notifies other users in the room that a new user has connected.
 *
 * NOTE: disconnect handler is registered once in io.on('connection'),
 * not here, to avoid duplicate registrations.
 */
const handleJoinRoom = async (roomId, peerId, socket) => {
    Log.info(
        `[joinVoice] socket=${socket.id} peerId=${peerId} roomId=${roomId}`
    );
    socket.data.voiceRoomId = roomId;
    socket.data.voicePeerId = peerId;
    await socket.join(roomId);

    socket.to(roomId).emit('userConnected', { roomId, peerId });
};

/**
 * handleManualDisconnect
 *
 * Handles a manual disconnect request from a user (e.g., when a user clicks a "leave" button).
 *
 * @param {Socket} socket - The socket instance representing the user's connection.
 *
 * Behavior:
 * - Logs that the user (by socket id) has exited via the manual disconnect button.
 * - Emits a 'forceDisconnect' event to the client, instructing it to disconnect.
 * - The client-side disconnect will trigger the 'disconnect' event, which will notify other users to remove the disconnected user.
 */
const handleManualDisconnect = (socket) => {
    Log.info(
        `${socket.id} has exited with the btn from peer. Sending him info to disconnect`
    );
    socket.emit('forceDisconnect'); //disconnecting from client side. 'On disconnect will be triggered after there, telling all to remove the disconnected person.'
};

/**
 * handleDisconnect
 *
 * Handles the disconnection of a user.
 * Reads voiceRoomId / voicePeerId from socket.data to avoid stale closured values.
 */
const handleDisconnect = (socket) => {
    const voiceRoomId = socket.data.voiceRoomId;
    const voicePeerId = socket.data.voicePeerId;

    if (!voiceRoomId || !voicePeerId) {
        return;
    }

    Log.info(
        `[leaveVoice] socket=${socket.id} peerId=${voicePeerId} roomId=${voiceRoomId} (disconnect)`
    );
    socket.to(voiceRoomId).emit('removeUserVideo', {
        roomId: voiceRoomId,
        peerId: voicePeerId,
    });
};

const handleVoicePeerLeft = async ({ roomId, peerId } = {}, socket) => {
    const channel = getChannel(roomId);

    if (!channel || !peerId) {
        return;
    }

    Log.info(
        `[leaveVoice] socket=${socket.id} peerId=${peerId} roomId=${channel.slug} (voicePeerLeft)`
    );

    await socket.leave(channel.slug);
    socket.to(channel.slug).emit('removeUserVideo', {
        roomId: channel.slug,
        peerId,
    });

    if (socket.data.voiceRoomId === channel.slug) {
        delete socket.data.voiceRoomId;
        delete socket.data.voicePeerId;
    }
};

const handlePresenceJoinVoice = (
    { roomId, senderName, peerId, hasMic } = {},
    socket
) => {
    const channel = getChannel(roomId);

    if (!channel) {
        return;
    }

    if (
        socket.data.presenceRoomId &&
        socket.data.presenceRoomId !== channel.slug
    ) {
        removePresenceMember(socket);
    }

    const members = onlineMembersByRoom.get(channel.slug) || new Map();
    members.set(socket.id, {
        socketId: socket.id,
        peerId,
        roomId: channel.slug,
        senderName: normalizeSenderName(senderName),
        joinedVoice: true,
        hasMic: Boolean(hasMic),
        updatedAt: new Date().toISOString(),
    });

    onlineMembersByRoom.set(channel.slug, members);
    socket.data.presenceRoomId = channel.slug;
    broadcastPresence();
};

const handlePresenceUpdate = ({ senderName, hasMic } = {}, socket) => {
    const roomId = socket.data.presenceRoomId;
    const members = onlineMembersByRoom.get(roomId);
    const member = members?.get(socket.id);

    if (!member) {
        return;
    }

    members.set(socket.id, {
        ...member,
        senderName: normalizeSenderName(senderName),
        hasMic: hasMic !== undefined ? Boolean(hasMic) : member.hasMic,
        updatedAt: new Date().toISOString(),
    });
    broadcastPresence();
};

const handlePresenceLeaveVoice = (socket) => {
    removePresenceMember(socket);
    delete socket.data.presenceRoomId;
    broadcastPresence();
};

const handleChatJoin = async ({ roomId } = {}, socket) => {
    const channel = getChannel(roomId);

    if (!channel) {
        return;
    }

    socket.data.chatRoomId = channel.slug;
    socket.data.viewRoomId = channel.slug;
    await socket.join(channel.slug);
    socket.emit('chat:history', getChatHistory(channel.slug));
    emitPresenceToSocket(socket);
};

const handleChatSend = async ({ roomId, senderName, content } = {}, socket) => {
    const channel = getChannel(roomId || socket.data.chatRoomId);

    if (!channel) {
        return;
    }

    const normalizedContent = normalizeChatContent(content);

    if (!normalizedContent) {
        return;
    }

    if (!socket.rooms.has(channel.slug)) {
        await socket.join(channel.slug);
    }

    const message = {
        id: createChatMessageId(),
        roomId: channel.slug,
        senderName: normalizeSenderName(senderName),
        content: normalizedContent,
        createdAt: new Date().toISOString(),
    };

    saveChatMessage(message);
    io.to(channel.slug).emit('chat:message', message);
};

const handleCursorMove = async ({ roomId, x, y, senderName } = {}, socket) => {
    const channel = getChannel(roomId || socket.data.viewRoomId);
    const normalizedX = normalizeCursorPosition(x);
    const normalizedY = normalizeCursorPosition(y);

    if (!channel) {
        return;
    }

    if (normalizedX === undefined || normalizedY === undefined) {
        return;
    }

    if (!socket.rooms.has(channel.slug)) {
        await socket.join(channel.slug);
    }

    socket.to(channel.slug).emit('cursor:move', {
        roomId: channel.slug,
        socketId: socket.id,
        x: normalizedX,
        y: normalizedY,
        senderName: normalizeSenderName(senderName),
        color: getCursorColor(socket.id),
    });
};

const handleCursorLeave = ({ roomId } = {}, socket) => {
    const channel = getChannel(roomId || socket.data.viewRoomId);

    if (!channel) {
        return;
    }

    socket.to(channel.slug).emit('cursor:leave', {
        roomId: channel.slug,
        socketId: socket.id,
    });
};

const handleCursorRemove = (socket) => {
    const roomId = socket.data.viewRoomId || socket.data.chatRoomId;

    if (!roomId) {
        return;
    }

    socket.to(roomId).emit('cursor:remove', {
        roomId,
        socketId: socket.id,
    });
};

const handlePresenceRemove = (socket) => {
    removePresenceMember(socket);
    broadcastPresence();
};

/**
 * io.on('connection')
 *
 * Sets up socket event listeners for each new client connection.
 * - Logs when a user connects.
 * - Handles 'joinRoom' event to join a room.
 * - Handles 'peerLeft' event for manual disconnects.
 */
io.on('connection', (socket) => {
    Log.info(`User with socket.id ${socket.id} has connected.`);

    socket.on('disconnecting', () => {
        handleCursorRemove(socket);
        handlePresenceRemove(socket);
    });

    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });

    socket.on('joinRoom', (roomId, userId) =>
        handleJoinRoom(roomId, userId, socket)
    );
    socket.on('chat:join', (payload) => handleChatJoin(payload, socket));
    socket.on('chat:send', (payload) => handleChatSend(payload, socket));
    socket.on('presence:joinVoice', (payload) =>
        handlePresenceJoinVoice(payload, socket)
    );
    socket.on('presence:leaveVoice', () => handlePresenceLeaveVoice(socket));
    socket.on('presence:update', (payload) =>
        handlePresenceUpdate(payload, socket)
    );
    socket.on('voicePeerLeft', (payload) =>
        handleVoicePeerLeft(payload, socket)
    );
    socket.on('cursor:move', (payload) => handleCursorMove(payload, socket));
    socket.on('cursor:leave', (payload) => handleCursorLeave(payload, socket));
    socket.on('screen:shareStart', ({ roomId } = {}) => {
        const peerId = socket.data.voicePeerId;

        if (!roomId || !peerId) {
            return;
        }

        socket.to(roomId).emit('screen:shareStart', { peerId });
    });
    socket.on('screen:shareStop', ({ roomId } = {}) => {
        const peerId = socket.data.voicePeerId;

        if (!roomId || !peerId) {
            return;
        }

        socket.to(roomId).emit('screen:shareStop', { peerId });
    });
    socket.on('peerLeft', () => handleManualDisconnect(socket));
});

httpServer.listen(PORT, () =>
    // eslint-disable-next-line no-console
    console.log(
        `Listening at ${useHttps ? 'https' : 'http'}://${HOST}:${PORT} with PeerJS at /peerjs`
    )
);
