import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { buildPlanCheckVariables, generateArc, clearTemplateCache } from '../lib/planning/generator.js';

// The plan check holds a plan to the story and to the author's intent
// (ADR-0009 amendment, 2026-11-09): the cast's details, no sweeping claims,
// the register the author's direction and answers ask for.

const promptsDir = new URL('../prompts/', import.meta.url);
const read = name => readFileSync(new URL(name, promptsDir), 'utf8');

function makeArc(fields = {}) {
    return { premise: 'A debt.', direction: '', secrets: [], triggers: [], beats: [], ...fields };
}

describe('buildPlanCheckVariables: the author\'s answers', () => {
    it('renders each answer as a Q line and an A line', () => {
        const arc = makeArc({
            authorAnswers: [
                { question: 'How does the pressure work?', answer: 'Through deniable hints nobody admits.' },
                { question: 'Can anyone rescue her?', answer: 'No.' },
            ],
        });

        assert.equal(buildPlanCheckVariables(arc, null).AUTHOR_ANSWERS,
            '- Q: How does the pressure work?\n  A: Through deniable hints nobody admits.\n'
            + '- Q: Can anyone rescue her?\n  A: No.');
    });

    it('is (none) for an empty list and for an arc without one', () => {
        assert.equal(buildPlanCheckVariables(makeArc({ authorAnswers: [] }), null).AUTHOR_ANSWERS, '(none)');
        assert.equal(buildPlanCheckVariables(makeArc(), null).AUTHOR_ANSWERS, '(none)');
    });

    it('leaves out an entry without a question or an answer as text, and a list that is not one', () => {
        const arc = makeArc({
            authorAnswers: [
                { question: 'Who presses?', answer: '  ' },
                { question: 'How hard is the arc?', answer: 'Hard.' },
                null,
                { answer: 'No question.' },
            ],
        });

        assert.equal(buildPlanCheckVariables(arc, null).AUTHOR_ANSWERS, '- Q: How hard is the arc?\n  A: Hard.');
        assert.equal(buildPlanCheckVariables(makeArc({ authorAnswers: 'Hard.' }), null).AUTHOR_ANSWERS, '(none)');
    });

    it('check-plan.txt puts the answers under the public author input, after the rulings', () => {
        assert.ok(read('check-plan.txt').includes(
            '== PREMISE AND THE AUTHOR\'S DIRECTION ==\n'
            + 'These are public to the narrator and are what the author asked for. Never rewrite something because it carries them out.\n'
            + 'Premise: {{PREMISE}}\n'
            + 'Direction: {{DIRECTION}}\n'
            + 'Rulings:\n{{RULINGS}}\n'
            + 'Author\'s answers:\n{{AUTHOR_ANSWERS}}\n\n'
            + '{{STORY_BLOCK}}== SECRETS ==',
        ));
    });
});

describe('check-plan.txt: contradictions, sweeping claims, register', () => {
    const checkTemplate = read('check-plan.txt');

    it('the task finds the items the three rules catch', () => {
        assert.ok(checkTemplate.includes('and every secret that is not revealed in which someone forces a character that way, and every item the last three rules below catch. Write a replacement for each:\n'));
    });

    it('a secret may also be rewritten for a contradiction', () => {
        assert.ok(checkTemplate.includes('- A secret is rewritten only for leverage, by the same rule as a pressure: replace the contract or the command with the lever the setting gives the person and its cost; or for a contradiction, by the first rule below. Keep what the secret is:'));
    });

    it('pins the contradiction rule', () => {
        assert.ok(checkTemplate.includes('- Contradictions. A pressure, a trigger action, a world fact or a secret that is not revealed never contradicts what the NAMES block below lists for a cast member (age, role, relation) or another world fact. Rewrite it to agree and keep the rest: "As an uncertified minor Ward" becomes "As an uncertified Ward" for a cast member of age 18. Agreeing with what the story has established about the cast wins over keeping a secret\'s hidden fact unchanged.\n'));
    });

    it('pins the sweeping-claims rule', () => {
        assert.ok(checkTemplate.includes('- Sweeping claims. A world fact names who holds which power, or who wants or believes what. It never makes a claim about everyone or every group of people ("everyone", "peers, superiors and VIPs alike", "all of them"): the narrator makes it true of every character in every scene. Rewrite it to name who, or drop it with an empty "text".\n'));
    });

    it('pins the register rule', () => {
        assert.ok(checkTemplate.includes('- Register. When the author\'s direction or the author\'s answers say how pressure works or how hard the arc is (deniable hints nobody admits, no open force, no rescuers), rewrite every pressure, trigger action or world fact whose register contradicts that (an open demand, an order, a blunt "submitting turns her into a plaything", a rescuer stepping in) into the register the author asked for. Keep what it is about. Leave items that already fit. The author\'s direction and answers outrank the exception for a real power: where the author asked for no open force, a real power is played as leverage too.\n\n3. FULFILLMENTS.'));
    });
});

describe('generate-arc.txt: dilemmas that cost, world facts that agree with the cast', () => {
    const outlineTemplate = read('generate-arc.txt');

    it('pins the dilemma line after the leverage paragraph', () => {
        assert.ok(outlineTemplate.includes('contract and all. The same holds for the premise and for every world fact, secret and trigger that says how someone exerts pressure.\n\n'
            + 'Unless the author\'s direction or answers say otherwise, a dilemma an ally could dissolve in one conversation is not a dilemma: every pressure leaves the character a choice that costs, and no one in the story can simply make it go away.\n\n'
            + '4. WORLD FACTS STATE WHAT IS TRUE, NEVER HOW TO NARRATE\n'));
    });

    it('pins the world-fact line in the world-facts section', () => {
        assert.ok(outlineTemplate.includes('A world fact never states what a secret contains.\n'
            + 'A world fact never makes a claim about everyone or every group of people ("everyone", "all of them"), and it agrees with what the story has established about the cast: their ages, roles and relations.\n\n'
            + '5. ESCALATION IS A PATTERN, NOT A LABEL'));
    });
});

describe('generateArc: a re-plan\'s kept world facts reach the plan check', () => {
    const originalFetch = globalThis.fetch;
    const originalSendRequest = ConnectionManagerRequestService.sendRequest;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        clearTemplateCache();
    });

    /** Serve the real prompt templates; answer each call with the next text. */
    function installBackend(answers) {
        const sentPrompts = [];
        globalThis.fetch = async (url) => new Response(read(String(url).split('/').pop()));
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const text = answers.shift();
            return () => (async function* () { yield { text }; })();
        };
        return sentPrompts;
    }

    it('the outline is shown the old facts, and the facts it kept are numbered in WORLD FACTS', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        const storedAct = {
            id: 'arc-1', title: 'The Quiet Debt', status: 'active', tier: 'episode', focus: 'normal',
            messageStart: 100, lastFulfilledAt: 130, direction: '', premise: 'A debt comes due.',
            themes: [], tone: '', directives: [], antiPatterns: [],
            worldFacts: ['The creditor cannot touch her savings.', 'Everyone in town owes the creditor.'],
            secrets: [], foreshadowing: [], triggers: [], characters: [], estimatedLength: 14,
            beats: [{ id: 'summons', intention: 'She has received the summons.', status: 'active', unlockAfter: [] }],
        };
        const generatedPlan = JSON.stringify({
            title: 'Model title',
            premise: 'A debt comes due.',
            beats: [{ id: 'ledger', pressure: 'The ledger is due at dawn.', intention: 'She has read the ledger.' }],
            secrets: [],
            triggers: [],
            worldFacts: ['The creditor cannot touch her savings.', 'Everyone in town owes the creditor.'],
        });
        const planCheckAnswer = JSON.stringify({ revealed: [], rewrites: [{ kind: 'worldFact', id: 1, text: 'The baker and the mayor owe the creditor.' }], links: [] });
        const sentPrompts = installBackend(['The story stands still.', generatedPlan, planCheckAnswer]);
        const context = {
            character: null,
            persona: { name: '', description: '' },
            lorebook: { constants: [], arcSummaries: [], recent: [] },
            chatHistory: [],
            existingArcs: [storedAct],
        };

        const result = await generateArc(context, '', {}, { reviseArc: storedAct });

        assert.equal(result.error, null);
        assert.ok(sentPrompts[1].includes('- The creditor cannot touch her savings.\n- Everyone in town owes the creditor.'));
        assert.ok(sentPrompts[2].includes('== WORLD FACTS ==\n- [0] The creditor cannot touch her savings.\n- [1] Everyone in town owes the creditor.\n'));
        assert.deepEqual(result.arc.worldFacts, ['The creditor cannot touch her savings.', 'The baker and the mayor owe the creditor.']);
    });
});
