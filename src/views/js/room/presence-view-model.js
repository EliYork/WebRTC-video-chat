(function exposeVoicePresenceViewModel(global) {
    'use strict';

    const getMemberMicStatus = (member = {}) => {
        if (member.micPermissionDenied) {
            return {
                key: 'denied',
                label: '未授权',
                icon: 'fas fa-triangle-exclamation',
            };
        }

        if (!member.hasMic) {
            return {
                key: 'no-mic',
                label: '未开麦',
                icon: 'fas fa-microphone-slash',
            };
        }

        if (member.muted) {
            return {
                key: 'muted',
                label: '静音',
                icon: 'fas fa-microphone-slash',
            };
        }

        return {
            key: 'speaking',
            label: '开麦',
            icon: 'fas fa-microphone',
        };
    };

    const getMemberTileText = (member = {}) => {
        const micStatus = getMemberMicStatus(member);

        if (member.screenSharing) {
            return '正在共享屏幕';
        }

        if (micStatus.key === 'speaking') {
            return '正在语音';
        }

        if (micStatus.key === 'muted') {
            return '静音中';
        }

        if (micStatus.key === 'denied') {
            return '麦克风未授权';
        }

        return '未开麦';
    };

    const getMemberStatusIcons = (member = {}) => {
        const statuses = [getMemberMicStatus(member)];

        if (member.cameraOn) {
            statuses.push({
                key: 'camera',
                label: '摄像头开启',
                icon: 'fas fa-video',
            });
        }

        if (member.screenSharing) {
            statuses.push({
                key: 'screen',
                label: '共享中',
                icon: 'far fa-newspaper',
            });
        }

        return statuses;
    };

    const buildParticipantViewModel = (
        member = {},
        { isLocal = false, roomName = '', tileToggle } = {}
    ) => {
        const micStatus = getMemberMicStatus(member);

        return {
            id: member.socketId || member.peerId,
            isConnected: Boolean(member.socketId),
            isLocal,
            isMuted: micStatus.key === 'muted',
            isScreenSharing: Boolean(member.screenSharing),
            isSpeaking: micStatus.key === 'speaking',
            name: `${member.senderName || 'Guest'}${isLocal ? '（我）' : ''}`,
            roomId: member.roomId,
            roomName,
            statusText: getMemberTileText(member),
            statuses: getMemberStatusIcons(member),
            tileToggle,
        };
    };

    global.VoicePresenceViewModel = {
        buildParticipantViewModel,
        getMemberMicStatus,
        getMemberStatusIcons,
        getMemberTileText,
    };
})(window);
