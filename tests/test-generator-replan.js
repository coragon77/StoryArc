import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { generateArc, clearTemplateCache } from '../lib/planning/generator.js';

// A re-plan's premise through the whole generation (ADR-0003): the backend is
// the Connection Manager profile mock and the templates are the real prompt
// files, so the test reads what the model is actually sent.

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;
const promptsDir = new URL('../prompts/', import.meta.url);

/**
 * Serve the real prompt templates, and answer each LLM call with the next
 * queued text. Returns the prompts the model was sent, in call order.
 */
function installBackend(answers) {
    const sentPrompts = [];
    globalThis.fetch = async (url) => new Response(readFileSync(new URL(String(url).split('/').pop(), promptsDir), 'utf8'));
    ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
        sentPrompts.push(messages[0].content);
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
    return sentPrompts;
}

const harvestedContext = {
    character: null,
    persona: { name: '', description: '' },
    lorebook: { constants: [], arcSummaries: [], recent: [] },
    chatHistory: [],
    existingArcs: [],
};

/** A stored episode being re-planned: one fulfilled beat, one open one. */
function storedEpisode() {
    return {
        id: 'arc-1',
        title: 'The Quiet Debt',
        status: 'active',
        tier: 'episode',
        focus: 'spotlight',
        messageStart: 100,
        lastFulfilledAt: 130,
        direction: 'She pays what she owes.',
        premise: 'A debt comes due, and Mira must pay it alone.',
        themes: [],
        tone: '',
        directives: [],
        antiPatterns: [],
        secrets: [{ id: 'brother', content: 'The creditor is her brother.', revealPhase: 'climax', disclosed: false }],
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

const generatedPlan = JSON.stringify({
    title: 'Model-invented title',
    premise: 'Mira no longer pays alone: her sister stands with her against the debt.',
    beats: [{ id: 'ledger', pressure: 'The ledger is due at dawn.', intention: 'She has read the ledger.' }],
    secrets: [],
    triggers: [{ id: 'flees', condition: 'she flees', action: 'the guard says her brother sent him' }],
});

const planCheckAnswer = JSON.stringify({
    revealed: [],
    rewrites: [{ kind: 'trigger', id: 'flees', text: 'the guard follows at a distance' }],
    links: [],
});

describe('generateArc: a re-plan proposes the premise', () => {
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

    it('asks Phase 2 for a premise, keeps the stored one and checks the plan against the proposal', async () => {
        const sentPrompts = installBackend(['The story stands at a crossroads.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(harvestedContext, 'She pays what she owes.', {}, { reviseArc: storedEpisode() });

        assert.equal(result.error, null);
        // Phase 1, Phase 2, the plan check: no call added.
        assert.equal(sentPrompts.length, 3);

        const phase2Prompt = sentPrompts[1];
        assert.ok(!phase2Prompt.includes('Keep the premise as given'));
        assert.ok(phase2Prompt.includes('Write a premise for the arc as it stands now, keeping what the current premise says that is still true.'));
        assert.ok(phase2Prompt.includes('Current premise: A debt comes due, and Mira must pay it alone.'));
        assert.doesNotMatch(phase2Prompt, /ruling/i);

        assert.equal(result.arc.premise, 'A debt comes due, and Mira must pay it alone.');
        assert.equal(result.arc.proposedPremise, 'Mira no longer pays alone: her sister stands with her against the debt.');
        assert.equal(result.arc.title, 'The Quiet Debt');

        const planCheckPrompt = sentPrompts[2];
        assert.ok(planCheckPrompt.includes('Premise: Mira no longer pays alone: her sister stands with her against the debt.\n'));
        assert.ok(!planCheckPrompt.includes('Premise: A debt comes due'));
        assert.equal(result.arc.triggers.find(trigger => trigger.id === 'flees').action, 'the guard follows at a distance');
    });

    it('sends a new plan no arc-so-far block, and the premise contract with its plain-view sentence', async () => {
        const sentPrompts = installBackend(['The story stands at a crossroads.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(harvestedContext, '');

        assert.equal(result.error, null);
        assert.equal(sentPrompts.length, 3);
        const phase2Prompt = sentPrompts[1];
        assert.ok(!phase2Prompt.includes('== ARC SO FAR =='));
        assert.ok(!phase2Prompt.includes('Write a premise for the arc as it stands now'));
        assert.ok(phase2Prompt.includes(
            '"premise": "2-4 sentences describing what this arc IS. Not a plot summary but a dramatic thesis: what is at stake, '
            + 'what forces are in collision, what question the arc is exploring. This should make someone want to read the story. '
            + 'It is shown to the player in plain view, so it states no secret and no planned development, only the situation and the question the arc explores.",',
        ));
        assert.equal(result.arc.premise, 'Mira no longer pays alone: her sister stands with her against the debt.');
        assert.equal('proposedPremise' in result.arc, false);
    });
});
