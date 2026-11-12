import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyReplan, mergeReplan, replanTiers } from '../lib/planning/replan.js';
import { buildArcSoFar, plantedCluesOfSecret } from '../lib/planning/generator.js';
import { formatExistingArcs } from '../lib/planning/generator.js';
import { validateArcPlan } from '../lib/planning/validation.js';
import { reopenCompletionsFrom } from '../lib/planning/beat-completion.js';
import { isStalled } from '../lib/ui/progress.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

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
    it('marks the closed scene beats of an episode growing into an act or saga, and nothing else', () => {
        for (const tier of ['act', 'saga']) {
            const merged = mergeReplan(storedEpisode(), generatedPlan({ tier }));
            const kept = merged.beats.filter(beat => beat.status === 'completed');
            assert.deepEqual(kept.map(beat => [beat.id, beat.sceneBeat]), [['beat_1', true], ['beat_2', true]], tier);
            assert.equal(merged.beats.some(beat => beat.status !== 'completed' && 'sceneBeat' in beat), false, tier);
        }
        const episodeAgain = mergeReplan(storedEpisode(), generatedPlan());
        assert.equal(episodeAgain.beats.some(beat => 'sceneBeat' in beat), false);
        const actToSaga = mergeReplan({ ...storedEpisode(), tier: 'act' }, generatedPlan({ tier: 'saga' }));
        assert.equal(actToSaga.beats.some(beat => 'sceneBeat' in beat), false);
    });

    it('keeps a closed beat without its completion record: the history before a re-plan is frozen', () => {
        const existing = {
            ...storedEpisode(),
            tier: 'act',
            beats: [
                { id: 'm0', pressure: 'Rumours spread.', intention: 'She has heard the rumour.', status: 'skipped', unlockAfter: [] },
                {
                    id: 'm1', pressure: 'The guild watches.', intention: 'She has joined the guild.', status: 'completed', unlockAfter: [],
                    completion: { at: 140, messageId: 'm140', unlocked: ['m2'], skipped: ['m0'], arcCompleted: true, lastFulfilledBefore: 130 },
                },
                { id: 'm2', pressure: 'The vault waits.', intention: 'She has opened the vault.', status: 'active', unlockAfter: [] },
            ],
        };

        const merged = mergeReplan(existing, generatedPlan({ tier: 'act' }));

        assert.deepEqual(merged.beats.slice(0, 2), [
            { id: 'm0', pressure: 'Rumours spread.', intention: 'She has heard the rumour.', status: 'skipped', unlockAfter: [] },
            { id: 'm1', pressure: 'The guild watches.', intention: 'She has joined the guild.', status: 'completed', unlockAfter: [] },
        ]);
        // The stored arc is not mutated.
        assert.deepEqual(existing.beats[1].completion, { at: 140, messageId: 'm140', unlocked: ['m2'], skipped: ['m0'], arcCompleted: true, lastFulfilledBefore: 130 });
    });

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

    it('takes the world facts from the generated plan, and its empty directives and rules (ADR-0009)', () => {
        const existing = { ...storedEpisode(), worldFacts: ['Old fact.'] };
        const generated = generatedPlan({ worldFacts: ['The brother cannot leave the city.'], directives: [], antiPatterns: [] });
        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.worldFacts, ['The brother cannot leave the city.']);
        assert.deepEqual(merged.directives, []);
        assert.deepEqual(merged.antiPatterns, []);
    });

    it('gives an arc stored before world facts the generated ones', () => {
        const merged = mergeReplan(storedEpisode(), generatedPlan({ worldFacts: ['The ledger office closes at noon.'] }));
        assert.deepEqual(merged.worldFacts, ['The ledger office closes at noon.']);
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

    it('keeps a revealed secret verbatim and drops a generated one restating it', () => {
        // generatedPlan's secret_1 restates the disclosed secret_1.
        const merged = mergeReplan(storedEpisode(), generatedPlan());

        assert.deepEqual(merged.secrets[0], { id: 'secret_1', content: 'The creditor is her brother.', revealPhase: 'climax', disclosed: true });
        assert.equal(merged.secrets.filter(secret => /creditor is her brother/i.test(secret.content)).length, 1);
    });

    it('replaces an unrevealed secret the plan keeps under its id, holders and phase included', () => {
        const generated = generatedPlan({
            secrets: [{ id: 'secret_2', content: 'The brother forged the ledger to cover his illness.', revealPhase: 'escalation', holders: ['Tomas'] }],
        });

        const merged = mergeReplan(storedEpisode(), generated);

        assert.deepEqual(merged.secrets, [
            { id: 'secret_1', content: 'The creditor is her brother.', revealPhase: 'climax', disclosed: true },
            { id: 'secret_2', content: 'The brother forged the ledger to cover his illness.', revealPhase: 'escalation', disclosed: false, holders: ['Tomas'] },
        ]);
    });

    it('drops an unrevealed secret the plan leaves out and takes the plan\'s new one', () => {
        const generated = generatedPlan({ secrets: [{ id: 'brother_dying', content: 'The brother is dying.' }] });

        const merged = mergeReplan(storedEpisode(), generated);

        assert.deepEqual(merged.secrets.map(secret => [secret.id, secret.content]), [
            ['secret_1', 'The creditor is her brother.'],
            ['brother_dying', 'The brother is dying.'],
        ]);
    });

    it('keeps a planted clue and a fired trigger pointing at an unrevealed secret the plan rewrote', () => {
        const existing = {
            ...storedEpisode(),
            foreshadowing: [{ id: 'almond_ink', clue: 'Ink that smells of almonds', target: 'secret:secret_2', planted: true }],
            triggers: [{ id: 'ledger_touched', condition: 'if she opens the ledger', action: 'the clerk snatches it back', secret: 'secret_2', fired: true }],
        };
        const generated = generatedPlan({ secrets: [{ id: 'secret_2', content: 'The ledger was forged with almond ink by the brother.' }] });

        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.foreshadowing[0], { id: 'almond_ink', clue: 'Ink that smells of almonds', target: 'secret:secret_2', planted: true });
        assert.deepEqual(merged.triggers[0], { id: 'ledger_touched', condition: 'if she opens the ledger', action: 'the clerk snatches it back', secret: 'secret_2', fired: true });
        assert.deepEqual(plantedCluesOfSecret(merged, 'secret_2').map(clue => clue.id), ['almond_ink']);
        assert.equal(merged.secrets.find(secret => secret.id === 'secret_2').content, 'The ledger was forged with almond ink by the brother.');
    });

    it('suffixes a new secret whose id collides with a revealed one, and its trigger link follows', () => {
        const generated = generatedPlan({
            secrets: [{ id: 'secret_1', content: 'The brother is dying.' }],
            triggers: [{ id: 'brother_coughs', condition: 'if she visits', action: 'he hides the cough', secret: 'secret_1' }],
        });

        const merged = mergeReplan(storedEpisode(), generated);

        assert.deepEqual(merged.secrets.map(secret => [secret.id, secret.content]), [
            ['secret_1', 'The creditor is her brother.'],
            ['secret_1_2', 'The brother is dying.'],
        ]);
        assert.equal(merged.triggers.find(trigger => trigger.id === 'brother_coughs').secret, 'secret_1_2');
    });

    it('points a new trigger\'s secret link at the secret\'s merged id', () => {
        // generatedPlan's secret_1 restates the disclosed secret_1 and is
        // dropped, so its link follows to the stored one; its secret_2 ("The
        // brother is dying.") has an id validation invented and is suffixed
        // past the stored secret_2, which the plan left out. The link to
        // secret_2 is the plan's own word and stays as written.
        const generated = generatedPlan({
            triggers: [
                { id: 'brother_coughs', condition: 'if she visits', action: 'he hides the cough', secret: 'secret_2' },
                { id: 'creditor_named', condition: 'if she asks', action: 'the clerk goes pale', secret: 'secret_1' },
            ],
        });

        const merged = mergeReplan(storedEpisode(), generated);

        assert.deepEqual(merged.secrets.map(secret => [secret.id, secret.content]), [
            ['secret_1', 'The creditor is her brother.'],
            ['secret_2_2', 'The brother is dying.'],
        ]);
        assert.deepEqual(merged.triggers.map(trigger => [trigger.id, trigger.secret]), [
            ['trigger_1', undefined],
            ['brother_coughs', 'secret_2'],
            ['creditor_named', 'secret_1'],
        ]);
    });

    it('never lets an id validation invented replace an unrevealed secret', () => {
        // The planner gave no ids: validation numbers them secret_1, secret_2,
        // the ids the stored arc's unrevealed secrets have.
        const existing = {
            ...storedEpisode(),
            secrets: [
                { id: 'secret_1', content: 'The ledger is forged.', revealPhase: 'any', disclosed: false, holders: [] },
                { id: 'secret_2', content: 'The clerk is paid by the brother.', revealPhase: 'climax', disclosed: false, holders: [] },
            ],
        };
        const generated = generatedPlan({
            secrets: [{ content: 'The brother is dying.' }, { content: 'The creditor fled the capital.' }],
            triggers: [{ condition: 'if she visits', action: 'he hides the cough', secret: 'secret_1' }],
        });

        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.secrets.map(secret => [secret.id, secret.content]), [
            ['secret_1_2', 'The brother is dying.'],
            ['secret_2_2', 'The creditor fled the capital.'],
        ]);
        // An invented id's rename moves no link.
        assert.equal(merged.triggers[1].secret, 'secret_1');
    });

    it('keeps a link to a named secret on it when an invented id is the same string', () => {
        // The planner named one secret secret_1 (keeping the stored one) and
        // gave the first secret no id, which validation numbered secret_1 too.
        const existing = {
            ...storedEpisode(),
            secrets: [{ id: 'secret_1', content: 'The ledger is forged.', revealPhase: 'any', disclosed: false, holders: [] }],
        };
        const generated = generatedPlan({
            secrets: [{ content: 'The brother is dying.' }, { id: 'secret_1', content: 'The brother forged the ledger.' }],
            triggers: [{ id: 'ledger_opened', condition: 'if she opens the ledger', action: 'the clerk lies', secret: 'secret_1' }],
        });

        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.secrets.map(secret => [secret.id, secret.content]), [
            ['secret_1', 'The brother forged the ledger.'],
            ['secret_1_2', 'The brother is dying.'],
        ]);
        assert.equal(merged.triggers.find(trigger => trigger.id === 'ledger_opened').secret, 'secret_1');
    });

    it('lets a named id replace the unrevealed secret while an invented one is suffixed past it', () => {
        const existing = {
            ...storedEpisode(),
            secrets: [{ id: 'secret_1', content: 'The ledger is forged.', revealPhase: 'any', disclosed: false, holders: [] }],
        };
        const generated = generatedPlan({
            secrets: [{ content: 'The brother is dying.' }, { id: 'secret_1', content: 'The brother forged the ledger.' }],
        });

        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.secrets.map(secret => [secret.id, secret.content]), [
            ['secret_1', 'The brother forged the ledger.'],
            ['secret_1_2', 'The brother is dying.'],
        ]);
    });

    it('points a link to a dropped restated secret at the revealed secret with that content', () => {
        const existing = { ...storedEpisode(), secrets: [{ id: 'secret_1', content: 'The Duke is alive.', revealPhase: 'any', disclosed: true }] };
        const generated = {
            ...generatedPlan(),
            secrets: [{ id: 'duke_alive', content: 'the duke is alive.', revealPhase: 'climax', disclosed: false }],
            triggers: [{ id: 'grave_opened', condition: 'if the grave is opened', action: 'the gravedigger flees', secret: 'duke_alive', fired: false }],
        };

        const merged = mergeReplan(existing, generated);

        assert.equal(merged.triggers.find(trigger => trigger.id === 'grave_opened').secret, 'secret_1');
        assert.deepEqual(merged.secrets.map(secret => secret.id), ['secret_1']);
    });

    it('drops a generated secret that differs from a revealed one only in case or surrounding spaces', () => {
        const existing = { ...storedEpisode(), secrets: [{ id: 'secret_1', content: '  The Duke is alive ', revealPhase: 'any', disclosed: true }] };
        const generated = { ...generatedPlan(), secrets: [{ id: 'secret_1', content: 'the duke is ALIVE  ', revealPhase: 'any', disclosed: false }] };
        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.secrets, [{ id: 'secret_1', content: '  The Duke is alive ', revealPhase: 'any', disclosed: true }]);
    });

    it('keeps the holders of a revealed secret and takes a re-planned secret with the plan\'s', () => {
        const existing = { ...storedEpisode(), secrets: [
            { id: 'crane_plan', content: 'Julian plans the crane drop.', revealPhase: 'climax', disclosed: false, holders: ['Julian', 'Brody'] },
            { id: 'old_vow', content: 'Vera swore an oath to the guild.', revealPhase: 'any', disclosed: true, holders: ['Vera'] },
        ] };
        const { arc: generated } = validateArcPlan({
            title: 'T', premise: 'P', beats: [{ intention: 'She has found the crane.' }],
            secrets: [
                // Restates the revealed secret with other holders: the stored one wins.
                { id: 'vow_again', content: 'vera swore an oath to the guild.', holders: ['Julian'] },
                { id: 'crane_plan', content: 'Julian and Brody plan the crane drop for the gala.', revealPhase: 'climax', holders: ['Julian'] },
                { id: 'flash_drive', content: 'The flash drive holds the tether code.', revealPhase: 'escalation', holders: ['Gabriel'] },
            ],
        });

        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.secrets, [
            { id: 'old_vow', content: 'Vera swore an oath to the guild.', revealPhase: 'any', disclosed: true, holders: ['Vera'] },
            { id: 'crane_plan', content: 'Julian and Brody plan the crane drop for the gala.', revealPhase: 'climax', disclosed: false, holders: ['Julian'] },
            { id: 'flash_drive', content: 'The flash drive holds the tether code.', revealPhase: 'escalation', disclosed: false, holders: ['Gabriel'] },
        ]);
    });

    it('keeps a skipped milestone like a completed one, ahead of the new road', () => {
        const existing = {
            ...storedEpisode(),
            tier: 'act',
            beats: [
                { id: 'm0', pressure: 'The guild watches.', intention: 'She has joined the guild.', status: 'completed', unlockAfter: [] },
                { id: 'm1', pressure: 'Rumours spread.', intention: 'She has heard the rumour.', status: 'skipped', unlockAfter: [] },
                { id: 'm2', pressure: 'The vault waits.', intention: 'She has opened the vault.', status: 'active', unlockAfter: [] },
            ],
        };
        const generated = generatedPlan({ tier: 'act', beats: [{ id: 'm1', pressure: 'The creditor calls.', intention: 'She has paid the debt.' }] });

        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.beats.map(beat => [beat.id, beat.status, beat.intention]), [
            ['m0', 'completed', 'She has joined the guild.'],
            ['m1', 'skipped', 'She has heard the rumour.'],
            ['m1_2', 'active', 'She has paid the debt.'],
        ]);
    });

    it('gives two generated beats with the same id distinct ids', () => {
        const generated = {
            ...generatedPlan(),
            beats: [
                { id: 'beat_x', intention: 'First.', unlockAfter: [] },
                { id: 'beat_x', intention: 'Second.', unlockAfter: [] },
            ],
        };
        const merged = mergeReplan(storedEpisode(), generated);

        assert.deepEqual(merged.beats.map(b => b.id), ['beat_1', 'beat_2', 'beat_x', 'beat_x_2']);
    });

    it('skips a suffix that a kept beat already holds, and unlockAfter follows the rename', () => {
        const existing = {
            ...storedEpisode(),
            beats: [
                { id: 'beat_1', intention: 'Kept one.', status: 'completed', unlockAfter: [] },
                { id: 'beat_1_2', intention: 'Kept two.', status: 'completed', unlockAfter: [] },
            ],
        };
        const generated = {
            ...generatedPlan(),
            beats: [
                { id: 'beat_1', intention: 'New one.', unlockAfter: [] },
                { id: 'beat_9', intention: 'New two.', unlockAfter: ['beat_1'] },
            ],
        };
        const merged = mergeReplan(existing, generated);

        assert.deepEqual(merged.beats.map(b => b.id), ['beat_1', 'beat_1_2', 'beat_1_3', 'beat_9']);
        assert.deepEqual(merged.beats[3].unlockAfter, ['beat_1_3']);
    });

    it('gives a generated beat without unlockAfter an empty list', () => {
        const generated = { ...generatedPlan(), beats: [{ id: 'beat_9', intention: 'New.' }] };
        const merged = mergeReplan(storedEpisode(), generated);

        assert.deepEqual(merged.beats[2].unlockAfter, []);
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

    it('keeps the stored premise and carries the generated one as the proposal', () => {
        const merged = mergeReplan(storedEpisode(), generatedPlan({ premise: 'The brother is the creditor, and he is dying.' }));

        assert.equal(merged.premise, 'A debt comes due.');
        assert.equal(merged.proposedPremise, 'The brother is the creditor, and he is dying.');
        assert.equal(merged.title, 'The Quiet Debt');
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
        assert.ok(text.endsWith('do not plan these again):\n(nothing yet — the arc is being re-planned from its start)\n\n'));
    });

    it('prints one "- " line per secret and per fulfilled beat, under their headers', () => {
        const text = buildArcSoFar(storedEpisode());

        assert.ok(text.includes(
            'Secrets already revealed (established, do not restate):\n'
            + '- The creditor is her brother.\n'
            + '\n'
            + 'Secrets not yet revealed (re-plan them freely: keep, rewrite or drop each, keeping its id when you keep or rewrite it; a secret with planted clues or fired triggers listed under it must be kept or rewritten so it still explains them):\n'
            + '- [secret_2] The ledger is forged.\n'
            + '\n'
            + 'Escalation so far: old escalation\n',
        ), text);
        assert.ok(text.endsWith(
            'Already happened (fulfilled beats — do not plan these again):\n'
            + '- She has received the summons.\n'
            + '- She has confronted the messenger.\n'
            + '\n',
        ));
    });

    it('lists an unrevealed secret with its holders, planted clues and linked fired triggers', () => {
        const arc = {
            ...storedEpisode(),
            secrets: [{ id: 'forged_ledger', content: 'The ledger is forged.', revealPhase: 'any', disclosed: false, holders: ['Tomas', 'the clerk'] }],
            foreshadowing: [
                { id: 'almond_ink', clue: 'Ink that smells of almonds', target: 'secret:forged_ledger', planted: true },
                { id: 'fresh_binding', clue: 'A binding newer than its pages', target: 'secret:forged_ledger', planted: false },
            ],
            triggers: [
                { id: 'ledger_touched', condition: 'she opens the ledger', action: 'the clerk snatches it back', secret: 'forged_ledger', fired: true },
                { id: 'ledger_burned', condition: 'she copies a page', action: 'the clerk lies', secret: 'forged_ledger', fired: false },
                { id: 'guard_follows', condition: 'she flees', action: 'the guard follows', fired: true },
            ],
        };

        const text = buildArcSoFar(arc);

        assert.ok(text.includes(
            'so it still explains them):\n'
            + '- [forged_ledger] The ledger is forged.\n'
            + '  Known to: Tomas, the clerk\n'
            + '  Planted clue: Ink that smells of almonds\n'
            + '  Fired trigger: IF she opens the ledger → the clerk snatches it back\n'
            + '\n'
            + 'Escalation so far:',
        ), text);
    });

    it('lists skipped milestones as passed over after what already happened', () => {
        const arc = {
            ...storedEpisode(),
            tier: 'act',
            beats: [
                { id: 'm0', pressure: 'The guild watches.', intention: 'She has joined the guild.', status: 'completed', unlockAfter: [] },
                { id: 'm1', pressure: 'Rumours spread.', intention: 'She has heard the rumour.', status: 'skipped', unlockAfter: [] },
                { id: 'm2', pressure: 'The vault waits.', intention: 'She has opened the vault.', status: 'active', unlockAfter: [] },
            ],
        };

        const text = buildArcSoFar(arc);

        assert.ok(text.endsWith(
            'Already happened (fulfilled beats — do not plan these again):\n'
            + '- She has joined the guild.\n'
            + '\n'
            + 'Passed over (the story moved past them; do not plan them again):\n'
            + '- She has heard the rumour.\n'
            + '\n',
        ), text);
        assert.doesNotMatch(text, /She has opened the vault\./);
    });

    it('prints no passed-over block without a skipped milestone', () => {
        assert.doesNotMatch(buildArcSoFar(storedEpisode()), /Passed over/);
    });

    it('lists the world facts after the escalation, asking to keep the ones still true and their rank', () => {
        const text = buildArcSoFar({ ...storedEpisode(), worldFacts: ['The brother cannot leave the city.', 'The ledger office closes at noon.'] });

        assert.ok(text.includes(
            'Escalation so far: old escalation\n'
            + '\n'
            + 'World facts so far (keep in your "worldFacts" each one that is still true in the story; reword or drop one the story has overtaken):\n'
            + '- The brother cannot leave the city.\n'
            + '- The ledger office closes at noon.\n'
            + '\n'
            + 'Already happened (fulfilled beats — do not plan these again):\n',
        ), text);
    });

    it('says (none) for world facts on an arc stored before them', () => {
        const text = buildArcSoFar(storedEpisode());

        assert.ok(text.includes('reword or drop one the story has overtaken):\n(none)\n\nAlready happened'), text);
    });

    it('says (none) without secrets and (none recorded) without escalation', () => {
        const text = buildArcSoFar({ ...storedEpisode(), secrets: [], escalation: '' });

        assert.ok(text.includes('do not restate):\n(none)\n\nSecrets not yet revealed'), text);
        assert.ok(text.includes('so it still explains them):\n(none)\n\nEscalation so far: (none recorded)\n'), text);
    });

    it('opens with the header, the re-planning instruction and the premise', () => {
        const text = buildArcSoFar(storedEpisode());

        assert.ok(text.startsWith('== ARC SO FAR ==\nYou are RE-PLANNING an arc that is already running'));
        assert.ok(text.includes('The revealed secrets and what has already happened below are established and stay true.'));
        assert.ok(text.includes('Your "secrets" output holds the secrets not yet revealed that you keep or rewrite, and any new ones; a secret you leave out is dropped. Never put a revealed secret in it.'));
        assert.ok(!text.includes('only ADD'));
        assert.ok(text.includes('\n\nCurrent premise: A debt comes due.\n\n'));
    });

    it('asks for a premise for the arc as it stands now instead of keeping it', () => {
        const text = buildArcSoFar(storedEpisode());

        assert.ok(!text.includes('Keep the premise as given'));
        assert.ok(text.includes('Write a premise for the arc as it stands now, keeping what the current premise says that is still true.'));
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

describe('applyReplan', () => {
    /** A checked merged arc, written out by hand. */
    function mergedArc() {
        return {
            id: 'arc-1',
            title: 'The Quiet Debt',
            status: 'active',
            tier: 'act',
            premise: 'A debt comes due.',
            direction: 'new direction',
            messageStart: 100,
            lastFulfilledAt: 130,
            secrets: [{ id: 'secret_1', content: 'The creditor is her brother.', revealPhase: 'climax', disclosed: true }],
            beats: [
                { id: 'beat_1', status: 'completed', completion: { messageId: 120 } },
                { id: 'beat_2', status: 'active', unlockAfter: ['beat_1'] },
            ],
            foreshadowing: [],
            triggers: [],
        };
    }

    it('returns the arc to store equal to the merged arc, field for field, plus the re-plan stamp', () => {
        const { arc: stored, error } = applyReplan(mergedArc(), 250, { premise: 'A debt comes due.' });
        assert.equal(error, null);
        assert.deepEqual(stored, {
            id: 'arc-1',
            title: 'The Quiet Debt',
            status: 'active',
            tier: 'act',
            premise: 'A debt comes due.',
            direction: 'new direction',
            messageStart: 100,
            lastFulfilledAt: 130,
            replannedAt: 250,
            secrets: [{ id: 'secret_1', content: 'The creditor is her brother.', revealPhase: 'climax', disclosed: true }],
            beats: [
                { id: 'beat_1', status: 'completed', completion: { messageId: 120 } },
                { id: 'beat_2', status: 'active', unlockAfter: ['beat_1'] },
            ],
            foreshadowing: [],
            triggers: [],
        });
    });

    it('marks each open ruling answered at the chat length, and keeps an answered one\'s mark', () => {
        const merged = mergedArc();
        merged.rulings = [
            { id: 'r1', text: 'Aegis is not her defender.', at: 120, messageId: 'm120', answeredAt: 140 },
            { id: 'r2', text: 'Comics, not police procedural.', at: 200, messageId: 'm200' },
            { id: 'r3', text: 'Sundown is a mentor.', at: 210 },
        ];

        const { arc: stored } = applyReplan(merged, 250, { premise: 'A debt comes due.', storedRulings: structuredClone(merged.rulings) });

        assert.deepEqual(stored.rulings, [
            { id: 'r1', text: 'Aegis is not her defender.', at: 120, messageId: 'm120', answeredAt: 140 },
            { id: 'r2', text: 'Comics, not police procedural.', at: 200, messageId: 'm200', answeredAt: 250 },
            { id: 'r3', text: 'Sundown is a mentor.', at: 210, answeredAt: 250 },
        ]);
        assert.equal(merged.rulings[1].answeredAt, undefined);
    });

    it('keeps the rulings of the arc it re-plans through the merge', () => {
        const existing = { ...mergedArc(), rulings: [{ id: 'r1', text: 'Aegis is not her defender.', at: 120 }] };
        const generated = { ...mergedArc(), title: 'Ignored', beats: [], directives: [], antiPatterns: [], characters: [] };

        const storedRulings = [{ id: 'r1', text: 'Aegis is not her defender.', at: 120 }];
        const { arc: stored } = applyReplan(mergeReplan(existing, generated), 250, { premise: 'A debt comes due.', storedRulings });

        assert.deepEqual(stored.rulings, [{ id: 'r1', text: 'Aegis is not her defender.', at: 120, answeredAt: 250 }]);
    });

    it('does not mutate the merged arc, and the result shares nothing with it', () => {
        const merged = mergedWithProposal();
        const { arc: stored } = applyReplan(merged, 250, { premise: 'The brother is the creditor, and he is dying.' });
        stored.beats[1].status = 'completed';
        stored.secrets.push({ id: 'secret_2' });
        assert.deepEqual(merged, mergedWithProposal());
        assert.notEqual(stored, merged);
    });

    /** The merged arc of a re-plan whose Phase 2 proposed a premise. */
    function mergedWithProposal() {
        return { ...mergedArc(), proposedPremise: 'The brother is the creditor, and he is dying.' };
    }

    it('stores the proposal when the player chooses it, and no proposal field', () => {
        const { arc, error } = applyReplan(mergedWithProposal(), 250, { premise: 'The brother is the creditor, and he is dying.' });

        assert.equal(error, null);
        assert.equal(arc.premise, 'The brother is the creditor, and he is dying.');
        assert.equal('proposedPremise' in arc, false);
    });

    it('keeps the current premise when the player chooses it, and drops the proposal', () => {
        const { arc } = applyReplan(mergedWithProposal(), 250, { premise: 'A debt comes due.' });

        assert.equal(arc.premise, 'A debt comes due.');
        assert.equal('proposedPremise' in arc, false);
    });

    it('stores an edited premise as typed, trimmed', () => {
        const { arc } = applyReplan(mergedWithProposal(), 250, { premise: '  The brother is dying, and the debt is his.\n' });

        assert.equal(arc.premise, 'The brother is dying, and the debt is his.');
    });

    it('refuses a blank premise with the JSON editor\'s message', () => {
        assert.deepEqual(applyReplan(mergedWithProposal(), 250, { premise: '   ' }), { arc: null, error: 'premise cannot be empty.' });
        assert.deepEqual(applyReplan(mergedWithProposal(), 250, {}), { arc: null, error: 'premise cannot be empty.' });
    });
});

describe('applyReplan — the re-plan stamp restarts the stall count', () => {
    /**
     * The merged arc of a re-planned act: estimatedLength 90 with four
     * non-optional milestones, so a stall is more than 3 × 90 / 4 = 67.5
     * messages. m0 was completed at 2225 and kept by the re-plan, with its
     * completion record; before it the arc's lastFulfilledAt was its start, 2118.
     */
    function mergedAct() {
        return {
            id: 'act00001-full-id',
            title: 'Streets of the Jackpot Siren',
            status: 'active',
            tier: 'act',
            focus: 'normal',
            premise: 'Patrols on the Strip.',
            messageStart: 2118,
            lastFulfilledAt: 2225,
            estimatedLength: 90,
            beats: [
                { id: 'm0', intention: 'First patrol', status: 'completed', completion: { at: 2225, unlocked: [], arcCompleted: false, lastFulfilledBefore: 2118 } },
                { id: 'm1', intention: 'A rival', status: 'active' },
                { id: 'm2', intention: 'A favour owed', status: 'active' },
                { id: 'm3', intention: 'The Siren speaks', status: 'active' },
            ],
            secrets: [],
            foreshadowing: [],
            triggers: [],
        };
    }

    it('stores the chat length at apply as replannedAt; the stored act is not stalled one message on', () => {
        // 2300 would stall counted from the last fulfillment (2300 - 2225 = 75 > 67.5).
        const { arc: stored } = applyReplan(mergedAct(), 2300, { premise: 'Patrols on the Strip.' });

        assert.equal(stored.replannedAt, 2300);
        assert.equal(isStalled(stored, 2301), false);
    });

    it('a swipe of the message that completed a kept milestone reopens nothing after a re-plan', () => {
        // The act as stored before the re-plan: m0 completed at 2225, the
        // rest of its road open.
        const storedAct = { ...mergedAct(), worldFacts: [] };
        const { arc: generated } = validateArcPlan({
            title: 'T', premise: 'Patrols on the Strip.',
            beats: [
                { id: 'rival', pressure: 'A rival works the same corner.', intention: 'She has faced the rival.' },
                { id: 'favour', pressure: 'Someone keeps a tally of favours.', intention: 'She has called in a favour.' },
            ],
        }, { tier: 'act' });
        const { arc: stored } = applyReplan(mergeReplan(storedAct, generated), 2300, { premise: 'Patrols on the Strip.' });
        chat.length = 0;
        chat_metadata.story_arc = { version: 1, arcs: [stored], settings: {} };

        assert.equal(reopenCompletionsFrom(2225), false);

        assert.deepEqual(stored.beats.map(beat => [beat.id, beat.status]), [
            ['m0', 'completed'],
            ['rival', 'active'],
            ['favour', 'active'],
        ]);
        assert.equal(stored.lastFulfilledAt, 2225);
        assert.equal(isStalled(stored, 2301), false);
    });
});
