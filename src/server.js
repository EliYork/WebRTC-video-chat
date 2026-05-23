import fs from 'fs';
import express from 'express';

import dotenv from 'dotenv';
dotenv.config();

import { createServer as createServerHttp } from 'http';
import { createServer as createServerHttps } from 'https';

import { Server as SocketServer } from 'socket.io';
import { PeerServer } from 'peer';

import { dirname } from 'path';
import { fileURLToPath } from 'url';

import Logger from './utils/Log.js';

import { iceServers as iceServersList } from './utils/iceServers.js';
// import { getMemoryUsageMessage, getCpuUsageMessage } from "./utils/LogMemoryUsage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 443;
const PEER_PORT = process.env.PEER_PORT || 9000;

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

// PeerServer
const peerServer = PeerServer({
    port: PEER_PORT,
    path: '/peerjs',
    ssl: useHttps && { key, cert },
    iceServers: [...iceServersList],
});

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

app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/views'));
app.set('views', __dirname + '/views');

/** Routes */
app.get('/', (req, res) =>
    res.render('index', {
        channels: CHANNELS,
        invalidChannel: req.query.invalid,
    })
);

app.get('/room/:channel', (req, res) => {
    const channel = getChannel(req.params.channel);

    if (!channel) {
        return res.redirect('/?invalid=1');
    }

    res.render('room/index', {
        roomId: channel.slug,
        channelName: channel.name,
        peerPort: PEER_PORT,
        iceServers: JSON.stringify(iceServersList),
    });
});

app.use((_, res) => res.status(404).send('404 Not Found'));

/**
 * handleJoinRoon
 *
 * Handles a user's request to join a room.
 *
 * @param {string} roomId - The ID of the room the user wants to join.
 * @param {string} peerId - The ID of the user joining the room.
 * @param {Socket} socket - The socket instance representing the user's connection.
 *
 * Behavior:
 * - Logs the user's request to join the room.
 * - Adds the user's socket to the specified room.
 * - Notifies other users in the room that a new user has connected by emitting 'userConnected' with the userId.
 * - Sets up a listener for the 'disconnect' event on the socket, which will call handleDisconnect when triggered.
 */
const handleJoinRoon = async (roomId, peerId, socket) => {
    Log.info(`Peer with id ${peerId} has requested to enter room ${roomId}.`);
    await socket.join(roomId);

    socket.to(roomId).emit('userConnected', peerId);
    socket.on('disconnect', () => handleDisconnect(roomId, peerId, socket));
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
 * Handles the disconnection of a user from a room.
 *
 * @param {string} roomId - The ID of the room the user is leaving.
 * @param {string} peerId - The ID of the user who is disconnecting.
 * @param {Socket} socket - The socket instance representing the user's connection.
 *
 * Behavior:
 * - Logs that the user has exited via the browser.
 * - Notifies other users in the room to remove the disconnected user's video by emitting 'removeUserVideo' with the peerId.
 */
const handleDisconnect = (roomId, peerId, socket) => {
    Log.info(`User with peer id ${peerId} has exited via browser`);
    socket.to(roomId).emit('removeUserVideo', peerId);
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

    socket.on('joinRoom', (roomId, userId) =>
        handleJoinRoon(roomId, userId, socket)
    );
    socket.on('peerLeft', () => handleManualDisconnect(socket));
});

peerServer.listen(() =>
    // eslint-disable-next-line no-console
    console.log(
        `Peer server live at ${useHttps ? 'https' : 'http'}://${HOST}:9000`
    )
);

httpServer.listen(PORT, () =>
    // eslint-disable-next-line no-console
    console.log(`Listening at ${useHttps ? 'https' : 'http'}://${HOST}:${PORT}`)
);
