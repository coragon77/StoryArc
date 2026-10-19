import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyArcEdit, checkBeatEdit, removeBeat } from '../lib/planning/arc-edit.js';

/** A small stored episode with every field the editor sees. */
function storedArc() {
    return {
        id: 'arc-1',
        title: 'The Quiet Debt',
        status: 'active',
        tier: 'episode',
        focus: 'spotlight',
        createdAt: '2026-09-01T00:00:00.000Z',
        messageStart: 100,
        lastFulfilledAt: 130,
        pausedAt: null,
        direction: '',
        premise: 'A debt comes due.',
        themes: [],
        tone: 'quiet',
        directives: [],
        antiPatterns: [],
        secrets: [],
        foreshadowing: [],
        beats: [
            { id: 'beat_1', pressure: 'A letter arrives.', intention: 'She has read the letter.', status: 'active', unlockAfter: [] },
        ],
        escalation: '',
        triggers: [],
        characters: [],
        estimatedLength: 20,
    };
}

describe('applyArcEdit', () => {
    it('stores edited content fields', () => {
        const edited = { ...storedArc(), title: 'The Loud Debt', tone: 'loud', characters: ['Mara'] };
        const { arc, error } = applyArcEdit(storedArc(), JSON.stringify(edited));
        assert.equal(error, null);
        assert.equal(arc.title, 'The Loud Debt');
        assert.equal(arc.tone, 'loud');
        assert.deepEqual(arc.characters, ['Mara']);
    });

    it('keeps the bookkeeping fields from the stored arc', () => {
        const edited = {
            ...storedArc(),
            id: 'arc-2', status: 'completed', tier: 'saga', focus: 'paused',
            createdAt: 'x', messageStart: 0, lastFulfilledAt: 0, pausedAt: 5,
        };
        const { arc } = applyArcEdit(storedArc(), JSON.stringify(edited));
        assert.equal(arc.id, 'arc-1');
        assert.equal(arc.status, 'active');
        assert.equal(arc.tier, 'episode');
        assert.equal(arc.focus, 'spotlight');
        assert.equal(arc.createdAt, '2026-09-01T00:00:00.000Z');
        assert.equal(arc.messageStart, 100);
        assert.equal(arc.lastFulfilledAt, 130);
        assert.equal(arc.pausedAt, null);
    });

    it('stores estimatedLength as a number', () => {
        const edited = { ...storedArc(), estimatedLength: '30' };
        assert.equal(applyArcEdit(storedArc(), JSON.stringify(edited)).arc.estimatedLength, 30);
    });

    it('rejects text that is not JSON', () => {
        const { arc, error } = applyArcEdit(storedArc(), '{ title: ');
        assert.equal(arc, null);
        assert.match(error, /^Not valid JSON: /);
    });

    it('rejects a JSON list', () => {
        assert.equal(applyArcEdit(storedArc(), '[]').error, 'The arc must be a JSON object.');
    });

    it('rejects an empty title or premise', () => {
        assert.equal(applyArcEdit(storedArc(), JSON.stringify({ ...storedArc(), title: ' ' })).error, 'title cannot be empty.');
        assert.equal(applyArcEdit(storedArc(), JSON.stringify({ ...storedArc(), premise: '' })).error, 'premise cannot be empty.');
    });

    it('rejects a list field that is not a list', () => {
        const edited = { ...storedArc(), directives: 'be quiet' };
        assert.equal(applyArcEdit(storedArc(), JSON.stringify(edited)).error, 'directives must be a list.');
    });

    it('rejects an arc without beats', () => {
        const edited = { ...storedArc(), beats: [] };
        assert.equal(applyArcEdit(storedArc(), JSON.stringify(edited)).error, 'An arc needs at least one beat.');
    });

    it('rejects an estimatedLength that is not a positive number', () => {
        const edited = { ...storedArc(), estimatedLength: 0 };
        assert.equal(applyArcEdit(storedArc(), JSON.stringify(edited)).error, 'estimatedLength must be a number above 0.');
    });

    it('rejects duplicate beat ids', () => {
        const beat = storedArc().beats[0];
        const edited = { ...storedArc(), beats: [beat, { ...beat }] };
        assert.equal(applyArcEdit(storedArc(), JSON.stringify(edited)).error, 'Beat id "beat_1" is used twice.');
    });

    it('rejects a beat without unlockAfter list', () => {
        const edited = { ...storedArc(), beats: [{ id: 'beat_1', intention: 'She has read it.' }] };
        assert.equal(applyArcEdit(storedArc(), JSON.stringify(edited)).error, 'Beat "beat_1": unlockAfter must be a list.');
    });

    it('applies the beat rules with the stored tier', () => {
        const stored = { ...storedArc(), tier: 'act' };
        const edited = { ...stored, beats: [{ id: 'beat_1', pressure: '', intention: 'Done.', unlockAfter: [] }] };
        assert.equal(applyArcEdit(stored, JSON.stringify(edited)).error, 'Beat "beat_1": A milestone needs a pressure.');
    });
});

describe('checkBeatEdit', () => {
    it('accepts an episode beat without a pressure', () => {
        assert.equal(checkBeatEdit('episode', { pressure: '', intention: 'She has left.' }), null);
    });

    it('rejects an empty intention on any tier', () => {
        assert.equal(checkBeatEdit('episode', { pressure: 'Rain.', intention: '' }), '"Fulfilled when" cannot be empty.');
        assert.equal(checkBeatEdit('act', { pressure: 'Rain.', intention: '' }), '"Fulfilled when" cannot be empty.');
    });

    it('rejects a milestone without a pressure', () => {
        assert.equal(checkBeatEdit('act', { pressure: '', intention: 'The city has fallen.' }), 'A milestone needs a pressure.');
        assert.equal(checkBeatEdit('saga', { pressure: '', intention: 'The city has fallen.' }), 'A milestone needs a pressure.');
    });

    it('treats an arc without a tier as an episode', () => {
        assert.equal(checkBeatEdit(undefined, { pressure: '', intention: 'She has left.' }), null);
    });
});

describe('removeBeat', () => {
    it('removes the beat and keeps the others unchanged', () => {
        const beats = [
            { id: 'beat_1', status: 'completed', unlockAfter: [] },
            { id: 'beat_2', status: 'active', unlockAfter: [] },
            { id: 'beat_3', status: 'pending', unlockAfter: [] },
        ];
        assert.deepEqual(removeBeat(beats, 'beat_2'), [
            { id: 'beat_1', status: 'completed', unlockAfter: [] },
            { id: 'beat_3', status: 'pending', unlockAfter: [] },
        ]);
    });

    it('unlocks a beat whose only prerequisite was deleted', () => {
        const beats = [
            { id: 'beat_1', status: 'active', unlockAfter: [] },
            { id: 'beat_2', status: 'pending', unlockAfter: [] },
            { id: 'beat_3', status: 'locked', unlockAfter: ['beat_2'] },
        ];
        assert.deepEqual(removeBeat(beats, 'beat_2'), [
            { id: 'beat_1', status: 'active', unlockAfter: [] },
            { id: 'beat_3', status: 'pending', unlockAfter: [] },
        ]);
    });

    it('keeps a beat locked while another prerequisite is open', () => {
        const beats = [
            { id: 'beat_1', status: 'active', unlockAfter: [] },
            { id: 'beat_2', status: 'pending', unlockAfter: [] },
            { id: 'beat_3', status: 'locked', unlockAfter: ['beat_1', 'beat_2'] },
        ];
        assert.deepEqual(removeBeat(beats, 'beat_2'), [
            { id: 'beat_1', status: 'active', unlockAfter: [] },
            { id: 'beat_3', status: 'locked', unlockAfter: ['beat_1'] },
        ]);
    });

    it('unlocks a beat whose other prerequisites are completed', () => {
        const beats = [
            { id: 'beat_1', status: 'completed', unlockAfter: [] },
            { id: 'beat_2', status: 'active', unlockAfter: [] },
            { id: 'beat_3', status: 'locked', unlockAfter: ['beat_1', 'beat_2'] },
        ];
        assert.deepEqual(removeBeat(beats, 'beat_2'), [
            { id: 'beat_1', status: 'completed', unlockAfter: [] },
            { id: 'beat_3', status: 'pending', unlockAfter: ['beat_1'] },
        ]);
    });

    it('leaves locked beats alone that did not wait for the deleted beat', () => {
        const beats = [
            { id: 'beat_1', status: 'completed', unlockAfter: [] },
            { id: 'beat_2', status: 'pending', unlockAfter: [] },
            { id: 'beat_3', status: 'locked', unlockAfter: ['beat_1'] },
            { id: 'beat_4', status: 'locked', unlockAfter: [] },
        ];
        assert.deepEqual(removeBeat(beats, 'beat_2'), [
            { id: 'beat_1', status: 'completed', unlockAfter: [] },
            { id: 'beat_3', status: 'locked', unlockAfter: ['beat_1'] },
            { id: 'beat_4', status: 'locked', unlockAfter: [] },
        ]);
    });

    it('does not mutate the input', () => {
        const beats = [
            { id: 'beat_1', status: 'pending', unlockAfter: [] },
            { id: 'beat_2', status: 'locked', unlockAfter: ['beat_1'] },
        ];
        removeBeat(beats, 'beat_1');
        assert.equal(beats.length, 2);
        assert.equal(beats[1].status, 'locked');
        assert.deepEqual(beats[1].unlockAfter, ['beat_1']);
    });
});
