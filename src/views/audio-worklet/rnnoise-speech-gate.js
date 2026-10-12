// Uses RNNoise's existing VAD result; no additional model, lookahead or buffer.
export const createSpeechGate = ({
    sampleRate = 48000,
    enabled = true,
} = {}) => {
    const floor = 0.01; // -40 dB for confidently non-speech frames.
    const openThreshold = 0.6;
    const closeThreshold = 0.2;
    const holdSamples = Math.round(sampleRate * 0.18);
    const attackStep = 1 / Math.max(1, Math.round(sampleRate * 0.003));
    const releaseStep = 1 / Math.max(1, Math.round(sampleRate * 0.08));
    let gain = enabled ? floor : 1;
    let hold = 0;
    let speaking = false;

    const setEnabled = (value) => {
        enabled = Boolean(value);
        hold = 0;
        speaking = false;
    };
    const processFrame = (frame, probability) => {
        // Unknown/invalid VAD must preserve audio, never turn a model error
        // into a permanently closed microphone.
        const valid =
            Number.isFinite(probability) &&
            probability >= 0 &&
            probability <= 1;
        let target = 1;
        if (enabled && valid) {
            if (
                probability >= openThreshold ||
                (speaking && probability >= closeThreshold)
            ) {
                speaking = true;
                hold = holdSamples;
            } else {
                hold = Math.max(0, hold - frame.length);
                if (hold === 0) speaking = false;
            }
            if (!speaking && hold === 0) {
                // Uncertain speech is attenuated softly, rather than hard muted.
                const confidence = Math.max(
                    0,
                    Math.min(
                        1,
                        (probability - closeThreshold) /
                            (openThreshold - closeThreshold)
                    )
                );
                target = floor + (1 - floor) * confidence;
            }
        }
        for (let i = 0; i < frame.length; i += 1) {
            const step = target > gain ? attackStep : releaseStep;
            gain += Math.max(-step, Math.min(step, target - gain));
            frame[i] *= gain;
        }
        return gain;
    };
    return { processFrame, setEnabled };
};
