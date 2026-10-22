import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileLog } from '../src/utils/RotatingFileLog.cjs';

test('logs retain bounded numbered backups and never rotate unrelated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-rotate-'));
    try {
        const target = join(dir, 'app.log');
        writeFileSync(join(dir, 'other.log'), 'keep');
        const log = createFileLog({filePath:target, maxBytes:64, backups:2});
        for (let n=0;n<8;n++) assert.equal(log.write(`${n}:` + 'x'.repeat(35)), true);
        assert.deepEqual(readdirSync(dir).sort(), ['app.log','app.log.1','app.log.2','other.log']);
        assert.match(readFileSync(target,'utf8'), /^7:/);
        assert.match(readFileSync(`${target}.1`,'utf8'), /^6:/);
        for (const name of ['app.log','app.log.1','app.log.2']) assert.ok(statSync(join(dir,name)).size <= 64);
        assert.equal(readFileSync(join(dir,'other.log'),'utf8'), 'keep');
    } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('write failures remain nonfatal, are reported once, and recover when storage returns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-log-failure-')), fallback = [];
    try {
        let target = dir;
        const log = createFileLog({filePath:() => target, fallback:line => fallback.push(line)});
        assert.equal(log.write('one'), false); assert.equal(log.write('two'), false);
        assert.equal(log.writeFailed, true); assert.equal(fallback.filter(line=>line.startsWith('[log]')).length,1);
        target = join(dir,'recovered.log'); assert.equal(log.write('three'),true);
        assert.equal(log.writeFailed,false); assert.match(readFileSync(target,'utf8'),/three/);
        target = dir; log.write('four'); assert.equal(fallback.filter(line=>line.startsWith('[log]')).length,2);
        const broken = createFileLog({filePath:dir, fallback:() => { throw Error('stderr unavailable'); }});
        assert.doesNotThrow(()=>broken.write('still alive'));
    } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('oversized unicode entries are bounded and retain a valid UTF-8 truncation marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-log-entry-'));
    try {
        const target = join(dir,'app.log'), log = createFileLog({filePath:target,maxBytes:128,maxEntryBytes:64});
        assert.equal(log.write('日志😀'.repeat(100)),true);
        const data = readFileSync(target); assert.ok(data.length <= 64);
        assert.ok(!data.toString('utf8').includes('\uFFFD')); assert.match(data.toString('utf8'), /truncated/);
    } finally { rmSync(dir,{recursive:true,force:true}); }
});
