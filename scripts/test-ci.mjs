import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

process.env.CI = 'true';
const directory = new URL('../tests/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.mjs')).sort()
    .map(name => fileURLToPath(new URL(name, directory)));
const tests = run({ files, concurrency: 2, timeout: 30000 });
tests.on('test:summary', ({ file, counts, success }) => {
    if (file) return;
    if (!success || !counts.tests || counts.skipped || counts.todo) {
        process.exitCode = 1;
        process.stderr.write(`Strict test summary: ${JSON.stringify(counts)}\n`);
    }
});
tests.on('error', (error) => {
    process.exitCode = 1;
    process.stderr.write(`${error.message}\n`);
});
tests.compose(spec).pipe(process.stdout);
