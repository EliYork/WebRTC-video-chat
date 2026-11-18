import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRoomAssets } from '../src/utils/RoomAssets.js';

const root = resolve(process.argv[2] || 'src/views');
const assets = createRoomAssets(root, { optimized: false });
const sha = value => createHash('sha256').update(value).digest('hex');
const entries = await Promise.all(Object.entries(assets).map(async ([key, source]) => {
    const result = await transform(source, {
        loader: key === 'stylesheet' ? 'css' : 'js',
        minify: true,
        target: key === 'stylesheet' ? 'chrome100' : 'es2022',
        charset: 'utf8',
        legalComments: 'inline',
    });
    const name = key === 'stylesheet' ? 'styles/startup.min.css' : `js/room/startup.${key}.min.js`;
    const path = resolve(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, result.code);
    return [key, { sourceSha256: sha(source), sha256: sha(result.code), sourceBytes: Buffer.byteLength(source), bytes: Buffer.byteLength(result.code) }];
}));
const metadata = Object.fromEntries(entries);
writeFileSync(resolve(root, 'js/room/startup-assets.json'), JSON.stringify(metadata, null, 2) + '\n');
process.stdout.write(JSON.stringify(metadata, null, 2) + '\n');
