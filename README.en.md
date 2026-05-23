<p align="right"><a href="./README.md">中文</a> | English</p>

# Friends Channel Voice Rooms

A fixed-channel voice room web app for friends, with voice chat, screen sharing, channel chat, and full-page shared cursors.

## Features

- Fixed channels: the homepage lists preset channels, and `/room/{channel}` opens the selected room.
- Voice calls: `Join Call` requests microphone access only and does not request the camera by default.
- Manual camera: camera video is off by default and starts only when the camera button is clicked.
- Screen sharing: users can share their screen inside a channel.
- Fullscreen viewing: remote video and screen-share tiles can be opened fullscreen.
- Audio processing: microphone capture requests `echoCancellation`, `noiseSuppression`, and `autoGainControl`; local microphone audio is not played back locally.
- Channel text chat: realtime chat is broadcast only within the current channel.
- Temporary in-memory history: the server keeps the latest 50 chat messages per channel and clears them on restart.
- Full-page shared cursors: users in the same channel can see each other's mouse position even before joining voice.
- Channel isolation: voice, chat, and shared cursors are isolated between channels.

## Local Setup

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

If Windows PowerShell blocks `npm` / `npx` because of execution policy, use:

```bash
npm.cmd start
npm.cmd run eslint
npx.cmd prettier src/server.js src/views/script.js src/views/style.css README.md README.en.md --check
```

## Environment Variables

Common local HTTP development values:

```env
PORT=3000
USE_HTTPS=false
```

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

## Usage

1. Open `http://localhost:3000`.
2. Choose a channel.
3. After entering the channel, you can immediately see other users' cursors in the same channel.
4. Click `Join Call` to join voice.
5. Use microphone mute, camera, screen sharing, text chat, and fullscreen viewing as needed.
6. Use the copy channel link button to share the current channel URL with friends.

## Current Channels

- `lobby`: Lobby
- `game`: Game voice chat
- `project`: Project discussion
- `screen`: Watch a screen together
- `idle`: Idle hangout

## Testing Tips

- Use Chrome + Edge in the same channel to test two-window behavior.
- Share a screen in one window and watch it from the other, including fullscreen viewing.
- Test chat and shared cursors inside the same channel.
- Open different channels and confirm voice, chat, and cursors are isolated.
- Voice testing on one computer can cause echo; mute one window or use headphones.

## Tech Stack

- Node.js
- Express
- Socket.IO
- PeerJS
- WebRTC
- EJS
- Vanilla JavaScript / CSS

## Credits

- Based on `nlukic97/WebRTC-video-chat`.
- Full-page shared cursors were inspired by `nlukic97/WebSocket-Cursor-Room`.

## License

ISC
