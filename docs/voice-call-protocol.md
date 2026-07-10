# Voice Call Protocol And Peer Registry

Voice media uses one PeerJS `MediaConnection` per participant pair. The server
assigns the caller direction; DOM tiles, presence entries, and
`peer.connections` are not connection-ownership signals.

## Initial join

1. After PeerJS `open`, the client binds voice socket handlers and emits
   `voice:join` with its room and PeerJS id.
2. The server validates the fixed channel, records `voiceRoomId` and
   `voicePeerId` on `socket.data`, and serializes joins in that voice room.
3. Only the joining socket receives `voice:call-targets`, containing peers that
   were already in the room.
4. The joining client calls each target once. Existing clients never dial the
   new peer; they only answer the incoming call.

For sequential joins, B calls A, and C calls A plus B. This produces three
calls for A/B/C rather than six.

## Protocol and registry boundary

`voice-call-protocol.js` owns the refresh metadata constants and the
per-peer revision gate. It does not store active calls.

`voice-peer-registry.js` is the sole owner of remote real-time resources. Each
peer entry contains the current call identity and direction, lifecycle state,
refresh key/generation, replacement call state, composed remote stream,
participant tile, call listeners, stream/track listeners, and cleanup
generation. Presence remains a separate statement that a member belongs to a
voice room; it can ask the registry to ensure a tile or fully clean up a peer,
but it never owns a `MediaConnection`.

The registry states are `idle`, `pending-outgoing`, `pending-incoming`,
`replacing`, `active`, `closing`, and `closed`. Sender lookup and track
replacement use only the current registry call and never traverse PeerJS
internal connection collections.

## Media refresh and replacement

When local track composition changes, the original caller remains the caller.
The new call becomes the registry's current identity while the previous call,
stream, and tile are retained. Events from the previous call cannot overwrite
or clean the current entry. When the new stream arrives, the registry updates
the existing composed stream and tile, then unbinds and closes the previous
call. If creation throws, returns no call, or the replacement errors before a
stream arrives, the previous call remains current and the refresh revision is
released for retry.

## Cleanup

`cleanupPeer(peerId, reason)` is idempotent. It unbinds call and media
listeners, detaches the tile's `srcObject`, closes owned current/replacement
calls at most once, removes the tile, clears stream references, and deletes the
entry. `teardown(reason)` applies the same operation to every peer for local
leave, PeerJS close/error, Socket.IO disconnect, and page teardown.

A single ended audio or video track is removed from the composed stream while
other live tracks and the tile remain. All tracks ending, or the stream becoming
inactive, performs full peer cleanup. PeerJS `disconnected` only marks the
signaling session unavailable and blocks new calls; it does not claim that
remote presence ended or immediately destroy established media.

## Server owner boundary

Voice join, refresh, active leave (`voicePeerLeft`), and disconnect cleanup use
`socket.data.voiceRoomId` and `socket.data.voicePeerId`. Leave clears that owner
state before broadcasting, so active leave plus disconnect is idempotent and a
client payload cannot select another peer. Screen-share events still accept a
client room id and remain in the trust-boundary backlog.

## Deliberate boundary

This layer does not implement automatic PeerJS or Socket.IO reconnect, retry,
or backoff. Real-browser WebRTC timing, temporary PeerServer disconnect
behavior, and permission failures still require manual validation and later
repair work.
