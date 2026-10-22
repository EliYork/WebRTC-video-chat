/* eslint-disable no-await-in-loop -- Serial GPU workloads, never run with a live capture. */
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const out = resolve('integrations/piik/.build/performance');
mkdirSync(out, { recursive: true });
const binary = resolve(process.env.PIIK_PERF_ENCODER || join(out, 'native/baseline.exe'));
if (!existsSync(binary)) throw Error('Run scripts/build-piik-performance.ps1 first');
const two = process.argv.includes('--two-outputs');
const profiles = two ? [[3840, 2160, 15000000]] : [[1920, 1080, 6000000], [2560, 1440, 10000000], [3840, 2160, 15000000]];
const results = [];
for (const [width, height, bitrate] of profiles) for (let repeat = 1; repeat <= 3; repeat++) {
    const active = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        '@(Get-Process piik-capture -ErrorAction SilentlyContinue).Count'], { encoding: 'utf8', windowsHide: true }).trim();
    if (active !== '0') throw Error('Live native capture detected; GPU benchmark stopped without touching it');
    const gpuSamples = [];
    const gpu = spawn('nvidia-smi.exe', ['--query-gpu=utilization.gpu,utilization.encoder', '--format=csv,noheader,nounits', '--loop-ms=1000'], { windowsHide: true, stdio: 'pipe' });
    let gpuFailure = null, gpuText = '';
    gpu.on('error', e => { gpuFailure = e.message; });
    gpu.stdout.on('data', bytes => {
        gpuText += bytes.toString();
        const lines = gpuText.split(/\r?\n/);
        gpuText = lines.pop();
        for (const line of lines) {
        const [render, encode] = line.split(',').map(Number);
        if (Number.isFinite(render) && Number.isFinite(encode)) gpuSamples.push({ gpuPercent: render, encoderPercent: encode });
        }
    });
    gpu.stderr.on('data', () => {});
    const child = spawn(binary, [String(width), String(height), String(bitrate), '5', two ? '1' : '0', '-'], {
        windowsHide: true, stdio: 'pipe', env: { ...process.env, PIIK_CAPTURE_DEBUG: '1' },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    let exit;
    try {
        exit = await new Promise((done, reject) => { child.once('exit', done); child.once('error', reject); });
    } finally { gpu.kill(); }
    const label = `${two ? 'two-output' : 'baseline'}-${width}-${repeat}`;
    writeFileSync(join(out, `${label}.log`), stderr);
    if (exit !== 0) throw Error(`GPU fixture failed: ${label}; see its bounded log`);
    const result = JSON.parse(stdout.trim());
    result.input = 'eight deterministic pre-uploaded dynamic NV12 textures; no WGC/scaling pipeline';
    result.preference = 'maintain-framerate (same before/after; reduced resolution disqualifies target size)';
    result.gpu = { scope: 'whole NVIDIA GPU, not process attribution', samples: gpuSamples,
        unavailable: gpuFailure || (gpuSamples.length ? null : 'nvidia-smi returned no valid samples') };
    result.encoderCounters = stderr.trim().split(/\r?\n/).filter(l => l.startsWith('event=encoder-stats')).map(line =>
        Object.fromEntries(line.split(' ').map(kv => kv.split('=')).filter(kv => kv.length === 2).map(([k,v]) => [k, Number.isFinite(Number(v)) ? Number(v) : v])));
    writeFileSync(join(out, `${label}.json`), JSON.stringify(result, null, 2));
    results.push(result);
    process.stdout.write(`${label}: ${result.outputs[0].fps.toFixed(2)} FPS, reduced=${result.outputs[0].reducedResolutionFrames}, noOutput=${result.outputs[0].noOutput}\n`);
}
writeFileSync(join(out, two ? 'two-output-report.json' : 'native-report.json'), JSON.stringify({ binary, results }, null, 2));
