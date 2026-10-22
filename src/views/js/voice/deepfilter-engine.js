// Pinned, local-only runtime assets. Loading starts only when enhanced denoising
// is selected; failed/cancelled downloads are never cached as a usable model.
export const DEEPFILTER_ASSETS = Object.freeze({
    worklet: '/vendor/deepfilter-0.2.0/processor.js',
    wasm: '/wasm/deepfilter-0.2.0/df_bg.wasm',
    model: '/wasm/deepfilter-0.2.0/DeepFilterNet3_onnx.tar.gz',
});
const HASHES = {
    wasm: '8ebf2b217b80fc128505b993c8d7d7d892df5a845ab7a2516fed74b76e7fe708',
    model: 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616',
};
export const createDeepfilterLoader = ({
    fetchBytes = async (url, signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error('deepfilter-download-failed');
        return response.arrayBuffer();
    },
    digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        value => value.toString(16).padStart(2, '0')).join(''),
    compile = bytes => WebAssembly.compile(bytes),
} = {}) => {
    let cached;
    return async ({ signal } = {}) => {
        signal?.throwIfAborted();
        if (cached) return cached;
        const deadline = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
        const verified = async (kind) => {
            const bytes = await fetchBytes(DEEPFILTER_ASSETS[kind], deadline);
            if (await digest(bytes) !== HASHES[kind]) throw new Error('deepfilter-integrity-failed');
            deadline.throwIfAborted();
            return bytes;
        };
        const [binary, modelBytes] = await Promise.all([verified('wasm'), verified('model')]);
        const wasmModule = await compile(binary);
        deadline.throwIfAborted();
        cached = { wasmModule, modelBytes };
        return cached;
    };
};
export const loadDeepfilter = createDeepfilterLoader();

export class DeepfilterWorkletNode extends AudioWorkletNode {
    constructor(context, assets) {
        super(context, 'workadventure-deepfilternet', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
            channelCount: 1, channelCountMode: 'explicit',
            processorOptions: {
                ...assets,
                speechAttenuationDb: 25,
                pauseGate: { extraAttenuationDb: 20, lookaheadFrames: 1,
                    hangoverFrames: 10, releaseDbPerFrame: 0.6,
                    speechAboveFloorDb: 10, maxSpeechAttenuationDb: 15 },
                // The existing microphone gain remains the only gain control.
                bypassUntilReady: false, maxLoad: 0.7, loadReportAfterMs: 4000,
            },
        });
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.port.postMessage({ type: 'dispose' });
        this.disconnect();
        this.port.close();
    }
}
