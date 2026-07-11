import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
    new URL(
        '../src/views/js/media/screen-share-volume-controller.js',
        import.meta.url
    ),
    'utf8'
);

class FakeStream {
    constructor(tracks = []) {
        this.tracks = [...tracks];
    }

    getTracks() {
        return [...this.tracks];
    }

    getAudioTracks() {
        return this.tracks.filter((track) => track.kind === 'audio');
    }
}

const track = (kind, id) => ({ id, kind, readyState: 'live' });

const createElement = () => ({
    className: '',
    dataset: {},
    muted: false,
    parentElement: null,
    removed: false,
    srcObject: null,
    volume: 1,
    remove() {
        const index = this.parentElement?.children.indexOf(this) ?? -1;
        if (index >= 0) this.parentElement.children.splice(index, 1);
        this.parentElement = null;
        this.removed = true;
    },
});

const createTarget = () => ({
    children: [],
    append(element) {
        element.remove();
        element.parentElement = this;
        element.removed = false;
        this.children.push(element);
    },
});

const load = () => {
    const createdElements = [];
    const window = { MediaStream: FakeStream };
    vm.runInNewContext(source, { window });
    const controller = window.VoiceScreenShareVolumeController.createController(
        {
            MediaStreamCtor: FakeStream,
            applyElementState: ({ element, muted, volume }) => {
                element.muted = muted;
                element.volume = volume;
            },
            attachMediaElement: (element, stream) => {
                element.srcObject = stream;
            },
            clearMediaElement: (element) => {
                element.srcObject = null;
                element.clearCount = (element.clearCount || 0) + 1;
            },
            createAudioElement: () => {
                const element = createElement();
                createdElements.push(element);
                return element;
            },
        }
    );
    return { controller, createdElements };
};

test('sender role metadata distinguishes microphone and screen audio tracks', () => {
    const mic = track('audio', 'mic');
    const screen = track('audio', 'screen');
    const window = { MediaStream: FakeStream };
    vm.runInNewContext(source, { window });

    assert.deepEqual(
        JSON.parse(
            JSON.stringify(
                window.VoiceScreenShareVolumeController.buildTrackRoles({
                    screenStream: new FakeStream([screen]),
                    stream: new FakeStream([mic, screen]),
                })
            )
        ),
        [
            { role: 'participant-audio', trackId: 'mic' },
            { role: 'screen-share-audio', trackId: 'screen' },
        ]
    );
});

const roles = (participantId, screenId) => [
    { role: 'participant-audio', trackId: participantId },
    { role: 'screen-share-audio', trackId: screenId },
];

test('participant and A/B screen-share volume and mute targets stay independent', () => {
    const { controller } = load();
    const participantElement = { muted: false, volume: 0.8 };
    const aMic = track('audio', 'a-mic');
    const aScreen = track('audio', 'a-screen');
    const aVideo = track('video', 'a-video');
    const a = controller.bindSource({
        generation: 1,
        ownerKey: 'A',
        sourceStream: new FakeStream([aMic, aScreen, aVideo]),
        target: createTarget(),
        trackRoles: roles(aMic.id, aScreen.id),
    });

    assert.deepEqual(a.primaryStream.getTracks(), [aMic, aVideo]);
    assert.deepEqual(a.element.srcObject.getTracks(), [aScreen]);
    assert.equal(controller.setVolume('A', 0.35, { generation: 1 }), true);
    assert.equal(a.element.volume, 0.35);
    assert.equal(participantElement.volume, 0.8);
    assert.equal(controller.setMuted('A', true, { generation: 1 }), true);
    assert.equal(a.element.muted, true);
    assert.equal(participantElement.muted, false);

    participantElement.volume = 0.45;
    participantElement.muted = true;
    assert.equal(a.element.volume, 0.35);
    assert.equal(a.element.muted, true);

    const bMic = track('audio', 'b-mic');
    const bScreen = track('audio', 'b-screen');
    const b = controller.bindSource({
        generation: 4,
        ownerKey: 'B',
        sourceStream: new FakeStream([
            bMic,
            bScreen,
            track('video', 'b-video'),
        ]),
        target: createTarget(),
        trackRoles: roles(bMic.id, bScreen.id),
    });
    controller.setVolume('B', 0.7, { generation: 4 });
    assert.equal(b.element.volume, 0.7);
    assert.equal(a.element.volume, 0.35);

    const noAudio = controller.bindSource({
        generation: 1,
        ownerKey: 'C',
        sourceStream: new FakeStream([
            track('audio', 'c-mic'),
            track('video', 'c-video'),
        ]),
        target: createTarget(),
        trackRoles: [{ role: 'participant-audio', trackId: 'c-mic' }],
    });
    assert.equal(noAudio.hasScreenAudio, false);
    assert.equal(controller.getSnapshot('C').hasAudio, false);
    assert.equal(controller.setVolume('C', 0.1, { generation: 1 }), false);
    assert.equal(participantElement.volume, 0.45);
});

test('replacement inherits state while stale generations and cleanup cannot retain old elements', () => {
    const { controller } = load();
    const target = createTarget();
    const firstMic = track('audio', 'mic-1');
    const firstScreen = track('audio', 'screen-1');
    const first = controller.bindSource({
        generation: 7,
        ownerKey: 'A',
        sourceStream: new FakeStream([
            firstMic,
            firstScreen,
            track('video', 'video-1'),
        ]),
        target,
        trackRoles: roles(firstMic.id, firstScreen.id),
    });
    controller.setVolume('A', 0.25, { generation: 7 });
    controller.setMuted('A', true, { generation: 7 });

    const nextMic = track('audio', 'mic-2');
    const nextScreen = track('audio', 'screen-2');
    const next = controller.bindSource({
        generation: 8,
        ownerKey: 'A',
        sourceStream: new FakeStream([
            nextMic,
            nextScreen,
            track('video', 'video-2'),
        ]),
        target,
        trackRoles: roles(nextMic.id, nextScreen.id),
    });

    assert.notEqual(next.element, first.element);
    assert.equal(next.element.volume, 0.25);
    assert.equal(next.element.muted, true);
    assert.equal(first.element.srcObject, null);
    assert.equal(first.element.removed, true);
    assert.equal(first.element.clearCount, 1);
    assert.equal(controller.setVolume('A', 0.9, { generation: 7 }), false);
    assert.equal(controller.setMuted('A', false, { generation: 7 }), false);
    assert.equal(next.element.volume, 0.25);
    assert.equal(next.element.muted, true);

    controller.cleanup('A');
    assert.equal(next.element.srcObject, null);
    assert.equal(next.element.removed, true);
    assert.equal(controller.getBindingCount(), 0);
    assert.equal(controller.getSnapshot('A').element, undefined);
    controller.destroy();
    assert.equal(controller.getBindingCount(), 0);
});
