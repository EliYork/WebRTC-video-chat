(function exposeVoiceChannelSidebarUI(global) {
    'use strict';

    const { toggleClass } = global.VoiceViewUtils;

    const renderChannelItemState = (
        element,
        { isSelectedTarget = false, isViewing = false, isVoice = false } = {}
    ) => {
        if (!element) {
            return;
        }

        toggleClass(element, 'is-viewing', isViewing);
        toggleClass(element, 'is-voice', isVoice);
        toggleClass(element, 'is-voice-target', isSelectedTarget);

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
        { joinedRoomId = '', selectedRoomId = '', viewingRoomId = '' } = {}
    ) => {
        channels.forEach((channel) => {
            const roomId = channel.dataset.channelRoom;

            renderChannelItemState(channel, {
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
