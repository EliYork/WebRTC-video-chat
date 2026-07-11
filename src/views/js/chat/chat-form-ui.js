(function (global) {
    const getRefs = (refs = {}) => ({
        form: refs.form,
        input: refs.input,
        submitButton: refs.submitButton,
    });

    const getMessageContent = ({ refs = {}, maxLength = 500 } = {}) => {
        const { input } = getRefs(refs);
        return input?.value.trim().slice(0, maxLength) || '';
    };

    const renderSubmitState = ({
        refs = {},
        disabled = false,
        loading = false,
    } = {}) => {
        const { submitButton } = getRefs(refs);

        if (!submitButton) {
            return false;
        }

        submitButton.disabled = Boolean(disabled || loading);
        submitButton.setAttribute('aria-busy', String(Boolean(loading)));
        return true;
    };

    const renderInputState = ({
        refs = {},
        maxLength = 500,
        placeholder = '发送消息',
    } = {}) => {
        const { input } = getRefs(refs);

        if (!input) {
            return false;
        }

        input.maxLength = maxLength;
        input.placeholder = placeholder;
        return true;
    };

    const resetForm = ({ refs = {}, focus = false } = {}) => {
        const { input } = getRefs(refs);

        if (!input) {
            return false;
        }

        input.value = '';

        if (focus) {
            input.focus();
        }

        return true;
    };

    const focusInput = ({ refs = {} } = {}) => {
        const { input } = getRefs(refs);
        input?.focus();
    };

    global.VoiceChatFormUI = {
        getMessageContent,
        renderSubmitState,
        renderInputState,
        resetForm,
        focusInput,
    };
})(window);
