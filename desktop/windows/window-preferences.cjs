const {
    readFileSync,
    writeFileSync,
    renameSync,
    mkdirSync,
} = require('node:fs');
const { dirname } = require('node:path');
const behaviors = new Set(['ask', 'tray', 'quit']);
function createWindowPreferences(file, log = () => {}) {
    let closeBehavior = 'ask';
    try {
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        if (behaviors.has(saved.closeBehavior))
            closeBehavior = saved.closeBehavior;
    } catch (error) {
        if (error.code !== 'ENOENT') log('window-preferences-read-failed');
    }
    return {
        snapshot: () => ({ closeBehavior }),
        setCloseBehavior(value) {
            if (!behaviors.has(value)) throw Error('Invalid close behavior');
            // Persist before changing memory; a failed write must not claim success.
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(
                `${file}.tmp`,
                JSON.stringify({ closeBehavior: value }),
                { mode: 0o600 }
            );
            renameSync(`${file}.tmp`, file);
            closeBehavior = value;
            return this.snapshot();
        },
    };
}
module.exports = { createWindowPreferences };
