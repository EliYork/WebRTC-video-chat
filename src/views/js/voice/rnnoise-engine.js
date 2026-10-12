// Load only when RNNoise is selected. Keep the lightweight legacy engine as
// an explicit, reported fallback on unsupported or slow devices.
import { loadRnnoise as loadLegacy } from '../../vendor/web-noise-suppressor.js';
import { loadRnnoiseV2 } from '../../audio-worklet/rnnoise-v2-wasm.js';
/* eslint-disable no-await-in-loop -- Yield between bounded probe batches to avoid a long UI task. */

export const createRnnoiseLoader = ({
    fetchModel = () => fetch('/wasm/rnnoise-v2-2025.1.5.wasm', { signal: AbortSignal.timeout(5000) }),
    compile = (binary) => WebAssembly.compile(binary), loadModern = loadRnnoiseV2,
    loadOld = loadLegacy, now = () => performance.now(),
    yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) => async (legacyOptions) => {
    let fallback = 'model-load-failed';
    try {
        const response = await fetchModel();
        if (!response.ok) throw new Error('rnnoise-v2-download');
        const module = await compile(await response.arrayBuffer());
        const api = await loadModern(module);
        const state = api.createDenoiseState();
        const frame = new Float32Array(api.frameSize);
        const durations = [];
        try {
            // Small, bounded probe. No microphone samples or recordings.
            for (let i = 0; i < 48; i++) {
                for (let j = 0; j < frame.length; j++) frame[j] = Math.sin((i * frame.length + j) * 0.037) * 4000;
                const start = now();
                const vad = state.processFrame(frame);
                if (!Number.isFinite(vad)) throw new Error('rnnoise-v2-invalid');
                if (i >= 8) durations.push(now() - start);
                if (i % 8 === 7) await yieldTask();
            }
        } finally { state.destroy(); }
        durations.sort((a, b) => a - b);
        const p95 = durations[Math.floor(durations.length * 0.95)];
        // One 128-sample quantum is 2.67ms; leave room for graph/framing work.
        if (p95 <= 1.8) return { engine: 'rnnoise-v2-2025.1.5', binary: module, probeP95Ms: Math.round(p95 * 1000) / 1000 };
        fallback = 'model-too-slow';
    } catch { /* legacy resources remain usable */ }
    return { engine: 'rnnoise-legacy-2022', binary: await loadOld(legacyOptions), fallback };
};
export const loadRnnoise = createRnnoiseLoader();

export class RnnoiseWorkletNode extends AudioWorkletNode {
    constructor(context, { wasmBinary, maxChannels }) {
        super(context, '@sapphi-red/web-noise-suppressor/rnnoise', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [maxChannels],
            processorOptions: { wasmBinary: wasmBinary.binary, engine: wasmBinary.engine,
                engineFallback: wasmBinary.fallback || null, probeP95Ms: wasmBinary.probeP95Ms ?? null, maxChannels },
        });
    }
    destroy() { this.port.postMessage('destroy'); this.disconnect(); }
}
