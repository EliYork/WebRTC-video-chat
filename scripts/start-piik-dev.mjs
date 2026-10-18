import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startPiikLocal } from './piik-local-service.mjs';
const piik = await startPiikLocal();
const platform = spawn(
    process.execPath,
    [resolve(import.meta.dirname, '../src/server.js')],
    {
        windowsHide: true,
        stdio: 'inherit',
        env: {
            ...process.env,
            PIIK_ENABLED: 'true',
            PIIK_INTERNAL_URL: piik.baseURL,
        },
    }
);
const stop = () => {
    platform.kill();
    piik.close();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
platform.on('exit', (code) => {
    piik.close();
    process.exitCode = code || 0;
});
platform.on('error', (error) => {
    piik.close();
    throw error;
});
