const FRAME_SIZE = 480;
const STATS_INTERVAL_FRAMES = 1800;

class RNNoiseProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.rawBuffer = [];
        this.processedBuffer = [];
        this.ready = false;
        this.fallback = false;
        this.pendingFrame = false;
        this.lastOutSample = 0;

        this.processCount = 0;
        this.frameCount = 0;
        this.processedCount = 0;
        this.passthroughCount = 0;
        this.statsFrames = 0;

        this.port.onmessage = (event) => {
            const { type, data } = event.data;

            if (type === 'processed') {
                const output = new Float32Array(data);

                for (let i = 0; i < output.length; i++) {
                    this.processedBuffer.push(output[i]);
                }

                this.pendingFrame = false;
                this.processedCount++;
            }
        };
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0] || !output || !output[0]) {
            return true;
        }

        const inputChannel = input[0];
        const outputChannel = output[0];
        const numChannels = Math.min(input.length, output.length);

        this.processCount++;

        for (let i = 0; i < inputChannel.length; i++) {
            this.rawBuffer.push(inputChannel[i]);
        }

        while (this.rawBuffer.length >= FRAME_SIZE && !this.pendingFrame) {
            const frame = this.rawBuffer.splice(0, FRAME_SIZE);

            this.frameCount++;

            if (this.ready && !this.fallback) {
                this.pendingFrame = true;
                this.port.postMessage(
                    { type: 'process', data: new Float32Array(frame) },
                    [frame.buffer]
                );
            } else {
                for (let j = 0; j < frame.length; j++) {
                    this.processedBuffer.push(frame[j]);
                }
                this.passthroughCount++;
            }
        }

        for (let i = 0; i < outputChannel.length; i++) {
            if (this.processedBuffer.length > 0) {
                const sample = this.processedBuffer.shift();
                outputChannel[i] = sample;
                this.lastOutSample = sample;
            } else if (this.pendingFrame || this.ready) {
                outputChannel[i] = this.lastOutSample;
            } else {
                outputChannel[i] =
                    i < inputChannel.length ? inputChannel[i] : 0;
                this.lastOutSample = outputChannel[i];
            }
        }

        for (let ch = 1; ch < numChannels; ch++) {
            const outCh = output[ch];

            for (let i = 0; i < outCh.length; i++) {
                outCh[i] = outputChannel[i];
            }
        }

        this.statsFrames++;
        if (this.statsFrames >= STATS_INTERVAL_FRAMES) {
            this.statsFrames = 0;
            this.port.postMessage({
                type: 'stats',
                data: {
                    processCount: this.processCount,
                    frameCount: this.frameCount,
                    processedCount: this.processedCount,
                    passthroughCount: this.passthroughCount,
                    pendingFrame: this.pendingFrame,
                    ready: this.ready,
                    fallback: this.fallback,
                    rawBufferLen: this.rawBuffer.length,
                    processedBufferLen: this.processedBuffer.length,
                },
            });
        }

        return true;
    }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
