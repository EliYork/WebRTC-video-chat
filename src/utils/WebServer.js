import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

// HTTPS is an explicit operating mode. A missing/malformed certificate must
// stop startup before a listener opens, never change the selected protocol.
export function createWebServer(app, { env = process.env, root = process.cwd(), read = readFileSync } = {}) {
    if (!['true', 'false'].includes(env.USE_HTTPS))
        throw Error('USE_HTTPS must be exactly "true" or "false"');
    if (env.USE_HTTPS === 'false') return { server: createHttpServer(app), useHttps: false };
    const keyFile = env.TLS_KEY_FILE?.trim();
    const certFile = env.TLS_CERT_FILE?.trim();
    if (Boolean(keyFile) !== Boolean(certFile))
        throw Error('[https] TLS_KEY_FILE and TLS_CERT_FILE must be configured together');
    try {
        const key = read(resolve(root, keyFile || 'cert/selfsigned.key'));
        const cert = read(resolve(root, certFile || 'cert/selfsigned.crt'));
        return { server: createHttpsServer({ key, cert }, app), useHttps: true };
    } catch (error) {
        // Neither PEM contents nor potentially private filesystem paths belong
        // in startup output. Preserve a useful, bounded system error code.
        const code = /^[A-Z][A-Z0-9_]{1,64}$/.test(error.code || '') ? error.code : 'TLS_CONFIGURATION_ERROR';
        throw Error(`[https] Cannot start HTTPS (${code}). Check the configured TLS key/certificate; HTTP fallback is disabled.`);
    }
}
