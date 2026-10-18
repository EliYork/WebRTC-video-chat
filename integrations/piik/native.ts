// Reuse Piik's authenticated App control and native Pion senders. The local
// capture ID is not a Piik room credential; Node alone authorizes publication.
import {
    NativeClient,
    discoverNativeConnect,
} from './.deps/upstream/src/client/native/client';
import { NativeMediaBridge } from './.deps/upstream/src/client/native/media-bridge';
import { defaultNativeCapturePath } from './.deps/upstream/src/client/native/capture-selection';
import type { NativeCaptureTarget } from './.deps/upstream/src/client/native/wire';

export function createNativeCapture(
    authorize: () => Promise<unknown>,
    onFailure: () => void
) {
    let client: NativeClient | null = null;
    let connecting: Promise<NativeClient> | null = null;
    let generation = 0;
    let sources: NativeCaptureTarget[] = [];
    let path: { adapterIndex: number; encoderIndex: number } | null = null;
    let active: any = null;
    let cleanup = Promise.resolve();
    const provider = document.querySelector<HTMLSelectElement>(
        '[data-screen-share-provider]'
    );
    const sourceSelect = document.querySelector<HTMLSelectElement>(
        '[data-piik-native-source]'
    );
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
        connecting = null;
        const previous = active;
        active = null;
        const previousClient = client;
        client = null;
        previous?.unsubscribe?.();
        previous?.unsubscribeClose?.();
        previous?.bridge.dispose();
        sources = [];
        path = null;
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
            stop();
            onFailure();
        }
    };
    const prepare = async () => {
        await authorize();
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
                path = defaultNativeCapturePath(
                    await next.captureOptions(),
                    'h264'
                );
                if (!next.health.nativeMedia.video || !path)
                    throw new Error('Piik App 未发现可用的 H.264 硬件编码器');
                sources = (await next.sources()).filter(
                    (source) => source.kind !== 'picker'
                );
                if (!sources.length)
                    throw new Error('Piik App 没有可用的显示器或窗口');
                if (sourceSelect) {
                    sourceSelect.replaceChildren(
                        ...sources.map(
                            (source, index) =>
                                new Option(source.title, String(index))
                        )
                    );
                }
                setStatus('App 已连接 · H.264 硬件路径 · 请选择显示器或窗口');
                return next;
            } catch (error) {
                if (client === next) stop();
                else next.close();
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
            if (active) return;
            stop();
            setStatus('正在连接 Piik App…');
            void prepare().catch((error) => setStatus(error.message));
        });
    provider?.addEventListener('change', () => {
        const native = provider.value === 'native';
        updateResolutionValidity();
        document.querySelector<HTMLElement>(
            '[data-piik-native-options]'
        )!.hidden = !native;
        if (native) {
            setStatus('正在连接 Piik App…');
            void prepare().catch((error) => setStatus(error.message));
        } else if (!active) stop();
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
    return {
        async capture(options: any, signal: AbortSignal): Promise<MediaStream> {
            const size = sizes[options.resolutionPreset];
            if (!size) {
                setStatus(resolutionMessage);
                throw Object.assign(new Error(resolutionMessage), {
                    name: 'NativeShareConfigurationError',
                });
            }
            const next = await prepare();
            await authorize();
            if (signal.aborted || client !== next)
                throw new Error('原生共享请求已取消');
            const token = generation;
            const source = sources[Number(sourceSelect?.value || 0)];
            if (!source || !path) throw new Error('请先选择有效的原生采集源');
            const [width, height] = size;
            const profile = {
                resolution: { width, height },
                maxFramerate: options.frameRate || 60,
                maxBitrate: 15000000,
                maxAudioBitrate: 128000,
                degradationPreference: 'maintain-resolution' as const,
            };
            const shareId = crypto.randomUUID();
            const bridge = new NativeMediaBridge(shareId, next, fail);
            const owner: any = {
                client: next,
                shareId,
                bridge,
                profile,
                codec: 'h264',
                stream: null,
            };
            active = owner;
            owner.unsubscribeClose = next.onClose(fail);
            owner.unsubscribe = next.onEvent((event) => {
                if (event.shareId === shareId && event.type === 'share-ended')
                    fail();
            });
            const abort = () => {
                if (active === owner) stop();
            };
            signal.addEventListener('abort', abort, { once: true });
            try {
                const result = await next.startShare({
                    shareId,
                    source,
                    ...path,
                    audio:
                        document.querySelector<HTMLInputElement>(
                            '[data-piik-native-audio]'
                        )?.checked || false,
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
                if (token !== generation) throw new Error('原生共享请求已取消');
                setStatus('App 原生 H.264 共享中');
                return owner.stream;
            } catch (error) {
                if (active === owner) stop();
                throw error;
            } finally {
                signal.removeEventListener('abort', abort);
            }
        },
        get: (stream: MediaStream) =>
            active?.stream === stream ? active : null,
        isActive: () => !!active,
        stop,
    };
}
