import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlanCheck, buildPlanCheckVariables, plantedCluesOfSecret } from '../lib/planning/generator.js';

// The plan check rewrites a secret that hands someone a power they would not
// hold; on a re-plan, a secret the arc already had gets a proposal the player
// takes or keeps in step 3 (ADR-0003 amendment, 2026-11-09).

/** A merged re-plan: two secrets the arc had, one the plan adds, and clues that point at them. */
function makeReplannedAct() {
    return {
        id: 'act-1',
        title: 'Trade Dress',
        tier: 'act',
        premise: 'Vanguard wants the rookie humiliated.',
        direction: 'Julian needs her to submit.',
        secrets: [
            { id: 'contract_leash', content: 'Her sponsor contract lets Vanguard order her to every gala.', revealPhase: 'escalation', disclosed: false, holders: ['Julian'] },
            { id: 'jumbotron_cut', content: 'Julian rigged the Jumbotron to broadcast his gauntlet feed.', revealPhase: 'climax', disclosed: false, holders: ['Julian'] },
            { id: 'new_debt', content: 'A clause makes Vera work off her debt in Julian\'s office.', revealPhase: 'climax', disclosed: false, holders: ['Vera'] },
        ],
        foreshadowing: [
            { id: 'gala_invite', clue: 'An invitation arrives with Vanguard\'s seal.', target: 'secret:contract_leash', planted: true },
            { id: 'signed_page', clue: 'Ellie never saw the last page she signed.', target: 'contract_leash', planted: true },
            { id: 'unplanted_hint', clue: 'Julian\'s assistant smirks at the gala list.', target: 'secret:contract_leash', planted: false },
            { id: 'screen_flicker', clue: 'The Jumbotron flickers during drills.', target: 'Secret: jumbotron_cut', planted: true },
            { id: 'prose_target', clue: 'Vanguard lawyers in the lobby.', target: 'the contract', planted: true },
        ],
        triggers: [],
        beats: [],
    };
}

describe('secret rewrites: which planted clues point at a secret', () => {
    function makeArcWithTargets(targets) {
        return { foreshadowing: targets.map((target, index) => ({ id: `clue_${index}`, clue: `Clue ${index}.`, target, planted: true })) };
    }

    it('reads the leading id after "secret:", before a bracket or a dash', () => {
        const arc = makeArcWithTargets(['secret:voss_betrayal (his deal)', 'secret:voss_betrayal - the deal', 'SECRET: voss_betrayal, later']);

        assert.deepEqual(plantedCluesOfSecret(arc, 'voss_betrayal').map(entry => entry.clue), ['Clue 0.', 'Clue 1.', 'Clue 2.']);
    });

    it('keeps a hyphen inside an id', () => {
        const arc = makeArcWithTargets(['secret:voss-betrayal']);

        assert.deepEqual(plantedCluesOfSecret(arc, 'voss-betrayal').map(entry => entry.clue), ['Clue 0.']);
        assert.deepEqual(plantedCluesOfSecret(arc, 'voss'), []);
    });

    it('never matches a beat target or a target in prose', () => {
        const arc = makeArcWithTargets(['beat:voss_betrayal', 'Voss betrays the crew', 'the voss_betrayal deal']);

        assert.deepEqual(plantedCluesOfSecret(arc, 'voss_betrayal'), []);
    });
});

describe('secret rewrites: the plan check', () => {
    it('lists each secret\'s planted clues under it, matched by "secret:<id>" or the bare id', () => {
        const variables = buildPlanCheckVariables(makeReplannedAct(), null);

        assert.equal(variables.SECRETS, [
            '- [contract_leash] (escalation) Her sponsor contract lets Vanguard order her to every gala.',
            '  Planted clue: An invitation arrives with Vanguard\'s seal.',
            '  Planted clue: Ellie never saw the last page she signed.',
            '- [jumbotron_cut] (climax) Julian rigged the Jumbotron to broadcast his gauntlet feed.',
            '  Planted clue: The Jumbotron flickers during drills.',
            '- [new_debt] (climax) A clause makes Vera work off her debt in Julian\'s office.',
        ].join('\n'));
    });

    it('stores a rewrite of a secret the arc already had as a proposal and keeps its content', () => {
        const checked = applyPlanCheck(makeReplannedAct(), {
            revealed: [],
            rewrites: [{ kind: 'secret', id: 'contract_leash', text: '  Vanguard pays for her brother\'s clinic place, and a missed gala could end it.  ' }],
        }, ['contract_leash', 'jumbotron_cut']);

        assert.deepEqual(checked.secrets[0], {
            id: 'contract_leash',
            content: 'Her sponsor contract lets Vanguard order her to every gala.',
            proposedContent: 'Vanguard pays for her brother\'s clinic place, and a missed gala could end it.',
            revealPhase: 'escalation',
            disclosed: false,
            holders: ['Julian'],
        });
    });

    it('rewrites a secret the plan itself adds directly, with no proposal', () => {
        const checked = applyPlanCheck(makeReplannedAct(), {
            revealed: [],
            rewrites: [{ kind: 'secret', id: 'new_debt', text: 'Vera owes Julian more than she earns, and he lets her know it.' }],
        }, ['contract_leash', 'jumbotron_cut']);

        assert.deepEqual(checked.secrets[2], {
            id: 'new_debt',
            content: 'Vera owes Julian more than she earns, and he lets her know it.',
            revealPhase: 'climax',
            disclosed: false,
            holders: ['Vera'],
        });
    });

    it('rewrites every secret of a fresh plan directly', () => {
        const checked = applyPlanCheck(makeReplannedAct(), {
            rewrites: [{ kind: 'secret', id: 'contract_leash', text: 'Vanguard pays for her brother\'s clinic place.' }],
        }, []);

        assert.equal(checked.secrets[0].content, 'Vanguard pays for her brother\'s clinic place.');
        assert.equal('proposedContent' in checked.secrets[0], false);
    });

    it('never rewrites a secret the same answer marks revealed, nor one already disclosed', () => {
        const arc = makeReplannedAct();
        arc.secrets[2].disclosed = true;

        const checked = applyPlanCheck(arc, {
            revealed: ['contract_leash'],
            rewrites: [
                { kind: 'secret', id: 'contract_leash', text: 'Vanguard pays for her brother\'s clinic place.' },
                { kind: 'secret', id: 'new_debt', text: 'Vera owes Julian more than she earns.' },
            ],
        }, ['contract_leash', 'jumbotron_cut']);

        assert.deepEqual(checked.secrets[0], {
            id: 'contract_leash',
            content: 'Her sponsor contract lets Vanguard order her to every gala.',
            revealPhase: 'escalation',
            disclosed: true,
            holders: ['Julian'],
        });
        assert.deepEqual(checked.secrets[2], {
            id: 'new_debt',
            content: 'A clause makes Vera work off her debt in Julian\'s office.',
            revealPhase: 'climax',
            disclosed: true,
            holders: ['Vera'],
        });
    });

    it('drops a rewrite identical to the stored text, an empty one and one for an unknown secret', () => {
        const arc = makeReplannedAct();

        const checked = applyPlanCheck(arc, {
            revealed: [],
            rewrites: [
                { kind: 'secret', id: 'contract_leash', text: ' Her sponsor contract lets Vanguard order her to every gala. ' },
                { kind: 'secret', id: 'jumbotron_cut', text: '   ' },
                { kind: 'secret', id: 'no_such_secret', text: 'Nowhere to go.' },
            ],
        }, ['contract_leash', 'jumbotron_cut']);

        assert.deepEqual(checked.secrets, makeReplannedAct().secrets);
    });

    it('does not mutate the arc it is given', () => {
        const arc = makeReplannedAct();

        applyPlanCheck(arc, {
            revealed: [],
            rewrites: [
                { kind: 'secret', id: 'contract_leash', text: 'Vanguard pays for her brother\'s clinic place.' },
                { kind: 'secret', id: 'new_debt', text: 'Vera owes Julian more than she earns.' },
            ],
        }, ['contract_leash', 'jumbotron_cut']);

        assert.deepEqual(arc, makeReplannedAct());
    });

    it('renames inside a proposal too', () => {
        const arc = makeReplannedAct();
        arc.secrets[0].content = 'Julian Hale\'s contract lets him order her to every gala.';
        const originalLog = console.log;
        console.log = () => {};
        let checked;
        try {
            checked = applyPlanCheck(arc, {
                revealed: [],
                rewrites: [{ kind: 'secret', id: 'contract_leash', text: 'Julian Hale pays for her brother\'s clinic place.' }],
                renames: [{ from: 'Julian Hale', to: 'Tobias Reed' }],
            }, ['contract_leash', 'jumbotron_cut'], { cast: [{ name: 'Priya', aliases: [] }] });
        } finally {
            console.log = originalLog;
        }

        assert.equal(checked.secrets[0].content, 'Tobias Reed\'s contract lets him order her to every gala.');
        assert.equal(checked.secrets[0].proposedContent, 'Tobias Reed pays for her brother\'s clinic place.');
        assert.equal('proposedContent' in checked.secrets[1], false);
    });
});
