// Adapter for the exact @shiguredo/rnnoise-wasm 2025.1.5 binary exports.
// The upstream RNNoise implementation and weights are unchanged.
export const loadRnnoiseV2 = async (binary) => {
    let wasm;
    const imports = {
        env: {
            __assert_fail: () => { throw new Error('rnnoise-v2-assert'); },
            emscripten_resize_heap: (size) => {
                try {
                    const memory = wasm.memory;
                    memory.grow(Math.max(0, Math.ceil((size - memory.buffer.byteLength) / 65536)));
                    return 1;
                } catch { return 0; }
            },
        },
        wasi_snapshot_preview1: {
            fd_write: (fd, vectors, count, written) => {
                const heap = new Uint32Array(wasm.memory.buffer);
                let bytes = 0;
                for (let i = 0; i < count; i++) bytes += heap[(vectors >>> 2) + i * 2 + 1];
                heap[written >>> 2] = bytes;
                return 0;
            },
        },
    };
    const result = await WebAssembly.instantiate(binary, imports);
    wasm = (result.instance || result).exports;
    wasm.emscripten_stack_init();
    wasm.__wasm_call_ctors();
    const frameSize = wasm.rnnoise_get_frame_size();
    if (frameSize !== 480) throw new Error('rnnoise-v2-frame-size');
    return {
        frameSize,
        createDenoiseState() {
            let state = 0, input = 0, output = 0;
            const destroy = () => {
                if (state) wasm.rnnoise_destroy(state);
                if (input) wasm.free(input);
                if (output) wasm.free(output);
                state = input = output = 0;
            };
            try {
                state = wasm.rnnoise_create(0);
                input = wasm.malloc(frameSize * 4);
                output = wasm.malloc(frameSize * 4);
                if (!state || !input || !output) throw new Error('rnnoise-v2-allocation');
            } catch (error) { destroy(); throw error; }
            let inputView, outputView;
            return {
                // Same signed-16-bit float convention as the legacy adapter.
                processFrame(frame) {
                    if (!state || frame.length !== frameSize) throw new Error('rnnoise-v2-state');
                    if (inputView?.buffer !== wasm.memory.buffer) {
                        inputView = new Float32Array(wasm.memory.buffer, input, frameSize);
                        outputView = new Float32Array(wasm.memory.buffer, output, frameSize);
                    }
                    inputView.set(frame);
                    const vad = wasm.rnnoise_process_frame(state, output, input);
                    // Inference itself does not allocate. The view check on
                    // the next frame also handles another state growing memory.
                    frame.set(outputView);
                    return vad;
                },
                destroy,
            };
        },
    };
};
