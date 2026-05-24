class PassthroughProcessor extends AudioWorkletProcessor {
    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        for (let channel = 0; channel < input.length; channel++) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];

            if (inputChannel && outputChannel) {
                for (let i = 0; i < inputChannel.length; i++) {
                    outputChannel[i] = inputChannel[i];
                }
            }
        }

        return true;
    }
}

registerProcessor('passthrough-processor', PassthroughProcessor);
