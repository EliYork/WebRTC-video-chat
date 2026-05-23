# WebRTC Voice and Screen Share

A small self-hosted WebRTC room app built with Node.js, Express, PeerJS, Socket.IO, EJS, and vanilla JavaScript.

The current baseline is a voice-first room:

- Join Call requests microphone access only.
- Camera video is optional and starts only after the camera button is clicked.
- Screen sharing can be sent even when no camera video track exists.
- Each room is a unique URL that can be shared with another browser window or user.

## Current Features

- Unique room URLs from the homepage redirect.
- Audio-only room join by default.
- Microphone mute and unmute.
- Optional camera toggle.
- Screen sharing to connected peers.
- Screen sharing for peers that do not already have a video sender.
- Late join support when another peer is already sharing a screen.
- Audio-only placeholder tiles when a remote peer has no video track.
- Basic server logging to `logs/node.log`.

No login system or external AI integration is included in this baseline.

## Media Logic

The frontend media flow is intentionally simple:

- `Join Call` calls `getUserMedia({ audio: true })`.
- The local stream always starts as audio-only.
- The camera button calls `getUserMedia({ video: true, audio: false })` only when the user asks to turn the camera on.
- If camera startup fails, the call stays connected and the error is logged with `console.warn`.
- Screen sharing calls `getDisplayMedia()` and uses the returned screen video track as the active video track.
- For each connected peer, screen sharing first looks for an existing video sender with `sender.track?.kind === 'video'`.
- If a video sender exists, the app uses `replaceTrack(screenTrack)`.
- If no video sender exists, the app starts a small additional PeerJS media call carrying the screen video track.
- When a new peer joins, the app calls them with the current active stream, so an already-active screen share can be received by the late joiner.
- When screen sharing stops, the app restores the camera track if the camera is on; otherwise it returns peers to audio-only state.

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

The app redirects to a unique room URL.

## Two-Window Test

1. Start the server with `npm start`.
2. Open `http://localhost:3000` in browser window A.
3. Copy the redirected room URL.
4. Open the same room URL in browser window B.
5. Click `Join Call` in both windows.
6. Confirm the browser asks for microphone permission, not camera permission.
7. In A, click the screen share button.
8. Confirm the browser shows that `localhost:3000` is sharing the screen.
9. Confirm B can see A's shared screen.
10. Stop sharing in A.
11. Confirm B returns to an audio-only placeholder and no console error is thrown.

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
npx prettier src/views/script.js src/views/style.css README.md --check
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