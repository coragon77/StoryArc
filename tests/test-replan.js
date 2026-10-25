import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeReplan, replanTiers } from '../lib/planning/replan.js';
import { buildArcSoFar } from '../lib/planning/arc-so-far.js';
import { formatExistingArcs } from '../lib/planning/generator.js';
import { validateArcPlan } from '../lib/planning/validation.js';

/** An episode with two fulfilled beats, one planted clue, one fired trigger. */
function storedEpisode() {
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
        direction: 'old direction',
        premise: 'A debt comes due.',
        themes: ['old theme'],
        tone: 'old tone',
        directives: ['old directive'],
        antiPatterns: ['old anti'],
        secrets: [
            { id: 'secret_1', content: 'The creditor is her brother.', revealPhase: 'climax', disclosed: true },
            { id: 'secret_2', content: 'The ledger is forged.', revealPhase: 'any', disclosed: false },
        ],
        foreshadowing: [
            { id: 'foreshadow_1', clue: 'A letter with a broken seal', target: 'secret_1', planted: true },
            { id: 'foreshadow_2', clue: 'Ink that smells of almonds', target: 'secret_2', planted: false },
        ],
        beats: [
            { id: 'beat_1', intention: 'She has received the summons.', status: 'completed', unlockAfter: [] },
            { id: 'beat_2', intention: 'She has confronted the messenger.', status: 'completed', unlockAfter: [] },
            { id: 'beat_3', intention: 'She has met the creditor.', status: 'active', unlockAfter: [] },
            { id: 'beat_4', intention: 'She has learned the truth.', status: 'pending', unlockAfter: [] },
        ],
        escalation: 'old escalation',
        triggers: [
            { id: 'trigger_1', condition: 'if she flees', action: 'the guard follows', fired: true },
            { id: 'trigger_2', condition: 'if she pays', action: 'the debt doubles', fired: false },
        ],
        characters: ['old character'],
        estimatedLength: 14,
    };
}

/** What a fresh generation looks like after validateArcPlan (ids are positional). */
function generatedPlan(overrides = {}) {
    const { arc } = validateArcPlan({
        title: 'Model-invented title',
        premise: 'Model-invented premise',
        themes: ['new theme'],
        tone: 'new tone',
        directives: ['new directive'],
        antiPatterns: ['new anti'],
        secrets: [
            { content: 'The creditor is her brother.' },
            { content: 'The brother is dying.' },
        ],
        foreshadowing: [{ clue: 'A cough behind the curtain', target: 'secret_2' }],
        beats: [
            { pressure: 'The trail goes cold.', intention: 'She has found the brother.' },
            { pressure: 'Everyone expects vengeance.', intention: 'She has chosen mercy.', unlockAfter: ['beat_1'] },
        ],
        escalation: 'new escalation',
        triggers: [{ condition: 'if she lies', action: 'the brother knows' }],
        characters: ['new character'],
        estimatedLength: 12,
        ...overrides,
    }, { tier: overrides.tier || 'episode' });
    return arc;
}

describe('mergeReplan', () => {
    it('keeps identity, focus, status and the edited title/premise/direction', () => {
        const existing = { ...storedEpisode(), title: 'Edited title', premise: 'Edited premise', direction: 'new direction' };
        const merged = mergeReplan(existing, generatedPlan());

        assert.equal(merged.id, 'arc-1');
        assert.equal(merged.createdAt, '2026-09-01T00:00:00.000Z');
        assert.equal(merged.messageStart, 100);
        assert.equal(merged.lastFulfilledAt, 130);
        assert.equal(merged.pausedAt, null);
        assert.equal(merged.focus, 'spotlight');
        assert.equal(merged.status, 'active');
        assert.equal(merged.title, 'Edited title');
        assert.equal(merged.premise, 'Edited premise');
        assert.equal(merged.direction, 'new direction');
    });

    it('replaces the road: tier, length, guidance fields', () => {
        const merged = mergeReplan(storedEpisode(), generatedPlan());

        assert.equal(merged.estimatedLength, 12);
        assert.deepEqual(merged.themes, ['new theme']);
        assert.equal(merged.tone, 'new tone');
        assert.deepEqual(merged.directives, ['new directive']);
        assert.deepEqual(merged.antiPatterns, ['new anti']);
        assert.equal(merged.escalation, 'new escalation');
        assert.deepEqual(merged.characters, ['new character']);
    });

    it('keeps fulfilled beats unchanged and appends new unfulfilled beats with no episode beat active', () => {
        const merged = mergeReplan(storedEpisode(), generatedPlan());

        assert.deepEqual(merged.beats.slice(0, 2), storedEpisode().beats.slice(0, 2));
        assert.equal(merged.beats.length, 4);
        assert.deepEqual(merged.beats.map(b => b.intention), [
            'She has received the summons.',
            'She has confronted the messenger.',
            'She has found the brother.',
            'She has chosen mercy.',
        ]);
        assert.deepEqual(merged.beats.slice(2).map(b => b.status), ['pending', 'pending']);
        assert.equal(merged.beats.some(b => b.status === 'active'), false);
    });

    it('suffixes generated ids that collide with kept ids and rewrites unlockAfter to match', () => {
        const merged = mergeReplan(storedEpisode(), generatedPlan());

        assert.deepEqual(merged.beats.map(b => b.id), ['beat_1', 'beat_2', 'beat_1_2', 'beat_2_2']);
        assert.deepEqual(merged.beats[3].unlockAfter, ['beat_1_2']);
        assert.deepEqual(merged.foreshadowing.map(f => f.id), ['foreshadow_1', 'foreshadow_1_2']);
        assert.deepEqual(merged.triggers.map(t => t.id), ['trigger_1', 'trigger_1_2']);
    });

    it('keeps planted foreshadowing and fired triggers, drops the unplanted and unfired', () => {
        const merged = mergeReplan(storedEpisode(), generatedPlan());

        assert.deepEqual(merged.foreshadowing[0], storedEpisode().foreshadowing[0]);
        assert.equal(merged.foreshadowing[1].clue, 'A cough behind the curtain');
        assert.equal(merged.foreshadowing[1].planted, false);
        assert.deepEqual(merged.triggers[0], storedEpisode().triggers[0]);
        assert.equal(merged.triggers[1].condition, 'if she lies');
        assert.equal(merged.triggers[1].fired, false);
    });

    it('keeps every existing secret verbatim and only adds new ones', () => {
        const merged = mergeReplan(storedEpisode(), generatedPlan());

        assert.deepEqual(merged.secrets.slice(0, 2), storedEpisode().secrets);
        assert.equal(merged.secrets.length, 3);
        assert.equal(merged.secrets[2].content, 'The brother is dying.');
        assert.equal(merged.secrets[2].id, 'secret_2_2');
        assert.equal(merged.secrets[2].disclosed, false);
    });

    it('re-planning as an act yields milestones all active and tier act', () => {
        const merged = mergeReplan(storedEpisode(), generatedPlan({ tier: 'act' }));

        assert.equal(merged.tier, 'act');
        assert.deepEqual(merged.beats.slice(2).map(b => b.status), ['active', 'active']);
        assert.deepEqual(merged.beats.slice(0, 2).map(b => b.status), ['completed', 'completed']);
    });

    it('a re-planned act with a pressure-less milestone is rejected by validation before any merge (#13)', () => {
        // generator.js validates with the chosen tier and only then calls
        // mergeReplan; the same gate as a fresh plan applies.
        const { valid, arc, errors } = validateArcPlan({
            title: 'Model-invented title',
            premise: 'Model-invented premise',
            beats: [
                { pressure: 'The trail goes cold.', intention: 'She has found the brother.' },
                { intention: 'She has chosen mercy.' },
            ],
        }, { tier: 'act' });
        assert.equal(valid, false);
        assert.equal(arc, null);
        assert.deepEqual(errors, ['Milestone "beat_2" has no pressure']);
    });

    it('does not mutate its inputs', () => {
        const existing = storedEpisode();
        const generated = generatedPlan();
        const existingBefore = structuredClone(existing);
        const generatedBefore = structuredClone(generated);
        mergeReplan(existing, generated);

        assert.deepEqual(existing, existingBefore);
        assert.deepEqual(generated, generatedBefore);
    });
});

describe('replanTiers — an arc may grow, never shrink', () => {
    it('lets an episode stay or grow into an act or saga', () => {
        assert.deepEqual(replanTiers('episode'), ['episode', 'act', 'saga']);
    });

    it('lets an act stay or grow into a saga, never become an episode', () => {
        assert.deepEqual(replanTiers('act'), ['act', 'saga']);
    });

    it('keeps a saga a saga', () => {
        assert.deepEqual(replanTiers('saga'), ['saga']);
    });

    it('treats a missing or unknown tier as episode', () => {
        assert.deepEqual(replanTiers(undefined), ['episode', 'act', 'saga']);
        assert.deepEqual(replanTiers('chapter'), ['episode', 'act', 'saga']);
    });
});

describe('buildArcSoFar', () => {
    it('returns an empty string when planning new', () => {
        assert.equal(buildArcSoFar(null), '');
        assert.equal(buildArcSoFar(undefined), '');
    });

    it('lists premise, secrets, escalation and fulfilled beats as already happened', () => {
        const text = buildArcSoFar(storedEpisode());

        assert.match(text, /^== ARC SO FAR ==/);
        assert.match(text, /A debt comes due\./);
        assert.match(text, /The creditor is her brother\./);
        assert.match(text, /The ledger is forged\./);
        assert.match(text, /old escalation/);
        assert.match(text, /already happened/i);
        assert.match(text, /She has received the summons\./);
        assert.match(text, /She has confronted the messenger\./);
        assert.doesNotMatch(text, /She has met the creditor\./);
        assert.doesNotMatch(text, /She has learned the truth\./);
    });

    it('says so when nothing has been fulfilled yet', () => {
        const arc = storedEpisode();
        arc.beats.forEach(b => { b.status = 'pending'; });
        const text = buildArcSoFar(arc);

        assert.match(text, /already happened/i);
        assert.doesNotMatch(text, /She has received the summons\./);
    });
});

describe('formatExistingArcs', () => {
    const arcs = [
        { id: 'arc-1', focus: 'normal', title: 'One', premise: 'First premise' },
        { id: 'arc-2', focus: 'paused', title: 'Two', premise: 'Second premise' },
    ];

    it('marks the arc being re-planned and leaves the others alone', () => {
        const lines = formatExistingArcs(arcs, 'arc-2').split('\n');

        assert.equal(lines[0], '[NORMAL] "One" — First premise');
        assert.equal(lines[1], '[PAUSED] [BEING RE-PLANNED] "Two" — Second premise');
    });

    it('is unchanged when not re-planning', () => {
        assert.equal(formatExistingArcs(arcs), '[NORMAL] "One" — First premise\n[PAUSED] "Two" — Second premise');
        assert.equal(formatExistingArcs([]), '(No existing arcs)');
    });
});
