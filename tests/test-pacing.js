import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Both this file and pacing.js import chat from '/script.js', which the
// ESM loader resolves to the same mock module — so they share the same array.
import { chat } from '/script.js';
import { calculatePhase, messagesUntilNextPhase } from '../lib/injection/pacing.js';
import { createDefaultArc } from '../lib/core/constants.js';

describe('calculatePhase', () => {
    it('returns setup for a fresh arc with no completed beats', () => {
        const arc = createDefaultArc({
            messageStart: 0,
            estimatedLength: 40,
            beats: [
                { id: 'b1', status: 'active', optional: false },
                { id: 'b2', status: 'pending', optional: false },
            ],
        });
        chat.length = 0;
        const { phase } = calculatePhase(arc);
        assert.equal(phase, 'setup');
    });

    it('returns resolution when all beats completed and messages exceeded', () => {
        const arc = createDefaultArc({
            messageStart: 0,
            estimatedLength: 10,
            beats: [
                { id: 'b1', status: 'completed', optional: false },
                { id: 'b2', status: 'completed', optional: false },
            ],
        });
        chat.length = 0;
        for (let i = 0; i < 15; i++) chat.push({});
        const { phase } = calculatePhase(arc);
        assert.equal(phase, 'resolution');
        chat.length = 0;
    });

    it('ignores optional beats in ratio calculation', () => {
        const arc = createDefaultArc({
            messageStart: 0,
            estimatedLength: 100,
            beats: [
                { id: 'b1', status: 'completed', optional: false },
                { id: 'b2', status: 'pending', optional: true },
            ],
        });
        chat.length = 0;
        for (let i = 0; i < 100; i++) chat.push({});
        const { beatRatio } = calculatePhase(arc);
        assert.equal(beatRatio, 1.0);
        chat.length = 0;
    });

    it('uses minimum of beat phase and message phase', () => {
        const arc = createDefaultArc({
            messageStart: 0,
            estimatedLength: 100,
            beats: [
                { id: 'b1', status: 'completed', optional: false },
                { id: 'b2', status: 'completed', optional: false },
                { id: 'b3', status: 'pending', optional: false },
            ],
        });
        chat.length = 0;
        for (let i = 0; i < 5; i++) chat.push({});
        const { phase } = calculatePhase(arc);
        assert.equal(phase, 'setup');
        chat.length = 0;
    });
});

describe('messagesUntilNextPhase', () => {
    it('counts messages left until the phase boundary', () => {
        // setup ends at 20% of 40 messages = message 8; chat is at 5 -> 3 left
        const arc = createDefaultArc({ messageStart: 0, estimatedLength: 40 });
        chat.length = 0;
        for (let i = 0; i < 5; i++) chat.push({});
        assert.equal(messagesUntilNextPhase(arc, 'setup'), 3);
        chat.length = 0;
    });

    it('offsets the boundary by the arc start message', () => {
        // setup ends at floor(0.20 * 40) + 100 = message 108; chat is at 100 -> 8 left
        const arc = createDefaultArc({ messageStart: 100, estimatedLength: 40 });
        chat.length = 0;
        for (let i = 0; i < 100; i++) chat.push({});
        assert.equal(messagesUntilNextPhase(arc, 'setup'), 8);
        chat.length = 0;
    });

    it('returns 0 once the boundary is passed', () => {
        const arc = createDefaultArc({ messageStart: 0, estimatedLength: 40 });
        chat.length = 0;
        for (let i = 0; i < 20; i++) chat.push({});
        assert.equal(messagesUntilNextPhase(arc, 'setup'), 0);
        chat.length = 0;
    });

    it('returns 0 for arcs without an estimated length', () => {
        const arc = createDefaultArc({ messageStart: 0 });
        delete arc.estimatedLength;
        chat.length = 0;
        assert.equal(messagesUntilNextPhase(arc, 'setup'), 0);
    });

    it('treats a missing messageStart as 0 instead of producing NaN', () => {
        const arc = createDefaultArc({ estimatedLength: 40 });
        delete arc.messageStart;
        chat.length = 0;
        for (let i = 0; i < 5; i++) chat.push({});
        assert.equal(messagesUntilNextPhase(arc, 'setup'), 3);
        chat.length = 0;
    });

    it('returns 0 for an unknown phase', () => {
        const arc = createDefaultArc({ messageStart: 0, estimatedLength: 40 });
        chat.length = 0;
        assert.equal(messagesUntilNextPhase(arc, 'nonsense'), 0);
    });
});
