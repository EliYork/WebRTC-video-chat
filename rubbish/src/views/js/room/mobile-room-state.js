(function exposeVoiceMobileRoomState(global) {
    'use strict';

    const createMobileRoomState = ({
        refs = {},
        getTiles,
        getLocalTileId = () => 'local-video',
        getRemotePeerOrder = () => [],
        isScreenSharingPeer: isSharingTile = () => false,
        isMobileLayout = () => false,
        renderMobileTileNav,
        toggleRoomClass,
    } = {}) => {
        let activeIndex = 0;

        const getAllTiles = () =>
            typeof getTiles === 'function' ? getTiles() : [];

        const getOrderedTiles = () => {
            const localTileId = getLocalTileId();
            const tiles = getAllTiles();
            const localTile = tiles.find((tile) => tile.id === localTileId);
            const remoteTiles = tiles.filter((tile) => tile.id !== localTileId);
            const remotePeerOrder = getRemotePeerOrder();

            remoteTiles.sort((a, b) => {
                const aSharing = isSharingTile(a.id);
                const bSharing = isSharingTile(b.id);

                if (aSharing && !bSharing) return -1;
                if (!aSharing && bSharing) return 1;

                return (
                    remotePeerOrder.indexOf(a.id) -
                    remotePeerOrder.indexOf(b.id)
                );
            });

            if (localTile) {
                remoteTiles.push(localTile);
            }

            return remoteTiles;
        };

        const updateTileView = () => {
            const orderedTiles = getOrderedTiles();
            const totalTiles = orderedTiles.length;

            if (totalTiles === 0) {
                activeIndex = 0;
            } else {
                activeIndex = Math.min(activeIndex, totalTiles - 1);
            }

            const activeTile = orderedTiles[activeIndex];

            renderMobileTileNav?.({
                refs,
                activeIndex,
                activeTile,
                allTiles: getAllTiles(),
                isInRoom: refs.mainLayout?.classList.contains('mobile-in-room'),
                totalTiles,
            });
        };

        const setRoomView = (isInRoom) => {
            toggleRoomClass?.(refs.mainLayout, 'mobile-in-room', isInRoom);
            updateTileView();
        };

        const updateRoomState = (isJoined) => {
            setRoomView(Boolean(isJoined) && isMobileLayout());
        };

        const goPrevious = () => {
            const totalTiles = getAllTiles().length;

            if (totalTiles <= 1) {
                return;
            }

            activeIndex = (activeIndex - 1 + totalTiles) % totalTiles;
            updateTileView();
        };

        const goNext = () => {
            const totalTiles = getAllTiles().length;

            if (totalTiles <= 1) {
                return;
            }

            activeIndex = (activeIndex + 1) % totalTiles;
            updateTileView();
        };

        const resetIndex = () => {
            activeIndex = 0;
            updateTileView();
        };

        const getActiveIndex = () => activeIndex;

        return {
            updateTileView,
            setRoomView,
            updateRoomState,
            goPrevious,
            goNext,
            resetIndex,
            getActiveIndex,
        };
    };

    global.VoiceMobileRoomState = {
        createMobileRoomState,
    };
})(window);
