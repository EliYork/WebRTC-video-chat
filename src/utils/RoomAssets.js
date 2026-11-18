import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');

export function getRoomAssetVersions({ runtime, stylesheet, mainScript }) {
    return { runtime: sha(runtime), stylesheet: sha(stylesheet), mainScript: sha(mainScript) };
}

// Assemble existing sources once at startup. No browser loader or media changes.
export function createRoomAssets(viewsRoot, { optimized = true } = {}) {
    const root = resolve(viewsRoot);
    const read = (path) => {
        const file = resolve(root, path);
        if (!file.startsWith(root + sep)) throw new Error('Room asset outside views root');
        return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    };
    const paths = JSON.parse(read('js/room/boot-scripts.json'));
    if (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length)
        throw new Error('Invalid room script list');
    const runtime = paths.map((path) => {
        if (typeof path !== 'string' || !/^\/js\/[\w/-]+\.js$/.test(path))
            throw new Error('Invalid room script path');
        return `\n;\n// ${path}\n${read(path.slice(1))}`;
    }).join('');
    const stack = new Set();
    const stylesheet = (path) => {
        const file = resolve(root, path);
        if (stack.has(file)) throw new Error('Circular room stylesheet import');
        stack.add(file);
        const value = read(file).replace(/@import\s+url\(['"]([^'"]+)['"]\);/g, (_, imported) => {
            if (!/^[\w./-]+\.css$/.test(imported)) throw new Error('Invalid room stylesheet import');
            return stylesheet(resolve(dirname(file), imported));
        });
        stack.delete(file);
        return value;
    };
    const assets = { runtime, stylesheet: stylesheet('style.css'), mainScript: read('script.js') };
    // Optional generated copies are used only when both source and output hashes match.
    // Editing any source immediately falls back to the assembled source, never stale code.
    if (optimized) {
        try {
            const metadata = JSON.parse(read('js/room/startup-assets.json'));
            for (const key of Object.keys(assets)) {
                const entry = metadata[key];
                if (!entry || entry.sourceSha256 !== sha(assets[key])) continue;
                const minified = read(key === 'stylesheet' ? 'styles/startup.min.css' : `js/room/startup.${key}.min.js`);
                if (sha(minified) === entry.sha256) assets[key] = minified;
            }
        } catch { /* Development checkouts need not have generated assets. */ }
    }
    return assets;
}
