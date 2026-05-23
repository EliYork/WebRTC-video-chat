<p align="right"><a href="./README.md">中文</a> | English</p>

# WebRTC Voice and Screen Share

A small self-hosted WebRTC room app built with Node.js, Express, PeerJS, Socket.IO, EJS, and vanilla JavaScript.

The current baseline is a voice-first fixed-channel room:

- `Join Call` requests microphone access only.
- Camera video is optional and starts only after the camera button is clicked.
- Screen sharing can be sent even when no camera video track exists.
- The homepage shows a small fixed channel list.
- Each channel has a stable URL such as `/room/project`.

## Current Features

- Fixed homepage channel list.
- Stable channel routes: `lobby`, `game`, `project`, `screen`, and `idle`.
- Audio-only room join by default.
- Browser-supported echo cancellation, noise suppression, and auto gain are requested by default.
- Microphone mute and unmute.
- Optional camera toggle.
- Screen sharing to connected peers.
- Remote video and screen shares can be opened fullscreen by button or double-click.
- In-channel text chat with the latest 50 messages kept in server memory.
- Screen sharing for peers that do not already have a video sender.
- Late join support when another peer is already sharing a screen.
- Audio-only placeholder tiles when a remote peer has no video track.
- Copy channel link button on the room page.
- Basic server logging to `logs/node.log`.

No login system or external AI integration is included in this baseline.

## Media Logic

The frontend media flow is intentionally simple:

- `Join Call` first requests audio with `echoCancellation`, `noiseSuppression`, and `autoGainControl`; if unsupported, it falls back to basic `audio: true`.
- The local stream always starts as audio-only.
- The camera button calls `getUserMedia({ video: true, audio: false })` only when the user asks to turn the camera on.
- If camera startup fails, the call stays connected and the error is logged with `console.warn`.
- Screen sharing calls `getDisplayMedia()` and uses the returned screen video track as the active video track.
- For each connected peer, screen sharing first looks for an existing video sender with `sender.track?.kind === 'video'`.
- If a video sender exists, the app uses `replaceTrack(screenTrack)`.
- If no video sender exists, the app starts a small additional PeerJS media call carrying the screen video track.
- When a new peer joins, the app calls them with the current active stream, so an already-active screen share can be received by the late joiner.
- When screen sharing stops, the app restores the camera track if the camera is on; otherwise it returns peers to audio-only state.

## Chat Logic

- The room page creates a temporary nickname such as `Guest-1234`.
- The nickname is stored in `localStorage` and can be edited on the room page.
- Chat uses the existing Socket.IO connection with `chat:join`, `chat:history`, `chat:send`, and `chat:message`.
- Each message includes `id`, `roomId`, `senderName`, `content`, and `createdAt`.
- The server stores the latest 50 messages per channel in memory; messages are lost when the server restarts.
- Messages only broadcast within the same channel, so `/room/project` chat does not appear in `/room/game`.
- The client renders message content as text nodes and does not use `innerHTML` for user input.

## Local Setup

### Prerequisites

- Node.js
- npm

### Install

```bash
npm install
```

### Environment

Create a `.env` file from the example:

```bash
cp .env.example .env
```

For local HTTP development, the important values are:

```env
USE_HTTPS=false
PORT=3000
PEER_PORT=9000
```

The included `.env.example` already contains these defaults.

### Start

```bash
npm start
```

For auto-reload during development:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The app shows the fixed channel list.

## Channels

Current channels are defined in `src/server.js`:

- `lobby`: Lobby
- `game`: Game voice chat
- `project`: Project discussion
- `screen`: Watch a screen together
- `idle`: Idle hangout

Channel URLs use this format:

```text
http://localhost:3000/room/project
```

Invalid channel slugs redirect back to the homepage with a friendly message.

## Two-Window Test

1. Start the server with `npm start`.
2. Open `http://localhost:3000` in browser window A.
3. Click `项目讨论`.
4. Copy the current channel URL, or click `复制频道链接`.
5. Open the same `/room/project` URL in browser window B.
6. Click `Join Call` in both windows.
7. Confirm the browser asks for microphone permission, not camera permission.
8. In A, click the screen share button.
9. Confirm the browser shows that `localhost:3000` is sharing the screen.
10. Confirm B can see A's shared screen.
11. Stop sharing in A.
12. Confirm B returns to an audio-only placeholder and no console error is thrown.

Channel isolation check:

1. Open `/room/project` in A.
2. Open `/room/game` in B.
3. Join both.
4. Confirm they do not connect to the same voice room.

Late join check:

1. Join the room in A.
2. Start screen sharing in A.
3. Open the same room URL in B.
4. Join in B.
5. Confirm B receives A's current screen share.

## Quality Checks

Run these before submitting changes:

```bash
npm run eslint -- src/views/script.js
npx prettier src/views/script.js src/views/style.css README.md README.en.md --check
```

Also confirm `.env.example` contains `USE_HTTPS=false` and `PORT=3000`.

## Project Structure

```text
src/
  server.js
  utils/
    iceServers.js
    Log.js
    LogMemoryUsage.js
  views/
    room/
      index.ejs
    script.js
    style.css
logs/
package.json
README.md
README.en.md
```

## Notes

- WebRTC uses the ICE servers configured in `src/utils/iceServers.js`.
- TURN servers may be needed for production networks with strict NAT or firewall rules.
- HTTPS can be enabled with `USE_HTTPS=true` and certificates at `cert/selfsigned.crt` and `cert/selfsigned.key`.

## License

ISC

## Credits

This project is based on:

- nlukic97/WebRTC-video-chat, licensed under the MIT License.
- nlukic97/WebSocket-Cursor-Room, licensed under the ISC License.
