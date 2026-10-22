// Summarize measured JSON only; raw media/logs remain in the ignored build folder.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const directory = resolve('integrations/piik/.build/performance');
const read = name => JSON.parse(readFileSync(join(directory, name), 'utf8'));
const number = value => Number.isFinite(value) ? value.toFixed(2) : '—';
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
const weighted = (rows, key, window = 'rtcWindowMs') =>
    sum(rows.map(r => ({ value: r[key] * r[window] })), 'value') / sum(rows, window);
const rows = [];
for (const file of readdirSync(directory).sort()) {
    if (!/^(baseline|filtered)(-r\d+)?-(1080p|1440p|2160p)-p2p\.json$/.test(file)) continue;
    const d = read(file);
    const visible = d.intervals.filter((r, i) => r.playbackValid ??
        (!d.rawSamples[i].hidden && !d.rawSamples[i + 1].hidden));
    rows.push({ file, preset: d.preset, tag: d.tag, cpuCores: d.appCpuCores,
        retainedLogBytes: d.retainedLogBytes, receivedFps: weighted(d.intervals, 'receivedFps'),
        decodedFps: weighted(d.intervals, 'decodedFps'), mbps: weighted(d.intervals, 'mbps'),
        submittedFps: weighted(visible, 'submittedFps', visible[0]?.submittedWindowMs ? 'submittedWindowMs' : 'playbackWindowMs'),
        playbackDropsVisible: sum(visible, 'playbackDropped'), decodeDrops: sum(d.intervals, 'decodeDropped'),
        excludedPlaybackWindows: d.intervals.length - visible.length,
        captureWorkers: d.captureWorkers, playbackDropsAll: sum(d.intervals, 'playbackDropped') });
}
const native = [];
for (const file of ['native-report.json', 'two-output-report.json']) {
    const report = read(file);
    report.results.forEach((d, i) => {
        const output = d.outputs[0], samples = d.gpu?.samples || [];
        native.push({ file, repeat: i % 3 + 1, width: d.width, height: d.height,
            outputs: d.outputs.length, encoder: d.encoder, fps: output.fps,
            mbps: output.mbps, noOutput: output.noOutput,
            reducedResolutionFrames: output.reducedResolutionFrames,
            meanWorkMs: output.meanWorkMs, p95WorkMs: output.p95WorkMs,
            scheduleMissed: d.scheduleMissed, cpuMs: d.cpuMs,
            gpuEncoderMeanPercent: samples.length ? sum(samples, 'encoderPercent') / samples.length : null,
            gpuEncoderMaxPercent: samples.length ? Math.max(...samples.map(s => s.encoderPercent)) : null,
            lastEncoderCounters: d.encoderCounters?.filter(c => c.output === 0).at(-1) || null });
    });
}
const wgc = [], wgcP2p = [];
for (const file of readdirSync(directory).sort()) {
    if (/^wgc-(before|after)-r[1-3]\.json$/.test(file)) {
        const d = read(file);
        wgc.push({ file, tag: d.tag, captureFps: d.acceptedCaptureFps, encodedFps: d.encodedFps, reducedFrames: d.reducedFrames, mbps: d.mbps });
    }
    if (/^wgc-(?:(before|after)-r[1-3]|gpu-(before|after))-2160p-p2p\.json$/.test(file)) {
        const d = read(file), visible = d.intervals.filter(r => r.playbackValid);
        wgcP2p.push({ file, tag: d.tag, gpuAllowed: Boolean(d.gpuAllowed), receivedFps: weighted(d.intervals, 'receivedFps'), decodedFps: weighted(d.intervals, 'decodedFps'),
            submittedFps: weighted(visible, 'submittedFps', 'submittedWindowMs'), playbackDrops: sum(visible, 'playbackDropped'),
            decodeDrops: sum(d.intervals, 'decodeDropped'), lost: sum(d.intervals, 'lost'), mbps: weighted(d.intervals, 'mbps'),
            reducedWindows: d.intervals.filter(r => r.width !== 3840 || r.height !== 2160).length,
            captureWorkers: d.captureWorkers, cleanup: d.captureCleanupPassed, routes: d.routes });
    }
}
const result = { generatedAt: new Date().toISOString(), p2p: rows, native, wgc, wgcP2p };
writeFileSync(join(directory, 'comparison.json'), JSON.stringify(result, null, 2));
const table = [
    '# Piik 本机隔离测试汇总', '',
    '自动生成；CPU 为 App 使用的逻辑核数；日志为测试结束时最多两份轮转文件的保留量，不等于累计写入量。', '',
    '## 预编码动态 H.264 → 真实 Piik P2P → headless Edge 软件接收', '',
    '| 档位 / 构建 | CPU 核 | 日志 KB | 接收 FPS | 解码 FPS | 可见提交 FPS | 可见播放丢帧 | 排除后台区间 | 实际 Mbps |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(r => `| ${r.preset} / ${r.tag} | ${number(r.cpuCores)} | ${number(r.retainedLogBytes / 1000)} | ${number(r.receivedFps)} | ${number(r.decodedFps)} | ${number(r.submittedFps)} | ${r.playbackDropsVisible} | ${r.excludedPlaybackWindows} | ${number(r.mbps)} |`), '',
    '固定预编码输入不执行实时码率控制；4K 约17 Mbps，不可当成15 Mbps实时编码验收。各指标按各自窗口汇总；r3 起记录完整可见性变更，旧报告只能检查窗口两端。提交合成器不等于物理显示。', '',
    '## 动态 NV12 GPU 纹理 → 真实 Piik AdaptiveEncoder / NVIDIA H.264 Encoder MFT', '',
    '| 目标 / 输出数 / 重复 | 编码 FPS | 降尺寸帧 | 无输出 | 调度跳过 | 均值 / p95 ms | 实际 Mbps | GPU编码均值 / 峰值 % |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...native.map(r => `| ${r.width}×${r.height} / ${r.outputs} / ${r.repeat} | ${number(r.fps)} | ${r.reducedResolutionFrames} | ${r.noOutput} | ${r.scheduleMissed} | ${number(r.meanWorkMs)} / ${number(r.p95WorkMs)} | ${number(r.mbps)} | ${number(r.gpuEncoderMeanPercent)} / ${number(r.gpuEncoderMaxPercent)} |`), '',
    '1秒预热、5秒测量、目标60 FPS；1080p 6 Mbps、1440p 10 Mbps、4K 15 Mbps。存在降尺寸的测试未达到目标画质。', '',
    '纹理已上传且适配后的纹理预生成；不包含真实WGC采集/缩放/游戏竞争。GPU指标来自整张显卡，包含初始化和其他进程，不作进程归因。', '',
    '## 自建静音动态窗口 → 真实 WGC / NVIDIA MFT（4K60，15 Mbps）', '',
    '| 构建 / 重复 | 采集接受 FPS | 编码 FPS | 降尺寸帧 | 实际 Mbps |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...wgc.map(r => `| ${r.tag} | ${number(r.captureFps)} | ${number(r.encodedFps)} | ${r.reducedFrames} | ${number(r.mbps)} |`), '',
    '每次90编码帧预热、8秒测量；采集接受 FPS 为进入编码队列的 FrameBegin，不是所有 WGC 回调。只捕获测试自身的 HWND/PID/creationTime。', '',
    '## 同一过滤日志的 App，只替换 WGC 采集程序 → Pion → headless Edge', '',
    '| 构建 / 重复 | 接收 FPS | 解码 FPS | 提交 FPS | 播放丢帧 | 解码丢帧 | 丢包 | 实际 Mbps | 降尺寸区间 | worker / 清理 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...wgcP2p.map(r => `| ${r.tag} | ${number(r.receivedFps)} | ${number(r.decodedFps)} | ${number(r.submittedFps)} | ${r.playbackDrops} | ${r.decodeDrops} | ${r.lost} | ${number(r.mbps)} | ${r.reducedWindows} | ${r.captureWorkers} / ${r.cleanup} |`), '',
    '同一合成内容；约3秒预热后8秒测量。r1～r3强制软件接收，gpu-before/after仅允许GPU（不保证具体解码器），两种接收配置分别对照。实际 WGC/MFT 和 Pion 发送，App保留上游双输出。提交合成器仍有丢帧，不能当成实机稳60验收。', '',
    '原始数据、逐窗口计数、编码器丢帧原因见同目录 JSON / log；不提交这些日志或合成媒体。', '',
];
writeFileSync(join(directory, 'comparison.md'), table.join('\n'));
process.stdout.write(`Generated ${join(directory, 'comparison.md')}\n`);
