# Chat Panel Component

## Ownership

`VoiceChatPanelRuntime` is the only owner of Chat Panel business DOM and UI
state. It receives the existing `#chat-panel` element rendered by
`src/views/room/index.ejs`, validates all required descendants before binding,
and caches these exact nodes:

- `#chatForm`
- `#chatInput`
- the form submit button
- `#chatMessages`
- optional `#chatName`

The runtime never calls `cloneNode()`, never rebuilds the root with
`innerHTML`, and never creates a second Chat Panel. The page-layout runtime may
move the root between normal and edit layouts. Since the runtime keeps direct
references and does not assume a parent or DOM depth, moving and recovering the
root preserves form/input/messages identity, listeners, draft value, and focus.
`destroy()` removes only runtime listeners, transport subscriptions, and the
runtime-created empty/status nodes; it does not remove the EJS root or any
layout wrapper.

## State and lifecycle

The runtime owns `initialized`, `destroyed`, current room id, room revision,
connection state, sending/composition flags, cached refs, rendered stable
message ids, and live messages received while history is loading.

`init()` is idempotent. It resolves and validates required DOM before binding,
initializes the stored display name and form ARIA/button state, binds form/input
and composition listeners once, and installs transport subscriptions.

`setRoom(roomId)` is idempotent for the current room. A real switch advances
the room revision, cancels pending send UI effects, clears the old view into a
loading state, and requests the new room through the transport. Tagged history
or live events for an old room are rejected. A pending send completion also
checks the captured room revision before clearing or focusing the input.

`rejoinCurrentRoom()` is the reconnect path. It advances the revision and asks
the existing lifecycle to restore membership without clearing visible messages
or the draft. The authoritative history then uses the same renderer as live
messages and merges any live event received during history loading. Stable
server message ids are deduplicated; payloads without ids are not given an
invented strong identity.

`destroy()` is idempotent. It removes every owned DOM listener, calls each
transport unsubscribe, invalidates pending callbacks, removes runtime-created
status/empty nodes, and rejects later re-initialization. Late history, live
messages, or send completions cannot write the DOM after destroy.

## Form and rendering boundary

The runtime owns submit, Enter versus Shift+Enter behavior, IME composition,
trim/max-length normalization, blank-message rejection, the sending guard,
button enabled/disabled and `aria-busy`, success reset/focus, and controlled
failure status. Sending is disabled without a room or while chat is connecting,
reconnecting, offline, or failed.

Connection notices take precedence over retained send errors. The runtime
stores explicit send rejection separately from rendered status, so reconnecting
does not hide connection state or discard an unchanged draft's rejection.
Editing input, a new send, or switching rooms clears that send error; storage
warnings remain independent and resume when higher-priority notices clear.

While connected and awaiting the current room history, the same status area
shows a history synchronization notice if no connection, delivery, send, or
storage warning takes precedence. Accepted history clears this notice even
without persistence metadata; an obsolete history response cannot clear it.

Successful send cleanup checks both submitted text and a local draft revision.
Input events and composition start advance that revision, so changing the text
away and back or beginning a new composition prevents an older acknowledgement
from clearing or focusing the current draft. An unchanged draft submitted later
still clears normally; this revision stays local and does not identify messages.

Clearing accepted text does not always restore focus. Automatic focus requires
a visible, focused document and current focus in the input or submit button.
The submit button's native disabled blur may restore input only when no later
focusin event claimed another control. The runtime owns one document focusin
listener and removes it on destroy or failed initialization; explicit
`focusInput()` remains available to user-requested navigation.

`chat-form-ui.js` is a ref-only helper. It does not query global DOM or send
messages. `chat-message-ui.js` is the single message DOM renderer used by both
history and live paths. Nickname and message text are assigned with
`textContent`; history is built in a `DocumentFragment` and appended once.

## Transport and server boundary

`VoiceChatSocketTransport` receives the page-owned Socket through `getSocket()`.
It does not call `io()`, own connection lifetime, or disconnect the transport.
Its interface is limited to:

- `joinRoom(roomId)`
- `sendMessage({ roomId, senderName, content })`
- `subscribeHistory(handler)`
- `subscribeMessage(handler)`
- `subscribeConnectionState(handler)`

The adapter retains the existing `chat:join`, `chat:history`, `chat:send`, and
`chat:message` payload semantics. Because history remains an array on the wire,
join requests are serialized; the adapter associates each response with the
in-flight requested room before delivering it to the runtime. Subscriptions
return exact `off()` cleanup functions.

Server ownership is unchanged. `switchViewChatRoom()` still leaves old
view/chat rooms, and `socket.data.chatRoomId` remains the authorization owner.
The server still stores and returns channel history, assigns stable message ids,
normalizes names/content, and rejects a requested send room that differs from
the socket owner. The component does not turn client `roomId` into an authority
fact.

## Composition, layout, and mobile boundaries

`script.js` creates the transport and runtime, injects the one real root, calls
`setRoom()` when the viewed channel changes, exposes the component display name
to existing presence/cursor composition, calls `rejoinCurrentRoom()` on Socket
connect, and calls `destroy()` from non-BFCache page teardown. It does not query
or mutate Chat Panel internals.

The Chat Panel does not read/write the layout store or own drag, resize,
z-index, recovery, mobile navigation, or viewport state. The current mobile
room controller does not query Chat Panel internals. Any later mobile action
that needs chat focus must call `chatPanelRuntime.focusInput()` rather than
finding `#chatInput` itself.

There must always be exactly one EJS-created Chat Panel business DOM tree.

## Bounded page retention

The message renderer keeps at most 500 message rows and one retention notice.
The runtime keeps at most 1000 recent message IDs and 500 live messages while
waiting for history, then merges history and live messages into the same
500-row window. Clear, room switch, and destroy release the corresponding
business records. This does not change the server's separate 50-message
history or delete stored records; it does not provide a complete archive or
permanent duplicate suppression.

When history overlaps queued live messages, the first shared stable ID locates
the live prefix that precedes the bounded snapshot. The runtime merges that
prefix, the snapshot, and remaining live events, deduplicates IDs with snapshot
content taking precedence, then keeps the latest 500 rows. It preserves stream
order without sorting by timestamps. Without shared IDs it retains history-first
ordering; it cannot infer a complete timeline from disjoint segments.

The renderer owns scroll compensation when trimming: readers keep a surviving
row at the same position inside the list viewport, while readers already at
the bottom follow new messages. CSS disables native scroll anchoring for this
container, and the renderer carries subpixel remainders between corrections.
History refresh uses the same reading intent: if the reader is above the bottom,
a surviving visible message ID anchors the replacement rows to the old viewport
offset. The renderer stores IDs by node in a WeakMap, without adding DOM
attributes. Missing or unidentified anchors fall back to the remaining top;
readers already at the bottom, initial loads, and room switches follow latest.
See [validation and limits](CHAT-RETENTION-2026-10-22.md).

The composition callback for an actual room change also calls the stage's
`resetChatRoom()` to clear its saved panel scroll offset and unread count.
Reopening chat in the new room follows latest; a same-room close and reopen
still restores its reading position. Clearing unread alone does not discard
that position. This keeps the stage's hidden-panel restoration from overriding
the renderer's new-room scroll policy.

For same-room panel restoration, the stage asks the message renderer to capture
a stable message ID and its offset inside the list before hiding it. After the
panel becomes measurable again, the renderer finds the current node with that
ID and restores its offset, including after trimming or history replacement.
The saved record contains only primitives. If the identified message no longer
exists, restoration falls back to the remaining top; an unidentified position
uses its saved scroll offset. The stage clears the record on room change and
destroy. Publish the stage and message-renderer changes together.
