(function exposePageLayoutStorage(global) {
    'use strict';

    const getLayoutStorageKey = ({ prefix, roomId }) =>
        `${prefix}:${String(roomId || 'default').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    const serializeLayoutItems = (layoutItems, context = {}) => {
        const seen = new Set();
        const items = [];

        layoutItems?.forEach?.((item) => {
            if (!item?.id || seen.has(item.id)) {
                return;
            }

            const grid = context.clampGridLayout(
                item.grid || item.layout || {}
            );
            seen.add(item.id);
            items.push({
                id: item.id,
                type: item.type,
                x: grid.x,
                y: grid.y,
                w: grid.w,
                h: grid.h,
                z: context.normalizeZIndex(item.layout?.zIndex),
                visible: item.visible !== false,
                config: {
                    ...context.normalizeComponentConfig(item.type, item.config),
                    peerId: item.peerId || null,
                },
            });
        });

        return items;
    };

    const normalizeLoadedLayoutItems = (payload, context = {}) => {
        const payloadVersion = Number(payload?.version);
        const supportedVersions = new Set(
            [context.version, ...(context.supportedVersions || [])]
                .map(Number)
                .filter(Number.isFinite)
        );

        if (
            !payload ||
            !Number.isFinite(payloadVersion) ||
            !supportedVersions.has(payloadVersion)
        ) {
            return [];
        }

        if (
            payload.grid &&
            (Number(payload.grid.columns) !== context.columns ||
                Number(payload.grid.rows) !== context.rows)
        ) {
            // Grid changes are still normalized below; incompatible payloads
            // should never be applied raw.
        }

        const knownTypes = context.getKnownLayoutItemTypes();
        const seen = new Set();
        const seenSingletonTypes = new Set();

        return (Array.isArray(payload.items) ? payload.items : [])
            .map((item) => {
                if (!item?.id) {
                    return null;
                }

                const type = context.normalizeLayoutItemType(item?.type);
                const peerId =
                    typeof item?.config?.peerId === 'string'
                        ? item.config.peerId
                        : context.getLegacyRemoteLayoutPeerId(item.id);
                const itemId =
                    type === context.remotePeerType
                        ? context.normalizeRemotePeerLayoutId(item.id, peerId, {
                              peerId,
                          })
                        : String(item.id);

                if (
                    !knownTypes.has(type) ||
                    seen.has(itemId) ||
                    (context.singletonTypes.has(type) &&
                        seenSingletonTypes.has(type))
                ) {
                    return null;
                }

                seen.add(itemId);
                if (context.singletonTypes.has(type)) {
                    seenSingletonTypes.add(type);
                }
                const migratedItem =
                    context.migrateLoadedLayoutItem?.({
                        item,
                        itemId,
                        payloadVersion,
                        type,
                    }) || item;
                const grid = context.normalizeAutoLayoutGrid(type, {
                    x: migratedItem.x,
                    y: migratedItem.y,
                    w: migratedItem.w,
                    h: migratedItem.h,
                });

                return {
                    id: itemId,
                    type,
                    grid,
                    z: context.normalizeZIndex(migratedItem.z),
                    visible: migratedItem.visible !== false,
                    config: {
                        ...context.normalizeComponentConfig(
                            type,
                            migratedItem.config
                        ),
                        peerId: peerId || null,
                    },
                };
            })
            .filter(Boolean);
    };

    const loadLayoutFromStorage = ({
        storageKey,
        normalize,
        onInvalid,
    } = {}) => {
        try {
            const raw = global.localStorage.getItem(storageKey);

            if (!raw) {
                return [];
            }

            return normalize(JSON.parse(raw));
        } catch (error) {
            if (typeof onInvalid === 'function') {
                onInvalid(error);
            }
            return [];
        }
    };

    const readLayoutPreferencesFromStorage = ({
        storageKey,
        normalizeLayoutPreferences,
        getDefaultLayoutPreferences,
    } = {}) => {
        try {
            const raw = global.localStorage.getItem(storageKey);
            if (!raw) {
                return getDefaultLayoutPreferences();
            }
            const payload = JSON.parse(raw);
            return normalizeLayoutPreferences(payload.preferences);
        } catch {
            return getDefaultLayoutPreferences();
        }
    };

    const buildLayoutStoragePayload = ({
        version,
        columns,
        rows,
        items,
        preferences,
    }) => ({
        version,
        updatedAt: new Date().toISOString(),
        grid: {
            columns,
            rows,
        },
        items,
        preferences,
    });

    const saveLayoutToStorage = ({ storageKey, payload } = {}) => {
        global.localStorage.setItem(storageKey, JSON.stringify(payload));
    };

    const clearSavedLayout = ({ storageKey } = {}) => {
        global.localStorage.removeItem(storageKey);
    };

    global.PageLayoutStorage = {
        buildLayoutStoragePayload,
        clearSavedLayout,
        getLayoutStorageKey,
        loadLayoutFromStorage,
        normalizeLoadedLayoutItems,
        readLayoutPreferencesFromStorage,
        saveLayoutToStorage,
        serializeLayoutItems,
    };
})(window);
