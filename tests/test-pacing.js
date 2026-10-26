import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Both this file and pacing.js import chat from '/script.js', which the
// ESM loader resolves to the same mock module — so they share the same array.
import { chat } from '/script.js';
import { calculatePhase, getPacingDirective, messagesUntilNextPhase, phaseBoundaryMessage } from '../lib/injection/pacing.js';
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

    it('counts messages from the arc start, not from the start of the chat', () => {
        // 50 messages, arc started at 40: 10 arc messages of ~20 = ratio 0.5.
        const arc = createDefaultArc({
            messageStart: 40,
            estimatedLength: 20,
            beats: [{ id: 'b1', status: 'completed', optional: false }],
        });
        chat.length = 0;
        for (let i = 0; i < 50; i++) chat.push({});
        const result = calculatePhase(arc);
        assert.equal(result.messageCount, 10);
        assert.equal(result.messageRatio, 0.5);
        chat.length = 0;
    });

    it('gives a beat ratio of 0, not NaN, for an arc with only optional beats or none', () => {
        chat.length = 0;
        const onlyOptional = createDefaultArc({
            messageStart: 0,
            estimatedLength: 20,
            beats: [{ id: 'b1', status: 'pending', optional: true }],
        });
        assert.equal(calculatePhase(onlyOptional).beatRatio, 0);
        const noBeats = createDefaultArc({ messageStart: 0, estimatedLength: 20, beats: [] });
        assert.equal(calculatePhase(noBeats).beatRatio, 0);
    });

    it('gives a message ratio of 0, not Infinity or NaN, for an arc without an estimated length', () => {
        chat.length = 0;
        for (let i = 0; i < 10; i++) chat.push({});
        const zero = createDefaultArc({ messageStart: 0, estimatedLength: 0, beats: [] });
        assert.equal(calculatePhase(zero).messageRatio, 0);
        const missing = createDefaultArc({ messageStart: 0, beats: [] });
        delete missing.estimatedLength;
        assert.equal(calculatePhase(missing).messageRatio, 0);
        chat.length = 0;
    });
});

describe('phase ranges (ratioToPhase through calculatePhase)', () => {
    // Every beat completed puts the beat phase at resolution, so the message
    // ratio alone decides the phase.
    function phaseAtMessage(messageCount) {
        const arc = createDefaultArc({
            messageStart: 0,
            estimatedLength: 20,
            beats: [{ id: 'b1', status: 'completed', optional: false }],
        });
        chat.length = 0;
        for (let i = 0; i < messageCount; i++) chat.push({});
        const { phase } = calculatePhase(arc);
        chat.length = 0;
        return phase;
    }

    it('puts a ratio exactly on a boundary into the next phase', () => {
        assert.equal(phaseAtMessage(3), 'setup');        // 0.15
        assert.equal(phaseAtMessage(4), 'development');  // 0.20 = setup max
        assert.equal(phaseAtMessage(10), 'escalation');  // 0.50 = development max
        assert.equal(phaseAtMessage(15), 'climax');      // 0.75 = escalation max
        assert.equal(phaseAtMessage(18), 'resolution');  // 0.90 = climax max
    });

    it('returns resolution for ratios at or above the last range', () => {
        assert.equal(phaseAtMessage(20), 'resolution');  // 1.0
        assert.equal(phaseAtMessage(35), 'resolution');  // 1.75
    });

    it('counts a chat shorter than the arc start (messages deleted) as setup', { todo: 'bug: a negative message ratio matches no range and falls through to resolution, lifting the message brake' }, () => {
        const arc = createDefaultArc({
            messageStart: 30,
            estimatedLength: 20,
            beats: [{ id: 'b1', status: 'completed', optional: false }],
        });
        chat.length = 0;
        for (let i = 0; i < 20; i++) chat.push({});
        const { phase } = calculatePhase(arc);
        chat.length = 0;
        assert.equal(phase, 'setup');
    });
});

describe('getPacingDirective', () => {
    it('returns the directive text of each phase', () => {
        assert.equal(getPacingDirective('setup'), 'Plant seeds. Build atmosphere. No revelations. No confrontations.');
        assert.equal(getPacingDirective('development'), 'Tensions grow. Complications deepen. Hints become patterns.');
        assert.equal(getPacingDirective('escalation'), 'Stakes rise sharply. Confrontations can begin. Secrets start surfacing.');
        assert.equal(getPacingDirective('climax'), 'Major beats resolve. Secrets revealed. Decisive moments.');
        assert.equal(getPacingDirective('resolution'), 'Aftermath. Emotional processing. Seeds for the next arc.');
    });

    it('falls back to the development directive for an unknown phase', () => {
        assert.equal(getPacingDirective('nonsense'), 'Tensions grow. Complications deepen. Hints become patterns.');
        assert.equal(getPacingDirective(undefined), 'Tensions grow. Complications deepen. Hints become patterns.');
    });
});

describe('phaseBoundaryMessage', () => {
    it('is the arc-relative message where the phase ends', () => {
        const arc = createDefaultArc({ messageStart: 100, estimatedLength: 40 });
        assert.equal(phaseBoundaryMessage(arc, 'setup'), 8);        // floor(0.20 * 40)
        assert.equal(phaseBoundaryMessage(arc, 'escalation'), 30);  // floor(0.75 * 40)
    });

    it('returns 0, not NaN, for an arc without an estimated length', () => {
        const arc = createDefaultArc({ messageStart: 0 });
        delete arc.estimatedLength;
        assert.equal(phaseBoundaryMessage(arc, 'setup'), 0);
    });

    it('returns 0 without throwing for an unknown phase', () => {
        const arc = createDefaultArc({ messageStart: 0, estimatedLength: 40 });
        assert.equal(phaseBoundaryMessage(arc, 'nonsense'), 0);
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

    it('returns the exact remaining count for an arc that started later in the chat', () => {
        // setup ends at floor(0.20 * 100) + 10 = message 30; chat is at 15 -> 15 left
        const arc = createDefaultArc({ messageStart: 10, estimatedLength: 100 });
        chat.length = 0;
        for (let i = 0; i < 15; i++) chat.push({});
        assert.equal(messagesUntilNextPhase(arc, 'setup'), 15);
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
