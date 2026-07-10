# View JS Modules

This document records the current responsibility boundaries for
`src/views/js/**/*.js`. Keep it in sync when a module moves, a new module is
added, or a module boundary changes.

The view modules are now grouped by feature domain:

- `shared/`: generic helpers and reusable UI helpers.
- `layout/`: page-layout data, geometry, editor, toolbar, and component UI.
- `chat/`: chat name, form, and message UI helpers.
- `media/`: voice/media control UI, output volume, fullscreen, noise, and join
  overlay helpers.
- `room/`: room, participant, channel, presence, tile, and cursor UI helpers.

This grouping is directory organization only. It does not change behavior,
window namespaces, module exports, or the ownership boundaries below.

## Loading Order

`src/views/room/index.ejs` currently loads these browser scripts before
`/script.js`:

1. `/js/shared/view-utils.js`
2. `/js/chat/chat-name-state.js`
3. `/js/media/noise-settings-ui.js`
4. `/js/shared/control-popovers-ui.js`
5. `/js/media/peer-volume-ui.js`
6. `/js/shared/copy-link-ui.js`
7. `/js/media/output-volume-state.js`
8. `/js/media/output-volume-ui.js`
9. `/js/media/media-controls-ui.js`
10. `/js/media/fullscreen-controls.js`
11. `/js/media/voice-join-overlay-ui.js`
12. `/js/layout/page-layout-snap-utils.js`
13. `/js/layout/page-layout-resize-utils.js`
14. `/js/layout/page-layout-edit-ui.js`
15. `/js/layout/page-layout-component-actions-ui.js`
16. `/js/layout/page-layout-storage.js`
17. `/js/layout/page-layout-config.js`
18. `/js/layout/page-layout-ids.js`
19. `/js/layout/page-layout-placement-utils.js`
20. `/js/layout/page-layout-components.js`
21. `/js/layout/page-layout-toolbar-ui.js`
22. `/js/layout/page-layout-component-menu-ui.js`
23. `/js/layout/page-layout-recovery-ui.js`
24. `/js/layout/page-layout-runtime.js`
25. `/js/layout/page-layout-editor-runtime.js`
26. `/js/layout/page-layout-component-runtime.js`
27. `/js/layout/page-layout-store-runtime.js`
28. `/js/room/room-ui-state.js`
29. `/js/room/mobile-room-state.js`
30. `/js/room/presence-view-model.js`
31. `/js/room/participants-list-ui.js`
32. `/js/room/tile-status-ui.js`
33. `/js/room/video-tile-structure-ui.js`
34. `/js/chat/chat-message-ui.js`
35. `/js/chat/chat-form-ui.js`
36. `/js/room/channel-sidebar-ui.js`
37. `/js/room/cursor-share-ui.js`
38. `/js/voice/voice-call-protocol.js`
39. `/js/voice/voice-peer-registry.js`
40. `/script.js`

Modules that use `window.VoiceViewUtils` must load after
`/js/shared/view-utils.js` and before `/script.js`. All view modules must load
before `/script.js`.

## Shared

`shared/view-utils.js` exposes shared DOM and small persistence utilities. It
should stay generic and avoid room, media, socket, PeerJS, or page-layout
business decisions.

`shared/control-popovers-ui.js` owns generic control popover open/close
behavior and positioning. It must not emit socket events or mutate media
streams.

`shared/copy-link-ui.js` owns invite/copy button feedback, clipboard writes,
icon/text state, and timers. It must not own room routing or socket state.

## Layout

`layout/page-layout-snap-utils.js` owns pure page-layout geometry helpers:
snap, clamp, bounds, resize direction, and grid math. It must not bind pointer
events or read/write storage.

`layout/page-layout-resize-utils.js` owns pure resize hit testing and resize
layout math. It must not read DOM bounds, bind pointer events, write storage,
or apply snap previews.

`layout/page-layout-edit-ui.js` owns visual editing helpers: snap preview,
resize cursor state, hover classes, and shared toolbar positioning helpers. It
must not toggle edit mode, finalize layout interactions, or persist layout
data.

`layout/page-layout-component-actions-ui.js` owns layout component floating
action toolbar DOM, selected tile class rendering, toolbar visibility,
free-move button state, and related aria/title text. It receives callbacks
from `script.js` for hide/free-move behavior and must not own storage, sockets,
PeerJS, media, or drag/resize pointer lifecycles.

`layout/page-layout-storage.js` owns page-layout storage key construction,
payload normalization, load/save/clear, and malformed-storage fallback. Its
storage key, payload shape, item fields, and normalize/load/save/clear
semantics are part of the contract.

`layout/page-layout-config.js` owns pure page-layout constants, default
component configuration, default layout preferences, and normalization helpers.
It must not read or write DOM, storage, socket, PeerJS, or media state.

`layout/page-layout-ids.js` owns pure page-layout id helpers: id-part
sanitizing, remote layout keys, remote item ids, legacy remote aliases, remote
id normalization, and alias list expansion. It receives room, member, and peer
state from `script.js` and must not read DOM, storage, sockets, PeerJS, or
media state.

`layout/page-layout-placement-utils.js` owns pure page-layout auto-placement
calculation: auto-placed type checks, default grid sizes, abnormal auto-grid
normalization, fallback layouts, grid bounds, overlap scoring, slot scoring,
and first-best available slot search. It receives grid constants,
clamp/convert helpers, and occupied rects from `script.js`; it must not inspect
DOM, storage, sockets, PeerJS, or media state.

`layout/page-layout-components.js` owns page-layout component default items,
component id mapping, display-state mapping, and display-only DOM rendering for
component tiles. It receives live state and callbacks from `script.js` and must
not own storage hydration, add/hide/reset actions, drag/resize lifecycles,
socket, PeerJS, or media flows.

`layout/page-layout-toolbar-ui.js` owns the layout edit toolbar DOM,
edit/add/reset button visual state, save status text, and reset confirmation
text. It must not clear storage, apply layouts, or decide edit-mode
transitions.

`layout/page-layout-component-menu-ui.js` owns layout component menu rendering,
closing, and expanded state. It receives menu items and callbacks from
`script.js`; it must not decide which component types are allowed or add
components directly.

`layout/page-layout-recovery-ui.js` owns the layout recovery toolbar DOM,
toolbar visibility, and debug table printing. It must not clear storage,
reload the page, restore the static layout, or initialize/validate the layout
board.

`layout/page-layout-runtime.js` owns the page-layout runtime boot path:
page-layout board creation, real DOM panel migration into the board, detached
board validation, default page-layout ensure, broken-board detection, recovery
toolbar wiring, original-node position capture, identity-preserving static
restore, and `window.__voiceLayoutDebug`. Recovery must move the original
sidebar, member tree, media dock, chat panel, and video grid back to their
recorded parents; it must not clone or rebuild those business nodes. Normal
recovery leaves a stable non-layout page, while explicit debug reset may reuse
the restored nodes for one guarded layout initialization attempt.
It receives DOM refs, storage/layout callbacks, toolbar hooks, and layout
helpers from `script.js`; it must not own WebRTC, media, socket, PeerJS, chat
socket flow, tile drag/resize lifecycles, or output-volume/media-element
application. This move is a large runtime migration, not a test closeout.

`layout/page-layout-editor-runtime.js` owns the page-layout editor runtime UI
glue: topbar creation and event binding, edit-mode button state sync,
component menu rendering/open/close, reset-default confirmation flow, save
status display, edit-mode enter/exit UI orchestration, selected component
toolbar state, and batch component-toolbar ensure. It receives DOM refs,
state getters/setters, and business callbacks from `script.js`; it must not
own layout storage writes, default-layout application, drag/resize lifecycles,
WebRTC, media, socket, PeerJS, or chat socket flow. This move is a large
runtime migration, not a test closeout.

`layout/page-layout-component-runtime.js` owns page-layout component lifecycle
orchestration: restoring/showing existing real DOM page panels, hiding
components, applying the default layout, applying saved layout items to
existing tiles, applying page-panel layout items, initializing layout from
storage with the hydration guard, and refreshing component-menu/mobile tile UI
after lifecycle changes. It receives layout apply/save/storage helpers, DOM
lookup helpers, and UI refresh callbacks from `script.js`; it must not own
`layoutItemsById`, saved item maps, drag/resize lifecycles, WebRTC, media,
socket, PeerJS, or chat socket flow. This move is a large component lifecycle
migration, not a test closeout.

`layout/page-layout-store-runtime.js` owns the page-layout state store:
layout item registry operations, saved layout item cache, layout preferences,
storage hydration state, serialize/normalize adapters, payload build,
load/save/clear orchestration, saved item preference lookup, remote alias
saved-item lookup, and tile item get/upsert/persist/visibility/retire
operations. It receives storage helpers, layout config helpers, geometry
normalizers, storage key access, remote alias resolution, DOM apply callbacks,
and save-status callbacks from `script.js`; it must not own DOM positioning,
drag/resize lifecycles, WebRTC, media, socket, PeerJS, or chat socket flow.
This move is a layout store/runtime migration, not a test closeout.

## Chat

`chat/chat-name-state.js` owns the chat display-name storage key, stored-name
fallback, input normalization, and name persistence. It must not read DOM, send
chat messages, update presence, or own socket flow.

`chat/chat-message-ui.js` owns chat message DOM creation, history rendering,
append behavior, and scroll-to-bottom UI sync. It must not own `chat:send`,
`chat:message`, or `chat:history` socket flow.

`chat/chat-form-ui.js` owns chat form value normalization, submit state,
input state, reset, and focus helpers. It must not send messages or own socket
flow.

## Media

`media/noise-settings-ui.js` owns the noise suppression settings UI: stored UI
preferences, labels, notices, and controls for configuring suppression. It must
not own media pipeline creation.

`media/peer-volume-ui.js` exposes `VoiceRemoteVolumeUI` and owns remote peer
volume popover rendering, slider display, and per-peer UI sync. It must not
apply output-device settings or touch media tracks directly.

`media/output-volume-state.js` owns the remote peer volume storage key, peer
volume storage reads/writes, volume clamping, and effective output volume
calculation. It must not write media element volume or muted state directly.

`media/output-volume-ui.js` owns output volume control UI, selected output
state display, and output menu rendering. It must not apply output settings to
remote media elements.

`media/media-controls-ui.js` owns call controls, mic/camera button rendering,
and leave button rendering. It must not enumerate devices, replace tracks, or
own media pipeline flow.

`media/fullscreen-controls.js` owns fullscreen button creation, labels, icon
state, tile/video fullscreen toggling, and browser fullscreen event binding. It
must not own layout persistence or tile resize logic.

`media/voice-join-overlay-ui.js` owns the join-voice overlay DOM, visibility,
labels, confirm/cancel controls, and overlay keyboard dismissal. It must call
back to `script.js` for room and voice decisions.

## Room

`room/room-ui-state.js` owns room header, local user card, call timer, and
mobile tile nav rendering. It should receive state snapshots from `script.js`
rather than reading live socket or media state.

`room/mobile-room-state.js` owns mobile tile ordering, active tile index,
mobile room class sync, and previous/next tile navigation. It receives live
room/media ordering state from `script.js` and must not own voice join/leave,
socket, PeerJS, or media-device flows.

`room/presence-view-model.js` is a pure mapper from member/presence state to
view models: mic status, tile text, status icons, and participant list data. It
must not touch the DOM, storage, sockets, PeerJS, or media streams.

`room/participants-list-ui.js` owns participant list DOM rendering and item
class sync. It should consume view models rather than deciding room, socket, or
media state.

`room/tile-status-ui.js` owns tile status text, badges, placeholders, and CSS
class sync. It must not attach streams or add/remove media tracks.

`room/video-tile-structure-ui.js` owns video tile DOM structure creation:
header, body, overlay, actions, footer, avatar text, and resize handle
elements. It must not bind pointer events or read/write layout storage.

`room/channel-sidebar-ui.js` owns channel list item rendering, active-channel
classes, and related aria state. It must not decide viewing room, voice target
room, or overlay behavior.

`room/cursor-share-ui.js` owns cursor overlay creation, remote cursor
rendering, idle state, and removal. It must not emit or listen for cursor
socket events.

`voice/voice-call-protocol.js` owns only refresh metadata and revision ordering.
It does not store active calls. `voice/voice-peer-registry.js` is the sole owner
of current/replacement call identity, direction and state, remote stream and
track listeners, participant tile identity, idempotent cleanup, and lookup of
the single sender used for track replacement. Presence and socket event
orchestration remain in `script.js` and call the registry's narrow APIs.

## Main Flow Still Owned By `script.js`

These high-risk flows remain in `src/views/script.js` unless a later phase
explicitly opens a new boundary and adds tests first:

- PeerJS session creation, socket events, and local media capture lifecycles.
- `requestAudioStream()`, `createAudioPipeline()`,
  remote stream composition, call-refresh orchestration, and
  `joinVoiceChannel()`.
- Main page orchestration and page-layout dependency wiring.
- Page layout DOM apply, resize/drag orchestration, and storage migration.
- Chat socket flow, including message payload decisions and history handling.
- Screen-share and cursor-share network flow.
- Output-device application to remote media.

## Adding New Modules

New modules should follow these rules:

- Place the module in the closest feature-domain folder instead of flattening
  it into `src/views/js/`.
- `script.js` provides the live state, view model, and callbacks.
- Modules own either pure UI rendering or pure mapping/state logic.
- Modules must not secretly read or write global business state.
- Modules that need app behavior must call an explicit callback back into
  `script.js`.
- Modules that use `VoiceViewUtils` must load after
  `/js/shared/view-utils.js`.
- New modules normally update `tests/page_layout_contract_test.mjs` with load
  order, namespace, required exports, and forbidden keyword contracts. The
  `page-layout-runtime.js`, `page-layout-editor-runtime.js`, and
  `page-layout-component-runtime.js`, and `page-layout-store-runtime.js`
  migrations intentionally deferred that contract sync because they were large
  runtime moves, not test closeouts.
