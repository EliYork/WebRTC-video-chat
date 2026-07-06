import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loadCssWithImports = (fileUrl, seen = new Set()) => {
    const key = fileUrl.href;

    if (seen.has(key)) {
        return '';
    }

    seen.add(key);

    const css = readFileSync(fileUrl, 'utf8');
    const importPattern =
        /^\s*@import\s+(?:url\(\s*)?['"](?<path>[^'"]+)['"]\s*\)?\s*;/gm;

    return css.replace(importPattern, (statement, importPath) => {
        if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
            throw new Error(
                `Only local relative CSS imports are supported: ${statement}`
            );
        }

        return loadCssWithImports(new URL(importPath, fileUrl), seen);
    });
};

const script = readFileSync(
    new URL('../src/views/script.js', import.meta.url),
    'utf8'
);
const roomIndex = readFileSync(
    new URL('../src/views/room/index.ejs', import.meta.url),
    'utf8'
);
const noiseSettingsUi = readFileSync(
    new URL('../src/views/js/noise-settings-ui.js', import.meta.url),
    'utf8'
);
const controlPopoversUi = readFileSync(
    new URL('../src/views/js/control-popovers-ui.js', import.meta.url),
    'utf8'
);
const peerVolumeUi = readFileSync(
    new URL('../src/views/js/peer-volume-ui.js', import.meta.url),
    'utf8'
);
const copyLinkUi = readFileSync(
    new URL('../src/views/js/copy-link-ui.js', import.meta.url),
    'utf8'
);
const outputVolumeUi = readFileSync(
    new URL('../src/views/js/output-volume-ui.js', import.meta.url),
    'utf8'
);
const fullscreenControls = readFileSync(
    new URL('../src/views/js/fullscreen-controls.js', import.meta.url),
    'utf8'
);
const voiceJoinOverlayUi = readFileSync(
    new URL('../src/views/js/voice-join-overlay-ui.js', import.meta.url),
    'utf8'
);
const style = loadCssWithImports(
    new URL('../src/views/style.css', import.meta.url)
);

const roomScriptSrcs = Array.from(
    roomIndex.matchAll(/<script\b[^>]*\bsrc=["'](?<src>[^"']+)["'][^>]*>/g),
    (match) => match.groups.src
);
const indexOfRoomScript = (src) => roomScriptSrcs.indexOf(src);
const assertScriptBefore = (scriptA, scriptB) => {
    const scriptAIndex = indexOfRoomScript(scriptA);
    const scriptBIndex = indexOfRoomScript(scriptB);

    assert.ok(scriptAIndex >= 0, `room index must load ${scriptA}`);
    assert.ok(scriptBIndex >= 0, `room index must load ${scriptB}`);
    assert.ok(
        scriptAIndex < scriptBIndex,
        `${scriptA} must load before ${scriptB}`
    );
};

const assertScriptBeforeMain = (scriptPath) => {
    assertScriptBefore(scriptPath, '/script.js');
};

const assertNoForbiddenKeywords = (source, filename, keywords) => {
    keywords.forEach((forbiddenKeyword) => {
        assert.ok(
            !source.includes(forbiddenKeyword),
            `${filename} must not contain ${forbiddenKeyword}`
        );
    });
};

const assertSourceContains = (source, label, requiredSnippets) => {
    requiredSnippets.forEach(({ pattern, message }) => {
        assert.match(
            source,
            pattern,
            message || `${label} must contain ${pattern}`
        );
    });
};

const getSourceBetween = (source, startPattern, endPattern, label) => {
    const startMatch = source.match(startPattern);

    assert.ok(startMatch, `${label} start must be inspectable`);

    const startIndex = startMatch.index;
    const rest = source.slice(startIndex + startMatch[0].length);
    const endMatch = rest.match(endPattern);

    assert.ok(endMatch, `${label} end must be inspectable`);

    return source.slice(
        startIndex,
        startIndex + startMatch[0].length + endMatch.index
    );
};

const uiModuleContracts = [
    {
        path: '/js/noise-settings-ui.js',
        filename: 'noise-settings-ui.js',
        source: noiseSettingsUi,
    },
    {
        path: '/js/control-popovers-ui.js',
        filename: 'control-popovers-ui.js',
        source: controlPopoversUi,
        forbidden: [
            'getUserMedia',
            'Peer',
            'socket.emit',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
        ],
    },
    {
        path: '/js/peer-volume-ui.js',
        filename: 'peer-volume-ui.js',
        source: peerVolumeUi,
        forbidden: [
            'getUserMedia',
            'Peer',
            'socket.emit',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
        ],
    },
    {
        path: '/js/copy-link-ui.js',
        filename: 'copy-link-ui.js',
        source: copyLinkUi,
        forbidden: [
            'Peer',
            'socket.emit',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
        ],
    },
    {
        path: '/js/output-volume-ui.js',
        filename: 'output-volume-ui.js',
        source: outputVolumeUi,
        forbidden: [
            'Peer',
            'socket.emit',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'applyOutputSettingsToRemoteMedia',
        ],
    },
    {
        path: '/js/fullscreen-controls.js',
        filename: 'fullscreen-controls.js',
        source: fullscreenControls,
        forbidden: [
            'Peer',
            'socket.emit',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'saveLayoutToStorage',
            'normalizeLoadedLayoutItems',
            'detectTileResizeDirection',
            'startTileResize',
        ],
    },
    {
        path: '/js/voice-join-overlay-ui.js',
        filename: 'voice-join-overlay-ui.js',
        source: voiceJoinOverlayUi,
        forbidden: [
            'Peer',
            'socket.emit',
            'getUserMedia',
            'replaceTrack',
            'requestAudioStream',
            'createAudioPipeline',
            'joinVoiceChannel',
            'setupCallStreamHandler',
            'setViewingRoom',
            'setVoiceTargetRoom',
        ],
    },
];

assertScriptBeforeMain('/js/view-utils.js');
uiModuleContracts.forEach(({ path, source, forbidden = [] }) => {
    assertScriptBeforeMain(path);

    if (source.includes('VoiceViewUtils')) {
        assertScriptBefore('/js/view-utils.js', path);
    }

    assertNoForbiddenKeywords(source, path.replace('/js/', ''), forbidden);
});

assert.match(
    roomIndex,
    /<aside\b[^>]*id="chat-panel"[^>]*class="chat-panel"[\s\S]*?<form\b[^>]*id="chatForm"[\s\S]*?<textarea\b[^>]*id="chatInput"/,
    '.chat-panel must remain intact and contain #chatForm / #chatInput'
);

assert.match(
    script,
    /PAGE_LAYOUT_STORAGE_KEY_PREFIX\s*=\s*'voicePageLayout:v2'/,
    'page layout must use the v2 storage key'
);

assert.match(
    script,
    /SIDEBAR_PANEL:\s*'sidebarPanel'/,
    'sidebarPanel must be a first-class page component'
);
assert.match(
    script,
    /CHAT_PANEL:\s*'chatPanel'/,
    'chatPanel must be a first-class page component'
);
const pageComponentTypesMatch = script.match(
    /const PAGE_COMPONENT_TYPES = \{(?<body>[\s\S]*?)\};/
);
assert.ok(pageComponentTypesMatch, 'PAGE_COMPONENT_TYPES must be inspectable');
assert.doesNotMatch(
    pageComponentTypesMatch.groups.body,
    /CHAT_INPUT/,
    'PAGE_COMPONENT_TYPES must not restore CHAT_INPUT'
);
assert.doesNotMatch(
    script,
    /STAGE_PANEL:\s*'stagePanel'/,
    'stagePanel must not be a page component'
);

const defaultsMatch = script.match(
    /const getDefaultLayoutItems = \(\) => \[(?<body>[\s\S]*?)\];/
);
assert.ok(
    defaultsMatch,
    'getDefaultLayoutItems should return a literal default layout'
);
const defaultBody = defaultsMatch.groups.body;

assert.match(
    defaultBody,
    /SIDEBAR_PANEL/,
    'default layout includes sidebarPanel'
);
assert.match(defaultBody, /CHAT_PANEL/, 'default layout includes chatPanel');
assert.match(defaultBody, /LOCAL_PEER/, 'default layout includes localPeer');
assert.doesNotMatch(
    defaultBody,
    /STAGE_PANEL|CHANNEL_SIDEBAR|SELF_STATUS|ROOM_INFO|CHAT_INPUT/,
    'default page layout must not include old split components'
);

assert.match(
    script,
    /const createPageTileFromNode = /,
    'page layout must move existing DOM roots into tiles'
);
assertSourceContains(script, 'script.js', [
    {
        pattern: /const requestAudioStream = async/,
        message: 'requestAudioStream must stay in script.js',
    },
    {
        pattern: /const createAudioPipeline = async/,
        message: 'createAudioPipeline must stay in script.js',
    },
    {
        pattern: /const joinVoiceChannel = /,
        message: 'joinVoiceChannel must stay in script.js',
    },
    {
        pattern: /const setViewingRoom = /,
        message: 'setViewingRoom must stay in script.js',
    },
    {
        pattern: /const setVoiceTargetRoom = /,
        message: 'setVoiceTargetRoom must stay in script.js',
    },
    {
        pattern: /function setupCallStreamHandler/,
        message: 'setupCallStreamHandler must stay in script.js',
    },
    {
        pattern: /const applyOutputSettings = /,
        message: 'applyOutputSettings must stay in script.js',
    },
    {
        pattern: /const applyOutputSettingsToRemoteMedia = /,
        message: 'applyOutputSettingsToRemoteMedia must stay in script.js',
    },
]);
assert.match(
    script,
    /const validateDetachedPageLayoutBoard = /,
    'page layout must validate detached board content before replacing #main'
);
assert.match(
    script,
    /item\.type === 'stagePanel'[\s\S]*?return null;/,
    'normalizeLoadedLayoutItems must ignore saved stagePanel entries'
);
assert.ok(
    script.indexOf('window.__voiceLayoutDebug = {') <
        script.indexOf('_runPageLayoutInit();'),
    'window.__voiceLayoutDebug must be defined before page layout init runs'
);
assert.match(
    script,
    /pageTiles:\s*document\.querySelectorAll/,
    'dumpDom must report pageTiles'
);
assert.match(
    script,
    /unexpectedStagePanel/,
    'dumpDom must flag an unexpected stagePanel'
);
assert.match(
    script,
    /REAL_DOM_PAGE_TYPES\.has\(type\)[\s\S]*?return;/,
    'renderLayoutComponentTile must return before replacing real DOM panel bodies'
);
assert.match(
    script,
    /REAL_DOM_PAGE_TYPES\.has\(type\)[\s\S]*?savedItem[\s\S]*?savedItem\?\.config[\s\S]*?config,/,
    'real DOM page panels must restore saved config such as freeMove while rendering'
);
assert.match(
    script,
    /showRecoveryToolbar\(\)/,
    'debug API must expose showRecoveryToolbar()'
);
assert.match(
    script,
    /bar\.hidden = true/,
    'recovery toolbar must be hidden by default'
);
assert.match(
    script,
    /footer\.hidden = true/,
    'real DOM page panels must hide footer labels'
);
assert.match(
    script,
    /title\.textContent = label/,
    'page-level panels must keep a visible title in the tile header'
);
assert.match(
    script,
    /avatar\.textContent = createTileAvatarText\(label\)/,
    'page-level panel headers must keep a leading avatar/icon marker'
);
assert.match(
    script,
    /layout-component-toolbar/,
    'layout controls must use an external floating component toolbar'
);
assert.match(
    script,
    /positionLayoutComponentToolbar/,
    'component toolbar position must be recalculated from tile bounds'
);
assert.match(
    script,
    /freeMove:\s*false/,
    'layout item config must persist a freeMove flag'
);
assert.match(
    script,
    /isTileFreeMoveEnabled/,
    'freeMove must affect normal-mode tile movement'
);
assert.doesNotMatch(
    script,
    /actions\.prepend\(removeButton\)/,
    'hide button must not be inserted inside the tile actions area'
);

assert.match(
    script,
    /finalizeLayoutEditing/,
    'clicking Done must finalize editing instead of only toggling edit mode'
);
assert.match(
    script,
    /snapAllLayoutItemsToGrid/,
    'finalize editing must snap all layout items to the grid'
);
const syncLayoutEditModeUiBody = getSourceBetween(
    script,
    /const syncLayoutEditModeUI = \(\) => \{/,
    /\nconst setLayoutEditMode = /,
    'layout edit mode UI sync helper'
);
const setLayoutEditModeBody = getSourceBetween(
    script,
    /const setLayoutEditMode = \(enabled\) => \{/,
    /\nconst toggleLayoutEditMode = /,
    'layout edit mode setter'
);
const toggleLayoutEditModeBody = getSourceBetween(
    script,
    /const toggleLayoutEditMode = \(\) => \{/,
    /\nconst getOrderedTiles = /,
    'layout edit mode toggle'
);
const finalizeLayoutEditingBody = getSourceBetween(
    script,
    /const finalizeLayoutEditing = \(\) => \{/,
    /\nconst getLayoutStorageKey = /,
    'layout edit finalize helper'
);
assert.match(
    syncLayoutEditModeUiBody,
    /mainLayout\?\.classList\.toggle\('is-layout-editing',\s*layoutEditMode\)/,
    'layout edit UI sync must toggle the main editing class from layoutEditMode'
);
assert.match(
    syncLayoutEditModeUiBody,
    /pageLayoutBoard\?\.classList\.toggle\('is-layout-editing',\s*layoutEditMode\)/,
    'layout edit UI sync must toggle the board editing class from layoutEditMode'
);
assert.match(
    syncLayoutEditModeUiBody,
    /layoutEditModeToggle\.setAttribute\([\s\S]*?'aria-pressed'[\s\S]*?String\(layoutEditMode\)/,
    'layout edit button pressed state must track layoutEditMode'
);
assert.match(
    syncLayoutEditModeUiBody,
    /\?\s*'完成编辑'[\s\S]*:\s*'编辑布局'/,
    'layout edit button label must switch between Edit Layout and Done'
);
assert.match(
    setLayoutEditModeBody,
    /layoutEditMode\s*=\s*Boolean\(enabled\)[\s\S]*?syncLayoutGridMetadata\(\)[\s\S]*?syncLayoutEditModeUI\(\)/,
    'entering or leaving layout edit mode must update state, grid metadata, and UI together'
);
assert.match(
    setLayoutEditModeBody,
    /if \(!layoutEditMode\) \{[\s\S]*?hideSnapPreview\(\)[\s\S]*?resetLayoutResizeCursor\(\)/,
    'leaving layout edit mode must clear snap preview and resize cursor state'
);
assert.match(
    toggleLayoutEditModeBody,
    /if \(layoutEditMode\) \{[\s\S]*?finalizeLayoutEditing\(\)[\s\S]*?return;/,
    'clicking Done must use finalizeLayoutEditing instead of directly leaving edit mode'
);
assert.match(
    toggleLayoutEditModeBody,
    /setLayoutEditMode\(true\)/,
    'clicking Edit Layout must enter layout edit mode through setLayoutEditMode(true)'
);
assert.match(
    finalizeLayoutEditingBody,
    /snapAllLayoutItemsToGrid\(\)[\s\S]*?hideSnapPreview\(\)[\s\S]*?saveLayoutToStorage\([\s\S]*?setLayoutEditMode\(false\)/,
    'finalizing layout edit mode must snap all items, hide preview, save, and then leave edit mode'
);
assert.match(
    script,
    /showSnapPreview/,
    'dragging and resizing must expose a snap preview state'
);
const showSnapPreviewBody = script.slice(
    script.indexOf('const showSnapPreview = '),
    script.indexOf('const hideSnapPreview = ')
);
assert.ok(showSnapPreviewBody, 'showSnapPreview body should be inspectable');
assert.doesNotMatch(
    showSnapPreviewBody,
    /layoutEditMode/,
    'snap preview must also be available for normal-mode freeMove dragging'
);
assert.match(
    script,
    /hideSnapPreview/,
    'snap preview must be hidden after interactions and when leaving edit mode'
);
assert.match(
    script,
    /const canDragLayoutItem = /,
    'layout dragging eligibility must be centralized'
);
assert.match(
    script,
    /const canDragLayoutItem = [\s\S]*?layoutEditMode[\s\S]*?\|\|[\s\S]*?freeMove\s*===\s*true/,
    'freeMove=true must allow normal-mode dragging'
);
assert.match(
    script,
    /const shouldIgnoreLayoutDragTarget = /,
    'interactive controls must be excluded from layout drag starts'
);
const ignoreDragTargetBody = script.slice(
    script.indexOf('const shouldIgnoreLayoutDragTarget = '),
    script.indexOf('const findLayoutComponentToolbar = ')
);
['input', 'textarea', 'button', 'select', 'a', '[contenteditable]'].forEach(
    (selector) => {
        assert.ok(
            ignoreDragTargetBody.includes(`'${selector}'`),
            `drag ignore list must include ${selector}`
        );
    }
);
assert.match(
    script,
    /const finalizeLayoutItemDrag = [\s\S]*?snapTileLayoutToGrid[\s\S]*?saveLayoutToStorage[\s\S]*?hideSnapPreview/,
    'drag finish must snap, save, and hide the preview through one path'
);
const singleTileSnapBody = getSourceBetween(
    script,
    /const snapTileLayoutToGridForTile = \(tile\) => \{/,
    /\nconst markTileLayoutUserPlaced = /,
    'single-tile snap helper'
);
const finalizeLayoutItemDragBody = getSourceBetween(
    script,
    /const finalizeLayoutItemDrag = \(tile\) => \{/,
    /\nconst finishTileLayoutInteraction = /,
    'drag finish helper'
);
const finishTileLayoutInteractionBody = getSourceBetween(
    script,
    /const finishTileLayoutInteraction = \(tile\) => \{/,
    /\nconst clampPositionedTileLayouts = /,
    'layout interaction finish helper'
);
assert.match(
    singleTileSnapBody,
    /snapTileLayoutToGrid\(/,
    'single-tile snap helper must reuse the shared snapTileLayoutToGrid() rule'
);
assert.match(
    finalizeLayoutItemDragBody,
    /snapTileLayoutToGridForTile\(tile\)/,
    'drag finish must snap the single tile before saving after normal or editing drag'
);
assert.match(
    finishTileLayoutInteractionBody,
    /finalizeLayoutItemDrag\(tile\)/,
    'normal and editing drag/resize finish must enter the shared single-tile snap path'
);
assert.match(
    script,
    /const applySavedTileLayout = [\s\S]*?upsertTileLayoutItem[\s\S]*?config:\s*layoutItem\.config/,
    'saved layout config such as freeMove must be restored when a tile is loaded'
);
assert.match(
    script,
    /const applyPageLayoutItemToPanel = [\s\S]*?upsertTileLayoutItem[\s\S]*?config:\s*item\.config/,
    'page-level saved layout config must be restored during storage initialization'
);
assert.match(
    script,
    /detectTileResizeDirection/,
    'resize must use tile-edge hit testing, not only tiny handle targets'
);
assert.match(
    script,
    /const finishTileLayoutInteraction = [\s\S]*?finalizeLayoutItemDrag/,
    'drag and resize finish must use the shared finalize path'
);
assert.match(
    script,
    /const AUTO_LAYOUT_GRID_SIZES = [\s\S]*?\[LAYOUT_ITEM_TYPES\.LOCAL_PEER\]:\s*\{\s*w:\s*5,\s*h:\s*4\s*\}[\s\S]*?\[LAYOUT_ITEM_TYPES\.REMOTE_PEER\]:\s*\{\s*w:\s*5,\s*h:\s*4\s*\}[\s\S]*?\[LAYOUT_ITEM_TYPES\.SCREEN_SHARE\]:\s*\{\s*w:\s*14,\s*h:\s*9\s*\}/,
    'auto-placed voice and screen-share tiles must use the requested default grid sizes'
);
assert.match(
    script,
    /const getOccupiedLayoutRects = /,
    'auto placement must collect occupied layout rects'
);
assert.match(
    script,
    /const rectOverlapArea = /,
    'auto placement must score overlap area'
);
assert.match(
    script,
    /const isRectWithinGrid = /,
    'auto placement must reject out-of-grid candidates'
);
assert.match(
    script,
    /const scoreLayoutSlot = /,
    'auto placement must score candidate slots'
);
assert.match(
    script,
    /const findAvailableLayoutSlot = /,
    'auto placement must have a shared findAvailableLayoutSlot helper'
);
assert.match(
    script,
    /const applySavedTileLayout = [\s\S]*?savedItem[\s\S]*?findAvailableLayoutSlot[\s\S]*?upsertTileLayoutItem/,
    'tiles without saved layout should use auto slot placement before being synced'
);
assert.doesNotMatch(
    script,
    /x:\s*13\s*\+\s*\(remoteIndex\s*%\s*3\)\s*\*\s*2/,
    'remote peer placement must not use the old fixed x=13 stagger'
);
assert.doesNotMatch(
    script,
    /y:\s*7\s*\+\s*\(remoteIndex\s*%\s*3\)\s*\*\s*2/,
    'remote peer placement must not use the old fixed y=7 stagger'
);
assert.doesNotMatch(
    script,
    /x:\s*8,\s*y:\s*2,\s*w:\s*16,\s*h:\s*10/,
    'screen-share placement must not use the old fixed 16x10 slot'
);
assert.match(
    script,
    /const markTileLayoutUserPlaced = [\s\S]*?userPlaced:\s*true/,
    'manual drag/resize must mark auto-placed media tiles as userPlaced'
);
assert.match(
    script,
    /const finalizeLayoutItemDrag = [\s\S]*?markTileLayoutUserPlaced[\s\S]*?saveLayoutToStorage/,
    'drag finish must persist the userPlaced flag before saving'
);
assert.match(
    script,
    /const applyStoredLayoutToExistingTile = [\s\S]*?if \(!tile\) \{[\s\S]*?return;/,
    'saved remote/screen-share layout must not create fake online tiles'
);

const toolbarMatch = style.match(
    /\.stage-layout-toolbar\s*\{(?<body>[\s\S]*?)\}/
);
const secondaryActionsMatch = style.match(
    /\.layout-edit-secondary-actions\s*\{(?<body>[\s\S]*?)\}/
);
const toolButtonMatch = style.match(
    /\.layout-edit-toggle,\s*\.layout-tool-button\s*\{(?<body>[\s\S]*?)\}/
);
const componentToolbarMatch = style.match(
    /\.layout-component-toolbar\s*\{(?<body>[\s\S]*?)\}/
);
assert.ok(toolbarMatch, 'page-level layout toolbar style must exist');
assert.ok(secondaryActionsMatch, 'secondary topbar actions style must exist');
assert.ok(toolButtonMatch, 'layout action button style must exist');
assert.ok(componentToolbarMatch, 'component floating toolbar style must exist');
assert.match(
    script,
    /page-layout-topbar/,
    'topbar must use a stable page-layout-topbar container'
);
assert.match(
    script,
    /layout-edit-primary-button/,
    'edit/done toggle must have a fixed primary button class'
);
assert.match(
    script,
    /layout-edit-secondary-actions/,
    'secondary layout actions must not affect primary button coordinates'
);
assert.match(
    toolbarMatch.groups.body,
    /position:\s*fixed/,
    'page-level layout toolbar must be fixed to the viewport'
);
const topToolbarZ = Number(
    toolbarMatch.groups.body.match(/z-index:\s*(\d+)/)?.[1]
);
const componentToolbarZ = Number(
    componentToolbarMatch.groups.body.match(/z-index:\s*(\d+)/)?.[1]
);
assert.ok(
    Number.isFinite(topToolbarZ) &&
        Number.isFinite(componentToolbarZ) &&
        topToolbarZ > componentToolbarZ,
    'page-level layout toolbar z-index must be higher than component toolbar'
);
assert.match(
    style,
    /\.layout-edit-primary-button[\s\S]*?width:\s*(?:11|12|13|14)\dpx/,
    'edit/done button must use a stable fixed width'
);
assert.match(
    style,
    /\.layout-edit-secondary-actions/,
    'secondary actions must be styled separately from the fixed primary button'
);
assert.match(
    style,
    /\.layout-snap-preview/,
    'style must define a visible snap preview overlay'
);
const boardMatch = style.match(/\.page-layout-board\s*\{(?<body>[\s\S]*?)\}/);
const boardEditingMatch = style.match(
    /\.page-layout-board\.is-layout-editing\s*\{(?<body>[\s\S]*?)\}/
);
const editingTileMatch = style.match(
    /\.page-layout-board\.is-layout-editing\s+\.video-tile\s*\{(?<body>[\s\S]*?)\}/
);
const mainMatch = style.match(/#main\s*\{(?<body>[\s\S]*?)\}/);
const getBackgroundSize = (body) =>
    body.match(/background-size:\s*(?<value>[\s\S]*?);/)?.groups.value.trim();
const getBackgroundPosition = (body) =>
    body
        .match(/background-position:\s*(?<value>[\s\S]*?);/)
        ?.groups.value.trim();
const pageTileHeaderMatch = style.match(
    /\.page-layout-tile \.tile-header\s*\{(?<body>[\s\S]*?)\}/
);
const pageTileFooterMatch = style.match(
    /\.page-layout-tile \.tile-footer\s*\{(?<body>[\s\S]*?)\}/
);
assert.ok(mainMatch, '#main base style must exist');
assert.ok(boardMatch, 'page layout board base style must exist');
assert.ok(boardEditingMatch, 'page layout board editing style must exist');
assert.ok(editingTileMatch, 'editing tile style must exist');
assert.ok(pageTileHeaderMatch, 'page tile header base style must exist');
assert.ok(pageTileFooterMatch, 'page tile footer base style must exist');
assert.doesNotMatch(
    mainMatch.groups.body,
    /radial-gradient/,
    '#main must not use a dot-board radial background'
);
assert.doesNotMatch(
    mainMatch.groups.body,
    /background-image:[\s\S]*linear-gradient\([^;]*1px/,
    '#main must not carry a separate grid definition'
);
assert.doesNotMatch(
    boardMatch.groups.body,
    /radial-gradient/,
    'normal-mode board must not use a dot-board radial background'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /radial-gradient/,
    'editing-mode board must not use a dot-board radial background'
);
assert.match(
    boardMatch.groups.body,
    /--layout-grid-line-opacity:\s*0\.0[0-9]+/,
    'normal-mode board should define the soft grid opacity variable'
);
assert.match(
    boardMatch.groups.body,
    /--layout-grid-line-color:\s*rgba\(\s*216,\s*111,\s*154,\s*var\(--layout-grid-line-opacity\)\s*\)/,
    'board grid line color should be derived from the shared opacity variable'
);
assert.match(
    boardMatch.groups.body,
    /--layout-grid-size-x:\s*calc\(100%\s*\/\s*var\(--layout-grid-columns,\s*32\)\)/,
    'board grid width should reuse the page layout grid columns'
);
assert.match(
    boardMatch.groups.body,
    /--layout-grid-size-y:\s*calc\(100%\s*\/\s*var\(--layout-grid-rows,\s*18\)\)/,
    'board grid height should reuse the page layout grid rows'
);
assert.match(
    boardMatch.groups.body,
    /linear-gradient\(var\(--layout-grid-line-color\) 1px, transparent 1px\)/,
    'normal-mode board should use the shared linear grid background'
);
assert.match(
    boardMatch.groups.body,
    /border:\s*1px\s+solid\s+transparent/,
    'normal-mode board should reserve border space to prevent edit-mode shifting'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /border:\s*1px/,
    'editing board must not add a new border width that shifts the layout'
);
assert.match(
    boardEditingMatch.groups.body,
    /border-color:/,
    'editing board should enhance the pre-reserved border by color only'
);
assert.match(
    boardEditingMatch.groups.body,
    /--layout-grid-line-opacity:\s*0\.1[0-9]+/,
    'editing mode should enhance the same grid by changing opacity only'
);
assert.match(
    editingTileMatch.groups.body,
    /box-shadow:[\s\S]*?\binset\s+0\s+0\s+0\s+2px/,
    'editing tile highlight must use inset box-shadow so visual bounds do not exceed saved layout bounds'
);
assert.doesNotMatch(
    editingTileMatch.groups.body,
    /box-shadow:[\s\S]*?(?<!inset\s)0\s+0\s+0\s+2px/,
    'editing tile highlight must not use an outer 0 0 0 2px box-shadow that exceeds the true layout boundary'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /background-image:/,
    'editing mode must not define a separate background image'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /background-size:/,
    'editing mode must not define a separate background size'
);
assert.doesNotMatch(
    boardEditingMatch.groups.body,
    /background-position:/,
    'editing mode must not define a separate background position'
);
assert.match(
    getBackgroundSize(boardMatch.groups.body) || '',
    /var\(--layout-grid-size-x\)\s+var\(--layout-grid-size-y\)/,
    'page board grid should use shared grid-size variables'
);
assert.match(
    getBackgroundPosition(boardMatch.groups.body) || '',
    /0\s+0/,
    'page board grid should use a stable origin'
);
assert.match(
    secondaryActionsMatch.groups.body,
    /width:\s*max-content/,
    'secondary topbar actions should size to their content instead of squeezing buttons'
);
assert.match(
    secondaryActionsMatch.groups.body,
    /flex-wrap:\s*nowrap/,
    'secondary topbar actions must remain horizontal'
);
assert.match(
    toolButtonMatch.groups.body,
    /white-space:\s*nowrap/,
    'layout action buttons must not wrap Chinese labels vertically'
);
assert.match(
    toolButtonMatch.groups.body,
    /flex:\s*0\s+0\s+auto/,
    'layout action buttons must not shrink into vertical labels'
);
assert.doesNotMatch(
    pageTileHeaderMatch.groups.body,
    /display:\s*none/,
    'normal-mode page tiles must keep title headers visible'
);
assert.match(
    pageTileHeaderMatch.groups.body,
    /min-height:\s*(?:3[0-9]|4[0-4])px/,
    'normal-mode page tile headers should stay compact'
);
assert.match(
    pageTileFooterMatch.groups.body,
    /display:\s*none/,
    'bottom footer labels must remain hidden'
);
assert.match(
    style,
    /--resize-hit-corner:\s*(?:1[6-9]|2[0-4])px/,
    'corner resize hit area should be 16-24px'
);
