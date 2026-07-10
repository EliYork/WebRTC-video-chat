# Voice Media Error Recovery

## Operation serialization and desired media

`VoiceMediaOperationRuntime` maintains an independent operation record for
microphone, camera, and screen capture: `idle`, `requesting`, `active`,
`stopping`, `switching`, or `failed`. Each record has a token. Repeated requests
share or reject the pending operation; stop, switch, leave, epoch change, and
page disposal invalidate it. A stale resolved stream is immediately stopped.

The following intent is explicit and is not inferred only from tracks:

- `desiredMicrophoneEnabled` (`desired.microphone`);
- `desiredCameraEnabled` (`desired.camera`);
- `desiredScreenSharing` (`desired.screen`);
- selected microphone, camera, and output device ids.

An unavailable actual device does not silently change a desired mic/camera from
on to off. A user mute/stop does. Screen intent becomes off when the picker is
cancelled or the browser stops capture; the picker is never reopened
automatically.

## Stable error taxonomy

| Browser names                                         | Internal type       | Recovery/UI policy                                      |
| ----------------------------------------------------- | ------------------- | ------------------------------------------------------- |
| `NotAllowedError`, `PermissionDeniedError`            | `permission-denied` | no automatic prompt; isolated mic/camera message        |
| screen `NotAllowedError` or `AbortError`              | `user-cancelled`    | reset pending/button; no severe error or call refresh   |
| `NotFoundError`, `DevicesNotFoundError`               | `device-not-found`  | keep voice session; default fallback where appropriate  |
| `NotReadableError`, `TrackStartError`                 | `device-busy`       | keep old live track on switch failure; allow user retry |
| `OverconstrainedError`, `ConstraintNotSatisfiedError` | `constraint-failed` | preserve old track; explain unsupported selection       |
| `SecurityError` or insecure-context `TypeError`       | `insecure-context`  | no retry loop; user must use a valid secure context     |
| other `AbortError`                                    | `operation-aborted` | output fallback or controlled retry                     |
| unknown                                               | `unknown`           | isolated media error; voice session remains available   |

Microphone, camera, screen, output, and network feedback use separate status
entries. One media error cannot overwrite another. The status region is
`aria-live="polite"` and does not bind media buttons.

## Device enumeration and fallback

`VoiceDeviceRuntime` debounces `devicechange`, serializes
`enumerateDevices()`, and rejects stale enumeration results. It keeps a selected
device while its id remains present even when labels are empty. Enumeration
never requests permission.

When a selected microphone or camera disappears, the selection changes to
`default` and one controlled replacement is attempted if the user still wants
that media. The old live track remains until the replacement capture succeeds.
If default capture also fails, that media becomes unavailable while the voice
session and other media continue.

Output selection checks `setSinkId` support. Unsupported browsers keep the
default browser route without an error. A failed selected sink, including
`AbortError`, changes the selection to `default`, applies it to every existing
remote media element, records a controlled message, and ensures new tiles use
the same current sink.

## Unexpected track end

Track listeners are owned by the current media type and client epoch. An
intentional stop removes the listener before `track.stop()`. Recovery is limited
to one in-flight attempt for the media type and epoch, so simultaneous
`devicechange` and `ended` cannot create duplicate capture requests.

- Microphone: if desired on, try default once; otherwise remain audio-off.
- Camera: if desired on and screen is not active, try default once. During
  screen share, camera end never replaces the screen source; recovery is
  considered when screen ends.
- Screen: browser stop clears sharing, publishes sharing false for the current
  server generation, and restores the live camera or audio-only placeholder.
  Microphone audio remains.
- Teardown or a stale screen/track callback performs no recovery.

## User action still required

The user must explicitly retry denied microphone/camera permission, reopen a
cancelled screen picker, select a different unavailable device, or manually
rejoin after the bounded session recovery reaches `failed`. No permission state
or auto-enable choice is persisted by this work.
