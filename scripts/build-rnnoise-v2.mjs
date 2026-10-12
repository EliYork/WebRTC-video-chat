// Extract, without changing the model, the embedded binary of an existing
// pinned dependency. No compiler, network fetch or new model package required.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('node_modules/@shiguredo/rnnoise-wasm/package.json', root), 'utf8'));
assert.equal(pkg.version, '2025.1.5');
const source = readFileSync(new URL('node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js', root), 'utf8');
const matches = [...source.matchAll(/return FA\("([A-Za-z0-9+/=]+)"\)/g)];
assert.equal(matches.length, 1, 'embedded binary format changed');
const binary = Buffer.from(matches[0][1], 'base64');
assert.equal(binary.length, 3600944);
assert.ok(WebAssembly.validate(binary));
const hash = createHash('sha256').update(binary).digest('hex');
assert.equal(hash, 'b3b67c9eae8f0791aad468c708659e0850bb37b0fb9c8a8666f2d7b0b6869bc4');
writeFileSync(new URL('src/views/wasm/rnnoise-v2-2025.1.5.wasm', root), binary);
process.stdout.write(JSON.stringify({ version: pkg.version, bytes: binary.length, sha256: hash }) + '\n');
