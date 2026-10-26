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

describe('parseLlmJson — fences and fallbacks', () => {
    // Lists have no braces, so the brace-extraction fallback cannot rescue a
    // fence that was stripped wrongly: these pin the fence patterns themselves.
    it('strips a json fence written on one line', () => {
        assert.deepEqual(parseLlmJson('```json["a","b"]```'), ['a', 'b']);
        assert.deepEqual(parseLlmJson('```json{"title":"x"}```'), { title: 'x' });
    });

    it('strips a json fence with newlines around a list', () => {
        assert.deepEqual(parseLlmJson('```json\n["a"]\n```'), ['a']);
    });

    it('strips a bare fence on one line and a closing fence at the very end', () => {
        assert.deepEqual(parseLlmJson('```["a"]```'), ['a']);
        assert.deepEqual(parseLlmJson('```\n["a"]\n```'), ['a']);
    });

    it('returns null for braces around invalid JSON, without throwing', () => {
        assert.equal(parseLlmJson('Here: {not json}'), null);
    });
});

describe('validateArcPlan — required fields', () => {
    const beats = [{ intention: 'X' }];

    it('rejects null and a string as not an object', () => {
        assert.deepEqual(validateArcPlan(null), { valid: false, arc: null, errors: ['Not a valid object'] });
        assert.deepEqual(validateArcPlan('a plan'), { valid: false, arc: null, errors: ['Not a valid object'] });
    });

    it('rejects a plan without premise with the premise error', () => {
        assert.deepEqual(validateArcPlan({ title: 'T', beats }), {
            valid: false, arc: null, errors: ['Missing required field: premise'],
        });
    });

    it('rejects beats that are missing, empty or not a list', () => {
        const beatsError = { valid: false, arc: null, errors: ['Missing required field: beats (must be non-empty array)'] };
        assert.deepEqual(validateArcPlan({ title: 'T', premise: 'P' }), beatsError);
        assert.deepEqual(validateArcPlan({ title: 'T', premise: 'P', beats: [] }), beatsError);
        assert.deepEqual(validateArcPlan({ title: 'T', premise: 'P', beats: 'x' }), beatsError);
    });

    it('lists every missing field at once', () => {
        assert.deepEqual(validateArcPlan({}).errors, [
            'Missing required field: title',
            'Missing required field: premise',
            'Missing required field: beats (must be non-empty array)',
        ]);
    });
});

describe('validateArcPlan — defaults for optional fields', () => {
    it('gives tone and escalation an empty string and every list field []', () => {
        const { arc } = validateArcPlan({ title: 'T', premise: 'P', beats: [{ intention: 'X' }] });
        assert.equal(arc.tone, '');
        assert.equal(arc.escalation, '');
        assert.deepEqual(arc.themes, []);
        assert.deepEqual(arc.directives, []);
        assert.deepEqual(arc.antiPatterns, []);
        assert.deepEqual(arc.characters, []);
        assert.deepEqual(arc.secrets, []);
        assert.deepEqual(arc.foreshadowing, []);
        assert.deepEqual(arc.triggers, []);
    });

    it('wraps a single string into a one-item list', () => {
        const { arc } = validateArcPlan({
            title: 'T', premise: 'P', beats: [{ intention: 'X' }],
            directives: 'one', themes: 'loss', characters: 'Mara',
        });
        assert.deepEqual(arc.directives, ['one']);
        assert.deepEqual(arc.themes, ['loss']);
        assert.deepEqual(arc.characters, ['Mara']);
    });

    it('passes tone and escalation through', () => {
        const { arc } = validateArcPlan({
            title: 'T', premise: 'P', beats: [{ intention: 'X' }], tone: 'grim', escalation: 'It gets worse.',
        });
        assert.equal(arc.tone, 'grim');
        assert.equal(arc.escalation, 'It gets worse.');
    });
});

describe('validateArcPlan — beat normalization', () => {
    const beatOf = (beat) => validateArcPlan({ title: 'T', premise: 'P', beats: [beat] }).arc.beats[0];

    it('fills flexibility, urgency, phase and optional with their defaults', () => {
        assert.deepEqual(beatOf({ intention: 'X' }), {
            id: 'beat_1',
            pressure: '',
            intention: 'X',
            flexibility: '',
            urgency: 'when-ready',
            status: 'active',
            unlockAfter: [],
            phase: 'development',
            optional: false,
        });
    });

    it('passes given values through unchanged', () => {
        assert.deepEqual(beatOf({
            id: 'b_door', pressure: 'Knocking.', intention: 'X', flexibility: 'any room',
            urgency: 'soon', status: 'pending', unlockAfter: ['b_0'], phase: 'climax', optional: true,
        }), {
            id: 'b_door',
            pressure: 'Knocking.',
            intention: 'X',
            flexibility: 'any room',
            urgency: 'soon',
            status: 'pending',
            unlockAfter: ['b_0'],
            phase: 'climax',
            optional: true,
        });
    });

    it('uses description as the intention when intention is missing', () => {
        assert.equal(beatOf({ description: 'She has left town.' }).intention, 'She has left town.');
    });

    it('gives a beat with neither intention nor description an empty intention', () => {
        assert.equal(beatOf({ pressure: 'Rain.' }).intention, '');
    });
});

describe('validateArcPlan — secrets, foreshadowing, triggers', () => {
    const arcOf = (extra) => validateArcPlan({ title: 'T', premise: 'P', beats: [{ intention: 'X' }], ...extra }).arc;

    it('turns a plain-string secret into a secret with that content', () => {
        assert.deepEqual(arcOf({ secrets: ['The duke is alive.'] }).secrets, [
            { id: 'secret_1', content: 'The duke is alive.', revealPhase: 'any', disclosed: false },
        ]);
    });

    it('accepts reveal_phase, defaults the reveal phase to any and always starts undisclosed', () => {
        assert.deepEqual(arcOf({
            secrets: [
                { id: 's_a', content: 'A', reveal_phase: 'climax', disclosed: true },
                { content: 'B', revealPhase: 'opening' },
                { content: 'C' },
            ],
        }).secrets, [
            { id: 's_a', content: 'A', revealPhase: 'climax', disclosed: false },
            { id: 'secret_2', content: 'B', revealPhase: 'opening', disclosed: false },
            { id: 'secret_3', content: 'C', revealPhase: 'any', disclosed: false },
        ]);
    });

    it('gives a secret object without content an empty content', () => {
        assert.equal(arcOf({ secrets: [{ revealPhase: 'any' }] }).secrets[0].content, '');
    });

    it('fills missing clue and target with "", passes given ones and starts unplanted', () => {
        assert.deepEqual(arcOf({
            foreshadowing: [
                { id: 'f_a', clue: 'Ink smells of almonds.', target: 'secret_1', planted: true },
                {},
            ],
        }).foreshadowing, [
            { id: 'f_a', clue: 'Ink smells of almonds.', target: 'secret_1', planted: false },
            { id: 'foreshadow_2', clue: '', target: '', planted: false },
        ]);
    });

    it('fills missing condition and action with "", passes given ones and starts unfired', () => {
        assert.deepEqual(arcOf({
            triggers: [
                { id: 't_a', condition: 'if she flees', action: 'the guard follows', fired: true },
                {},
            ],
        }).triggers, [
            { id: 't_a', condition: 'if she flees', action: 'the guard follows', fired: false },
            { id: 'trigger_2', condition: '', action: '', fired: false },
        ]);
    });
});
