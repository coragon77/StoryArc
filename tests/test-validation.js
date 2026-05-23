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
            estimated_length: 60,
        });
        assert.deepEqual(arc.antiPatterns, ['Do not rush']);
        assert.deepEqual(arc.beats[0].unlockAfter, ['beat_0']);
        assert.equal(arc.estimatedLength, 60);
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
