/* eslint-disable no-await-in-loop -- Each retry waits for a new explicit user choice. */
// Retry only the initial navigation. A running room keeps its own reconnection
// policy, media streams and draft; this helper never reloads an active call.
async function openRoom({ url, createStartup, confirm, cancelled, log }) {
    while (!cancelled()) {
        const startup = createStartup();
        try {
            await startup.load(url);
            return !cancelled();
        } catch (error) {
            startup.dispose();
            if (cancelled()) return false;
            log(`room-startup-failed ${error.message}`);
            const answer = await confirm({
                title: '暂时无法连接语音据点',
                detail: '请检查网络后重试。原有设置会保留。',
                accept: '重试连接', cancel: '退出客户端',
            });
            if (cancelled() || answer.response !== 0) return false;
        }
    }
    return false;
}
module.exports = { openRoom };
