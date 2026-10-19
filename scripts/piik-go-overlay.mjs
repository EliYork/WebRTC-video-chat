// Narrow, pinned source overlay: an explicit authenticated viewer departure
// releases its slot; broken transports keep Piik's original reconnect grace.
// Generated full files stay ignored. The upstream checkout is never mutated.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
    const manifest = join(directory, 'overlay.json');
    writeFileSync(manifest, JSON.stringify({ Replace }, null, 2));
    return manifest;
}
