# View JS Modules

## Loading order

The room template loads the local Socket.IO and PeerJS clients, followed by the active screen-sharing client, the room runtime bundle, and `script.js`. [Room template](../src/views/room/index.ejs)

The [boot script list](../src/views/js/room/boot-scripts.json) defines the module order. [RoomAssets](../src/utils/RoomAssets.js) assembles the scripts and styles for the server. It uses minified copies when both the source and output hashes match. `npm run build:web` regenerates those copies and their manifest.

## Ownership

| Area | Owner |
| --- | --- |
| Room setup | `src/views/script.js` wires components, Socket.IO, PeerJS, local tracks and room-level events. |
| Stage and navigation | `room/stage-layout-runtime.js` owns the responsive stage, member grid, share focus, and compact navigation. |
| Chat | `chat/chat-panel-runtime.js` owns the form, message list, and deduplication. `chat/chat-socket-transport.js` adapts the room socket. |
| Channels and members | `sidebar/sidebar-runtime.js` owns the channel tree and presence display. `sidebar/sidebar-socket-transport.js` binds the room socket. |
| Media controls | `media/media-dock-runtime.js` owns the microphone, camera, sharing and output controls. The adapter passes commands and state between the Dock and the room. |
| Fullscreen and preview | `media/fullscreen-controls.js` and `media/local-screen-share-preview-controller.js` own tile fullscreen and local preview behaviour. |
| Voice transport | `voice/voice-session-runtime.js` tracks local and server session state. `voice/voice-peer-registry.js` owns PeerJS calls, pending incoming calls and remote media. |
| Screen sharing | `voice/voice-screen-sfu-runtime.js` manages legacy SFU routing. The Piik bundle supplies its own screen-media runtime. |
| Diagnostics | `voice/voice-call-diagnostics.js`, `voice/voice-share-diagnostics.js` and `voice/voice-media-quality-runtime.js` own recording, sampling and export. |

Shared helpers live in `shared/`. A new browser script that publishes a global must be listed before its first consumer in the boot script list. Entry points and dependency order are checked by the [room asset tests](../tests/room_assets_test.mjs). The [stage browser test](../scripts/test-stage-browser.mjs) exercises the assembled page with loopback networking and synthetic audio and video.
