// Narrow, pinned overlays: explicit departure releases capacity; media library
// packet traces are opt-in while App samples and real warnings/errors survive.
// Generated full files stay ignored. The upstream checkout is never mutated.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { preparePiikShareOverlay } from './piik-share-overlay.mjs';
import { editOnce } from './piik-client-overlay.mjs';

// GO-2026-6865 was fixed in v1.20.2. Use the patched version and checksums
// from Piik e79e658 while keeping the pinned Piik source and protocol intact.
const PIIK_COMPRESS_VERSION = 'v1.20.5';

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
    const moduleFile = join(source, 'go.mod');
    const checksumFile = join(source, 'go.sum');
    const compress = 'github.com/klauspost/compress';
    const goMod = editOnce(readFileSync(moduleFile, 'utf8'), `${compress} v1.20.1`, `${compress} ${PIIK_COMPRESS_VERSION}`);
    const goSum = readFileSync(checksumFile, 'utf8').trimEnd() + '\n' +
        `${compress} ${PIIK_COMPRESS_VERSION} h1:rJj5VjH4xQxbnLphg6eqUcDxRFCw1jpMdDY9qXlrwSs=\n` +
        `${compress} ${PIIK_COMPRESS_VERSION}/go.mod h1:LUdAzn7YLVvxLpc7y3V1m40wESHTgc1422pwwBSKYuI=\n`;
    for (const [original, generated, content] of [
        [moduleFile, join(directory, 'go.mod'), goMod],
        [checksumFile, join(directory, 'go.sum'), goSum],
    ]) {
        writeFileSync(generated, content);
        Replace[original] = generated;
    }
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
    preparePiikShareOverlay(source, out, Replace);
    const loopback = join(source, 'internal/app/loopback/server.go');
    let loopbackSource = readFileSync(Replace[loopback] || loopback, 'utf8').replaceAll('\r\n', '\n');
    for (const [oldSource, newSource] of [
        ['"crypto/rand"', '"crypto/rand"\n\t"crypto/subtle"'],
        ['"net/url"', '"net/url"\n\t"os"'],
        ['\tserver.mu.Lock()\n\tconnectURL := server.connectURL',
            '\tif !authorizeDesktopDiscovery(response, request) {\n\t\treturn\n\t}\n\tserver.mu.Lock()\n\tconnectURL := server.connectURL'],
        ['\tresponse.Header().Set("Cache-Control", "no-store")\n\twriteJSON(response, http.StatusOK, Health{',
            '\tif !authorizeDesktopDiscovery(response, request) {\n\t\treturn\n\t}\n\tresponse.Header().Set("Cache-Control", "no-store")\n\twriteJSON(response, http.StatusOK, Health{'],
        ['func allowPrivateNetwork(', `func authorizeDesktopDiscovery(response http.ResponseWriter, request *http.Request) bool {
\tproof := os.Getenv("ELIYORK_NATIVE_DISCOVERY_PROOF")
\tif proof == "" || subtle.ConstantTimeCompare([]byte(proof), []byte(request.Header.Get("X-EliYork-Native-Discovery"))) == 1 {
\t\treturn true
\t}
\tresponse.Header().Set("Cache-Control", "no-store")
\thttp.Error(response, "forbidden", http.StatusForbidden)
\treturn false
}

func allowPrivateNetwork(`],
    ]) loopbackSource = editOnce(loopbackSource, oldSource, newSource);
    const generatedLoopback = join(directory, 'loopback-server.go');
    writeFileSync(generatedLoopback, loopbackSource);
    Replace[loopback] = generatedLoopback;
    const manifest = join(directory, 'overlay.json');
    writeFileSync(manifest, JSON.stringify({ Replace }, null, 2));
    return manifest;
}
