import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isStalled, renderProgressDisplay } from '../lib/ui/progress.js';
import { chat } from './mocks/st-mocks.js';

/**
 * An episode starting at chat index 0 with estimatedLength 20 and four
 * non-optional beats, the first `done` of them completed.
 */
function episode(done, overrides = {}) {
    const beats = Array.from({ length: 4 }, (_, i) => ({
        id: `b${i}`, status: i < done ? 'completed' : 'pending', optional: false,
    }));
    return { id: 'ep', title: 'The Heist', tier: 'episode', focus: 'normal', status: 'active',
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 20, beats, ...overrides };
}

/** Run fn with the mock chat holding `length` messages, then empty it. */
function withChatLength(length, fn) {
    chat.length = 0;
    for (let i = 0; i < length; i++) chat.push({ mes: `m${i}` });
    try {
        return fn();
    } finally {
        chat.length = 0;
    }
}

/** The visible text of rendered HTML: tags dropped, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('renderProgressDisplay — card content', () => {
    it('renders nothing for no arcs', () => {
        assert.equal(renderProgressDisplay([]), '');
        assert.equal(renderProgressDisplay(null), '');
    });

    it('counts and fills by non-optional beats only', () => {
        // 1 of 4 non-optional beats done; the two completed optional beats do not count.
        const optional = [
            { id: 'o1', status: 'completed', optional: true },
            { id: 'o2', status: 'completed', optional: true },
        ];
        const arc = episode(1);
        arc.beats.push(...optional);
        const html = withChatLength(2, () => renderProgressDisplay([arc]));

        assert.ok(html.includes('style="width: 25%"'));
        assert.ok(html.includes('1/4 beats'));
    });

    it('shows 0% and 0/0 for an arc with only optional beats', () => {
        const arc = episode(0, { beats: [{ id: 'o1', status: 'pending', optional: true }] });
        const html = withChatLength(2, () => renderProgressDisplay([arc]));

        assert.ok(html.includes('style="width: 0%"'));
        assert.ok(html.includes('0/0 beats'));
    });

    it('calls the beats of an arc without a tier "beats"', () => {
        const html = withChatLength(2, () => renderProgressDisplay([episode(1, { tier: undefined })]));

        assert.ok(html.includes('1/4 beats'));
    });
});

describe('renderProgressDisplay — pacing line', () => {
    it('shows the messages left while the message clock holds the phase back', () => {
        // Chat length 2 of 20: setup ends at message floor(0.2 × 20) = 4, so 2 are left.
        // The beats (1 of 4 = 0.25) alone would allow development.
        const html = withChatLength(2, () => renderProgressDisplay([episode(1)]));

        assert.equal(textOf(html), 'The Heist Setup 1/4 beats ~2 msgs to next phase');
    });

    it('shows no pacing line when the beats hold the phase back', () => {
        // Chat length 10 is past the setup boundary at 4; the beats (0 of 4) keep it in setup.
        const html = withChatLength(10, () => renderProgressDisplay([episode(0)]));

        assert.equal(textOf(html), 'The Heist Setup 0/4 beats');
    });

    it('shows no pacing line in resolution, even with messages left in it', () => {
        // Chat length 19 of 20 is resolution with 1 message to the boundary; there is no next phase.
        // The last beat was fulfilled at message 18, so the arc is not stalled.
        const html = withChatLength(19, () => renderProgressDisplay([episode(4, { lastFulfilledAt: 18 })]));

        assert.equal(textOf(html), 'The Heist Resolution 4/4 beats');
    });

    it('puts nothing but whitespace between two cards', () => {
        const html = withChatLength(10, () => renderProgressDisplay([episode(0), episode(0, { id: 'ep2', title: 'The Escape' })]));

        assert.equal(textOf(html), 'The Heist Setup 0/4 beats The Escape Setup 0/4 beats');
        assert.match(html, /<\/div>\s*<div class="story-arc-progress-card">/);
    });
});

describe('renderProgressDisplay — escaping the arc title', () => {
    it('escapes a model-written title in the text and in the title attribute', () => {
        const title = `<b>"Tom" & 'Jerry'</b>`;
        const html = withChatLength(10, () => renderProgressDisplay([episode(0, { title })]));

        assert.ok(html.includes(`title="&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;"`));
        assert.ok(html.includes(`>&lt;b&gt;&quot;Tom&quot; &amp; 'Jerry'&lt;/b&gt;</span>`));
        assert.ok(!html.includes('<b>'));
    });

    it('renders an empty title as empty text and an empty attribute', () => {
        const html = withChatLength(10, () => renderProgressDisplay([episode(0, { title: '' })]));

        assert.ok(html.includes('<span class="story-arc-progress-title" title=""></span>'));
    });
});

describe('isStalled — arcs it cannot judge', () => {
    it('never calls an arc with only optional beats stalled', () => {
        const arc = episode(0, { beats: [{ id: 'o1', status: 'pending', optional: true }] });

        assert.equal(isStalled(arc, 1000), false);
    });

    it('never calls an arc without estimatedLength stalled', () => {
        assert.equal(isStalled(episode(0, { estimatedLength: 0 }), 1000), false);
        assert.equal(isStalled(episode(0, { estimatedLength: undefined }), 1000), false);
    });

    it('does not shrink the allowance for optional beats', () => {
        // 4 non-optional beats: allowance 3 × 20 / 4 = 15. With 4 optional beats
        // wrongly counted it would be 3 × 20 / 8 = 7.5. Ten messages in: not stalled.
        const arc = episode(0);
        arc.beats.push(...Array.from({ length: 4 }, (_, i) => ({ id: `o${i}`, status: 'pending', optional: true })));

        assert.equal(isStalled(arc, 10), false);
    });
});
