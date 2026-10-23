// Optional, capability-gated additions to the pinned control client. The same
// virtual source is used by TypeScript and esbuild; upstream stays untouched.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function editOnce(text, before, after) {
    if (text.split(before).length !== 2) throw Error(`Piik share overlay context changed: ${before.slice(0, 90)}`);
    return text.replace(before, after);
}
export function patchPiikClient(file, text) {
    text = text.replaceAll('\r\n', '\n');
    if (file.endsWith('/native/wire.ts')) {
        text = editOnce(text, 'processAudio: z.boolean().default(false),', 'independentAudio: z.boolean().default(false),\n      processAudio: z.boolean().default(false),');
        text = editOnce(text, 'code: z.literal("operation-failed"),', 'code: z.literal("operation-failed"),\n    reason: z.enum(["hardware-unavailable", "encoder-failed", "media-capture-failed", "audio-target-invalid", "audio-capture-failed", "system-exclusion-unavailable", "capture-unconfirmed"]).optional(),');
        text = editOnce(text, 'type: z.literal("share-ended"),\n      failed: z.boolean(),', 'type: z.literal("share-ended"),\n      reason: z.enum(["hardware-unavailable", "encoder-failed", "media-capture-failed", "capture-unconfirmed"]).optional(),\n      failed: z.boolean(),');
        text += `
export const platformAudioTargetSchema = z.object({
  pid: z.number().int().positive().max(0xffffffff), creationTime: decimalIdentifierSchema,
}).strict();
export const platformAudioListSchema = z.object({ ...responseBase, type: z.literal("platform-audio-sources"),
  sources: z.array(platformAudioTargetSchema.extend({ name: z.string().min(1).max(512),
    hasSession: z.boolean(), active: z.boolean(), icon: z.string().max(24000).regex(/^(?:|data:image\\/bmp;base64,[A-Za-z0-9+/=]+)$/),
  }).strict()).max(1024), systemSafe: z.boolean(),
}).strict();
export const platformShareStatusSchema = z.object({ ...responseBase, type: z.literal("platform-share-status"),
  shareId: opaqueIdentifierSchema, codec: z.enum(["", "h264", "vp8"]), hardware: z.boolean(),
  state: z.enum(["unknown", "starting", "active"]), encoder: z.string().max(512), adapter: z.string().max(512),
  audio: z.enum(["none", "active", "failed"]),
}).strict();
`;
    } else if (file.endsWith('/native/client.ts')) {
        text = editOnce(text, 'import {\n  captureOptionsResponseSchema,', 'import {\n  platformAudioListSchema, platformShareStatusSchema,\n  captureOptionsResponseSchema,');
        text = editOnce(text, '  audio: boolean;\n  excludeAudio?', '  audio: boolean;\n  audioMode?: "none" | "system" | "application";\n  audioTarget?: { pid: number; creationTime: string };\n  microphoneMixing?: boolean;\n  excludeAudio?');
        text = editOnce(text, '  async captureOptions():', `  async audioSources() {
    if (!this.health.nativeMedia.independentAudio) throw new Error("请升级客户端后选择独立音源");
    return this.request("platform-audio-sources", {}, platformAudioListSchema);
  }
  async shareStatus(shareId: string) {
    if (!this.health.nativeMedia.independentAudio) return null;
    const result = await this.request("platform-share-status", { shareId }, platformShareStatusSchema);
    if (result.shareId !== shareId) throw new Error("Native share identity changed");
    return result;
  }
  async captureOptions():`);
        text = editOnce(text, 'const { showCaptureBorder = false, excludeAudio, ...shareInput } = input;', `const { showCaptureBorder = false, excludeAudio, audioMode, audioTarget, microphoneMixing, ...shareInput } = input;
    if (audioMode && !this.health.nativeMedia.independentAudio) throw new Error("请升级客户端后选择独立音源");`);
        text = editOnce(text, '...(this.health.nativeMedia.microphone ? { microphoneMixing: true } : {}),', '...(audioMode ? { audioMode, ...(audioTarget ? { audioTarget } : {}) } : {}),\n        ...(this.health.nativeMedia.microphone ? { microphoneMixing: microphoneMixing ?? true } : {}),');
        text = editOnce(text, '"start-share",\n      {', 'audioMode ? "platform-start-share" : "start-share",\n      {');
        text = editOnce(text, '{ cause: { code: failure.data.code } }', '{ cause: { code: failure.data.code, reason: failure.data.reason } }');
    }
    return text;
}
export const piikClientOverlay = { name: 'piik-share-control', setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]client[\\/]native[\\/](client|wire)\.ts$/ }, args => ({
        contents: patchPiikClient(args.path.replaceAll('\\', '/'), readFileSync(args.path, 'utf8')), loader: 'ts',
    }));
} };
export async function checkPiikTypes(source, home) {
    const { default: ts } = await import(pathToFileURL(join(source, 'node_modules/typescript/lib/typescript.js')));
    const config = ts.readConfigFile(join(home, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, home);
    const host = ts.createCompilerHost(parsed.options);
    const read = host.readFile;
    host.readFile = file => {
        const original = read(file);
        return original === undefined ? undefined : patchPiikClient(file.replaceAll('\\', '/'), original);
    };
    const program = ts.createProgram(parsed.fileNames, parsed.options, host);
    const errors = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
    if (errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: () => home, getCanonicalFileName: f => f, getNewLine: () => '\n',
    }));
}
