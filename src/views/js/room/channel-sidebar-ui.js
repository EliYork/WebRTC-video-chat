(function exposeVoiceChannelSidebarUI(global) {
    'use strict';

    const { toggleClass } = global.VoiceViewUtils;

    const renderChannelItemState = (
        element,
        {
            hasMembers,
            isSelectedTarget = false,
            isViewing = false,
            isVoice = false,
        } = {}
    ) => {
        if (!element) {
            return;
        }

        toggleClass(element, 'is-viewing', isViewing);
        toggleClass(element, 'is-voice', isVoice);
        toggleClass(element, 'is-voice-target', isSelectedTarget);
        if (hasMembers !== undefined) {
            toggleClass(element, 'has-members', hasMembers);
        }

        const link = element.querySelector('.tree-channel-link');
        if (link) {
            if (isViewing) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        }
    };

    const renderChannelListState = (
        channels = [],
        {
            joinedRoomId = '',
            memberCounts = new Map(),
            selectedRoomId = '',
            viewingRoomId = '',
        } = {}
    ) => {
        channels.forEach((channel) => {
            const roomId = channel.dataset.channelRoom;

            renderChannelItemState(channel, {
                hasMembers: (memberCounts.get(roomId) || 0) > 0,
                isSelectedTarget: !joinedRoomId && roomId === selectedRoomId,
                isViewing: roomId === viewingRoomId,
                isVoice: roomId === joinedRoomId,
            });
        });
    };

    global.VoiceChannelSidebarUI = {
        renderChannelItemState,
        renderChannelListState,
    };
})(window);
