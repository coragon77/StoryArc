import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings } from '/scripts/extensions.js';
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
import { generateArc, clearTemplateCache, buildTierBlock } from '../lib/planning/generator.js';
import { PROMPT_CATALOG, describePrompts, savePromptEdit } from '../lib/planning/prompt-edits.js';
import { buildPromptChecks } from '../lib/ui/prompts.js';

// An arc's plan stays inside its own plot thread (#97, #101): the outline
// prompt carries the thread block, and no longer asks for an arc that
// intersects the running ones. The backend is the Connection Manager mock,
// the templates are the real prompt files.

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;
const promptsDir = new URL('../prompts/', import.meta.url);
const readPrompt = name => readFileSync(new URL(name, promptsDir), 'utf8');

function installBackend(answers) {
    const sentPrompts = [];
    globalThis.fetch = async (url) => new Response(readPrompt(String(url).split('/').pop()));
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

/** A stored episode planned before the link setting existed: no allowLinks field. */
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

const generatedPlan = JSON.stringify({
    title: 'The Quiet Debt',
    premise: 'A debt comes due.',
    beats: [{ id: 'ledger', pressure: 'The ledger is due at dawn.', intention: 'She has read the ledger.' }],
    secrets: [],
    triggers: [],
});
const planCheckAnswer = JSON.stringify({ revealed: [], rewrites: [], links: [] });

/** The thread block's anchor phrases, as the outline prompt must carry them. */
function assertThreadBlock(outlinePrompt) {
    assert.ok(outlinePrompt.includes('== PLOT THREAD (binding) =='), outlinePrompt);
    assert.ok(outlinePrompt.includes('A plot thread is one line of the story with its own question, its own people and its own ending.'));
    assert.ok(outlinePrompt.includes('on a re-plan the player\'s rulings'));
    assert.ok(outlinePrompt.includes('Everything else going on in the story is BACKDROP for this arc'));
    assert.ok(outlinePrompt.includes('Backdrop may supply where and when a beat plays, never what happens in it.'));
    assert.ok(outlinePrompt.includes('unless the text says that its outcome is part of this arc'));
    assert.ok(outlinePrompt.includes('pick ONE plot thread from the story and name it in the premise'));
    assert.ok(outlinePrompt.includes('- No link: no secret ties this arc\'s people or things to another plot thread.'));
    assert.ok(outlinePrompt.includes('The test: take the other plot thread out of the story. Every beat must still be fulfillable, and every secret must still be about this arc\'s own people.'));
}

describe('generateArc: the outline carries the thread block', () => {
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

    it('a new plan: the backdrop rule, the take-it-out test and the "no link" wording, after the direction', async () => {
        const sentPrompts = installBackend(['The story stands at a crossroads.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(harvestedContext, 'Mira pays her debt.');

        assert.equal(result.error, null);
        const outlinePrompt = sentPrompts[1];
        assertThreadBlock(outlinePrompt);
        assert.ok(outlinePrompt.indexOf('Mira pays her debt.') < outlinePrompt.indexOf('== PLOT THREAD (binding) =='));
        assert.ok(outlinePrompt.indexOf('== PLOT THREAD (binding) ==') < outlinePrompt.indexOf('== TIER: EPISODE =='));
    });

    it('a re-plan of an arc with no stored setting gets the same "no link" wording', async () => {
        const sentPrompts = installBackend(['The story stands at a crossroads.', generatedPlan, planCheckAnswer]);

        const result = await generateArc(harvestedContext, 'She pays what she owes.', {}, { reviseArc: storedEpisode() });

        assert.equal(result.error, null);
        assert.ok(sentPrompts[1].includes('== ARC SO FAR =='));
        assertThreadBlock(sentPrompts[1]);
    });
});

describe('the outline template keeps the running arcs\' plot threads out', () => {
    const outline = readPrompt('generate-arc.txt');

    it('asks for no arc that intersects or spans several threads', () => {
        assert.equal(outline.includes('intersect'), false);
        assert.equal(outline.includes('multi-thread'), false);
        assert.equal(outline.includes('interference patterns'), false);
    });

    it('says the running arcs own their plot threads and their events are backdrop here', () => {
        assert.ok(outline.includes('Each one owns its own plot thread, and its events are backdrop for your new arc: it may supply where and when a beat plays, never what happens in it.'));
        assert.ok(outline.includes('8. ITS OWN PLOT THREAD, NOT ANOTHER ARC\'S\n'));
        assert.ok(outline.includes('- [ ] The arc keeps to its own plot thread: no beat, pressure, premise or secret is built from a running arc\'s events or another plot thread\'s, and it does not duplicate the running arcs\n'));
    });

    it('keeps the open threads guideline', () => {
        assert.ok(outline.includes('- OPEN THREADS: this arc continues a story that will keep going.'));
    });

    it('slots the thread block after the themes, before the tier', () => {
        assert.ok(outline.includes('{{AUTHOR_ANSWERS_BLOCK}}{{THEMES_BLOCK}}{{THREAD_BLOCK}}{{TIER_BLOCK}}'));
        assert.equal(outline.split('{{THREAD_BLOCK}}').length - 1, 1);
    });
});

describe('buildTierBlock: an episode is one plot thread', () => {
    it('says so in the episode branch', () => {
        assert.ok(buildTierBlock('episode').includes('- The arc is one plot thread: its scene beats are the steps of that thread, and a second, independent thread belongs in a second arc.\n'));
    });
});

describe('Prompts popup: an edited outline without the thread block', () => {
    afterEach(() => {
        delete extension_settings.story_arc;
    });

    it('reports {{THREAD_BLOCK}} missing, with what it carries', () => {
        extension_settings.story_arc = {};
        const builtInOutline = readPrompt('generate-arc.txt');
        const oldOutline = builtInOutline.replace('{{THREAD_BLOCK}}', '');
        savePromptEdit('generate-arc.txt', oldOutline, oldOutline);
        const builtInTexts = Object.fromEntries(PROMPT_CATALOG.map(entry => [entry.name, readPrompt(entry.name)]));

        const outline = describePrompts(builtInTexts, extension_settings.story_arc.promptOverrides).prompts
            .find(prompt => prompt.name === 'generate-arc.txt');

        assert.equal(outline.state, 'changed');
        assert.deepEqual(outline.missing, ['THREAD_BLOCK']);
        const html = buildPromptChecks(outline, { text: outline.text, missing: outline.missing, unknown: outline.unknown });
        assert.ok(html.includes('<code>{{THREAD_BLOCK}}</code> is missing: the rule that keeps the plan inside the arc\'s thread never reaches the model.'), html);
    });
});
