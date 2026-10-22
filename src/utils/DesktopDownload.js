import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Resolve the same immutable installer named by the published updater feed.
// Never accept a path/version from the request or redirect outside this site.
export function createDesktopDownload(directory, { read = readFileSync, stat = statSync } = {}) {
    return (_req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const feed = read(join(directory, 'latest.yml'), 'utf8');
            const version = /^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m.exec(feed)?.[1];
            const name = `EliYork-Voice-Setup-${version}-x64.exe`;
            const path = /^path:\s*(\S+)\s*$/m.exec(feed)?.[1];
            if (!version || path !== name || !stat(join(directory, name)).isFile()) throw Error('not-published');
            return res.redirect(302, `/downloads/windows/${name}`);
        } catch {
            return res.status(503).type('text/plain').send('客户端暂时无法下载，请稍后重试。');
        }
    };
}
