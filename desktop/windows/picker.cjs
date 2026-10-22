let selected;
document.querySelector('#cancel').onclick = document.querySelector('#close').onclick = () => window.close();
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.close(); });
document.querySelector('#start').onclick = () => {
    if (!selected) return;
    document.querySelector('#start').disabled = true;
    window.screenPicker.select(selected.id, document.querySelector('#audio').checked);
};
window.screenPicker.onSources(({ sources, audioRequested }) => {
    selected = null;
    document.querySelector('#start').disabled = true;
    document.querySelector('#selection').textContent = '尚未选择画面';
    const audio = document.querySelector('#audio');
    audio.disabled = !audioRequested;
    audio.checked = Boolean(audioRequested);
    document.querySelector('#audio-note').textContent = audioRequested
        ? '系统声音可能包含通话声音，可按需关闭。' : '当前共享未请求系统声音。';
    const list = document.querySelector('#sources');
    list.replaceChildren();
    for (const [prefix, title] of [['screen:', '屏幕'], ['window:', '窗口']]) {
        const group = sources.filter(source => source.id.startsWith(prefix));
        if (!group.length) continue;
        const heading = document.createElement('h2'); heading.textContent = title;
        const grid = document.createElement('div'); grid.className = 'source-grid';
        grid.setAttribute('role', 'radiogroup'); grid.setAttribute('aria-label', title);
        group.forEach((source, i) => {
            const name = prefix === 'screen:' ? `显示器 ${i + 1}` : source.name;
            const button = document.createElement('button'); button.className = 'source-card';
            button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', 'false');
            button.title = name;
            const image = document.createElement('img'); image.src = source.thumbnail; image.alt = '';
            const label = document.createElement('span'); label.textContent = name;
            button.append(image, label);
            button.onclick = () => {
                list.querySelectorAll('.source-card').forEach(card => card.setAttribute('aria-checked', String(card === button)));
                selected = source;
                document.querySelector('#selection').textContent = `已选择 ${name}`;
                document.querySelector('#start').disabled = false;
            };
            button.onkeydown = event => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                const cards = [...list.querySelectorAll('.source-card')];
                const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[event.key];
                const next = cards[(cards.indexOf(button) + step + cards.length) % cards.length];
                next.focus(); next.click();
            };
            grid.append(button);
        });
        list.append(heading, grid);
    }
    if (!list.children.length) {
        const empty = document.createElement('p'); empty.className = 'empty';
        empty.textContent = '未找到可共享的画面，请关闭后重新选择。'; list.append(empty);
    }
});
