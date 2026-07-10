# Voice Session State Machine

## Purpose and ownership

Voice Session Resilience v1 separates user intent from transient connectivity.
`VoiceSessionRuntime` owns the client session state and client epoch; it does not
own MediaConnections, local tracks, Socket.IO rooms, or the server generation.

| State or resource                          | Canonical owner                        | Other writers                           | Cleanup entry                      | Recovery entry                | Main risk addressed           |
| ------------------------------------------ | -------------------------------------- | --------------------------------------- | ---------------------------------- | ----------------------------- | ----------------------------- |
| Socket connection/transport                | Socket.IO client                       | Engine.IO transport                     | page teardown                      | Socket.IO manager reconnect   | treating polling as failure   |
| current Peer / local peer id               | `script.js` Peer lifecycle             | PeerJS `open/close`                     | leave/page teardown                | peer reconnect/recreate       | old Peer callbacks            |
| desired voice room                         | `VoiceSessionRuntime`                  | join/leave UI                           | explicit leave                     | manual join                   | reconnect changing intent     |
| actual voice state / client epoch          | `VoiceSessionRuntime`                  | lifecycle events through narrow methods | leave/dispose                      | socket/peer restore           | stale async work              |
| server voice owner/generation              | `VoiceCallSignaling` on `socket.data`  | `voice:join` only                       | active leave/disconnecting         | idempotent join/snapshot      | spoofed or ghost owner        |
| local mic/camera/screen                    | `script.js` plus media operation token | user action/recovery                    | media stop/leave/page teardown     | explicit or one-shot fallback | late permission resolves      |
| active video source                        | `script.js`                            | camera/screen transitions               | media stop                         | camera-after-screen           | camera and screen collision   |
| media targets                              | canonical server snapshot              | peer join/left trigger snapshot         | reconcile/leave                    | `voice:snapshot`              | old and new peer ids together |
| outgoing/incoming calls and remote streams | `VoicePeerRegistry`                    | directional call APIs                   | peer cleanup/registry teardown     | target reconciliation         | duplicate direction owner     |
| participant tiles                          | registry plus current presence         | presence reconciliation                 | peer no longer present             | canonical presence snapshot   | ghost participant             |
| selected devices                           | `VoiceDeviceRuntime`                   | user selection/track settings           | page dispose                       | devicechange/default fallback | detached device loops         |
| retry attempt/timer                        | `VoiceRetryController`                 | peer recovery only                      | success/leave/dispose/epoch change | online or peer failure        | competing retry loops         |
| page teardown                              | `VoiceMediaLifecycle` guard            | non-BFCache `pagehide`                  | one idempotent run                 | none                          | late callbacks after unload   |

## Desired and actual state

`desiredVoiceState` is `joined` or `left`. It changes only because the user
joins/leaves, switches voice rooms, or the page is permanently disposed.
Transport failures never change it. The actual state is one of:

| State                 | Meaning                                                                     | Typical next states                             |
| --------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| `idle`                | no join intent                                                              | `joining`, `disposed`                           |
| `joining`             | Peer/server owner is being established                                      | `joined`, reconnect states, `failed`, `leaving` |
| `joined`              | Peer and current server owner are reconciled                                | reconnect states, `leaving`                     |
| `degraded`            | media may still flow but a non-terminal dependency is impaired              | `joined`, reconnect states                      |
| `reconnecting-socket` | Socket owner is unavailable; existing P2P/media are retained                | `restoring`, `failed`, `leaving`                |
| `reconnecting-peer`   | Peer signaling is unavailable; established calls are retained when possible | `restoring`, `failed`, `leaving`                |
| `restoring`           | transport is back and canonical owner/targets/presence are rebuilding       | `joined`, reconnect states, `failed`            |
| `failed`              | bounded recovery exhausted or error is not recoverable                      | manual `joining`, `leaving`                     |
| `leaving`             | explicit cleanup is running                                                 | `idle`, `disposed`                              |
| `disposed`            | permanent page teardown completed                                           | none                                            |

Illegal transitions are rejected without changing state. Duplicate lifecycle
events are idempotent.

## Client epoch and server generation

The client epoch advances for a new join, Socket reconnect cycle, Peer
recreation, manual retry, leave, and page teardown. Media operations capture
the epoch and their own per-media token. A late result is stopped and cannot
write state when either value is stale.

The client sends `clientSessionEpoch` on `voice:join`. The server echoes it on
the target snapshot and stores it only as a correlation token. The server's
`voiceSessionGeneration` remains the authority for the current socket-owned
voice session. Neither value substitutes for the other.

Persistent resources that intentionally survive a Socket reconnect (live local
tracks and the current Peer) are rebound to the new epoch. Old Peer instances,
old screen sessions, old calls, old target/presence snapshots, timers, and
pending media requests cannot affect the new session.

## Socket.IO recovery

Socket.IO owns its reconnection timer. The client configures bounded attempts,
delay, maximum delay, and jitter but does not start a competing Socket timer.
Business code accepts either polling or WebSocket and records the active
transport in opt-in diagnostics.

On disconnect, the client keeps local media, established P2P calls, registry
entries, and participant tiles. It enters `reconnecting-socket`. On connect it:

1. rejoins the current view/chat room;
2. emits `voice:join` with the current room, Peer id, and client epoch;
3. adopts the returned server generation;
4. reconciles the exact target snapshot;
5. republishes presence using the new socket owner;
6. requests `voice:snapshot` to verify the canonical target set;
7. retains valid calls and creates only missing outgoing directions;
8. reaches `joined` only after the new server owner succeeds.

## PeerJS recovery

`disconnected` means signaling is degraded, not that established WebRTC calls
are dead. New outgoing calls pause while registry media and tiles remain. A
single retry controller calls the supported `peer.reconnect()` API with bounded
backoff. `open` triggers server-owner and target reconciliation.

`close`, `unavailable-id`, or a failed reconnect recreates the Peer. The new
Peer id advances the client epoch; the server atomically retires the old peer
owned by that socket, emits its removal, increments the server generation, and
returns the current targets. Local media is reused and outgoing directions are
rebuilt through the existing registry.

Peer errors are classified. Call-scoped `peer-unavailable`/`webrtc` errors do
not destroy the session. Network/server/socket errors reconnect. An unavailable
id recreates. Browser incompatibility and invalid configuration fail without
an infinite retry. Unknown session errors receive the same bounded recreate
policy.

## Browser lifecycle

- `offline` pauses peer retry and keeps live tracks/calls.
- `online` wakes one retry/reconcile path.
- `visibilitychange` records state only; it never means leave.
- BFCache `pagehide` preserves the session.
- persisted `pageshow` checks Socket, Peer, and owner state once.
- non-BFCache `pagehide` disposes the epoch, pending operations, retries,
  tracks, registry, Peer, and Socket exactly once.

## Diagnostics

Enable with `?voiceMediaDebug=1` or
`localStorage.setItem('voiceMediaDebug', '1')`. The 300-entry bounded log covers
session state/epoch, transport, Peer lifecycle/error type, retry, join
generation, reconciliation, media operations, device fallback, track end, UI
error state, and teardown. It excludes full SDP, ICE candidates, IPs, device
labels, track ids, and full nicknames. Export with `exportVoiceMediaDebug()`.

## Manual-only boundaries

Permission prompts and the screen picker always require a user gesture. Screen
sharing is never automatically restarted. A denied permission is retried only
after another user action. This version does not deploy TURN, modify Nginx,
persist an offline voice session, or guarantee media continuity after a peer
instance is permanently closed.
