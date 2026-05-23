import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Both this file and pacing.js import chat from '/script.js', which the
// ESM loader resolves to the same mock module — so they share the same array.
import { chat } from '/script.js';
import { calculatePhase } from '../lib/injection/pacing.js';
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
