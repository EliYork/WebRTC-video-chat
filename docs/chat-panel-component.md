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
