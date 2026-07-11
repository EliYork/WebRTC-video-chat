# Voice Media Call Protocol

## Confirmed negotiation constraint

The Edge `webrtc-internals` dump showed connected PeerConnections whose offer
and answer contained only `m=application`. They had no `m=audio`, no `m=video`,
and no RTP stats. The sharing answerer later added a video track while handling
a replacement call, but an answer cannot add a media section that the remote
offer did not contain.

PeerJS 1.5.4 adds every caller-stream track to its new RTCPeerConnection before
`createOffer()`. `MediaConnection.answer(stream)` adds answer-side tracks before
applying the offer, but those tracks are still limited by the offered media
sections. `offerToReceiveAudio` and `offerToReceiveVideo` are not used as a
substitute for explicit Unified Plan transceivers, and PeerJS does not expose a
high-level renegotiation operation for an existing MediaConnection.

The former assumption that one permanently directed, bidirectional
MediaConnection could later gain arbitrary answerer media through a replacement
answer is therefore invalid.

## Directional media model

Each participant pair has zero, one, or two intentional MediaConnections:

```text
A -> B: carries only A's current media snapshot
B -> A: carries only B's current media snapshot
```

Each sender direction has at most one owned call. Replacement transfers the
direction owner to the new generation and immediately closes the retired call;
it does not keep a same-direction call alive while waiting for connection.
These are not duplicate bidirectional calls: the two directions have distinct
ownership and never send the answerer's tracks back on the same call.

An incoming send call is always accepted with `call.answer()` and no stream,
which is PeerJS's one-way-call path. The caller's stream therefore defines all
offered RTP media sections. The registry never uses PeerJS's private connection
lists as an owner.

An empty local snapshot does not create a MediaConnection. This avoids the
data-channel-only offer seen in the dump. When that participant later enables a
media type, it creates its own send call and the offer contains the required
media section.

## Join and media publication

1. After PeerJS `open`, the client binds the incoming-call handler and emits
   `voice:join` with the requested fixed room, PeerJS id, and client epoch.
2. The server validates and records the socket-owned voice room/id, assigns a
   monotonic voice-session generation, and serializes joins in that room.
3. The joining socket receives an epoch-tagged `voice:call-targets` with all
   existing peers and can verify it with `voice:snapshot`.
4. Existing sockets receive `voice:peer-joined` for the new peer.
5. Every side adds the other to its media-target set and publishes its own
   current snapshot if that snapshot contains live tracks.

Local media changes do not ask a remote, historically chosen caller to rebuild
the pair. The changing participant increments its local media generation and
publishes a replacement only in its own outgoing direction to every current
target.

Outgoing metadata contains:

- `voiceMediaDirection: "send"`;
- positive `voiceMediaGeneration`;
- ordered `voiceMediaKinds` (for example `['audio', 'audio', 'video']`);
- concise sharing/video-source diagnostics.

Incoming calls with missing direction metadata, invalid generations, duplicate
generations, or stale generations are closed. A replacement becomes the sole
owner for that direction and the old call is retired immediately. Its real
remote stream then replaces the previous composed media snapshot. Late stream,
close, or error events from retired generations cannot overwrite current state.

## Media policy and SDP behavior

The media snapshot contains live tracks only:

- microphone audio: normally one audio track;
- screen audio: retained in addition to microphone audio;
- video: one `activeVideoTrack`.

Microphone and screen audio are not silently collapsed. If both exist, PeerJS
adds two audio tracks and Chromium creates two audio senders/media sections.
There is currently no Web Audio mixing step.

Camera and screen video are intentionally mutually exclusive in the outgoing
snapshot. Starting screen share makes the screen track the one active video
source; stopping it restores the live camera track if present, otherwise the
next snapshot is audio-only. Camera-to-screen replacement rebuilds only the
local send direction.

| A media                           | B media      | Directional result                                 |
| --------------------------------- | ------------ | -------------------------------------------------- |
| none                              | none         | no media call until a live track exists            |
| mic                               | mic          | one audio call in each direction                   |
| mic                               | mic + camera | reverse audio calls plus B's video m-line          |
| mic + screen video                | mic          | A offers audio/video; B independently offers audio |
| mic + screen video + screen audio | mic          | A offers two audio m-lines and one video m-line    |
| camera then screen                | mic          | A replaces only A -> B with the new video source   |
| any side enables media later      | any          | that side originates or replaces its own send call |

Socket.IO sharing state remains UI/presence state only. It never substitutes for
an RTP track, an SDP media section, or inbound/outbound RTP stats. Tile
`srcObject` assignment only renders registry-owned remote tracks.

Remote tile presentation is derived from live tracks, not from the presence of
a `<video>` node or an ended track that remains in a MediaStream. When the
registry has no live remote video, the old video decoder is paused, detached,
and reset before the existing tile renders its audio element and participant
placeholder. When camera replaces screen inside the same composed stream, the
video element is explicitly rebound to the new live track. Neither transition
changes participant tile identity or interrupts surviving audio.

## Registry and cleanup

`voice-peer-registry.js` owns incoming and outgoing call identity separately for
each remote peer, their generations/listeners, the composed remote stream, and
the stable participant tile. A direction close affects only that direction.
The participant tile remains while presence still owns the peer.

`cleanupPeer(peerId, reason)` closes both directions once, unbinds call and media
listeners, detaches the remote stream, and removes the tile. Leave, refresh
replacement, page teardown, and late close/error paths are idempotent.

Socket transport loss does not use this cleanup path. Existing local tracks,
P2P calls, registry entries, and tiles remain while the Socket owner is
restored. PeerJS signaling `disconnected` likewise pauses new calls without
closing established calls.

For a non-BFCache `pagehide`, the page stops screen/camera/microphone tracks at
most once, notifies voice leave, tears down the registry, destroys PeerJS, and
disconnects Socket.IO. BFCache pagehide is preserved.

## Opt-in diagnostics

Diagnostics are disabled by default. Enable them for one page with
`?voiceMediaDebug=1`, or persistently with:

```js
localStorage.setItem('voiceMediaDebug', '1');
```

The bounded log retains at most 300 entries and records session epoch/state,
transport, retry, peer lifecycle/error type, peer id, direction,
generation, track kinds/enabled state, sender/transceiver kinds, SDP media-kind
summaries, connection state, sharing state, remote stream kinds, and cleanup
reason. It does not record full SDP, candidates, IPs, device labels, track ids,
or unbounded history. Export a copy in the console with:

```js
exportVoiceMediaDebug();
```

## Server owner boundary

Voice join, peer-joined targeting, active leave (`voicePeerLeft`), and disconnect
cleanup use `socket.data.voiceRoomId` and `socket.data.voicePeerId`. Screen share
accepts only a strict `sharing` boolean plus the server-issued voice-session
generation. Presence derives peer, room, and sharing state from the server
owner.

| Event                                    | Client business payload               | Server identity/room owner               | Broadcast target                |
| ---------------------------------------- | ------------------------------------- | ---------------------------------------- | ------------------------------- |
| `voice:join`                             | fixed room, PeerJS id, client epoch   | validated room/id and session generation | joiner plus existing room peers |
| `voice:snapshot`                         | none                                  | current socket voice owner               | requesting socket               |
| `voice:call-targets`                     | none                                  | current room membership                  | joining socket                  |
| `voice:peer-joined`                      | none                                  | newly joined socket owner                | existing sockets in owned room  |
| `presence:joinVoice` / `presence:update` | bounded display/media booleans        | current voice owner                      | presence snapshot               |
| `voicePeerLeft` / disconnect             | none                                  | current voice owner                      | owned voice room                |
| `screen:share`                           | strict boolean and session generation | current voice owner                      | owned voice room                |

## Test model and remaining browser gate

`tests/voice_media_negotiation_test.mjs` uses a strict fake SDP/transceiver
model. It derives offer media sections only from caller tracks and rejects an
answer that tries to add more audio/video sections than the offer. It covers
late mic/video, both microphones, screen media, two audio tracks, video-source
replacement, audio-only fallback, stale events, leave/rejoin, and three peers.

The directional media matrix has already passed real Edge testing. Resilience
changes remain at the browser retest gate: transport loss, PeerServer loss,
offline/online, permission denial, device detach/output fallback, BFCache, and
multi-participant recovery. No browser acceptance was run in this code task.

## Remote screen-share quality label

The screen-share quality pill is a viewer-side enhancement layered on top of the existing directional media protocol. It does not change offer/answer direction, incoming answer behavior, registry ownership, reconnect, backoff, or media operation state. For each remote peer, the registry exposes a narrow read-only quality source containing the current incoming call, generation, remote stream, tile, and peer connection reference. The stats runtime samples only the current live remote video track when the server/UI state says the peer is sharing their screen and the tile's video element is still bound to that same registry stream.

Resolution labels map 1280×720 to 720p, 1920×1080 to 1080p, 2560×1440 to 1440p, and 3840×2160 to 4K; non-standard and portrait sizes render as raw width×height. FPS comes from inbound `framesPerSecond` or from decoded/received frame deltas and is smoothed over the latest three valid samples. If stats fields, `getStats()`, or peer connection state are unavailable, the missing part is hidden quietly and media playback continues. Debug logging is limited to low-frequency lifecycle events and never records SDP, ICE candidates, IP addresses, SSRCs, track IDs, device labels, or full peer IDs.
