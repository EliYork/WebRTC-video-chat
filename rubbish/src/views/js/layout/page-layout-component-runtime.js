(function exposePageLayoutComponentRuntime(global) {
    'use strict';

    const createComponentRuntime = (options = {}) => {
        const documentRef = options.document || global.document;
        const logger = options.logger || global.console;

        const refreshComponentLifecycleUI = () => {
            options.renderLayoutComponentMenu?.();
            options.updateMobileTileView?.();
        };

        const getExistingLayoutComponentTile = (type) => {
            if (type === options.localPeerType) {
                return documentRef.getElementById('local-video');
            }

            return documentRef.getElementById(
                options.getLayoutComponentId(type)
            );
        };

        const addLayoutComponent = (type) => {
            const allowedTypes = options.getSingletonTypes();

            if (!allowedTypes.has(type)) {
                return null;
            }

            const tile = getExistingLayoutComponentTile(type);

            if (!tile) {
                logger.warn(
                    '[page-layout]',
                    'Cannot recreate missing real DOM page panel:',
                    type
                );
                return null;
            }

            const layoutId = options.getTileLayoutId(tile);
            const savedItem = options.getSavedLayoutItemPreference(layoutId);
            const defaultItem = options
                .getDefaultLayoutItems()
                .find((item) => item.type === type);
            const layoutItem = savedItem || defaultItem;

            if (
                layoutItem &&
                (savedItem || !tile.classList.contains('is-positioned'))
            ) {
                const nextLayout = options.convertGridLayoutToPixels({
                    ...layoutItem.grid,
                    zIndex: layoutItem.z || options.getNextTileLayoutZIndex(),
                });
                const syncedItem = options.upsertTileLayoutItem(tile, {
                    layout: nextLayout,
                    visible: layoutItem.visible !== false,
                    positioned: true,
                    config: layoutItem.config,
                });
                options.applyTileLayoutItemToElement(tile, syncedItem, {
                    applyPosition: true,
                });
            }

            const hydrating = options.isLayoutStorageHydrating();
            const visible =
                hydrating && savedItem
                    ? savedItem.visible
                    : hydrating
                      ? true
                      : true;
            tile.classList.toggle('is-layout-hidden', !visible);
            options.setTileLayoutItemVisibility(
                tile.dataset.layoutItemId,
                visible
            );
            options.bringTileLayoutToFront(tile);
            options.saveLayoutToStorage(visible ? '布局已更新' : '布局已更新');
            refreshComponentLifecycleUI();

            return tile;
        };

        const hideLayoutComponent = (tile) => {
            if (!tile) {
                return;
            }

            options.setTileLayoutItemVisibility(
                tile.dataset.layoutItemId,
                false
            );
            tile.classList.add('is-layout-hidden');
            options
                .findLayoutComponentToolbar(tile)
                ?.classList.remove('is-visible');
            options.closePeerVolumePopover();
            options.saveLayoutToStorage('布局已更新');
            refreshComponentLifecycleUI();
        };

        const applyDefaultLayout = () => {
            options.clearSavedLayout();

            const defaultItems = options.getDefaultLayoutItems();
            const pageTypes = options.getCorePageTypes();

            pageTypes.forEach((type) => {
                addLayoutComponent(type);
            });

            defaultItems.forEach((item) => {
                const tile =
                    item.type === options.localPeerType
                        ? documentRef.getElementById('local-video')
                        : documentRef.getElementById(
                              options.getLayoutComponentId(item.type)
                          ) ||
                          options
                              .getVideoTiles()
                              .find(
                                  (candidate) =>
                                      options.getTileLayoutId(candidate) ===
                                      item.id
                              );

                if (!tile) {
                    return;
                }

                tile.classList.remove('is-layout-hidden');
                options.applyTileLayout(
                    tile,
                    options.convertGridLayoutToPixels({
                        ...item.grid,
                        zIndex: options.getNextTileLayoutZIndex(),
                    })
                );
                const syncedItem = options.upsertTileLayoutItem(tile, {
                    visible: item.visible,
                    positioned: true,
                    config: item.config,
                });
                options.applyTileLayoutItemToElement(tile, syncedItem, {
                    applyPosition: false,
                });
                options.setTileLayoutItemVisibility(
                    tile.dataset.layoutItemId,
                    item.visible
                );
            });

            options.saveLayoutToStorage('已恢复默认');
            refreshComponentLifecycleUI();
        };

        const getInitialLayoutItems = () => {
            const savedItems = options.getSavedLayoutItems();

            return savedItems.length
                ? savedItems
                : options.getDefaultLayoutItems();
        };

        const applyStoredLayoutToExistingTile = (item) => {
            const tile = options
                .getVideoTiles()
                .find(
                    (candidate) =>
                        options.getTileLayoutId(candidate) === item.id
                );

            if (!tile) {
                return;
            }

            options.applyTileLayout(
                tile,
                options.convertGridLayoutToPixels({
                    ...item.grid,
                    zIndex: item.z || options.getNextTileLayoutZIndex(),
                })
            );
            const syncedItem = options.upsertTileLayoutItem(tile, {
                visible: item.visible,
                positioned: true,
                config: item.config,
            });
            options.applyTileLayoutItemToElement(tile, syncedItem, {
                applyPosition: false,
            });
            options.setTileLayoutItemVisibility(
                tile.dataset.layoutItemId,
                item.visible
            );
            tile.classList.toggle('is-layout-hidden', !item.visible);
        };

        const applyPageLayoutItemToPanel = (item) => {
            const tile = getExistingLayoutComponentTile(item.type);

            if (!tile) {
                return;
            }

            const nextLayout = options.convertGridLayoutToPixels({
                ...item.grid,
                zIndex: item.z || options.getNextTileLayoutZIndex(),
            });

            options.applyTileLayout(tile, nextLayout);
            const syncedItem = options.upsertTileLayoutItem(tile, {
                layout: nextLayout,
                visible: item.visible,
                positioned: true,
                config: item.config,
            });
            options.applyTileLayoutItemToElement(tile, syncedItem, {
                applyPosition: true,
            });
            options.setTileLayoutItemVisibility(
                tile.dataset.layoutItemId,
                item.visible
            );
            tile.classList.toggle('is-layout-hidden', !item.visible);
        };

        const initializeLayoutFromStorage = () => {
            const initialItems = getInitialLayoutItems();

            options.setLayoutStorageHydrating(true);
            try {
                initialItems.forEach((item) => {
                    if (options.getSingletonTypes().has(item.type)) {
                        const existing = getExistingLayoutComponentTile(
                            item.type
                        );
                        if (!existing) {
                            addLayoutComponent(item.type);
                        } else {
                            applyPageLayoutItemToPanel(item);
                        }
                        return;
                    }

                    applyStoredLayoutToExistingTile(item);
                });
            } finally {
                options.setLayoutStorageHydrating(false);
            }

            refreshComponentLifecycleUI();
        };

        return {
            addLayoutComponent,
            applyDefaultLayout,
            applyPageLayoutItemToPanel,
            applyStoredLayoutToExistingTile,
            getExistingLayoutComponentTile,
            getInitialLayoutItems,
            hideLayoutComponent,
            initializeLayoutFromStorage,
            refreshComponentLifecycleUI,
        };
    };

    global.PageLayoutComponentRuntime = {
        createComponentRuntime,
        createRuntime: createComponentRuntime,
    };
})(window);
