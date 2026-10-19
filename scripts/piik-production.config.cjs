// PM2 loads this on the Linux host. The existing Node .env remains unchanged.
const path = require('node:path');
const root = path.resolve(__dirname, '..');
module.exports = {
    apps: [
        {
            name: 'voice-piik',
            cwd: root,
            script: path.join(root, 'integrations/piik/.build/piik-server'),
            interpreter: 'none',
            autorestart: true,
            restart_delay: 2000,
            max_memory_restart: '120M',
            min_uptime: 10000,
            max_restarts: 10,
            kill_timeout: 8000,
            env: {
                PIIK_ENV: 'production',
                LISTEN_HOST: '127.0.0.1',
                PORT: '17887',
                PUBLIC_BASE_URL: 'https://voice.eliyork.com',
                ALLOWED_ORIGINS: 'http://127.0.0.1:17887',
                ROOM_DATABASE_PATH: ':memory:',
                ROOM_EMPTY_TIMEOUT_SECONDS: '60',
                MAX_VIEWERS_PER_ROOM: '3',
                ENDPOINT_MEDIA_COPY_CAPACITY: '3',
                STUN_URLS:
                    'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478',
                STUN_LISTEN_HOST: '127.0.0.1',
                NAT_PREDICTION_ENABLED: 'false',
                GOMEMLIMIT: '64MiB',
                GOGC: '75',
                GOMAXPROCS: '1',
            },
        },
    ],
};
