/* eslint-disable no-await-in-loop -- Readiness checks must be sequential. */
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
export async function startPiikLocal() {
    const listener = createServer();
    listener.listen(30000 + Math.floor(Math.random() * 10000), '127.0.0.1');
    await once(listener, 'listening');
    const port = listener.address().port;
    await new Promise((done) => listener.close(done));
    const baseURL = `http://127.0.0.1:${port}`;
    const directory = resolve(
        import.meta.dirname,
        '../integrations/piik/.build'
    );
    // Explicit environment prevents the platform's .env/SFU settings leaking
    // into the media subsystem. This development process binds loopback only.
    const processHandle = spawn(
        join(
            directory,
            process.platform === 'win32' ? 'piik-server.exe' : 'piik-server'
        ),
        [],
        {
            cwd: directory,
            windowsHide: true,
            stdio: 'pipe',
            env: {
                SystemRoot: process.env.SystemRoot,
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                PORT: String(port),
                LISTEN_HOST: '127.0.0.1',
                PIIK_ENV: 'development',
                PUBLIC_BASE_URL: baseURL,
                ROOM_DATABASE_PATH: ':memory:',
                ROOM_EMPTY_TIMEOUT_SECONDS: '60',
                MAX_VIEWERS_PER_ROOM: '3',
                ENDPOINT_MEDIA_COPY_CAPACITY: '3',
            },
        }
    );
    let log = '';
    processHandle.stdout.on('data', (b) => {
        log += b;
    });
    processHandle.stderr.on('data', (b) => {
        log += b;
    });
    let failure;
    processHandle.on('error', (error) => {
        failure = error;
    });
    for (let i = 0; i < 100; i++) {
        if (failure || processHandle.exitCode !== null)
            throw failure || new Error(`Piik startup failed: ${log}`);
        try {
            if ((await fetch(`${baseURL}/healthz`)).ok)
                return {
                    baseURL,
                    close: () => processHandle.kill(),
                    process: processHandle,
                };
        } catch {
            // A refused connection is expected while the child is starting.
        }
        await new Promise((done) => setTimeout(done, 100));
    }
    processHandle.kill();
    throw new Error(`Piik startup timed out: ${log}`);
}
