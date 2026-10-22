(function exposeShareWatchStatus(global) {
    'use strict';

    // Read existing transport snapshots and player events. No capture, stats
    // polling, retry policy or route changes belong in this presentation layer.
    const describe = ({ local, previewHidden, error, ended, connections = [], paused, ready, waiting } = {}) => {
        if (local) return previewHidden ? { state: 'preview-hidden', text: '本机预览已隐藏，共享仍在继续。' } : { state: 'playing', text: '' };
        if (error) return { state: 'error', text: '当前共享无法播放，请尝试重新进入频道。' };
        if (ended) return { state: 'interrupted', text: '共享画面已中断，等待共享者恢复…' };
        if (connections.some((state) => ['failed', 'closed', 'disconnected'].includes(state))) {
            return { state: 'reconnecting', text: '共享连接中断，等待恢复…' };
        }
        if (!ready) return { state: 'connecting', text: '正在连接共享画面…' };
        if (paused) return { state: 'paused', text: '播放已暂停', resume: true };
        if (waiting) return { state: 'buffering', text: '画面正在缓冲…' };
        return { state: 'playing', text: '' };
    };
    const createRuntime = ({ root, getSource } = {}) => {
        const doc = root.ownerDocument;
        let tile, video, stream, panel, label, resume, observer, timer, noticeTimer;
        let initialized = false, disposed = false, waitingSince = 0;
        let resumeRevision = 0, failedResumeRevision = -1;
        const cleanups = [];
        const listen = (node, type, callback) => {
            node?.addEventListener(type, callback);
            cleanups.push(() => node?.removeEventListener(type, callback));
        };
        const release = () => {
            resumeRevision++;
            cleanups.splice(0).forEach((cleanup) => cleanup());
            panel?.remove(); panel = label = resume = undefined;
            tile = video = stream = undefined; waitingSince = 0;
        };
        const syncStream = () => {
            if (stream === video?.srcObject) return;
            stream = video?.srcObject;
            resumeRevision++;
            waitingSince = 0;
            failedResumeRevision = -1;
        };
        const update = () => {
            if (!tile || disposed) return;
            syncStream();
            if (!video?.paused) failedResumeRevision = -1;
            const source = getSource(tile.id) || {};
            const connections = source.piikConnections?.filter((entry) => entry.统计年龄_ms <= 10000)
                .flatMap((entry) => [entry.连接状态, entry.ICE状态]) || [source.pc?.connectionState, source.pc?.iceConnectionState];
            const state = describe({ local: source.isLocal, previewHidden: source.previewHidden,
                error: video?.error, paused: video?.paused, ready: video?.readyState >= 2 && video?.videoWidth > 0,
                ended: video?.srcObject?.getVideoTracks?.().some((track) => track.readyState === 'ended'),
                waiting: waitingSince > 0 && Date.now() - waitingSince > 800, connections });
            const text = state.state === 'paused' && failedResumeRevision === resumeRevision
                ? '浏览器未能恢复播放，请检查媒体权限后重试。' : state.text;
            if (tile.dataset.playbackState !== state.state) tile.dataset.playbackState = state.state;
            if (label.textContent !== text) label.textContent = text;
            panel.hidden = !text;
            resume.hidden = !state.resume;
        };
        const select = () => {
            if (disposed) return;
            const next = root.querySelector('#video-grid > .is-stage-focus') || undefined;
            const player = next?.querySelector('video');
            if (next === tile && player === video) return;
            const ended = Boolean(tile && !next && root.dataset.voiceState === 'joined');
            release();
            const notice = doc.getElementById('stageShareNotice');
            global.clearTimeout(noticeTimer);
            if (notice) {
                notice.hidden = !ended;
                if (ended) {
                    notice.textContent = '共享已结束，已返回语音';
                    noticeTimer = global.setTimeout(() => { notice.hidden = true; }, 6000);
                }
            }
            if (!next) return;
            tile = next; video = player;
            panel = doc.createElement('div'); panel.className = 'share-watch-message no-drag'; panel.setAttribute('role', 'status');
            label = doc.createElement('span'); resume = doc.createElement('button');
            resume.type = 'button'; resume.textContent = '继续观看';
            panel.append(label, resume); (tile.querySelector('.tile-body') || tile).append(panel);
            listen(resume, 'click', async () => {
                syncStream();
                const player = video, stream = player?.srcObject, targetLabel = label;
                const revision = ++resumeRevision;
                const isCurrent = () => !disposed && revision === resumeRevision && player === video &&
                    player?.srcObject === stream && targetLabel === label;
                try {
                    update();
                    // Invoke before awaiting so the click retains user activation.
                    await player?.play();
                    if (isCurrent()) update();
                } catch {
                    if (isCurrent() && player.paused) {
                        failedResumeRevision = revision; update();
                    }
                }
            });
            for (const type of ['playing', 'loadeddata', 'resize', 'pause', 'error', 'emptied', 'ended']) {
                listen(video, type, () => {
                    if (['playing', 'emptied', 'ended'].includes(type)) resumeRevision++;
                    if (['playing', 'loadeddata', 'emptied', 'ended', 'error'].includes(type)) waitingSince = 0;
                    update();
                });
            }
            for (const type of ['waiting', 'stalled']) listen(video, type, () => {
                syncStream(); waitingSince ||= Date.now();
            });
            update();
        };
        const onSample = (event) => { if (event.detail?.tile === tile) update(); };
        return {
            init: () => {
                if (initialized || disposed) return;
                initialized = true;
                observer = new global.MutationObserver(select);
                observer.observe(root.querySelector('#video-grid') || root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
                doc.addEventListener('voice:share-sample', onSample);
                timer = global.setInterval(() => { if (!doc.hidden) update(); }, 1000);
                select();
            },
            destroy: () => {
                disposed = true; observer?.disconnect(); release();
                doc.removeEventListener('voice:share-sample', onSample);
                global.clearInterval(timer); global.clearTimeout(noticeTimer);
                const notice = doc.getElementById('stageShareNotice'); if (notice) notice.hidden = true;
            },
        };
    };
    global.VoiceShareWatchStatus = { createRuntime, describe };
})(window);
