(function exposeVoiceAudioSettingsController(global) {
    'use strict';
    // One revision spans both the device and mode, so a late mode failure cannot
    // roll back a newer device selection (or persist an unadopted preference).
    const createController = ({
        initial,
        apply,
        onRequested,
        onCommitted,
        onChange,
        rollback,
    } = {}) => {
        let requested = { ...initial };
        let committed = { ...initial };
        let revision = 0;
        let pending = false;
        let error = null;
        let task;
        const snapshot = () => ({
            requested: { ...requested },
            committed: { ...committed },
            pending,
            error,
        });
        const notify = () => onChange?.(snapshot());
        const adopt = (config) => {
            committed = { ...config };
            onCommitted?.(committed);
        };
        const perform = async (patch) => {
            const token = ++revision;
            requested = { ...requested, ...patch };
            const config = { ...requested };
            pending = true;
            error = null;
            onRequested?.(config);
            notify();
            let ok;
            let failureType = null;
            try {
                ok = await apply(config);
            } catch (failure) {
                failureType = failure?.name || 'Error';
                ok = false;
            }
            if (token !== revision) return false;
            pending = false;
            error = failureType;
            if (ok) adopt(config);
            else {
                error ||= 'switch-failed';
                requested = { ...committed, ...rollback?.() };
                onRequested?.(requested);
            }
            notify();
            return Boolean(ok);
        };
        const select = (patch) => {
            const next = { ...requested, ...patch };
            if (
                pending &&
                next.mode === requested.mode &&
                next.deviceId === requested.deviceId
            )
                return task;
            task = perform(patch);
            return task;
        };
        const cancel = () => {
            revision += 1;
            pending = false;
            error = null;
            requested = { ...committed };
            onRequested?.(requested);
        };
        return { select, snapshot, adopt, cancel };
    };
    global.VoiceAudioSettingsController = { createController };
})(window);
