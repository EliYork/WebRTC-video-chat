# Sidebar Component

## DOM ownership

`VoiceSidebarRuntime` is the single owner of the existing
`#channel-sidebar.sidebar-channel-tree` node rendered by
`src/views/room/index.ejs`. The current physical `.room-sidebar` also contains
the brand and Media Dock, while page-layout bootstrap moves the real channel
tree, brand, and Media Dock independently. The formal Sidebar business root is
therefore the channel tree, not the outer shell.

During `init()` the runtime validates each fixed `[data-channel-room]` and
caches its existing link, count badge, and member list. It never clones,
replaces, or reconstructs the root and does not depend on a fixed parent. Layout
normal/edit moves and recovery retain the same root, links, member lists,
listeners, active state, and focus targets. Dynamic member rows are the only
business nodes the component creates; `destroy()` removes them without deleting
the EJS root or a layout wrapper.

## Viewing and voice state

The runtime independently owns:

- current viewing room;
- current joined voice room;
- current voice target room;
- active/voice/target/member classes and `aria-current`;
- connection state and room navigation revision.

Room ids are accepted only when they exist in the fixed EJS channel set. A
channel click emits `onRequestViewRoom(roomId)` and waits for an accepted result;
only the newest pending request may become active. Repeated clicks on the
current viewing room are idempotent. Browser history calls the public
`setViewingRoom()` API. Viewing a room does not mutate the voice room, and a
double click emits the separate `onRequestVoiceRoom(roomId)` callback.

The runtime does not call Socket.IO join/leave, update Chat Panel internals,
rebuild Stage, or decide voice-session policy. `script.js` remains the
composition owner that updates URL/view-chat lifecycle and then confirms state
through the Sidebar and Chat Panel public APIs.

## Presence boundary

`VoiceSidebarSocketTransport` subscribes to the existing `presence:state`
protocol and Socket connection events through an injected `getSocket()`. It
does not create or disconnect the Socket, and every listener has an exact
unsubscribe.

The runtime normalizes snapshots to the fixed room list and whitelists member
identity plus mic/camera/screen booleans. Members are deduplicated by socket id;
missing members disappear on the next snapshot, peer-id replacement cannot
leave a ghost row, and identical reconnect snapshots skip DOM work. Names and
status labels use the existing text-only renderers. Large member lists use a
`DocumentFragment` batch.

The same snapshot is forwarded through `onPresenceSnapshot()` so `script.js`
can retain voice-session epoch checks, peer presence maps, screen-sharer state,
tile reconciliation, and media diagnostics. Sidebar never becomes the call,
stream, peer, or video-tile owner.

## Copy, layout, and mobile boundaries

The runtime supports optional `[data-sidebar-copy-room]` controls through
`getRoomUrl()` and `onCopyRoomLink()`. No such control currently exists inside
the channel tree, so this componentization does not add or redesign one. The
existing Media Dock copy button remains Media Dock composition and is untouched.

Sidebar does not read/write the layout store or own drag, resize, z-index,
visibility, breakpoints, or mobile navigation. Mobile code may use
`getRootElement()` or `focusRoom()` but must not query member rows. No mobile
product behavior changed in this task.

## Lifecycle

`init()` validates all required DOM before subscribing, binds one delegated
click and double-click listener, subscribes once, initializes view/voice and
connection state, and is idempotent. Subscription failure rolls back without a
half-initialized component.

`destroy()` is idempotent. It invalidates pending navigation, removes delegated
listeners, unsubscribes presence/connection callbacks, clears component-created
member rows, and rejects re-initialization. Late presence or navigation results
cannot write the DOM.
