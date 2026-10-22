const { readFileSync, writeFileSync, renameSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const validVersion = value => typeof value === 'string' && value.length <= 80 && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value);
function createUpdatePreferences(file, log = () => {}) {
    let ignoredVersion = '';
    try {
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        if (validVersion(saved.ignoredVersion)) ignoredVersion = saved.ignoredVersion;
    } catch (error) {
        if (error.code !== 'ENOENT') log('update-preferences-read-failed');
    }
    return {
        getIgnoredVersion: () => ignoredVersion,
        setIgnoredVersion(value) {
            if (!validVersion(value)) throw Error('Invalid update version');
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(`${file}.tmp`, JSON.stringify({ ignoredVersion: value }), { mode: 0o600 });
            renameSync(`${file}.tmp`, file);
            ignoredVersion = value;
        },
    };
}
module.exports = { createUpdatePreferences };
