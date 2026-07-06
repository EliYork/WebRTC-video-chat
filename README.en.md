<p align="right"><a href="./README.md">中文</a> | English</p>

# Friends Channel Voice Rooms

A self-hosted fixed-channel voice room web app for friends.

It is less like a traditional meeting product and more like a customizable voice desktop: channels on the left, chat on the right, and movable voice windows in the middle. It supports voice chat, screen sharing, channel text chat, full-page shared cursors, and a page-level customizable layout.

## Features

- Fixed channels: the homepage opens the lobby by default, and the left channel tree switches between `/room/{channel}` rooms.
- Voice calls: users can join the current channel voice room from the channel UI.
- Microphone-first join: joining voice requests microphone access only and does not request the camera by default.
- Manual camera: camera video is off by default and starts only when the camera button is clicked.
- Screen sharing: users can share their screen inside a channel.
- Fullscreen viewing: remote video and screen-share tiles can be opened fullscreen.
- Channel text chat: realtime chat is broadcast only within the current channel.
- Temporary in-memory history: the server keeps the latest 50 chat messages per channel and clears them on restart.
- Full-page shared cursors: users in the same channel can see each other's mouse position even before joining voice.
- Channel isolation: voice, chat, and shared cursors are isolated between channels.
- Audio processing: microphone capture requests `echoCancellation`, `noiseSuppression`, and `autoGainControl`; local microphone audio is not played back locally.
- Page-level customizable layout: the sidebar, chat panel, and voice windows can be moved, resized, hidden, and restored.
- Grid-snapped layout: moved or resized components snap to the page grid and are saved in browser `localStorage`.
- Free movement: components are movable and resizable by default in normal mode; this can be disabled per component.
- Automatic voice window placement: local and remote voice windows try to appear in free space and avoid existing panels/windows.

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

## Deployment Notes

For production HTTPS, let Nginx or your hosting panel terminate TLS while Node keeps `USE_HTTPS=false` and listens on `PORT=3000`.

PeerJS is mounted on the same Express service at `/peerjs`, so the page, Socket.IO, and PeerJS all use the same origin. Nginx only needs to proxy to `127.0.0.1:3000` and preserve WebSocket Upgrade headers for Socket.IO / PeerJS.

For production use, consider adding a TURN server to improve connection reliability on restrictive NATs, office networks, or campus networks.

## Usage

1. Open `http://localhost:3000`; it enters the lobby by default.
2. Use the left channel tree to switch channels.
3. After entering the channel, you can immediately see other users' cursors in the same channel.
4. Double-click a sidebar channel or use the voice control to join voice.
5. Use microphone mute, camera, screen sharing, text chat, and fullscreen viewing as needed.
6. Use the copy channel link button to share the current channel URL with friends.
7. Click "Edit layout" to customize page components. Moved/resized layouts are saved in the current browser.

## Current Channels

- `lobby`: Lobby
- `game`: Game voice chat
- `project`: Project discussion
- `screen`: Watch a screen together
- `idle`: Idle hangout

## Layout Notes

The page uses a browser-local page-level layout system:

- `sidebarPanel`: channel list and local user/status controls.
- `chatPanel`: channel chat panel.
- `localPeer`: local voice/video window.
- `remotePeer`: remote participant voice/video window.
- `screenShare`: screen sharing window.

Layouts are saved in the current browser's `localStorage`. If browser data is cleared or the app is opened on another device, the layout needs to be adjusted again.

## Testing Tips

- Use Chrome + Edge in the same channel to test two-window behavior.
- Share a screen in one window and watch it from the other, including fullscreen viewing.
- Test chat and shared cursors inside the same channel.
- Open different channels and confirm voice, chat, and cursors are isolated.
- Voice testing on one computer can cause echo; mute one window or use headphones.
- Test the page layout by moving/resizing the sidebar, chat panel, and voice windows, then refresh and confirm the layout is preserved.

## Tech Stack

- Node.js
- Express
- Socket.IO
- PeerJS
- WebRTC
- EJS
- Vanilla JavaScript / CSS
- Web Audio API

## Project Status and Roadmap

This project is currently a lightweight self-hosted voice room for friends, not a full meeting system with accounts, permissions, and persistent user data.

Planned directions:

- Account system and user identity.
- More fine-grained layout components, such as separate chat input, user status card, and room info card.
- Layout presets, import/export, and cross-device sync after the account system exists.
- Better permissions, room management, and mobile experience.
- TURN server setup and more production stability improvements.

## Special Thanks / Credits

This project learned from and referenced the following open-source projects. Many thanks to their authors:

| Project | What it helped with | License |
|---|---|---|
| [nlukic97/WebRTC-video-chat](https://github.com/nlukic97/WebRTC-video-chat) | Video calls, WebRTC / PeerJS, and screen sharing ideas | ISC |
| [nlukic97/WebSocket-Cursor-Room](https://github.com/nlukic97/WebSocket-Cursor-Room) | Multi-user cursor position sync / shared cursor ideas | MIT |
| [sapphi-red/web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor) | Web Audio API noise suppression nodes and noise reduction references | MIT |

The projects above remain owned by their original authors and follow their own repository licenses. This project's license is listed below.

## License

ISC
