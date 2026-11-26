import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { generateArc, clearTemplateCache, applyPlanCheck } from '../lib/planning/generator.js';
import { PROMPT_CATALOG, describePrompts, savePromptEdit } from '../lib/planning/prompt-edits.js';
import { buildPromptChecks } from '../lib/ui/prompts.js';

// The plan check judges a plan against its plot thread (#97, #105): it gets
// the thread block in its plan-check form, the running arcs, and the story
// analysis on a new plan too, under a heading that does not switch on the
// revealed-secrets task. The backend is the Connection Manager mock, the
// templates are the real prompt files.

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;
const promptsDir = new URL('../prompts/', import.meta.url);
const readPrompt = name => readFileSync(new URL(name, promptsDir), 'utf8');

/** Answers each call with the next text; an Error in the list is thrown instead. */
function installBackend(answers) {
    const sentPrompts = [];
    globalThis.fetch = async (url) => new Response(readPrompt(String(url).split('/').pop()));
    ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
        sentPrompts.push(messages[0].content);
        const answer = answers.shift();
        if (answer instanceof Error) throw answer;
        return () => (async function* () { yield { text: answer }; })();
    };
    return sentPrompts;
}

/** The running act of another plot thread: Lena's rise to fame. */
const fameAct = {
    id: 'arc-fame',
    title: 'Lena on Stage',
    status: 'active',
    tier: 'act',
    focus: 'normal',
    premise: 'Can Lena turn one viral show into a career?',
};

function harvestedContext(existingArcs = [fameAct]) {
    return {
        character: null,
        persona: { name: '', description: '' },
        lorebook: { constants: [], arcSummaries: [], recent: [] },
        chatHistory: [{ name: 'Mira', is_user: true, mes: 'I count the coins again.' }],
        existingArcs,
    };
}

/** A stored episode being re-planned; no allowLinks field. */
function storedEpisode() {
    return {
        id: 'arc-1',
        title: 'The Quiet Debt',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        messageStart: 100,
        direction: 'She pays what she owes.',
        premise: 'A debt comes due, and Mira must pay it alone.',
        themes: [],
        tone: '',
        directives: [],
        antiPatterns: [],
        secrets: [],
        foreshadowing: [],
        beats: [
            { id: 'summons', intention: 'She has received the summons.', status: 'completed', unlockAfter: [] },
            { id: 'messenger', intention: 'She has confronted the messenger.', status: 'active', unlockAfter: [] },
        ],
        escalation: '',
        triggers: [],
        characters: [],
        estimatedLength: 14,
    };
}

const ANALYSIS = 'Mira owes the moneylender; Lena has gone viral and the press follows her.';

const generatedPlan = JSON.stringify({
    title: 'The Quiet Debt',
    premise: 'Will Mira pay her debt, and will Lena\'s fame survive the press?',
    beats: [
        { id: 'ledger', pressure: 'The press hounds Lena backstage.', intention: 'She has read the ledger.' },
        { id: 'payment', pressure: 'The moneylender wants his coin by dawn.', intention: 'She has paid the moneylender.' },
    ],
    secrets: [],
    triggers: [],
});
const emptyCheckAnswer = JSON.stringify({ revealed: [], rewrites: [], gates: [] });

describe('generateArc: what the plan check is given to judge the plot thread', () => {
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

    it('a new plan: the analysis under its own heading, no revealed-secrets block, the running arcs and the "no link" wording', async () => {
        const sentPrompts = installBackend([ANALYSIS, generatedPlan, emptyCheckAnswer]);

        const result = await generateArc(harvestedContext(), 'Mira pays her debt.');

        assert.equal(result.error, null);
        assert.equal(sentPrompts.length, 3);
        const checkPrompt = sentPrompts[2];
        assert.ok(checkPrompt.includes(`== STORY ANALYSIS ==\n${ANALYSIS}\n`), checkPrompt);
        assert.equal(checkPrompt.includes('== STORY SO FAR =='), false);
        assert.equal(checkPrompt.includes('== SECRETS BEFORE THIS RE-PLAN =='), false);
        assert.ok(checkPrompt.includes('== PLOT THREAD (binding) =='));
        assert.ok(checkPrompt.includes('Everything else going on in the story is BACKDROP for this arc'));
        assert.ok(checkPrompt.includes('People are shared: a character who also belongs to another plot thread may appear in this arc\'s beats. A part belongs to a plot thread by what happens in it, never by who is in it.'));
        assert.ok(checkPrompt.includes('- No link: no secret ties this arc\'s people or things to another plot thread.'));
        assert.equal(checkPrompt.includes('- A link may be planned'), false);
        // The outline's own closing line does not reach the check.
        assert.equal(checkPrompt.includes('before you output the plan'), false);
        assert.ok(checkPrompt.includes('[NORMAL] "Lena on Stage" — Can Lena turn one viral show into a career?'));
        // The running arcs come after the thread block, which says "listed below".
        assert.ok(checkPrompt.indexOf('== PLOT THREAD (binding) ==') < checkPrompt.indexOf('"Lena on Stage"'));
    });

    it('a new plan with links allowed: the check reads "a link may be planned"', async () => {
        const sentPrompts = installBackend([ANALYSIS, generatedPlan, emptyCheckAnswer]);

        const result = await generateArc(harvestedContext(), 'Mira pays her debt.', {}, { allowLinks: true });

        assert.equal(result.error, null);
        const checkPrompt = sentPrompts[2];
        assert.ok(checkPrompt.includes('- A link may be planned: a secret that ties this arc\'s own people or things to another plot thread'), checkPrompt);
        assert.equal(checkPrompt.includes('- No link:'), false);
    });

    it('no running arcs: the check says so', async () => {
        const sentPrompts = installBackend([ANALYSIS, generatedPlan, emptyCheckAnswer]);

        await generateArc(harvestedContext([]), 'Mira pays her debt.');

        assert.ok(sentPrompts[2].includes('== RUNNING ARCS (other plot threads) ==\n(No existing arcs)\n'), sentPrompts[2]);
    });

    it('a re-plan: the analysis stays in the story so far block, and the re-planned arc is not listed as a running arc', async () => {
        const sentPrompts = installBackend([ANALYSIS, generatedPlan, emptyCheckAnswer]);
        const reviseArc = storedEpisode();

        const result = await generateArc(harvestedContext([fameAct, reviseArc]), 'She pays what she owes.', {}, { reviseArc });

        assert.equal(result.error, null);
        const checkPrompt = sentPrompts[2];
        assert.ok(checkPrompt.includes(`== STORY SO FAR ==\nAnalysis: ${ANALYSIS}\n`));
        assert.equal(checkPrompt.includes('== STORY ANALYSIS =='), false);
        assert.ok(checkPrompt.includes('"Lena on Stage"'));
        assert.equal(checkPrompt.includes('"The Quiet Debt"'), false);
        assert.ok(checkPrompt.includes('- No link:'));
    });
});

/** A new episode as planned, before the check: one pressure names the other plot thread's force. */
function plannedEpisode(overrides = {}) {
    return {
        id: 'arc-2',
        title: 'The Quiet Debt',
        tier: 'episode',
        premise: 'Will Mira pay her debt, and will Lena\'s fame survive the press?',
        direction: 'Mira pays her debt.',
        secrets: [],
        triggers: [],
        beats: [
            { id: 'ledger', pressure: 'The press hounds Lena backstage.', intention: 'She has read the ledger.', status: 'active', unlockAfter: [] },
            { id: 'payment', pressure: 'The moneylender wants his coin by dawn.', intention: 'She has paid the moneylender.', status: 'pending', unlockAfter: [] },
        ],
        foreshadowing: [],
        ...overrides,
    };
}

const threadAnswer = {
    rewrites: [
        { kind: 'pressure', id: 'ledger', text: 'The moneylender\'s men watch the door of her room.' },
        { kind: 'premise', id: 'premise', text: 'Will Mira pay her debt before it ruins her?' },
    ],
};

describe('applyPlanCheck: the plot thread rewrites', () => {
    it('a new plan with a direction: the foreign pressure and the premise are rewritten, the input arc is not mutated', () => {
        const arc = plannedEpisode();

        const checked = applyPlanCheck(arc, threadAnswer, [], false);

        assert.equal(checked.beats[0].pressure, 'The moneylender\'s men watch the door of her room.');
        assert.equal(checked.beats[1].pressure, 'The moneylender wants his coin by dawn.');
        assert.equal(checked.premise, 'Will Mira pay her debt before it ruins her?');
        assert.equal(arc.premise, 'Will Mira pay her debt, and will Lena\'s fame survive the press?');
        assert.equal(arc.beats[0].pressure, 'The press hounds Lena backstage.');
    });

    it('a blank direction: the premise defines the plot thread and is not rewritten, the pressure still is', () => {
        for (const direction of ['', undefined]) {
            const checked = applyPlanCheck(plannedEpisode({ direction }), threadAnswer, [], false);

            assert.equal(checked.premise, 'Will Mira pay her debt, and will Lena\'s fame survive the press?');
            assert.equal(checked.beats[0].pressure, 'The moneylender\'s men watch the door of her room.');
        }
    });

    it('a re-plan: neither the premise the wizard passed in nor the proposed premise is rewritten', () => {
        const arc = plannedEpisode({ premise: 'A debt comes due, and Mira must pay it alone.', proposedPremise: 'Will Mira pay, and will Lena shine?' });
        const names = { cast: [], replanPremise: 'A debt comes due, and Mira must pay it alone.', replanTitle: 'The Quiet Debt' };

        const checked = applyPlanCheck(arc, threadAnswer, [], true, names);

        assert.equal(checked.premise, 'A debt comes due, and Mira must pay it alone.');
        assert.equal(checked.proposedPremise, 'Will Mira pay, and will Lena shine?');
        assert.equal(checked.beats[0].pressure, 'The moneylender\'s men watch the door of her room.');
    });

    it('a re-plan whose premise and title are empty strings: the premise is still not rewritten', () => {
        const arc = plannedEpisode({ premise: '', proposedPremise: 'Will Mira pay, and will Lena shine?' });
        const names = { cast: [], replanPremise: '', replanTitle: '' };

        const checked = applyPlanCheck(arc, threadAnswer, [], true, names);

        assert.equal(checked.premise, '');
        assert.equal(checked.proposedPremise, 'Will Mira pay, and will Lena shine?');
    });

    it('an empty premise text is ignored', () => {
        const checked = applyPlanCheck(plannedEpisode(), { rewrites: [{ kind: 'premise', id: 'premise', text: '  ' }] }, [], false);

        assert.equal(checked.premise, 'Will Mira pay her debt, and will Lena\'s fame survive the press?');
    });
});

describe('generateArc: the check\'s answer on the stored plan, and a check that fails', () => {
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

    it('a readable answer: the premise and the foreign pressure are rewritten in the planned arc', async () => {
        installBackend([ANALYSIS, generatedPlan, JSON.stringify({ revealed: [], ...threadAnswer, gates: [] })]);

        const result = await generateArc(harvestedContext(), 'Mira pays her debt.');

        assert.equal(result.arc.premise, 'Will Mira pay her debt before it ruins her?');
        assert.equal(result.arc.beats[0].pressure, 'The moneylender\'s men watch the door of her room.');
    });

    it('an unreadable answer: premise and pressures as generated, one check call', async () => {
        const sentPrompts = installBackend([ANALYSIS, generatedPlan, 'I would rewrite the premise.']);

        const result = await generateArc(harvestedContext(), 'Mira pays her debt.');

        assert.equal(result.error, null);
        assert.equal(sentPrompts.length, 3);
        assert.equal(result.arc.premise, 'Will Mira pay her debt, and will Lena\'s fame survive the press?');
        assert.deepEqual(result.arc.beats.map(beat => beat.pressure), ['The press hounds Lena backstage.', 'The moneylender wants his coin by dawn.']);
    });

    it('a failed call: premise and pressures as generated, one check call', async () => {
        const sentPrompts = installBackend([ANALYSIS, generatedPlan, new Error('400 Bad Request')]);

        const result = await generateArc(harvestedContext(), 'Mira pays her debt.');

        assert.equal(result.error, null);
        assert.equal(sentPrompts.length, 3);
        assert.equal(result.arc.premise, 'Will Mira pay her debt, and will Lena\'s fame survive the press?');
        assert.equal(result.arc.beats[0].pressure, 'The press hounds Lena backstage.');
    });
});

describe('check-plan.txt: the plot thread task', () => {
    const checkPlan = readPrompt('check-plan.txt');

    it('slots the analysis, the thread block and the running arcs before the secrets, once each', () => {
        assert.ok(checkPlan.includes('{{ANALYSIS_BLOCK}}{{STORY_BLOCK}}{{THREAD_BLOCK}}== RUNNING ARCS (other plot threads) ==\n{{EXISTING_ARCS}}\n\n== SECRETS =='));
        assert.equal(checkPlan.split('{{THREAD_BLOCK}}').length - 1, 1);
    });

    it('says what is foreign, what is not, and that a doubtful part stays', () => {
        assert.ok(checkPlan.includes('This arc\'s plot thread is what the Direction, the author\'s answers and the rulings state; when the Direction is (none), the premise states it.'));
        assert.ok(checkPlan.includes('A part is foreign when it is an event of another plot thread, or a secret about another plot thread\'s people, with nothing of this arc\'s subject in it.'));
        assert.ok(checkPlan.includes('A part is foreign by what happens in it, never by who is in it: a beat with a character who also belongs to another plot thread is not foreign for that, and a breather with the friend whose rise is another arc stays.'));
        assert.ok(checkPlan.includes('A breather or a scene of colour with this arc\'s own people is not foreign. When in doubt, the part stays.'));
    });

    it('an answer that names another plot thread\'s events as the stage shields no beat that is one of them', () => {
        assert.ok(checkPlan.includes('An answer or a direction that names another plot thread\'s events as the stage (where or when this arc plays) does not shield a beat whose fulfillment is one of those events.'));
    });

    it('rewrites a foreign pressure, and the premise only on a new plan with a direction', () => {
        assert.ok(checkPlan.includes('- A pressure that names another plot thread\'s force: rewrite it to name the force of this arc\'s plot thread'));
        assert.ok(checkPlan.includes('- The premise: only when no STORY SO FAR block is given and the Direction is not (none).'));
        assert.ok(checkPlan.includes('"kind": "trigger | pressure | fulfillment | worldFact | secret | premise"'));
    });
});

describe('Prompts popup: an edited plan check prompt without the thread block', () => {
    afterEach(() => {
        delete extension_settings.story_arc;
    });

    it('reports {{THREAD_BLOCK}} missing, with what it carries', () => {
        extension_settings.story_arc = {};
        const builtInCheck = readPrompt('check-plan.txt');
        const oldCheck = builtInCheck.replace('{{THREAD_BLOCK}}', '');
        savePromptEdit('check-plan.txt', oldCheck, oldCheck);
        const builtInTexts = Object.fromEntries(PROMPT_CATALOG.map(entry => [entry.name, readPrompt(entry.name)]));

        const check = describePrompts(builtInTexts, extension_settings.story_arc.promptOverrides).prompts
            .find(prompt => prompt.name === 'check-plan.txt');

        assert.equal(check.state, 'changed');
        assert.deepEqual(check.missing, ['THREAD_BLOCK']);
        const html = buildPromptChecks(check, { text: check.text, missing: check.missing, unknown: check.unknown });
        assert.ok(html.includes('<code>{{THREAD_BLOCK}}</code> is missing: the rule that keeps the plan inside the arc\'s thread never reaches the model.'), html);
    });

    it('an edited check prompt from before #105: says what the analysis and the running arcs carry', () => {
        extension_settings.story_arc = {};
        const builtInCheck = readPrompt('check-plan.txt');
        const oldCheck = builtInCheck.replace('{{ANALYSIS_BLOCK}}', '').replace('{{THREAD_BLOCK}}', '').replace('{{EXISTING_ARCS}}', '');
        savePromptEdit('check-plan.txt', oldCheck, oldCheck);
        const builtInTexts = Object.fromEntries(PROMPT_CATALOG.map(entry => [entry.name, readPrompt(entry.name)]));

        const check = describePrompts(builtInTexts, extension_settings.story_arc.promptOverrides).prompts
            .find(prompt => prompt.name === 'check-plan.txt');

        assert.deepEqual([...check.missing].sort(), ['ANALYSIS_BLOCK', 'EXISTING_ARCS', 'THREAD_BLOCK']);
        const html = buildPromptChecks(check, { text: check.text, missing: check.missing, unknown: check.unknown });
        assert.ok(html.includes('<code>{{ANALYSIS_BLOCK}}</code> is missing: on a new plan the story analysis never reaches the check, so it cannot see a plot thread that has no arc yet.'), html);
        assert.ok(html.includes('<code>{{EXISTING_ARCS}}</code> is missing: the running arcs never reach the model, so it works as if no other arc were running.'), html);
        assert.equal(html.includes('what Story Arc fills in there never reaches the model'), false, html);
    });
});
