import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatRateLimiter } from '../src/utils/ChatRateLimit.js';

const fakeNow = () => 1_000_000;

test('chat rate limiter allows up to maxMessages within the window', () => {
    const limiter = createChatRateLimiter({
        maxMessages: 3,
        now: fakeNow,
        windowMs: 10_000,
    });

    assert.equal(limiter.allow('socket-a'), true);
    assert.equal(limiter.allow('socket-a'), true);
    assert.equal(limiter.allow('socket-a'), true);
    assert.equal(limiter.allow('socket-a'), false);
});

test('chat rate limiter is per-key, other sockets are not affected', () => {
    const limiter = createChatRateLimiter({
        maxMessages: 1,
        now: fakeNow,
        windowMs: 10_000,
    });

    assert.equal(limiter.allow('socket-a'), true);
    assert.equal(limiter.allow('socket-a'), false);
    assert.equal(limiter.allow('socket-b'), true);
});

test('chat rate limiter frees a key after the window elapses', () => {
    let current = 1_000_000;
    const limiter = createChatRateLimiter({
        maxMessages: 1,
        now: () => current,
        windowMs: 10_000,
    });

    assert.equal(limiter.allow('socket-a'), true);
    assert.equal(limiter.allow('socket-a'), false);

    current += 10_001;
    assert.equal(limiter.allow('socket-a'), true);
});

test('chat rate limiter clear resets a key immediately', () => {
    const limiter = createChatRateLimiter({
        maxMessages: 1,
        now: fakeNow,
        windowMs: 10_000,
    });

    assert.equal(limiter.allow('socket-a'), true);
    assert.equal(limiter.allow('socket-a'), false);

    limiter.clear('socket-a');
    assert.equal(limiter.allow('socket-a'), true);
});
