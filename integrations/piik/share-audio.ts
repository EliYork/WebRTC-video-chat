import type { NativeClient } from './.deps/upstream/src/client/native/client';

export const audioTargetKey = (target: {pid: number; creationTime: string}) => `${target.pid}:${target.creationTime}`;
export function parseAudioTarget(key: unknown) {
    const match = typeof key === 'string' && /^([1-9]\d{0,9}):([1-9]\d{0,19})$/.exec(key);
    if (!match || Number(match[1]) > 0xffffffff || BigInt(match[2]) > 0xffffffffffffffffn) return null;
    return {pid: Number(match[1]), creationTime: match[2]};
}
export function nativeAudioSelection(options: any, client: NativeClient, source: any) {
    const mode = options.nativeAudioMode || (options.shareAudio ? 'source' : 'none');
    if (!['none', 'system', 'application', 'source'].includes(mode)) throw Error('请选择有效的共享音频模式');
    if (mode === 'source') {
        if (options.shareAudio && !(source.kind === 'window' ? client.health.nativeMedia.processAudio : client.health.nativeMedia.systemAudio))
            throw Error('当前客户端不支持此来源的声音');
        return {audio: options.shareAudio === true, microphoneMixing: false};
    }
    if (!client.health.nativeMedia.independentAudio) {
        if (mode === 'none') return {audio: false, microphoneMixing: false};
        throw Error('独立音源需要新版 Windows 客户端；旧版可使用“随画面”声音');
    }
    const target = mode === 'application' ? parseAudioTarget(options.nativeAudioTargetKey) : null;
    if (mode === 'application' && (!target || !client.health.nativeMedia.processAudio)) throw Error('请选择有效的应用音源；应用重启后需刷新重选');
    if (mode === 'system' && !client.health.nativeMedia.processAudioExclusion) throw Error('当前系统无法排除客户端通话声音，请选择应用音源');
    return {audioMode: mode as 'none' | 'system' | 'application', ...(target ? {audioTarget: target} : {}), audio: mode !== 'none', microphoneMixing: false};
}
export function nativeFailureText(error: any) {
    const reason = error?.cause?.reason;
    return ({
        'hardware-unavailable': '没有可用的 H.264 硬件编码器；未启用软件回退',
        'encoder-failed': 'H.264 硬件编码初始化或运行失败；请检查显卡驱动和编码负载',
        'media-capture-failed': '画面采集失败；请检查目标窗口是否已关闭或受保护',
        'audio-target-invalid': '应用音源已退出、重启或不可访问，请刷新并重新选择',
        'audio-capture-failed': '共享音频采集失败；未切换为系统声音，请重新选择音源',
        'system-exclusion-unavailable': '无法安全排除客户端通话声音，请选择指定应用声音',
        'capture-unconfirmed': '原生采集或编码失败，原因未确认；请查看客户端诊断',
    } as Record<string,string>)[reason] || error?.message || '原生共享失败，原因未确认';
}
export function encoderSummary(status: any) {
    const confirmed = status?.state === 'active' && status?.codec === 'h264' && status?.hardware === true;
    return {
        codec: status?.codec === 'h264' ? 'H.264' : '未确认',
        method: confirmed ? 'GPU 硬件编码' : '未确认',
        encoder: confirmed && status.encoder ? status.encoder : '未确认',
        adapter: confirmed && status.adapter ? status.adapter : '未确认',
        state: status?.state === 'active' ? '正在编码' : status?.state === 'starting' ? '正在初始化，尚未确认输出' : '等待开始共享',
    };
}
export function showEncoderStatus(status: any) {
    const summary = encoderSummary(status);
    for (const [key,value] of Object.entries(summary)) {
        const element = document.querySelector<HTMLElement>(`[data-native-encoder-${key}]`);
        if (element) element.textContent = value;
    }
}

// Shares the selector's short-lived authorized connection. Metadata only;
// closing/refreshing the dialog invalidates every outstanding result.
export function createAudioSourcePicker() {
    const mode = document.querySelector<HTMLSelectElement>('[data-native-audio-mode]');
    const select = document.querySelector<HTMLSelectElement>('[data-native-audio-target]');
    const group = document.querySelector<HTMLElement>('[data-native-audio-application]');
    const hint = document.querySelector<HTMLElement>('[data-native-audio-hint]');
    const icon = document.querySelector<HTMLImageElement>('[data-native-audio-icon]');
    let generation = 0;
    let selected = '';
    let applications: any[] = [];
    const sync = () => {
        if (group) group.hidden = mode?.value !== 'application';
        selected = select?.value || selected;
        if (icon) {
            const source = applications.find(app => audioTargetKey(app) === select?.value);
            icon.hidden = !source?.icon;
            icon.src = source?.icon || '';
        }
        const descriptions: Record<string,string> = {
            none: '仅共享画面，麦克风语音保持独立。',
            system: '系统声音将排除本客户端进程树。其他浏览器或通话软件的声音仍可能被共享。',
            application: '列出当前会话中可访问的进程（最多 1024 项，含无窗口应用），优先显示有音频会话的进程。采集所选进程及其子进程；无声时保持静音。浏览器可能包含多个标签页，也可能由其他进程播放，无法保证单标签隔离。应用重启后需刷新重选。',
            source: '旧版能力：窗口对应应用声音，或整屏系统声音；整屏声音可能包含通话。',
        };
        if (hint) hint.textContent = descriptions[mode?.value || 'none'];
    };
    mode?.addEventListener('change', sync);
    select?.addEventListener('change', sync);
    sync();
    const close = () => { generation++; };
    return {
        close,
        sync,
        setSelected(key: string) { selected = key || ''; },
        async load(client: NativeClient) {
            const token = ++generation;
            if (!mode || !select) return;
            const legacy = mode.querySelector<HTMLOptionElement>('[data-native-audio-legacy]');
            if (legacy) legacy.hidden = client.health.nativeMedia.independentAudio;
            try {
                let systemSafe = false;
                if (client.health.nativeMedia.independentAudio) {
                    const response = await client.audioSources();
                    if (token !== generation) return;
                    applications = response.sources; systemSafe = response.systemSafe;
                } else applications = [];
                if (token !== generation) return;
                for (const option of Array.from(mode.options)) {
                    option.disabled = option.value === 'application' ? !client.health.nativeMedia.processAudio || !client.health.nativeMedia.independentAudio : option.value === 'system' ? !systemSafe : false;
                }
                select.replaceChildren(new Option('选择应用（含无窗口进程）', ''), ...applications.map(app =>
                    new Option(`${app.name} · PID ${app.pid}${app.active ? ' · 音频会话活跃' : app.hasSession ? ' · 音频会话空闲' : ' · 暂无音频会话'}`, audioTargetKey(app))));
                select.value = selected;
                // Retain an invalid selection as invalid. Never silently choose
                // another process with the same executable name or a reused PID.
                if (selected && !select.value) {
                    select.add(new Option('原应用已失效，请刷新重选', selected)); select.value = selected;
                    select.selectedOptions[0].disabled = true;
                }
                sync();
                select.dispatchEvent(new Event('change', {bubbles: true}));
            } catch {
                if (token !== generation) return;
                applications = []; select.replaceChildren(new Option('读取失败，请刷新来源', ''));
                if (hint) hint.textContent = '无法读取应用音源；请刷新来源或升级客户端。未切换为系统声音。';
            }
        },
    };
}
