const fs = require('node:fs');
const { dirname } = require('node:path');

// One process owns each log. Rotation only touches this file and its numbered
// backups; native Piik diagnostics and PM2 logs have separate owners.
function createFileLog({ filePath, maxBytes = 5 * 1024 * 1024, backups = 3,
    maxEntryBytes = 64 * 1024, fallback = line => console.error(line) }) {
    if (!Number.isInteger(backups) || backups < 1 || backups > 10 ||
        !Number.isInteger(maxBytes) || maxBytes < 64 ||
        !Number.isInteger(maxEntryBytes) || maxEntryBytes < 32)
        throw Error('Invalid log limits');
    let writeFailed = false;
    const report = line => { try { fallback(line); } catch { /* Logging stays best effort. */ } };
    const size = path => {
        try { return fs.statSync(path).size; }
        catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
    };
    const remove = path => {
        try { fs.unlinkSync(path); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
    const move = (from, to) => {
        try { fs.renameSync(from, to); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
    return {
        get writeFailed() { return writeFailed; },
        write(value) {
            const limit = Math.min(maxBytes, maxEntryBytes);
            let data = Buffer.from(`${value}\n`, 'utf8');
            if (data.length > limit) {
                const suffix = Buffer.from('… [truncated]\n');
                // Avoid splitting a UTF-8 sequence at the size boundary.
                const prefix = data.subarray(0, limit - suffix.length).toString('utf8').replace(/\uFFFD$/, '');
                data = Buffer.concat([Buffer.from(prefix), suffix]);
            }
            try {
                const target = typeof filePath === 'function' ? filePath() : filePath;
                fs.mkdirSync(dirname(target), { recursive: true });
                if (size(target) + data.length > maxBytes) {
                    remove(`${target}.${backups}`);
                    for (let n = backups - 1; n >= 1; n--) move(`${target}.${n}`, `${target}.${n + 1}`);
                    move(target, `${target}.1`);
                }
                fs.appendFileSync(target, data, { mode: 0o600 });
                writeFailed = false;
                return true;
            } catch (error) {
                if (!writeFailed) report(`[log] file write failed (${error.code || 'unknown'}); logging to stderr`);
                writeFailed = true;
                report(data.toString('utf8').trimEnd());
                return false;
            }
        },
    };
}
module.exports = { createFileLog };
