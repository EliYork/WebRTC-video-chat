// Reuse Piik's authenticated App control and native Pion senders. The local
// capture ID is not a Piik room credential; Node alone authorizes publication.
import {
    NativeClient,
    discoverNativeConnect,
} from './.deps/upstream/src/client/native/client';
import { NativeMediaBridge } from './.deps/upstream/src/client/native/media-bridge';
import {
    defaultNativeCapturePath,
    nativeCaptureTargetKey,
} from './.deps/upstream/src/client/native/capture-selection';
import { createNativeSourcePicker } from './source-picker';
import type { NativeCaptureTarget } from './.deps/upstream/src/client/native/wire';
import {createAudioSourcePicker, nativeAudioSelection, nativeFailureText, showEncoderStatus} from './share-audio';

export function createNativeCapture(
    authorize: () => Promise<unknown>,
    onFailure: (message?: string) => void
) {
    let client: NativeClient | null = null;
    let connecting: Promise<NativeClient> | null = null;
    let generation = 0;
    let sources: NativeCaptureTarget[] = [];
    let path: { adapterIndex: number; encoderIndex: number } | null = null;
    let active: any = null;
    let capturing: symbol | null = null;
    let cleanup = Promise.resolve();
    const provider = document.querySelector<HTMLSelectElement>(
        '[data-screen-share-provider]'
    );
    const audioPicker = createAudioSourcePicker();
    const picker = createNativeSourcePicker(authorize, audioPicker);
    let pickerVisible = false;
    let editingQuality = false;
    const status = document.querySelector<HTMLElement>(
        '[data-piik-native-status]'
    );
    const resolutionSelect = document.querySelector<HTMLSelectElement>(
        '[data-screen-share-resolution]'
    );
    // Keep the validation hint available even if the server has a cached EJS view.
    if (status && !document.querySelector('[data-piik-native-config-status]')) {
        const hint = document.createElement('p');
        hint.className = 'media-device-hint';
        hint.dataset.piikNativeConfigStatus = '';
        hint.setAttribute('role', 'status');
        hint.hidden = true;
        status.after(hint);
    }
    const resolutionMessage =
        'Piik 原生共享暂不支持“原始分辨率”或“自动”。请选择 720p、1080p、1440p 或 2160p（4K）；不会自动降低分辨率。';
    const sizes: Record<string, number[]> = {
        '720p': [1280, 720],
        '1080p': [1920, 1080],
        '1440p': [2560, 1440],
        '2160p': [3840, 2160],
    };
    const updateResolutionValidity = () => {
        const native = provider?.value === 'native';
        const invalid = native && !sizes[resolutionSelect?.value || ''];
        resolutionSelect?.setCustomValidity(invalid ? resolutionMessage : '');
        const hint = document.querySelector<HTMLElement>(
            '[data-piik-native-config-status]'
        );
        if (hint) {
            hint.hidden = !invalid;
            hint.textContent = invalid ? resolutionMessage : '';
        }
        const routeHint = document.querySelector<HTMLElement>(
            '[data-piik-provider-hint]'
        );
        if (routeHint)
            routeHint.textContent = `Piik P2P · ${native ? 'App 原生采集 · H.264 硬件编码' : '浏览器采集与编码'} · 每路最多 3 人观看 · 目标码率 15 Mbps。实际画质和帧率取决于设备与网络。`;
    };
    resolutionSelect?.addEventListener('change', updateResolutionValidity);
    updateResolutionValidity();
    const setStatus = (text: string) => {
        if (status) status.textContent = text;
    };
    const stop = () => {
        generation++;
        capturing = null;
        connecting = null;
        const previous = active;
        active = null;
        const previousClient = client;
        client = null;
        previous?.unsubscribe?.();
        previous?.unsubscribeClose?.();
        previous?.bridge.dispose();
        clearTimeout(previous?.statusTimer);
        sources = [];
        path = null;
        showEncoderStatus(null);
        if (previousClient) {
            cleanup = previous
                ? previousClient
                      .stopShare(previous.shareId)
                      .catch(() => {})
                      .finally(() => previousClient.close())
                : Promise.resolve(previousClient.close());
        }
    };
    const fail = () => {
        if (active) {
            const message = '原生共享中断，原因未确认；请重新开始共享或查看客户端诊断。';
            stop();
            setStatus(message);
            onFailure(message);
        }
    };
    const prepare = async (expectedGeneration: number) => {
        await authorize();
        if (generation !== expectedGeneration) throw Error('原生共享请求已取消');
        if (connecting) return connecting;
        if (client) return client;
        const token = generation;
        connecting = (async () => {
            await cleanup;
            const next = await NativeClient.connect();
            if (!next)
                throw new Error(
                    '请先启动 Piik App 并批准此网站；浏览器也可能需要本地网络访问许可。'
                );
            if (token !== generation) {
                next.close();
                throw new Error('原生共享请求已取消');
            }
            client = next;
            try {
                const availablePath = defaultNativeCapturePath(
                    await next.captureOptions(),
                    'h264'
                );
                if (token !== generation || client !== next) throw Error('原生共享请求已取消');
                if (!next.health.nativeMedia.video || !availablePath)
                    throw new Error('Piik App 未发现可用的 H.264 硬件编码器');
                const availableSources = (await next.sources()).filter(
                    (source) => source.kind !== 'picker'
                );
                if (token !== generation || client !== next) throw Error('原生共享请求已取消');
                if (!availableSources.length)
                    throw new Error('Piik App 没有可用的显示器或窗口');
                path = availablePath;
                sources = availableSources;
                return next;
            } catch (error) {
                if (client === next) stop();
                throw error;
            }
        })().finally(() => {
            if (token === generation) connecting = null;
        });
        return connecting;
    };
    document
        .querySelector('[data-piik-native-refresh]')
        ?.addEventListener('click', () => {
            if (pickerVisible && provider?.value === 'native')
                void picker.open();
        });
    const syncPicker = () => {
        const native = provider?.value === 'native';
        updateResolutionValidity();
        if (!native) {
            const hint = document.querySelector<HTMLElement>(
                '[data-share-audio-hint]'
            );
            if (hint)
                hint.textContent =
                    '声音来源由浏览器选择器决定。整屏声音可能包含本频道通话，可取消勾选以避免回传；建议选择独立窗口或标签页。';
        }
        const nativeOptions = document.querySelector<HTMLElement>(
            '[data-piik-native-options]'
        );
        if (nativeOptions) nativeOptions.hidden = !native;
        const browserSource = document.querySelector<HTMLElement>('[data-share-browser-source]');
        if (browserSource) browserSource.hidden = native;
        audioPicker.sync();
        const nativeAudio = document.querySelector<HTMLElement>('[data-native-audio-section]');
        const webAudio = document.querySelector<HTMLElement>('[data-web-audio-section]');
        const encoder = document.querySelector<HTMLElement>('[data-native-encoder-section]');
        if (nativeAudio) nativeAudio.hidden = !native;
        if (webAudio) webAudio.hidden = native;
        if (encoder) encoder.hidden = !native;
        if (native && pickerVisible && !editingQuality) void picker.open();
        else picker.close();
    };
    provider?.addEventListener('change', syncPicker);
    document.addEventListener('voice-share-dialog-open', (event) => {
        pickerVisible = true;
        editingQuality = (event as CustomEvent).detail?.mode === 'quality';
        const key = (event as CustomEvent).detail?.nativeSourceKey;
        if (typeof key === 'string') picker.setSelected(key);
        audioPicker.setSelected((event as CustomEvent).detail?.nativeAudioTargetKey || '');
        syncPicker();
    });
    document.addEventListener('voice-share-dialog-close', () => {
        pickerVisible = false;
        picker.close();
    });
    // This link is followed only by the user. Discovery grants no control;
    // approval stays in Piik's existing capability-protected local launcher.
    document
        .querySelector('[data-piik-native-approve]')
        ?.addEventListener('click', async () => {
            try {
                await authorize();
                const url = await discoverNativeConnect();
                const link = document.querySelector<HTMLAnchorElement>(
                    '[data-piik-native-approval-link]'
                );
                if (!url || !link)
                    throw new Error('未发现 Piik App，请先启动 App');
                link.href = url;
                link.hidden = false;
                setStatus(
                    '点击“打开 App 授权”后，在 App 中核对并批准此网站，再点击重新连接。'
                );
            } catch (error: any) {
                setStatus(error.message);
            }
        });
    const profileFor = (options: any) => {
        const size = sizes[options.resolutionPreset];
        if (!size) throw new Error(resolutionMessage);
        return {
            resolution: { width: size[0], height: size[1] },
            maxFramerate: options.frameRate || 60,
            maxBitrate: options.maxBitrate || 15000000,
            maxAudioBitrate: 128000,
            degradationPreference: 'maintain-resolution' as const,
        };
    };
    return {
        async capture(options: any, signal: AbortSignal): Promise<MediaStream> {
            if (active || capturing) throw Error('已有原生共享请求，请先停止共享');
            if (signal.aborted) throw Error('原生共享请求已取消');
            const requestToken = generation;
            const requestOwner = Symbol();
            capturing = requestOwner;
            const cancelRequest = () => { if (capturing === requestOwner) stop(); };
            signal.addEventListener('abort', cancelRequest, {once: true});
            try {
            const size = sizes[options.resolutionPreset];
            if (!size) {
                setStatus(resolutionMessage);
                throw Object.assign(new Error(resolutionMessage), {
                    name: 'NativeShareConfigurationError',
                });
            }
            const next = await prepare(requestToken);
            await authorize();
            if (signal.aborted || client !== next)
                throw new Error('原生共享请求已取消');
            const token = generation;
            const source = sources.find(
                (s) => nativeCaptureTargetKey(s) === options.nativeSourceKey
            );
            if (!source || !path) throw new Error('请先选择有效的原生采集源');
            const audio = nativeAudioSelection(options, next, source);
            const profile = profileFor(options);
            const shareId = crypto.randomUUID();
            const bridge = new NativeMediaBridge(shareId, next, fail);
            const owner: any = {
                client: next,
                shareId,
                bridge,
                profile,
                source,
                audio: audio.audio,
                audioMode: options.nativeAudioMode || (options.shareAudio ? 'source' : 'none'),
                audioTargetKey: options.nativeAudioTargetKey || '',
                path,
                codec: 'h264',
                stream: null,
            };
            active = owner;
            owner.unsubscribeClose = next.onClose(fail);
            owner.unsubscribe = next.onEvent((event) => {
                if (event.shareId === shareId && event.type === 'share-ended') {
                    const message = event.failed ? nativeFailureText({cause: {reason: event.reason || 'capture-unconfirmed'}}) : '原生共享已结束';
                    if (active === owner) { stop(); setStatus(message); onFailure(message); }
                }
            });
            const updateStatus = async () => {
                if (active !== owner) return;
                try {
                    const state = await next.shareStatus(shareId);
                    if (active !== owner) return;
                    owner.encoderStatus = state;
                    showEncoderStatus(state);
                    if (state?.audio === 'failed' && owner.audio) {
                        const message = '共享音源已退出或采集失败，共享已停止；请刷新重选音源，未切换为系统声音。';
                        stop(); setStatus(message); onFailure(message); return;
                    }
                } catch { if (active === owner) { owner.encoderStatus = null; showEncoderStatus(null); } }
                if (active === owner) owner.statusTimer = setTimeout(updateStatus, 1500);
            };
            const abort = () => {
                if (active === owner) stop();
            };
            signal.addEventListener('abort', abort, { once: true });
            try {
                const result = await next.startShare({
                    shareId,
                    source,
                    ...path,
                    ...audio,
                    showCaptureBorder: true,
                    edgeCapacity: 3,
                    profile,
                    codec: 'h264',
                });
                if (result.codec !== 'h264')
                    throw new Error(
                        `原生编码器返回 ${result.codec}，未启用静默软件回退`
                    );
                if (token !== generation) throw new Error('原生共享请求已取消');
                owner.stream = await bridge.start(result.audio);
                owner.actualAudio = result.audio;
                if (owner.audio && (!result.audio || result.sourceAudio === false)) throw Error('共享音频未能启动；未切换为系统声音');
                if (token !== generation) throw new Error('原生共享请求已取消');
                setStatus('App 原生 H.264 共享中');
                void updateStatus();
                return owner.stream;
            } catch (error) {
                if (active === owner) stop();
                const message = nativeFailureText(error); setStatus(message);
                throw new Error(message);
            } finally {
                signal.removeEventListener('abort', abort);
            }
            } catch (error) {
                if (requestToken === generation && !active) stop();
                throw error;
            } finally {
                signal.removeEventListener('abort', cancelRequest);
                if (capturing === requestOwner) capturing = null;
            }
        },
        async update(stream: MediaStream, options: any, changeSource: boolean) {
            const owner = active;
            if (!owner || owner.stream !== stream)
                throw new Error('共享已结束，请重新开始');
            await authorize();
            if (active !== owner) throw new Error('共享已结束');
            const nextProfile = profileFor(options);
            const available = changeSource ? await owner.client.sources() : [];
            const source = changeSource
                ? available.find(
                      (s: NativeCaptureTarget) =>
                          nativeCaptureTargetKey(s) === options.nativeSourceKey
                  )
                : owner.source;
            if (!source) throw new Error('所选窗口或屏幕已不可用，请刷新来源');
            if (options.shareAudio !== owner.audio)
                throw new Error('更改声音来源需要重新开始共享');
            if ((options.nativeAudioMode || (options.shareAudio ? 'source' : 'none')) !== owner.audioMode ||
                (options.nativeAudioTargetKey || '') !== owner.audioTargetKey || (changeSource && !['none', 'source'].includes(owner.audioMode)))
                throw Error('更改独立音源或画面需要重新开始共享');
            const previousProfile = owner.profile;
            await owner.client.updateShare(owner.shareId, nextProfile);
            try {
                if (changeSource)
                    await owner.client.replaceShareSource(
                        owner.shareId,
                        source,
                        owner.audio,
                        owner.path,
                        true
                    );
            } catch (error) {
                try {
                    await owner.client.updateShare(
                        owner.shareId,
                        previousProfile
                    );
                } catch {
                    if (active === owner) fail();
                }
                throw error;
            }
            if (active !== owner) throw new Error('共享已结束');
            owner.profile = nextProfile;
            owner.source = source;
            return nextProfile;
        },
        get: (stream: MediaStream) =>
            active?.stream === stream ? active : null,
        isActive: () => !!active,
        stop: () => {
            picker.close();
            stop();
        },
    };
}
