module.exports = {
    appId: 'com.eliyork.voice',
    productName: 'EliYork Voice',
    executableName: 'EliYork Voice',
    asar: false,
    npmRebuild: false,
    files: [
        'package.json',
        'main.cjs',
        'preload.cjs',
        'updater.cjs',
        'picker-preload.cjs',
        'picker.html',
        'picker.cjs',
    ],
    extraResources: [
        {
            from: '../../integrations/piik/.build',
            to: 'native',
            filter: [
                'piik-app.exe',
                'runtime/native/piik-capture.exe',
                'LICENSE-Piik.txt',
                'THIRD-PARTY-NOTICES.txt',
            ],
        },
    ],
    extraFiles: [
        { from: '../../LICENSE', to: 'LICENSE-EliYork.txt' },
        { from: 'README.md', to: 'README.md' },
    ],
    win: { target: [{ target: 'nsis', arch: ['x64'] }], signExecutable: false },
    nsis: {
        oneClick: true,
        perMachine: false,
        allowElevation: false,
        packElevateHelper: false,
        deleteAppDataOnUninstall: false,
        createDesktopShortcut: true,
        artifactName: 'EliYork-Voice-Setup-${version}-x64.exe',
    },
    publish: {
        provider: 'generic',
        url: 'https://voice.eliyork.com/downloads/windows/',
        useMultipleRangeRequest: false,
    },
};
