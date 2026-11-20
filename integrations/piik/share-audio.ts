import type { NativeClient } from './.deps/upstream/src/client/native/client';

export const SCREEN_AUDIO_BITRATE = 256_000;

export const audioTargetKey = (target: {pid: number; creationTime: string}) => `${target.pid}:${target.creationTime}`;
export function parseAudioTarget(key: unknown) {
    const match = typeof key === 'string' && /^([1-9]\d{0,9}):([1-9]\d{0,19})$/.exec(key);
    if (!match || Number(match[1]) > 0xffffffff || BigInt(match[2]) > 0xffffffffffffffffn) return null;
    return {pid: Number(match[1]), creationTime: match[2]};
}
export function nativeAudioSelection(options: any, client: NativeClient, source: any) {
    let mode = options.nativeAudioMode || (options.shareAudio ? 'source' : 'none');
    if (!['none', 'system', 'application', 'source'].includes(mode)) throw Error('请选择有效的共享音频模式');
    if (mode === 'source') {
        if (!options.shareAudio) return {audio: false, microphoneMixing: false};
        if (options.shareAudio && !(source.kind === 'window' ? client.health.nativeMedia.processAudio : client.health.nativeMedia.systemAudio))
            throw Error('当前客户端不支持此来源的声音');
        // Legacy display capture is endpoint loopback, including received voice.
        // Reuse the independent process-tree path instead of starting that mix.
        if (source.kind !== 'window') {
            if (!client.health.nativeMedia.independentAudio || !client.health.nativeMedia.processAudioExclusion)
                throw Error('旧版整屏声音会回传通话，请升级客户端后使用“系统声音”，或选择独立应用窗口声音');
            mode = 'system';
        } else if (client.health.nativeMedia.independentAudio) {
            const target = parseAudioTarget(`${source.pid}:${source.creationTime}`);
            if (!target) throw Error('窗口应用音源已失效，请刷新并重新选择');
            return {audioMode: 'application' as const, audioTarget: target, audio: true, microphoneMixing: false};
        } else return {audio: true, microphoneMixing: false};
    }
    if (!client.health.nativeMedia.independentAudio) {
        if (mode === 'none') return {audio: false, microphoneMixing: false};
        throw Error('独立音源需要新版 Windows 客户端；旧版可选择应用窗口声音');
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
export function createAudioSourcePicker() {
    const mode = document.querySelector<HTMLSelectElement>('[data-native-audio-mode]');
    const select = document.querySelector<HTMLSelectElement>('[data-native-audio-target]');
    const group = document.querySelector<HTMLElement>('[data-native-audio-application]');
    const hint = document.querySelector<HTMLElement>('[data-native-audio-hint]');
    const icon = document.querySelector<HTMLImageElement>('[data-native-audio-icon]');
    let generation = 0;
    let selected = '';
    let applications: any[] = [];
    let audioStatus = '';
    const sync = () => {
        if (group) group.hidden = mode?.value !== 'application';
        selected = select?.value || selected;
        if (icon) {
            const source = applications.find(app => audioTargetKey(app) === select?.value);
            icon.hidden = !source?.icon;
            icon.src = source?.icon || '';
        }
        if (hint) {
            const unavailable = mode?.value === 'system' && mode.selectedOptions[0]?.disabled;
            const text = audioStatus || (unavailable ? '此设备无法安全共享系统声音。请选择应用或关闭共享声音。' : '');
            hint.textContent = text;
            hint.hidden = !text;
        }
    };
    mode?.addEventListener('change', sync);
    select?.addEventListener('change', sync);
    sync();
    const close = () => { generation++; };
    return {
        close,
        sync,
        setSelected(key: string) {
            selected = key || '';
            if (select) select.value = selected;
        },
        async load(client: NativeClient) {
            const token = ++generation;
            if (!mode || !select) return;
            audioStatus = '';
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
                select.replaceChildren(new Option('选择应用', ''), ...applications.map(app =>
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
                const system = mode.querySelector<HTMLOptionElement>('[value="system"]');
                if (system) system.disabled = true;
                audioStatus = '无法读取声音来源。请刷新来源，或关闭共享声音。';
                sync();
                select.dispatchEvent(new Event('change', {bubbles: true}));
            }
        },
    };
}
