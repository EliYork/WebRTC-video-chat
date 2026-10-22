// Isolated Go logger benchmark; no server, browser, GPU or media devices.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { preparePiikGoOverlay } from './piik-go-overlay.mjs';
const source = resolve('integrations/piik/.deps/upstream');
const out = resolve('integrations/piik/.build/performance');
mkdirSync(out, { recursive: true });
const candidate = process.argv.includes('--candidate');
const overlay = candidate ? JSON.parse(readFileSync(preparePiikGoOverlay(source, out))) : { Replace: {} };
overlay.Replace[join(source, 'internal/diagnostics/performance_integration_test.go')] = resolve('scripts/fixtures/piik-media-log_test.go');
const manifest = join(out, `logging-${candidate ? 'after' : 'before'}.json`);
writeFileSync(manifest, JSON.stringify(overlay));
const stdout = execFileSync(process.env.PIIK_GO || 'go', ['test', '-overlay', manifest,
    './internal/diagnostics', '-run', 'TestMedia(LogErrorsAndSampleSurvive|TraceOptInStillRedactsSecrets)',
    '-bench', 'BenchmarkMediaRouteLog', '-benchtime=19000x', '-count=3'],
{ cwd: source, windowsHide: true, encoding: 'utf8', timeout: 120000 });
writeFileSync(join(out, `logging-${candidate ? 'after' : 'before'}.txt`), stdout);
process.stdout.write(stdout);
