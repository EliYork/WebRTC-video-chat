# Voice Call Protocol

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

## Gate and media refresh

`voice-call-protocol.js` keeps a narrow pending/active entry per remote peer.
Repeated target events return the existing call. `close`, `error`, synchronous
creation failure, an empty `peer.call()` result, and an owned leave signal all
release the entry so a later attempt can proceed.

When the local stream's track composition changes, the original caller remains
the caller. It closes its previous call before creating the replacement. If the
answering side changed media, the server broadcasts `voice:refresh-peer` from
the socket-owned room and peer identity; only clients that already own that
outgoing direction act on it. Refresh revisions make duplicate notifications
idempotent. The incoming side accepts a marked replacement by closing its old
call before answering the new one.

## Deliberate boundary

The gate stores only enough call identity to suppress duplicates, release on
failure, and find the single sender used by track replacement. It does not own
remote streams, participant tiles, presence cleanup, PeerJS reconnect, or a
complete call/stream/tile registry. Those remain a separate repair item.
