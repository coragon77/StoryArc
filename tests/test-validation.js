import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLlmJson, validateArcPlan } from '../lib/planning/validation.js';

describe('parseLlmJson', () => {
    it('parses clean JSON', () => {
        const result = parseLlmJson('{"title": "Test"}');
        assert.deepEqual(result, { title: 'Test' });
    });

    it('strips markdown code fences', () => {
        const result = parseLlmJson('```json\n{"title": "Test"}\n```');
        assert.deepEqual(result, { title: 'Test' });
    });

    it('extracts JSON from surrounding text', () => {
        const result = parseLlmJson('Here is the plan:\n{"title": "Test"}\nEnd.');
        assert.deepEqual(result, { title: 'Test' });
    });

    it('returns null for garbage', () => {
        assert.equal(parseLlmJson('not json at all'), null);
    });

    it('returns null for empty input', () => {
        assert.equal(parseLlmJson(''), null);
        assert.equal(parseLlmJson(null), null);
    });
});

describe('validateArcPlan', () => {
    it('accepts a valid minimal plan', () => {
        const { valid, arc, errors } = validateArcPlan({
            title: 'Test Arc',
            premise: 'Something happens',
            beats: [{ intention: 'A thing occurs' }],
        });
        assert.equal(valid, true);
        assert.equal(errors.length, 0);
        assert.equal(arc.title, 'Test Arc');
        assert.equal(arc.beats[0].id, 'beat_1');
        assert.equal(arc.beats[0].status, 'active');
    });

    it('rejects missing title', () => {
        const { valid, errors } = validateArcPlan({
            premise: 'Something', beats: [{ intention: 'X' }],
        });
        assert.equal(valid, false);
        assert.ok(errors.some(e => e.includes('title')));
    });

    it('rejects missing beats', () => {
        const { valid, errors } = validateArcPlan({
            title: 'Test', premise: 'Something', beats: [],
        });
        assert.equal(valid, false);
        assert.ok(errors.some(e => e.includes('beats')));
    });

    it('normalizes snake_case fields from LLM output', () => {
        const { arc } = validateArcPlan({
            title: 'Test', premise: 'X',
            anti_patterns: ['Do not rush'],
            beats: [{ intention: 'Y', unlock_after: ['beat_0'] }],
            estimated_length: 16,
        });
        assert.deepEqual(arc.antiPatterns, ['Do not rush']);
        assert.deepEqual(arc.beats[0].unlockAfter, ['beat_0']);
        assert.equal(arc.estimatedLength, 16);
    });

    it('keeps the pressure field when the LLM supplies one', () => {
        const { arc } = validateArcPlan({
            title: 'Test', premise: 'X',
            beats: [{ pressure: 'The audits are closing in', intention: 'She has confessed' }],
        });
        assert.equal(arc.beats[0].pressure, 'The audits are closing in');
        assert.equal(arc.beats[0].intention, 'She has confessed');
    });

    it('defaults pressure to an empty string when absent', () => {
        const { arc } = validateArcPlan({
            title: 'Test', premise: 'X',
            beats: [{ intention: 'Something happened' }],
        });
        assert.equal(arc.beats[0].pressure, '');
    });

    it('sets first beat to active, rest to pending', () => {
        const { arc } = validateArcPlan({
            title: 'Test', premise: 'X',
            beats: [
                { intention: 'First' },
                { intention: 'Second' },
                { intention: 'Third' },
            ],
        });
        assert.equal(arc.beats[0].status, 'active');
        assert.equal(arc.beats[1].status, 'pending');
        assert.equal(arc.beats[2].status, 'pending');
    });
});

describe('validateArcPlan — tier', () => {
    const plan = (extra = {}) => ({
        title: 'Test', premise: 'X',
        beats: [
            { pressure: 'One', intention: 'First', unlockAfter: [] },
            { pressure: 'Two', intention: 'Second', unlockAfter: ['beat_1'] },
            { pressure: 'Three', intention: 'Third', unlockAfter: ['beat_2'] },
        ],
        ...extra,
    });

    it('defaults tier to episode and keeps scene-beat shape', () => {
        const { arc } = validateArcPlan(plan());
        assert.equal(arc.tier, 'episode');
        assert.equal(arc.beats[0].status, 'active');
        assert.equal(arc.beats[1].status, 'pending');
        assert.deepEqual(arc.beats[1].unlockAfter, ['beat_1']);
    });

    it('normalizes an unknown tier to episode', () => {
        const { arc } = validateArcPlan(plan({ tier: 'campaign' }));
        assert.equal(arc.tier, 'episode');
    });

    it('takes the tier from options over the LLM output', () => {
        const { arc } = validateArcPlan(plan({ tier: 'episode' }), { tier: 'act' });
        assert.equal(arc.tier, 'act');
    });

    it('act: every milestone active, unlockAfter stripped', () => {
        const { arc } = validateArcPlan(plan({ tier: 'act' }));
        assert.equal(arc.tier, 'act');
        for (const beat of arc.beats) {
            assert.equal(beat.status, 'active');
            assert.deepEqual(beat.unlockAfter, []);
        }
    });

    it('saga: every milestone active, unlockAfter stripped', () => {
        const { arc } = validateArcPlan(plan(), { tier: 'saga' });
        assert.equal(arc.tier, 'saga');
        assert.ok(arc.beats.every(b => b.status === 'active' && b.unlockAfter.length === 0));
    });

    it('clamps estimatedLength to the tier band on both sides', () => {
        assert.equal(validateArcPlan(plan({ estimatedLength: 40 })).arc.estimatedLength, 20);
        assert.equal(validateArcPlan(plan({ estimatedLength: 3 })).arc.estimatedLength, 8);
        assert.equal(validateArcPlan(plan({ estimatedLength: 40 }), { tier: 'act' }).arc.estimatedLength, 60);
        assert.equal(validateArcPlan(plan({ estimatedLength: 500 }), { tier: 'act' }).arc.estimatedLength, 150);
        assert.equal(validateArcPlan(plan({ estimatedLength: 100 }), { tier: 'saga' }).arc.estimatedLength, 400);
        assert.equal(validateArcPlan(plan({ estimatedLength: 9000 }), { tier: 'saga' }).arc.estimatedLength, 1500);
        assert.equal(validateArcPlan(plan({ estimatedLength: 90 }), { tier: 'act' }).arc.estimatedLength, 90);
    });

    it('clamps a missing estimatedLength into the band too', () => {
        assert.equal(validateArcPlan(plan()).arc.estimatedLength, 20);
        assert.equal(validateArcPlan(plan(), { tier: 'saga' }).arc.estimatedLength, 400);
    });
});

describe('validateArcPlan — milestones carry a pressure (#13)', () => {
    const plan = (beats) => ({ title: 'Test', premise: 'X', beats });

    it('act: a beat without pressure is a validation error naming the beat', () => {
        const { valid, arc, errors } = validateArcPlan(plan([
            { pressure: 'Rations shrink.', intention: 'First' },
            { id: 'm_lies', intention: 'Someone has caught the guild in a lie.' },
        ]), { tier: 'act' });
        assert.equal(valid, false);
        assert.equal(arc, null);
        assert.deepEqual(errors, ['Milestone "m_lies" has no pressure']);
    });

    it('act: a blank pressure counts as missing', () => {
        const { valid, errors } = validateArcPlan(plan([{ pressure: '   ', intention: 'First' }]), { tier: 'act' });
        assert.equal(valid, false);
        assert.deepEqual(errors, ['Milestone "beat_1" has no pressure']);
    });

    it('saga: one error per pressure-less beat, in beat order', () => {
        const { valid, errors } = validateArcPlan(plan([
            { intention: 'First' },
            { pressure: 'Fine.', intention: 'Second' },
            { intention: 'Third' },
        ]), { tier: 'saga' });
        assert.equal(valid, false);
        assert.deepEqual(errors, ['Milestone "beat_1" has no pressure', 'Milestone "beat_3" has no pressure']);
    });

    it('act: valid when every milestone has a pressure', () => {
        const { valid, arc } = validateArcPlan(plan([
            { pressure: 'Rations shrink.', intention: 'First' },
            { pressure: 'Ledgers lie.', intention: 'Second' },
        ]), { tier: 'act' });
        assert.equal(valid, true);
        assert.deepEqual(arc.beats.map(b => b.pressure), ['Rations shrink.', 'Ledgers lie.']);
    });

    it('episode: a beat without pressure is still accepted (pre-tier fallback)', () => {
        const { valid, arc } = validateArcPlan(plan([{ intention: 'Something happened' }]), { tier: 'episode' });
        assert.equal(valid, true);
        assert.equal(arc.beats[0].pressure, '');
    });
});
