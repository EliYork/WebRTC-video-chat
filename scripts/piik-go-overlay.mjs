// Narrow, pinned overlays: explicit departure releases capacity; media library
// packet traces are opt-in while App samples and real warnings/errors survive.
// Generated full files stay ignored. The upstream checkout is never mutated.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function preparePiikGoOverlay(source, out) {
    const directory = join(out, 'go-overlay');
    mkdirSync(directory, { recursive: true });
    const replacements = new Map([
        [
            'session.go',
            [
                ['"context"', '"context"\n\t"errors"'],
                [
                    'revoked                 bool',
                    'revoked                 bool\n\texplicitDeparture       bool',
                ],
                [
                    'kind, data, err := sess.conn.Read(sess.ctx)\n\t\tif err != nil {\n\t\t\treturn',
                    'kind, data, err := sess.conn.Read(sess.ctx)\n\t\tif err != nil {\n\t\t\tvar closed websocket.CloseError\n\t\t\tif errors.As(err, &closed) && closed.Code == websocket.StatusNormalClosure && closed.Reason == "viewer-left" {\n\t\t\t\ts.mu.Lock()\n\t\t\t\tsess.explicitDeparture = true\n\t\t\t\ts.mu.Unlock()\n\t\t\t}\n\t\t\treturn',
                ],
            ],
        ],
        [
            'presence.go',
            [
                [
                    '\ts.sendViewerPresence(disconnected.RoomID)\n\n\t// The registered pointer',
                    '\tif sess.explicitDeparture {\n\t\ts.clearViewerGrace(disconnected.RoomID, disconnected.PeerID)\n\t\tif s.store.RemoveDisconnectedViewer(disconnected.RoomID, disconnected.PeerID) {\n\t\t\ts.clearViewerEvidence(disconnected.RoomID, disconnected.PeerID)\n\t\t\ts.router.removeViewer(disconnected.RoomID, disconnected.PeerID)\n\t\t}\n\t\ts.sendViewerPresence(disconnected.RoomID)\n\t\treturn\n\t}\n\ts.sendViewerPresence(disconnected.RoomID)\n\n\t// The registered pointer',
                ],
            ],
        ],
    ]);
    const Replace = {};
    for (const [name, edits] of replacements) {
        const original = join(source, 'internal/server/signal', name);
        let text = readFileSync(original, 'utf8').replaceAll('\r\n', '\n');
        for (const [before, after] of edits) {
            if (text.split(before).length !== 2)
                throw new Error(`Piik overlay context changed: ${name}`);
            text = text.replace(before, after);
        }
        const generated = join(directory, name);
        writeFileSync(generated, text);
        Replace[original] = generated;
    }
    const logging = join(source, 'internal/diagnostics/logging.go');
    let text = readFileSync(logging, 'utf8').replaceAll('\r\n', '\n');
    const before = 'logr.FromSlogHandler(slog.Default().With("library", "livekit", "scope", scope).Handler())';
    if (text.split(before).length !== 2) throw new Error('Piik media logger overlay context changed');
    text = text.replace(before, 'logr.FromSlogHandler(mediaLogHandler(slog.Default().With("library", "livekit", "scope", scope).Handler()))');
    const generated = join(directory, 'logging.go');
    writeFileSync(generated, text);
    Replace[logging] = generated;
    Replace[join(source, 'internal/diagnostics/media_log_filter.go')] = resolve(import.meta.dirname, 'piik-media-log-filter.go');
    const manifest = join(directory, 'overlay.json');
    writeFileSync(manifest, JSON.stringify({ Replace }, null, 2));
    return manifest;
}
