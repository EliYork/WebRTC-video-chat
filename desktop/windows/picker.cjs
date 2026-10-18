document.querySelector('#cancel').onclick = () => window.close();
window.screenPicker.onSources(({ sources, audioRequested }) => {
    document.querySelector('#audio').disabled = !audioRequested;
    for (const source of sources) {
        const button = document.createElement('button');
        const image = document.createElement('img');
        image.src = source.thumbnail;
        image.alt = '';
        const name = document.createElement('span');
        name.textContent = source.name;
        button.append(image, name);
        button.onclick = () =>
            window.screenPicker.select(
                source.id,
                document.querySelector('#audio').checked
            );
        document.querySelector('#sources').append(button);
    }
});
