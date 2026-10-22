import { NativeClient } from './.deps/upstream/src/client/native/client';
import { nativeCaptureTargetKey } from './.deps/upstream/src/client/native/capture-selection';
import type { NativeCaptureTarget } from './.deps/upstream/src/client/native/wire';

export const sourceLabel = (source: NativeCaptureTarget, index: number) =>
    source.kind === 'display' &&
    /^(?:\\\\\.\\)?DISPLAY\s*\d+$/i.test(source.title)
        ? `显示器 ${source.title.match(/\d+$/)?.[0] || index + 1}`
        : source.title;

// One short-lived, authorized control connection belongs to the selector.
// Closing it cancels pending upstream preview work without stopping an active
// share, which owns a separate control connection. No video capture loop here.
export function createNativeSourcePicker(authorize: () => Promise<unknown>) {
    const gallery = document.querySelector<HTMLElement>(
        '[data-piik-native-gallery]'
    );
    const select = document.querySelector<HTMLSelectElement>(
        '[data-piik-native-source]'
    );
    const status = document.querySelector<HTMLElement>(
        '[data-piik-native-status]'
    );
    const refresh = document.querySelector<HTMLButtonElement>(
        '[data-piik-native-refresh]'
    );
    let client: NativeClient | null = null,
        generation = 0,
        visible = false,
        selected = '';
    let lifetime: AbortController | null = null;
    let sources: NativeCaptureTarget[] = [];
    const pages = { display: 0, window: 0 };
    let queue: (() => Promise<void>)[] = [],
        inFlight = false;
    const notify = () =>
        select?.dispatchEvent(new Event('change', { bubbles: true }));
    const pump = async () => {
        if (inFlight || !visible || !queue.length) return;
        inFlight = true;
        try {
            await queue.shift()!();
        } finally {
            inFlight = false;
            void pump();
        }
    };
    const render = () => {
        if (!gallery || !select || !client || !visible) return;
        const token = generation,
            owner = client;
        queue = [];
        gallery.replaceChildren();
        select.replaceChildren(
            new Option('请选择来源', ''),
            ...sources.map(
                (s, i) =>
                    new Option(sourceLabel(s, i), nativeCaptureTargetKey(s))
            )
        );
        select.value = selected;
        for (const kind of ['display', 'window'] as const) {
            const group = sources.filter((s) => s.kind === kind);
            const section = document.createElement('section');
            section.dataset.sourceGroup = kind;
            const heading = document.createElement('div');
            heading.className = 'share-source-group-heading';
            const title = document.createElement('h3');
            title.textContent = `${kind === 'display' ? '屏幕' : '窗口'} · ${group.length}`;
            heading.append(title);
            const pageCount = Math.max(1, Math.ceil(group.length / 3));
            pages[kind] = Math.min(pages[kind], pageCount - 1);
            if (pageCount > 1) {
                const pager = document.createElement('button');
                pager.type = 'button';
                pager.textContent = `${pages[kind] + 1} / ${pageCount} · 下一页`;
                pager.addEventListener('click', () => {
                    pages[kind] = (pages[kind] + 1) % pageCount;
                    render();
                });
                heading.append(pager);
            }
            section.append(heading);
            const grid = document.createElement('div');
            grid.className = 'share-source-grid';
            for (const source of group.slice(
                pages[kind] * 3,
                (pages[kind] + 1) * 3
            )) {
                const key = nativeCaptureTargetKey(source);
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'share-source-card';
                card.dataset.nativeSourceKey = key;
                card.setAttribute('aria-pressed', String(key === selected));
                const image = document.createElement('img');
                image.hidden = true;
                image.alt = `${sourceLabel(source, 0)}预览`;
                const hint = document.createElement('span');
                hint.className = 'share-source-preview-status';
                hint.textContent = '正在获取预览…';
                image.addEventListener('load', () => {
                    image.hidden = false;
                    hint.hidden = true;
                });
                image.addEventListener('error', () => {
                    image.hidden = true;
                    hint.hidden = false;
                    hint.textContent = '预览无法显示，请刷新或选择其他来源';
                });
                const name = document.createElement('span');
                name.className = 'share-source-name';
                name.textContent = sourceLabel(source, sources.indexOf(source));
                card.title = name.textContent;
                card.append(image, hint, name);
                card.addEventListener('click', () => {
                    selected = key;
                    select.value = key;
                    gallery
                        .querySelectorAll<HTMLElement>(
                            '[data-native-source-key]'
                        )
                        .forEach((el) =>
                            el.setAttribute(
                                'aria-pressed',
                                String(el.dataset.nativeSourceKey === key)
                            )
                        );
                    if (status)
                        status.textContent = `已选择：${name.textContent}`;
                    const audioHint = document.querySelector<HTMLElement>(
                        '[data-share-audio-hint]'
                    );
                    if (audioHint)
                        audioHint.textContent =
                            source.kind === 'display'
                                ? '声音来源：整台电脑的系统声音，可能包含本频道通话。可取消勾选以避免回传。'
                                : '声音来源：所选窗口对应应用的声音，可能包含该应用的其他窗口。';
                    notify();
                });
                grid.append(card);
                queue.push(async () => {
                    try {
                        const data = await owner.sourcePreview(source);
                        if (
                            !visible ||
                            generation !== token ||
                            client !== owner ||
                            !card.isConnected
                        )
                            return;
                        if (data) image.src = data;
                        else
                            hint.textContent = '此来源暂不能预览，可刷新后重试';
                    } catch {
                        if (visible && generation === token && card.isConnected)
                            hint.textContent =
                                '预览不可用：窗口已关闭、受保护或客户端不支持';
                    }
                });
            }
            if (!group.length) {
                const empty = document.createElement('p');
                empty.className = 'media-device-hint';
                empty.textContent =
                    kind === 'window'
                        ? '没有可共享的窗口；打开窗口后刷新。'
                        : '未发现显示器。';
                grid.append(empty);
            }
            section.append(grid);
            gallery.append(section);
        }
        notify();
        void pump();
    };
    const close = () => {
        visible = false;
        generation++;
        queue = [];
        lifetime?.abort();
        lifetime = null;
        client?.close();
        client = null;
        sources = [];
        gallery?.replaceChildren();
        if (select) {
            select.value = '';
            notify();
        }
        if (refresh) refresh.disabled = false;
    };
    const open = async () => {
        close();
        visible = true;
        const controller = new AbortController();
        lifetime = controller;
        const token = generation;
        if (refresh) refresh.disabled = true;
        if (status) status.textContent = '正在连接客户端并读取来源…';
        try {
            await authorize();
            if (!visible || token !== generation) return;
            const next = await NativeClient.connect({
                signal: controller.signal,
            });
            if (!next)
                throw new Error(
                    '未连接客户端；请打开 EliYork Voice，或展开下方连接帮助。'
                );
            if (!visible || token !== generation) {
                next.close();
                return;
            }
            client = next;
            sources = (await next.sources()).filter((s) => s.kind !== 'picker');
            if (!visible || token !== generation) return;
            const missing =
                selected &&
                !sources.some((s) => nativeCaptureTargetKey(s) === selected);
            if (missing) selected = '';
            if (status)
                status.textContent = missing
                    ? '之前选择的窗口或屏幕已不可用，请重新选择。'
                    : '点击一张卡片，选择要共享的画面。';
            render();
        } catch (error: any) {
            if (visible && token === generation) {
                if (status) status.textContent = error.message;
                client?.close();
                client = null;
            }
        } finally {
            if (visible && token === generation && refresh)
                refresh.disabled = false;
        }
    };
    return {
        open,
        close,
        setSelected: (key: string) => {
            selected = key;
        },
    };
}
