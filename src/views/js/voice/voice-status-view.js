(function exposeVoiceStatusView(global) {
    'use strict';

    const CONNECTION_LABELS = Object.freeze({
        degraded: '连接中断，正在重试',
        failed: '语音恢复失败，请重新加入',
        idle: '未加入语音',
        joined: '连接已恢复',
        joining: '正在加入',
        leaving: '正在离开',
        offline: '网络离线',
        'reconnecting-peer': '语音信令中断，正在重试',
        'reconnecting-socket': '连接中断，正在重试',
        restoring: '正在恢复语音',
    });

    const ERROR_LABELS = Object.freeze({
        camera: {
            'constraint-failed': '摄像头配置不受支持',
            'device-busy': '摄像头被其他程序占用',
            'device-not-found': '未找到摄像头',
            'permission-denied': '摄像头权限被拒绝',
            unknown: '摄像头不可用',
        },
        microphone: {
            'constraint-failed': '麦克风配置不受支持',
            'device-busy': '麦克风被其他程序占用',
            'device-not-found': '未找到麦克风',
            'permission-denied': '麦克风权限被拒绝',
            unknown: '麦克风不可用',
        },
        output: {
            'operation-aborted': '输出设备切换失败，已回退默认设备',
            'device-not-found': '输出设备失效，已回退默认设备',
            unknown: '输出设备切换失败，已回退默认设备',
        },
        screen: {
            'insecure-context': '当前页面无法启动屏幕共享',
            'permission-denied': '屏幕共享权限被拒绝',
            unknown: '屏幕共享不可用',
        },
    });

    const createStatusView = ({ connectionElement, container } = {}) => {
        const mediaErrors = new Map();

        const renderErrors = () => {
            if (!container) {
                return;
            }
            container.replaceChildren();
            mediaErrors.forEach((message, type) => {
                if (!message) {
                    return;
                }
                const item = global.document.createElement('span');
                item.className = 'voice-status-message';
                item.dataset.voiceStatusKind = type;
                item.textContent = message;
                container.append(item);
            });
            container.classList.toggle(
                'hidden',
                container.childElementCount === 0
            );
        };

        const setConnection = (state, message) => {
            if (connectionElement) {
                connectionElement.textContent =
                    message || CONNECTION_LABELS[state] || state;
                connectionElement.dataset.voiceSessionState = state;
            }
        };

        const setMediaError = (type, errorType, message) => {
            if (errorType === 'user-cancelled' || !errorType) {
                mediaErrors.delete(type);
            } else {
                mediaErrors.set(
                    type,
                    message ||
                        ERROR_LABELS[type]?.[errorType] ||
                        ERROR_LABELS[type]?.unknown ||
                        '媒体设备不可用'
                );
            }
            renderErrors();
        };

        return {
            clearAll: () => {
                mediaErrors.clear();
                renderErrors();
            },
            clearMediaError: (type) => {
                mediaErrors.delete(type);
                renderErrors();
            },
            getSnapshot: () => Object.fromEntries(mediaErrors),
            setConnection,
            setMediaError,
        };
    };

    global.VoiceStatusView = {
        CONNECTION_LABELS,
        ERROR_LABELS,
        createStatusView,
    };
})(window);
