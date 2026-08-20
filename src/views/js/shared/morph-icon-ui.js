import { createMorph } from '/vendor/morphicons/morphicons-dom.min.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MORPH_SPRING = Object.freeze({ stiffness: 600, damping: 46 });

// Small, project-owned 24px stroke icon set. Keeping the endpoints on one
// coordinate grid gives Morphicons stable interpolation without another icon
// runtime or a component framework.
const ICONS = Object.freeze({
    settings: [
        [
            'path',
            {
                d: 'M12 2.75v2.1m0 14.3v2.1M2.75 12h2.1m14.3 0h2.1M5.46 5.46l1.49 1.49m10.1 10.1 1.49 1.49m0-13.08-1.49 1.49m-10.1 10.1-1.49 1.49',
            },
        ],
        ['circle', { cx: 12, cy: 12, r: 4.25 }],
    ],
    close: [
        ['line', { x1: 5, y1: 5, x2: 19, y2: 19 }],
        ['line', { x1: 19, y1: 5, x2: 5, y2: 19 }],
    ],
    pin: [
        ['path', { d: 'M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z' }],
        ['line', { x1: 12, y1: 14, x2: 12, y2: 22 }],
    ],
    'pin-off': [
        ['path', { d: 'M9.5 3h5l-.75 4.5M8 14h9v-2l-2.2-2.2M10.5 14 12 22' }],
        ['line', { x1: 4, y1: 4, x2: 20, y2: 20 }],
    ],
    'chevron-up': [['polyline', { points: '5 15 12 8 19 15' }]],
    'chevron-down': [['polyline', { points: '5 9 12 16 19 9' }]],
    'eye-off': [
        [
            'path',
            {
                d: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 1 12 4c5.2 0 8.5 4.2 9.5 6-.4.8-1.3 2.1-2.7 3.3M6.3 6.3C4.4 7.5 3.2 9.2 2.5 10.5 3.5 12.3 6.8 16 12 16c.8 0 1.6-.1 2.3-.3',
            },
        ],
    ],
    mic: [
        ['rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }],
        ['path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6' }],
    ],
    'mic-off': [
        [
            'path',
            {
                d: 'M9 9V6a3 3 0 0 1 5.7-1.3M15 10.5V11a3 3 0 0 1-.2 1.1M5.5 11a6.5 6.5 0 0 0 10.8 4.9M18.5 11a6.4 6.4 0 0 1-.7 2.9M12 17.5V21M9 21h6',
            },
        ],
        ['line', { x1: 4, y1: 4, x2: 20, y2: 20 }],
    ],
    video: [
        ['rect', { x: 3, y: 6, width: 13, height: 12, rx: 2 }],
        ['path', { d: 'm16 10 5-3v10l-5-3Z' }],
    ],
    'video-off': [
        [
            'path',
            {
                d: 'M10.5 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h11V11M16 10l5-3v10l-2.5-1.5',
            },
        ],
        ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }],
    ],
    'volume-2': [
        ['path', { d: 'M4 10v4h4l5 4V6l-5 4H4Z' }],
        ['path', { d: 'M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11' }],
    ],
    'volume-x': [
        ['path', { d: 'M4 10v4h4l5 4V6l-5 4H4Z' }],
        ['line', { x1: 17, y1: 9, x2: 22, y2: 14 }],
        ['line', { x1: 22, y1: 9, x2: 17, y2: 14 }],
    ],
    'screen-share': [
        ['rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }],
        ['path', { d: 'M8 21h8M12 17v4M8.5 11.5 12 8l3.5 3.5M12 8v6' }],
    ],
    'screen-share-off': [
        [
            'path',
            {
                d: 'M8.5 4H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12M12 17v4M8 21h8M14.5 4H19a2 2 0 0 1 2 2v7',
            },
        ],
        ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }],
    ],
    maximize: [
        ['polyline', { points: '9 3 3 3 3 9' }],
        ['polyline', { points: '15 3 21 3 21 9' }],
        ['polyline', { points: '21 15 21 21 15 21' }],
        ['polyline', { points: '9 21 3 21 3 15' }],
    ],
    minimize: [
        ['polyline', { points: '9 3 9 9 3 9' }],
        ['polyline', { points: '15 3 15 9 21 9' }],
        ['polyline', { points: '21 15 15 15 15 21' }],
        ['polyline', { points: '3 15 9 15 9 21' }],
    ],
});

const instances = new WeakMap();

const createSvg = () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const path = document.createElementNS(SVG_NS, 'path');

    svg.classList.add('morph-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(path);
    return { path, svg };
};

const ensureInstance = (button, iconName) => {
    const existing = instances.get(button);
    if (existing?.svg?.parentElement === button) {
        return existing;
    }

    existing?.morph?.destroy?.();
    button.querySelector('.morph-icon')?.remove();
    button.querySelector('i')?.remove();
    const { path, svg } = createSvg();
    button.prepend(svg);
    const instance = {
        current: iconName,
        morph: createMorph(path, ICONS[iconName], {
            reducedMotion: 'user',
        }),
        svg,
    };
    instances.set(button, instance);
    return instance;
};

const syncButtonIcon = (button, iconName, { animate = true } = {}) => {
    if (!button || !ICONS[iconName]) {
        return false;
    }

    const instance = ensureInstance(button, iconName);
    if (instance.current !== iconName) {
        if (animate) {
            instance.morph.morphTo(ICONS[iconName], MORPH_SPRING);
        } else {
            instance.morph.set(ICONS[iconName]);
        }
        instance.current = iconName;
    }

    button.dataset.morphIcon = iconName;
    return true;
};

const destroyButtonIcon = (button) => {
    const instance = instances.get(button);
    if (!instance) return false;
    instance.morph.destroy();
    instances.delete(button);
    return true;
};

window.VoiceMorphIconUI = {
    destroyButtonIcon,
    syncButtonIcon,
};

export { destroyButtonIcon, syncButtonIcon };
