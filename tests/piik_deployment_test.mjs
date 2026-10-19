import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('full-release rollback restores its actual baseline and preserves live data', () => {
    execFileSync(process.env.PYTHON || 'python', ['-B', fileURLToPath(new URL('./deploy_piik_server_test.py', import.meta.url))],
        { windowsHide: true, encoding: 'utf8', timeout: 15000 });
});
