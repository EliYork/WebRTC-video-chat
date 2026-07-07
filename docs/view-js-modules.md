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
6. `/js/output-volume-state.js`
7. `/js/output-volume-ui.js`
8. `/js/media-controls-ui.js`
9. `/js/fullscreen-controls.js`
10. `/js/voice-join-overlay-ui.js`
11. `/js/page-layout-snap-utils.js`
12. `/js/page-layout-resize-utils.js`
13. `/js/page-layout-edit-ui.js`
14. `/js/page-layout-component-actions-ui.js`
15. `/js/page-layout-storage.js`
16. `/js/page-layout-config.js`
17. `/js/page-layout-ids.js`
18. `/js/page-layout-components.js`
19. `/js/page-layout-toolbar-ui.js`
20. `/js/page-layout-component-menu-ui.js`
21. `/js/page-layout-recovery-ui.js`
22. `/js/room-ui-state.js`
23. `/js/mobile-room-state.js`
24. `/js/presence-view-model.js`
25. `/js/participants-list-ui.js`
26. `/js/tile-status-ui.js`
27. `/js/video-tile-structure-ui.js`
28. `/js/chat-message-ui.js`
29. `/js/chat-form-ui.js`
30. `/js/channel-sidebar-ui.js`
31. `/js/cursor-share-ui.js`
32. `/script.js`

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

`output-volume-state.js` owns remote peer volume storage, volume clamping, and
effective output volume calculation. It must not write media element volume or
muted state directly.

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

`page-layout-resize-utils.js` owns pure resize hit testing and resize layout
math. It must not read DOM bounds, bind pointer events, write storage, or apply
snap previews.

`page-layout-edit-ui.js` owns visual editing helpers: snap preview, resize
cursor state, hover classes, and shared toolbar positioning helpers. It must not
toggle edit mode, finalize layout interactions, or persist layout data.

`page-layout-component-actions-ui.js` owns layout component floating action
toolbar DOM, selected tile class rendering, toolbar visibility, free-move button
state, and related aria/title text. It receives callbacks from `script.js` for
hide/free-move behavior and must not own storage, sockets, PeerJS, media, or
drag/resize pointer lifecycles.

`page-layout-storage.js` owns page-layout storage key construction, payload
normalization, load/save/clear, and malformed-storage fallback. Its storage key,
payload shape, item fields, and normalize/load/save/clear semantics are part of
the contract.

`page-layout-config.js` owns pure page-layout constants, default component
configuration, default layout preferences, and normalization helpers. It must
not read or write DOM, storage, socket, PeerJS, or media state.

`page-layout-ids.js` owns pure page-layout id helpers: id-part sanitizing,
remote layout keys, remote item ids, legacy remote aliases, remote id
normalization, and alias list expansion. It receives room, member, and peer
state from `script.js` and must not read DOM, storage, sockets, PeerJS, or media
state.

`page-layout-components.js` owns page-layout component default items, component
id mapping, display-state mapping, and display-only DOM rendering for
component tiles. It receives live state and callbacks from `script.js` and must
not own storage hydration, add/hide/reset actions, drag/resize lifecycles,
socket, PeerJS, or media flows.

`page-layout-toolbar-ui.js` owns the layout edit toolbar DOM, edit/add/reset
button visual state, save status text, and reset confirmation text. It must not
clear storage, apply layouts, or decide edit-mode transitions.

`page-layout-component-menu-ui.js` owns layout component menu rendering,
closing, and expanded state. It receives menu items and callbacks from
`script.js`; it must not decide which component types are allowed or add
components directly.

`page-layout-recovery-ui.js` owns the layout recovery toolbar DOM, toolbar
visibility, and debug table printing. It must not clear storage, reload the
page, restore the static layout, or initialize/validate the layout board.

`room-ui-state.js` owns room header, local user card, call timer, and mobile
tile nav rendering. It should receive state snapshots from `script.js` rather
than reading live socket or media state.

`mobile-room-state.js` owns mobile tile ordering, active tile index, mobile room
class sync, and previous/next tile navigation. It receives live room/media
ordering state from `script.js` and must not own voice join/leave, socket,
PeerJS, or media-device flows.

`presence-view-model.js` is a pure mapper from member/presence state to view
models: mic status, tile text, status icons, and participant list data. It must
not touch the DOM, storage, sockets, PeerJS, or media streams.

`participants-list-ui.js` owns participant list DOM rendering and item class
sync. It should consume view models rather than deciding room, socket, or media
state.

`tile-status-ui.js` owns tile status text, badges, placeholders, and CSS class
sync. It must not attach streams or add/remove media tracks.

`video-tile-structure-ui.js` owns video tile DOM structure creation: header,
body, overlay, actions, footer, avatar text, and resize handle elements. It must
not bind pointer events or read/write layout storage.

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
