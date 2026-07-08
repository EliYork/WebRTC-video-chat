(function exposePageLayoutStoreRuntime(global) {
    'use strict';

    const createStoreRuntime = (options = {}) => {
        const documentRef = options.document || global.document;
        const layoutItemsById = new Map();
        const savedLayoutItemsById = new Map();
        let layoutPreferences = options.getDefaultLayoutPreferences();
        let layoutStorageHydrating = false;

        const readLayoutPreferencesFromStorage = () => {
            return options.layoutStorage.readLayoutPreferencesFromStorage({
                storageKey: options.getLayoutStorageKey(),
                normalizeLayoutPreferences: options.normalizeLayoutPreferences,
                getDefaultLayoutPreferences:
                    options.getDefaultLayoutPreferences,
            });
        };

        const getLayoutPreference = (key) => {
            return options.getLayoutPreferenceValue(layoutPreferences, key);
        };

        const getKnownLayoutItemTypes = () =>
            new Set([
                ...Object.values(options.layoutItemTypes),
                ...options.getSingletonTypes(),
            ]);

        const serialize = () =>
            options.layoutStorage.serializeLayoutItems(layoutItemsById, {
                clampGridLayout: options.clampGridLayout,
                normalizeZIndex: options.normalizeZIndex,
                normalizeComponentConfig: options.normalizeComponentConfig,
            });

        const normalizeLoadedLayoutItems = (payload) =>
            options.layoutStorage.normalizeLoadedLayoutItems(payload, {
                version: options.version,
                columns: options.columns,
                rows: options.rows,
                getKnownLayoutItemTypes,
                normalizeLayoutItemType: options.normalizeLayoutItemType,
                getLegacyRemoteLayoutPeerId:
                    options.getLegacyRemoteLayoutPeerId,
                normalizeRemotePeerLayoutId:
                    options.normalizeRemotePeerLayoutId,
                remotePeerType: options.layoutItemTypes.REMOTE_PEER,
                singletonTypes: options.getSingletonTypes(),
                normalizeAutoLayoutGrid: options.normalizeAutoLayoutGrid,
                normalizeZIndex: options.normalizeZIndex,
                normalizeComponentConfig: options.normalizeComponentConfig,
                supportedVersions: options.supportedStorageVersions,
                migrateLoadedLayoutItem: options.migrateLoadedLayoutItem,
            });

        const loadLayoutFromStorage = () =>
            options.layoutStorage.loadLayoutFromStorage({
                storageKey: options.getLayoutStorageKey(),
                normalize: normalizeLoadedLayoutItems,
                onInvalid: (error) => {
                    options.logger?.warn(
                        '[layout] saved layout is invalid; using defaults.',
                        error
                    );
                },
            });

        const refreshSaved = () => {
            savedLayoutItemsById.clear();
            loadLayoutFromStorage().forEach((item) => {
                savedLayoutItemsById.set(item.id, item);
            });
            layoutPreferences = readLayoutPreferencesFromStorage();
        };

        const getSavedItem = (itemId) => savedLayoutItemsById.get(itemId);
        const getSavedItems = () => Array.from(savedLayoutItemsById.values());

        const getSavedRemoteItem = (peerId, member, preferredId) =>
            options
                .getRemoteLayoutAliasIds(peerId, member, preferredId)
                .map((aliasId) => savedLayoutItemsById.get(aliasId))
                .find(Boolean);

        const buildLayoutStoragePayload = () =>
            options.layoutStorage.buildLayoutStoragePayload({
                version: options.version,
                columns: options.columns,
                rows: options.rows,
                items: serialize(),
                preferences: layoutPreferences
                    ? { ...layoutPreferences }
                    : options.getDefaultLayoutPreferences(),
            });

        const saveLayoutToStorage = (message = '已保存') => {
            if (layoutStorageHydrating) {
                return;
            }

            options.layoutStorage.saveLayoutToStorage({
                storageKey: options.getLayoutStorageKey(),
                payload: buildLayoutStoragePayload(),
            });
            refreshSaved();
            options.showLayoutSaveStatus(message);
        };

        const clearSavedLayout = () => {
            options.layoutStorage.clearSavedLayout({
                storageKey: options.getLayoutStorageKey(),
            });
            refreshSaved();
        };

        const createTileLayoutItem = ({
            id,
            type,
            peerId,
            elementId,
            layout,
            visible = true,
            positioned = false,
            config,
        }) => {
            const nextLayout = options.normalizeTileLayout(
                options.getFallbackTileLayoutForType(type, layout)
            );

            return {
                id,
                type,
                peerId,
                elementId,
                visible: Boolean(visible),
                positioned: Boolean(positioned),
                layout: nextLayout,
                grid: options.convertTileLayoutToGrid(nextLayout),
                config: options.normalizeComponentConfig(type, config),
            };
        };

        const getItem = (itemId) => layoutItemsById.get(itemId);
        const setItem = (item) => {
            if (item?.id) {
                layoutItemsById.set(item.id, item);
            }
            return item;
        };
        const deleteItem = (itemId) => layoutItemsById.delete(itemId);
        const forEachItem = (callback) => layoutItemsById.forEach(callback);
        const values = () => Array.from(layoutItemsById.values());
        const getRegistry = () => layoutItemsById;

        const upsertTileLayoutItem = (tile, updates = {}) => {
            const id = updates.id || options.getTileLayoutItemId(tile);
            const previous = getItem(id);
            const layout =
                updates.layout ||
                previous?.layout ||
                options.getCurrentTileLayout(tile);
            const tileConfig = tile.classList.contains('is-free-move-enabled')
                ? { freeMove: true }
                : {};
            const mergedConfig = {
                ...(previous?.config || {}),
                ...tileConfig,
                ...(updates.config || {}),
            };
            const item = createTileLayoutItem({
                id,
                type:
                    updates.type ||
                    previous?.type ||
                    options.layoutItemTypes.PLACEHOLDER,
                peerId:
                    updates.peerId ?? previous?.peerId ?? tile.dataset.peerId,
                elementId: updates.elementId || previous?.elementId || tile.id,
                layout,
                visible: updates.visible ?? previous?.visible ?? true,
                positioned:
                    updates.positioned ??
                    previous?.positioned ??
                    tile.classList.contains('is-positioned'),
                config: mergedConfig,
            });

            setItem(item);
            return item;
        };

        const syncTileLayoutItemFromElement = (tile, updates = {}) => {
            const item = upsertTileLayoutItem(tile, {
                ...updates,
                id: updates.id || options.getTileLayoutItemId(tile),
                peerId: updates.peerId ?? tile.dataset.peerId,
                elementId: tile.id,
            });

            options.applyTileLayoutItemToElement(tile, item, {
                applyPosition: false,
            });
            return item;
        };

        const saveTileLayout = (layoutId, layout) => {
            if (!layoutId) {
                return;
            }

            const item = getItem(layoutId);

            if (item) {
                item.layout = options.normalizeTileLayout(layout);
                item.grid = options.convertTileLayoutToGrid(item.layout);
                setItem(item);
            }

            saveLayoutToStorage('布局已更新');
        };

        const persistTileLayoutItem = (tile) => {
            const item = syncTileLayoutItemFromElement(tile, {
                layout: options.getCurrentTileLayout(tile),
                positioned: tile.classList.contains('is-positioned'),
                visible: true,
            });

            saveTileLayout(item.id, {
                ...item.layout,
                grid: options.convertTileLayoutToGrid(item.layout),
            });
        };

        const setItemVisibility = (
            itemId,
            visible,
            { syncElement = true } = {}
        ) => {
            const item = getItem(itemId);

            if (!item) {
                return;
            }

            item.visible = Boolean(visible);
            setItem(item);

            if (!syncElement) {
                return;
            }

            const tile = documentRef.getElementById(item.elementId);

            if (tile) {
                options.applyTileLayoutItemToElement(tile, item, {
                    applyPosition: false,
                });
            }
        };

        const retirePreviousTileLayoutItem = (tile, nextItemId) => {
            const previousItemIds = new Set([
                tile.dataset.layoutItemId,
                tile.dataset.layoutId,
            ]);

            previousItemIds.forEach((previousItemId) => {
                if (previousItemId && previousItemId !== nextItemId) {
                    if (
                        options.isRemoteLayoutAliasForTile(
                            tile,
                            previousItemId,
                            nextItemId
                        )
                    ) {
                        deleteItem(previousItemId);
                        return;
                    }

                    setItemVisibility(previousItemId, false, {
                        syncElement: false,
                    });
                }
            });
        };

        const isHydrating = () => layoutStorageHydrating;
        const setHydrating = (value) => {
            layoutStorageHydrating = Boolean(value);
        };

        refreshSaved();

        return {
            buildLayoutStoragePayload,
            clearSavedLayout,
            createTileLayoutItem,
            deleteItem,
            forEachItem,
            getItem,
            getLayoutPreference,
            getRegistry,
            getSavedItem,
            getSavedItems,
            getSavedRemoteItem,
            isHydrating,
            loadLayoutFromStorage,
            normalizeLoadedLayoutItems,
            persistTileLayoutItem,
            readLayoutPreferencesFromStorage,
            refreshSaved,
            retirePreviousTileLayoutItem,
            saveLayoutToStorage,
            saveTileLayout,
            serialize,
            setHydrating,
            setItem,
            setItemVisibility,
            syncTileLayoutItemFromElement,
            upsertTileLayoutItem,
            values,
        };
    };

    global.PageLayoutStoreRuntime = {
        createRuntime: createStoreRuntime,
        createStoreRuntime,
    };
})(window);
