import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isStalled, renderProgressDisplay } from '../lib/ui/progress.js';
import { processSignalResults } from '../lib/injection/signals.js';
import { pauseArc, resumeArc } from '../lib/injection/clock.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

// Episode of estimatedLength 20 with six non-optional beats: a stall is more
// than 3 × 20 / 6 = 10 messages since the last fulfillment.
function episode(overrides = {}) {
    const beats = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, status: 'active', optional: false }));
    return { id: 'ep', tier: 'episode', focus: 'normal', status: 'active', messageStart: 100, lastFulfilledAt: 100, estimatedLength: 20, beats, ...overrides };
}

describe('isStalled — threshold', () => {
    // lastFulfilledAt is the chat index of the fulfilling message, so after N
    // further messages chat.length is lastFulfilledAt + N + 1.
    const table = [
        { name: 'nine messages after the fulfillment: not stalled', chatLength: 110, expected: false },
        { name: 'ten messages after the fulfillment: stalled', chatLength: 111, expected: true },
        { name: 'right after the fulfillment: not stalled', chatLength: 101, expected: false },
    ];
    for (const row of table) {
        it(row.name, () => {
            assert.equal(isStalled(episode(), row.chatLength), row.expected);
        });
    }

    it('optional beats do not raise the per-beat allowance', () => {
        const beats = [...episode().beats, { id: 'opt', status: 'pending', optional: true }];
        assert.equal(isStalled(episode({ beats }), 111), true);
    });

    it('a fulfillment resets the count', () => {
        assert.equal(isStalled(episode({ lastFulfilledAt: 110 }), 120), false);
    });
});

describe('isStalled — never for paused arcs, acts, sagas', () => {
    it('paused episode', () => {
        assert.equal(isStalled(episode({ focus: 'paused', pausedAt: 105 }), 200), false);
    });
    it('act', () => {
        assert.equal(isStalled(episode({ tier: 'act' }), 200), false);
    });
    it('saga', () => {
        assert.equal(isStalled(episode({ tier: 'saga' }), 200), false);
    });
});

describe('isStalled — migrated arcs without a usable lastFulfilledAt', () => {
    it('missing lastFulfilledAt counts from messageStart', () => {
        assert.equal(isStalled(episode({ lastFulfilledAt: undefined }), 110), false);
        assert.equal(isStalled(episode({ lastFulfilledAt: undefined }), 111), true);
    });
    it('lastFulfilledAt 0 (pre-tier default) counts from messageStart', () => {
        assert.equal(isStalled(episode({ lastFulfilledAt: 0 }), 110), false);
    });
    it('pre-tier arc without a tier is an episode', () => {
        assert.equal(isStalled(episode({ tier: undefined }), 111), true);
    });
});

describe('lastFulfilledAt — set on fulfillment, shifted on resume', () => {
    beforeEach(() => {
        chat.length = 0;
        chat_metadata.story_arc = { arcs: [] };
    });

    it('a fulfillment stamps the index of the fulfilling message', async () => {
        const arc = episode({ id: 'arc12345-full-id', lastFulfilledAt: 100 });
        chat_metadata.story_arc.arcs = [arc];
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b0' }], [arc], 110);
        assert.equal(arc.lastFulfilledAt, 110);
        assert.equal(chat_metadata.story_arc.arcs[0].lastFulfilledAt, 110);
        assert.equal(isStalled(arc, 111), false);
    });

    it('a 15-message pause does not count', async () => {
        chat_metadata.story_arc.arcs = [episode()];
        chat.length = 105;
        await pauseArc('ep');
        chat.length = 120;
        await resumeArc('ep');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.equal(stored.lastFulfilledAt, 115);
        assert.equal(isStalled(stored, 120), false);
        assert.equal(isStalled(stored, 126), true);
    });
});

describe('renderProgressDisplay — stall nudge', () => {
    it('shows the re-plan nudge for a stalled episode only', () => {
        chat.length = 111;
        const html = renderProgressDisplay([episode({ id: 'stalled' }), episode({ id: 'fresh', lastFulfilledAt: 105 })]);
        assert.match(html, /class="story-arc-stall-btn" data-arc-id="stalled"[^>]*>[^<]*May have drifted — re-plan\?/);
        assert.doesNotMatch(html, /data-arc-id="fresh"/);
    });
});
