import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { generateArc, clearTemplateCache, applyPlanCheck, buildPlanCheckVariables } from '../lib/planning/generator.js';

/** The plan check's thread for an arc kept to itself, with no other running arc. */
const KEPT_TO_ITSELF = { allowLinks: false, otherRunningArcs: [] };

// The plan check removes a beat, secret or trigger that belongs to another
// plot thread (#97, #106), under guards in code: what the story has closed,
// revealed or planted stays.

/** A new act as planned: Mira's debt, with parts of Lena's fame thread in it. */
function plannedAct(overrides = {}) {
    return {
        id: 'arc-2',
        title: 'The Quiet Debt',
        tier: 'act',
        premise: 'Will Mira pay her debt before it ruins her?',
        direction: 'Mira pays her debt.',
        secrets: [
            { id: 'lender_brother', content: 'The moneylender is Mira\'s lost brother.', revealPhase: 'climax', disclosed: false },
            { id: 'lena_label', content: 'Lena\'s label is buying her silence.', revealPhase: 'escalation', disclosed: false },
        ],
        triggers: [
            { id: 'coin_counted', condition: 'Mira counts the coins', action: 'Her hands shake.', secret: '', fired: false },
            { id: 'label_call', condition: 'Lena takes the call', action: 'She hangs up pale.', secret: 'lena_label', fired: false },
            { id: 'press_flash', condition: 'the press finds Lena', action: 'Cameras flash.', secret: '', fired: false },
        ],
        beats: [
            { id: 'ledger', pressure: 'The moneylender wants his coin by dawn.', intention: 'She has read the ledger.', status: 'active', unlockAfter: [] },
            { id: 'premiere', pressure: 'The press crowds the theatre.', intention: 'Lena has played her premiere.', status: 'active', unlockAfter: [] },
            { id: 'payment', pressure: 'Dawn comes.', intention: 'She has paid the moneylender.', status: 'active', unlockAfter: ['premiere', 'ledger'] },
        ],
        foreshadowing: [
            { id: 'torn_contract', clue: 'A torn contract in Lena\'s bin', target: 'secret:lena_label', planted: false },
            { id: 'brother_ring', clue: 'The lender wears their father\'s ring', target: 'lender_brother', planted: false },
        ],
        ...overrides,
    };
}

const ids = items => items.map(item => item.id);

/** The names generateArc passes the check on a re-plan without a cast. */
const REPLAN = { cast: [] };

describe('applyPlanCheck: foreign beats', () => {
    it('removes an open beat and takes its id out of every prerequisite list', () => {
        const checked = applyPlanCheck(plannedAct(), { foreign: [{ kind: 'beat', id: 'premiere' }] }, [], false);

        assert.deepEqual(ids(checked.beats), ['ledger', 'payment']);
        assert.deepEqual(checked.beats[1].unlockAfter, ['ledger']);
    });

    it('keeps a completed and a skipped beat', () => {
        const arc = plannedAct();
        arc.beats[0].status = 'completed';
        arc.beats[1].status = 'skipped';

        const checked = applyPlanCheck(arc, { foreign: [{ kind: 'beat', id: 'ledger' }, { kind: 'beat', id: 'premiere' }] }, [], false);

        assert.deepEqual(ids(checked.beats), ['ledger', 'premiere', 'payment']);
    });

    it('removes no beat when the answer flags every open beat', () => {
        const arc = plannedAct();
        arc.beats[0].status = 'completed';
        const foreign = [{ kind: 'beat', id: 'premiere' }, { kind: 'beat', id: 'payment' }];

        const checked = applyPlanCheck(arc, { foreign }, [], false);

        assert.deepEqual(ids(checked.beats), ['ledger', 'premiere', 'payment']);
    });

    it('removes no beat when the removal would leave only optional beats open', () => {
        const episode = plannedAct({
            tier: 'episode',
            beats: [
                { id: 'ledger', pressure: 'The moneylender wants his coin.', intention: 'She has read the ledger.', status: 'active', unlockAfter: [] },
                { id: 'premiere', pressure: 'The press crowds the theatre.', intention: 'Lena has played her premiere.', status: 'pending', unlockAfter: [] },
                { id: 'stroll', pressure: 'The night is warm.', intention: 'Mira has walked the river.', status: 'pending', unlockAfter: [], optional: true },
            ],
        });
        const foreign = [{ kind: 'beat', id: 'ledger' }, { kind: 'beat', id: 'premiere' }];

        const checked = applyPlanCheck(episode, { foreign }, [], false);

        assert.deepEqual(ids(checked.beats), ['ledger', 'premiere', 'stroll']);
    });

    it('removes a beat when an open non-optional beat stays', () => {
        const episode = plannedAct({
            tier: 'episode',
            beats: [
                { id: 'ledger', pressure: 'The moneylender wants his coin.', intention: 'She has read the ledger.', status: 'active', unlockAfter: [] },
                { id: 'premiere', pressure: 'The press crowds the theatre.', intention: 'Lena has played her premiere.', status: 'pending', unlockAfter: [] },
                { id: 'stroll', pressure: 'The night is warm.', intention: 'Mira has walked the river.', status: 'pending', unlockAfter: [], optional: true },
            ],
        });

        const checked = applyPlanCheck(episode, { foreign: [{ kind: 'beat', id: 'premiere' }] }, [], false);

        assert.deepEqual(ids(checked.beats), ['ledger', 'stroll']);
    });

    it('removing the active beat of an episode makes the next pending beat active', () => {
        const episode = plannedAct({
            tier: 'episode',
            beats: [
                { id: 'premiere', pressure: 'The press crowds the theatre.', intention: 'Lena has played her premiere.', status: 'active', unlockAfter: [] },
                { id: 'ledger', pressure: 'The moneylender wants his coin.', intention: 'She has read the ledger.', status: 'pending', unlockAfter: [] },
                { id: 'payment', pressure: 'Dawn comes.', intention: 'She has paid the moneylender.', status: 'pending', unlockAfter: [] },
            ],
        });

        const checked = applyPlanCheck(episode, { foreign: [{ kind: 'beat', id: 'premiere' }] }, [], false);

        assert.deepEqual(checked.beats.map(beat => [beat.id, beat.status]), [['ledger', 'active'], ['payment', 'pending']]);
    });

    it('a foreign beat is removed, not rewritten, when the answer also rewrites its fulfillment', () => {
        const checked = applyPlanCheck(plannedAct(), {
            rewrites: [{ kind: 'fulfillment', id: 'premiere', text: 'Lena has bowed.' }],
            foreign: [{ kind: 'beat', id: 'premiere' }],
        }, [], false);

        assert.deepEqual(ids(checked.beats), ['ledger', 'payment']);
    });

    it('a removed beat takes its unplanted clue with it; a planted one stays', () => {
        const arc = plannedAct({
            foreshadowing: [
                { id: 'poster', clue: 'A premiere poster on the wall', target: 'beat:premiere', planted: false },
                { id: 'ticket', clue: 'A torn premiere ticket', target: 'Beat:premiere (the opening night)', planted: false },
                { id: 'flyer', clue: 'A flyer for the premiere', target: 'beat:premiere', planted: true },
                { id: 'ledger_page', clue: 'A ledger page', target: 'beat:ledger', planted: false },
            ],
        });

        const checked = applyPlanCheck(arc, { foreign: [{ kind: 'beat', id: 'premiere' }] }, [], false);

        assert.deepEqual(ids(checked.foreshadowing), ['flyer', 'ledger_page']);
    });

    it('a beat kept by a guard keeps its clue', () => {
        const arc = plannedAct({
            foreshadowing: [{ id: 'poster', clue: 'A premiere poster on the wall', target: 'beat:premiere', planted: false }],
        });
        arc.beats[1].status = 'completed';

        const checked = applyPlanCheck(arc, { foreign: [{ kind: 'beat', id: 'premiere' }] }, [], false);

        assert.deepEqual(ids(checked.foreshadowing), ['poster']);
    });
});

describe('applyPlanCheck: foreign secrets', () => {
    it('removes a new plan\'s secret with its unfired trigger and unplanted clue', () => {
        const checked = applyPlanCheck(plannedAct(), { foreign: [{ kind: 'secret', id: 'lena_label' }] }, [], false);

        assert.deepEqual(ids(checked.secrets), ['lender_brother']);
        assert.deepEqual(ids(checked.triggers), ['coin_counted', 'press_flash']);
        assert.deepEqual(ids(checked.foreshadowing), ['brother_ring']);
    });

    it('keeps a disclosed secret', () => {
        const arc = plannedAct();
        arc.secrets[1].disclosed = true;

        const checked = applyPlanCheck(arc, { foreign: [{ kind: 'secret', id: 'lena_label' }] }, [], false);

        assert.deepEqual(ids(checked.secrets), ['lender_brother', 'lena_label']);
        assert.deepEqual(ids(checked.triggers), ['coin_counted', 'label_call', 'press_flash']);
    });

    it('a re-plan keeps a secret the answer lists as revealed', () => {
        const arc = plannedAct();
        const earlierSecrets = [{ ...arc.secrets[1] }];

        const checked = applyPlanCheck(arc, { revealed: ['lena_label'], foreign: [{ kind: 'secret', id: 'lena_label' }] }, earlierSecrets, true, REPLAN);

        assert.deepEqual(checked.secrets.map(secret => [secret.id, secret.disclosed]), [['lender_brother', false], ['lena_label', true]]);
    });

    it('a re-plan keeps a secret the knowledge ledger saw come out', () => {
        const arc = plannedAct();
        const earlierSecrets = [{ ...arc.secrets[1] }];

        const checked = applyPlanCheck(arc, { revealed: [], foreign: [{ kind: 'secret', id: 'lena_label' }] }, earlierSecrets, true, REPLAN, ['lena_label']);

        assert.deepEqual(ids(checked.secrets), ['lender_brother', 'lena_label']);
    });

    it('a re-plan whose answer has no revealed list removes no earlier secret, only a new one', () => {
        const arc = plannedAct();
        const earlierSecrets = [{ ...arc.secrets[1] }];
        const foreign = [{ kind: 'secret', id: 'lena_label' }, { kind: 'secret', id: 'lender_brother' }];

        const checked = applyPlanCheck(arc, { foreign }, earlierSecrets, true, REPLAN);

        assert.deepEqual(ids(checked.secrets), ['lena_label']);
    });

    it('an answer without a revealed list removes no earlier secret, whatever the re-plan flag says', () => {
        const arc = plannedAct();
        const earlierSecrets = [{ ...arc.secrets[1] }];

        const checked = applyPlanCheck(arc, { foreign: [{ kind: 'secret', id: 'lena_label' }] }, earlierSecrets, false);

        assert.deepEqual(ids(checked.secrets), ['lena_label', 'lender_brother']);
    });

    it('a re-plan with a revealed list removes an earlier secret that did not come out', () => {
        const arc = plannedAct();
        const earlierSecrets = [{ ...arc.secrets[1] }];

        const checked = applyPlanCheck(arc, { revealed: [], foreign: [{ kind: 'secret', id: 'lena_label' }] }, earlierSecrets, true, REPLAN);

        assert.deepEqual(ids(checked.secrets), ['lender_brother']);
    });

    it('a re-plan keeps an earlier secret stored as disclosed, with its trigger, though the revealed list leaves it out', () => {
        // Marked revealed by hand in the Arc Manager: no ledger fact for it.
        const arc = plannedAct();
        arc.secrets[1].disclosed = true;
        const earlierSecrets = [{ ...arc.secrets[1] }];

        const checked = applyPlanCheck(arc, { revealed: [], foreign: [{ kind: 'secret', id: 'lena_label' }] }, earlierSecrets, true, REPLAN);

        assert.deepEqual(ids(checked.secrets), ['lender_brother', 'lena_label']);
        assert.deepEqual(ids(checked.triggers), ['coin_counted', 'label_call', 'press_flash']);
    });

    it('keeps a secret a planted clue points at, and its unfired trigger', () => {
        const arc = plannedAct();
        arc.foreshadowing[0].planted = true;

        const checked = applyPlanCheck(arc, { foreign: [{ kind: 'secret', id: 'lena_label' }] }, [], false);

        assert.deepEqual(ids(checked.secrets), ['lender_brother', 'lena_label']);
        assert.deepEqual(ids(checked.triggers), ['coin_counted', 'label_call', 'press_flash']);
    });

    it('keeps a secret a fired trigger points at', () => {
        const arc = plannedAct();
        arc.triggers[1].fired = true;

        const checked = applyPlanCheck(arc, { foreign: [{ kind: 'secret', id: 'lena_label' }] }, [], false);

        assert.deepEqual(ids(checked.secrets), ['lender_brother', 'lena_label']);
        assert.deepEqual(ids(checked.foreshadowing), ['torn_contract', 'brother_ring']);
    });
});

describe('applyPlanCheck: foreign triggers, and what is ignored', () => {
    it('removes an unfired trigger and keeps a fired one', () => {
        const arc = plannedAct();
        arc.triggers[0].fired = true;
        const foreign = [{ kind: 'trigger', id: 'coin_counted' }, { kind: 'trigger', id: 'press_flash' }];

        const checked = applyPlanCheck(arc, { foreign }, [], false);

        assert.deepEqual(ids(checked.triggers), ['coin_counted', 'label_call']);
    });

    it('ignores unknown ids, unknown kinds and lists of the wrong shape', () => {
        const answers = [
            { foreign: 'premiere' },
            { foreign: { kind: 'beat', id: 'premiere' } },
            { foreign: [null, 'premiere', { kind: 'beat' }, { kind: 'beat', id: 'no_such_beat' }, { kind: 'chapter', id: 'premiere' }, { kind: 'secret', id: 'premiere' }] },
        ];
        for (const answer of answers) {
            const checked = applyPlanCheck(plannedAct(), answer, [], false);

            assert.deepEqual(ids(checked.beats), ['ledger', 'premiere', 'payment']);
            assert.deepEqual(ids(checked.secrets), ['lender_brother', 'lena_label']);
            assert.deepEqual(ids(checked.triggers), ['coin_counted', 'label_call', 'press_flash']);
        }
    });

    it('does not mutate the arc given', () => {
        const arc = plannedAct();

        applyPlanCheck(arc, {
            foreign: [{ kind: 'beat', id: 'premiere' }, { kind: 'secret', id: 'lena_label' }, { kind: 'trigger', id: 'press_flash' }],
        }, [], false);

        assert.deepEqual(arc, plannedAct());
    });
});

describe('applyPlanCheck: the removal is logged by kind and id', () => {
    let logs;
    let originalLog;
    beforeEach(() => {
        logs = [];
        originalLog = console.log;
        console.log = (...parts) => logs.push(parts.join(' '));
    });
    afterEach(() => { console.log = originalLog; });

    it('one line lists each removed part and clue, ids only, never the plan text', () => {
        applyPlanCheck(plannedAct(), {
            foreign: [{ kind: 'beat', id: 'premiere' }, { kind: 'secret', id: 'lena_label' }, { kind: 'trigger', id: 'press_flash' }],
        }, [], false);

        assert.deepEqual(logs, ['[Story Arc] Plan check removed parts of other plot threads: beat premiere, secret lena_label, trigger label_call, trigger press_flash, clue torn_contract']);
    });

    it('nothing removed: no line', () => {
        const arc = plannedAct();
        arc.beats[1].status = 'completed';

        applyPlanCheck(arc, { foreign: [{ kind: 'beat', id: 'premiere' }, { kind: 'beat', id: 'no_such_beat' }] }, [], false);

        assert.deepEqual(logs, []);
    });
});

describe('buildPlanCheckVariables: which premise states a re-plan\'s plot thread', () => {
    it('a re-plan shows the proposed premise and, under it, the author\'s premise', () => {
        const arc = plannedAct({ premise: 'A debt comes due, and Mira must pay it alone.', proposedPremise: 'Will Mira pay, and will Lena shine?' });

        const variables = buildPlanCheckVariables(arc, 'A.', { chatHistory: [], earlierSecrets: [] }, KEPT_TO_ITSELF);

        assert.equal(variables.PREMISE, 'Will Mira pay, and will Lena shine?\nAuthor\'s premise: A debt comes due, and Mira must pay it alone.');
    });

    it('a new plan shows its one premise', () => {
        assert.equal(buildPlanCheckVariables(plannedAct(), 'A.', null, KEPT_TO_ITSELF).PREMISE, 'Will Mira pay her debt before it ruins her?');
    });
});

describe('check-plan.txt: foreign parts', () => {
    const checkPlan = readFileSync(new URL('../prompts/check-plan.txt', import.meta.url), 'utf8');

    it('lists foreign beats, secrets and triggers for removal, never as a fulfillment rewrite', () => {
        assert.ok(checkPlan.includes('- A beat, a secret or a trigger that is foreign: list it in "foreign" with its kind and id. Never rewrite it instead, not even its fulfillment.'));
        assert.ok(checkPlan.includes('"foreign": [{ "kind": "beat | secret | trigger", "id": "the item\'s id" }]'));
    });

    it('on a re-plan with a blank direction the author\'s premise states the plot thread, and the proposal shields no foreign part', () => {
        assert.ok(checkPlan.includes('when the Direction is (none), the premise states it. On a re-plan that is the Author\'s premise line, not the Premise line above it, which is the planner\'s proposal.'));
        assert.ok(checkPlan.includes('And a premise the planner wrote, under a direction or as a re-plan\'s proposal, does not make another plot thread\'s part this arc\'s own.'));
    });
});

// A planning run against a fake model: the stored arc comes without the
// parts the check named.

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

function installBackend(answers) {
    globalThis.fetch = async (url) => new Response(readFileSync(new URL(`../prompts/${String(url).split('/').pop()}`, import.meta.url), 'utf8'));
    ConnectionManagerRequestService.sendRequest = async () => {
        const answer = answers.shift();
        return () => (async function* () { yield { text: answer }; })();
    };
}

const harvestedContext = {
    character: null,
    persona: { name: '', description: '' },
    lorebook: { constants: [], arcSummaries: [], recent: [] },
    chatHistory: [{ name: 'Mira', is_user: true, mes: 'I count the coins again.' }],
    existingArcs: [],
};

const generatedPlan = JSON.stringify({
    title: 'The Quiet Debt',
    premise: 'Will Mira pay her debt before it ruins her?',
    beats: [
        { id: 'ledger', pressure: 'The moneylender wants his coin by dawn.', intention: 'She has read the ledger.' },
        { id: 'premiere', pressure: 'The press crowds the theatre.', intention: 'Lena has played her premiere.' },
        { id: 'payment', pressure: 'Dawn comes.', intention: 'She has paid the moneylender.' },
    ],
    secrets: [
        { id: 'lender_brother', content: 'The moneylender is Mira\'s lost brother.', revealPhase: 'climax' },
        { id: 'lena_label', content: 'Lena\'s label is buying her silence.', revealPhase: 'escalation' },
    ],
    triggers: [{ id: 'label_call', condition: 'Lena takes the call', action: 'She hangs up pale.', secret: 'lena_label' }],
});

describe('generateArc: the check removes foreign parts from the stored arc', () => {
    beforeEach(() => {
        clearTemplateCache();
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        clearTemplateCache();
    });

    it('a check answer naming a foreign beat and a foreign secret: the arc comes without them, and the count', async () => {
        const checkAnswer = JSON.stringify({ revealed: [], rewrites: [], gates: [], foreign: [{ kind: 'beat', id: 'premiere' }, { kind: 'secret', id: 'lena_label' }] });
        installBackend(['Mira owes the moneylender.', generatedPlan, checkAnswer]);

        const result = await generateArc(harvestedContext, 'Mira pays her debt.', {}, { tier: 'act' });

        assert.equal(result.error, null);
        assert.deepEqual(ids(result.arc.beats), ['ledger', 'payment']);
        assert.deepEqual(ids(result.arc.secrets), ['lender_brother']);
        assert.deepEqual(result.arc.triggers, []);
        // The beat, the secret and the secret's trigger
        assert.equal(result.removedParts, 3);
    });

    it('a check answer naming nothing foreign: no removed parts', async () => {
        installBackend(['Mira owes the moneylender.', generatedPlan, JSON.stringify({ revealed: [], rewrites: [], gates: [] })]);

        const result = await generateArc(harvestedContext, 'Mira pays her debt.', {}, { tier: 'act' });

        assert.equal(result.arc.beats.length, 3);
        assert.equal(result.removedParts, 0);
    });
});
