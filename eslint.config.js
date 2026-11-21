import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

const sequentialBrowserChecks = [
    'scripts/verify-microphone-app.mjs',
    'scripts/verify-room-ui-app.mjs',
    'scripts/verify-screen-routing-app.mjs',
    'scripts/verify-screen-sfu.mjs',
];

export default [
    js.configs.recommended,
    eslintConfigPrettier,
    {
        ignores: [
            'desktop/windows/.build/',
            'integrations/piik/.build/',
            'integrations/piik/.deps/',
            'integrations/piik/artifacts/',
            'native/windows-share-prototype/.deps/',
            'native/windows-share-prototype/artifacts/',
            'native/windows-share-prototype/build/',
            'src/views/vendor/',
            'src/views/wasm/',
            'src/views/audio-worklet/rnnoise-processor.js',
            'src/views/js/room/startup.*.min.js',
            'src/views/styles/startup.min.css',
        ],
    },
    {
        files: ['**/*.{js,mjs,cjs}'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
            'no-alert': 'error',
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-await-in-loop': 'error',
            'no-eval': 'error',
        },
    },
    {
        // Browser probes and test cases intentionally run dependent steps in order.
        files: [...sequentialBrowserChecks, 'tests/screen_send_policy_test.mjs'],
        rules: { 'no-await-in-loop': 'off' },
    },
    {
        files: [...sequentialBrowserChecks, 'scripts/build-sfu-client.mjs'],
        rules: { 'no-console': ['warn', { allow: ['log', 'warn', 'error'] }] },
    },
];
