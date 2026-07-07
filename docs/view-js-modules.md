# View JS Modules

This document records the current responsibility boundaries for
`src/views/js/*.js`. Keep it in sync when a new module is added or when a
module boundary changes.

## Loading Order

`src/views/room/index.ejs` currently loads these browser scripts before
`/script.js`:

1. `/js/view-utils.js`
2. `/js/noise-settings-ui.js`
3. `/js/control-popovers-ui.js`
4. `/js/peer-volume-ui.js`
5. `/js/copy-link-ui.js`
6. `/js/output-volume-ui.js`
7. `/js/fullscreen-controls.js`
8. `/js/voice-join-overlay-ui.js`
9. `/js/page-layout-snap-utils.js`
10. `/js/page-layout-edit-ui.js`
11. `/js/page-layout-storage.js`
12. `/js/room-ui-state.js`
13. `/js/presence-view-model.js`
14. `/js/participants-list-ui.js`
15. `/js/tile-status-ui.js`
16. `/js/chat-message-ui.js`
17. `/js/channel-sidebar-ui.js`
18. `/js/cursor-share-ui.js`
19. `/script.js`

Modules that use `window.VoiceViewUtils` must load after `view-utils.js` and
before `/script.js`.

## Module Boundaries

`view-utils.js` exposes shared DOM and small persistence utilities. It should
stay generic and avoid room, media, socket, PeerJS, or page-layout business
decisions.

`noise-settings-ui.js` owns the noise suppression settings UI: stored UI
preferences, labels, notices, and controls for configuring suppression. It must
not own media pipeline creation.

`control-popovers-ui.js` owns generic control popover open/close behavior and
positioning. It must not emit socket events or mutate media streams.

`peer-volume-ui.js` exposes `VoiceRemoteVolumeUI` and owns remote peer volume
popover rendering, slider display, and per-peer UI sync. It must not apply
output-device settings or touch media tracks directly.

`copy-link-ui.js` owns invite/copy button feedback, clipboard writes, icon/text
state, and timers. It must not own room routing or socket state.

`output-volume-ui.js` owns output volume control UI, selected output state
display, and output menu rendering. It must not apply output settings to remote
media elements.

`fullscreen-controls.js` owns fullscreen button creation, labels, icon state,
and browser fullscreen event binding. It must not own layout persistence or
tile resize logic.

`voice-join-overlay-ui.js` owns the join-voice overlay DOM, visibility, labels,
and overlay keyboard dismissal. It must call back to `script.js` for room and
voice decisions.

`page-layout-snap-utils.js` owns pure page-layout geometry helpers: snap,
clamp, bounds, resize direction, and grid math. It must not bind pointer events
or read/write storage.

`page-layout-edit-ui.js` owns visual editing helpers: snap preview, resize
cursor state, hover classes, and floating toolbar DOM. It must not toggle edit
mode, finalize layout interactions, or persist layout data.

`page-layout-storage.js` owns page-layout storage key construction, payload
normalization, load/save/clear, and malformed-storage fallback. Its storage key,
payload shape, item fields, and normalize/load/save/clear semantics are part of
the contract.

`room-ui-state.js` owns room header, local user card, call timer, and mobile
tile nav rendering. It should receive state snapshots from `script.js` rather
than reading live socket or media state.

`presence-view-model.js` is a pure mapper from member/presence state to view
models: mic status, tile text, status icons, and participant list data. It must
not touch the DOM, storage, sockets, PeerJS, or media streams.

`participants-list-ui.js` owns participant list DOM rendering and item class
sync. It should consume view models rather than deciding room, socket, or media
state.

`tile-status-ui.js` owns tile status text, badges, placeholders, and CSS class
sync. It must not attach streams or add/remove media tracks.

`chat-message-ui.js` owns chat message DOM creation, history rendering, append
behavior, and scroll-to-bottom UI sync. It must not own `chat:send`,
`chat:message`, or `chat:history` socket flow.

`channel-sidebar-ui.js` owns channel list item rendering, active-channel
classes, and related aria state. It must not decide viewing room, voice target
room, or overlay behavior.

`cursor-share-ui.js` owns cursor overlay creation, remote cursor rendering,
idle state, and removal. It must not emit or listen for cursor socket events.

## Main Flow Still Owned By `script.js`

These high-risk flows remain in `src/views/script.js` unless a later phase
explicitly opens a new boundary and adds tests first:

- WebRTC, PeerJS, socket, and stream lifecycles.
- `requestAudioStream()`, `createAudioPipeline()`,
  `setupCallStreamHandler()`, and `joinVoiceChannel()`.
- Page layout rendering, resize/drag orchestration, restore/migration, and
  storage migration.
- Chat socket flow, including message payload decisions and history handling.
- Screen-share and cursor-share network flow.
- Output-device application to remote media.

## Adding New Modules

New modules should follow these rules:

- `script.js` provides the live state, view model, and callbacks.
- Modules own either pure UI rendering or pure mapping logic.
- Modules must not secretly read or write global business state.
- Modules that need app behavior must call an explicit callback back into
  `script.js`.
- Modules that use `VoiceViewUtils` must load after `view-utils.js`.
- Each new module must update `tests/page_layout_contract_test.mjs` with load
  order, namespace, required exports, and forbidden keyword contracts.
