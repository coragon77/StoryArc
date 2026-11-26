import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings } from '/scripts/extensions.js';
import { clearTemplateCache, loadBuiltInTemplate, loadTemplate } from '../lib/planning/generator.js';
import { describePrompts, keepPromptEdit, savePromptEdit, resetPromptEdit } from '../lib/planning/prompt-edits.js';

const originalFetch = globalThis.fetch;

describe('loadTemplate with saved prompt edits', () => {
    beforeEach(() => {
        extension_settings.story_arc = {};
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('seed-state.txt')) return new Response('SEED for {{CHARACTER}}');
            throw new Error(`unexpected fetch ${url}`);
        };
        clearTemplateCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete extension_settings.story_arc;
        clearTemplateCache();
    });

    it('serves a saved edit on the next call, without clearing the cache', async () => {
        assert.equal(await loadTemplate('seed-state.txt'), 'SEED for {{CHARACTER}}');

        savePromptEdit('seed-state.txt', 'My seed for {{CHARACTER}}', 'SEED for {{CHARACTER}}');

        assert.equal(await loadTemplate('seed-state.txt'), 'My seed for {{CHARACTER}}');
    });

    it('serves the built-in text again after a reset', async () => {
        savePromptEdit('seed-state.txt', 'My seed for {{CHARACTER}}', 'SEED for {{CHARACTER}}');
        assert.equal(await loadTemplate('seed-state.txt'), 'My seed for {{CHARACTER}}');

        resetPromptEdit('seed-state.txt');

        assert.equal(await loadTemplate('seed-state.txt'), 'SEED for {{CHARACTER}}');
        assert.deepEqual(extension_settings.story_arc.promptOverrides, {});
    });

    it('never serves an edit stored under a name outside the allow-list', async () => {
        extension_settings.story_arc.promptOverrides = {
            'detail-pass.txt': { text: 'Smuggled prompt', builtInHash: 1 },
        };

        await assert.rejects(loadTemplate('detail-pass.txt'), /Invalid template: detail-pass\.txt/);
    });

    it('loadBuiltInTemplate gives the shipped text while an edit is stored', async () => {
        savePromptEdit('seed-state.txt', 'My seed for {{CHARACTER}}', 'SEED for {{CHARACTER}}');

        assert.equal(await loadBuiltInTemplate('seed-state.txt'), 'SEED for {{CHARACTER}}');
    });
});

/** Short built-in texts for all seven prompts, written out by hand. */
function builtInTexts() {
    return {
        'analyze-context.txt': 'Analyse {{CHAT_HISTORY}} with {{PERSONA}}',
        'ask-questions.txt': 'Ask about {{USER_DIRECTION}}',
        'generate-arc.txt': 'Plan {{TIER_BLOCK}} from {{USER_DIRECTION}}',
        'check-plan.txt': 'Check {{SECRETS}}',
        'extract-knowledge.txt': 'Read {{MESSAGES}} as {{PERSONA}}; claims {{CLAIMED_CLUES}}; again {{MESSAGES}}',
        'find-appearance.txt': 'Find {{CHARACTER}} in {{PASSAGES}}',
        'seed-state.txt': 'Seed {{CHARACTER}}',
    };
}

describe('describePrompts', () => {
    it('describes the seven prompts in catalog order, all built-in without edits', () => {
        const description = describePrompts(builtInTexts(), {});

        assert.deepEqual(description.prompts.map(prompt => [prompt.name, prompt.displayName, prompt.group, prompt.profile, prompt.state]), [
            ['analyze-context.txt', 'Story analysis', 'planning', 'generation profile', 'built-in'],
            ['ask-questions.txt', 'Questions for you', 'planning', 'generation profile', 'built-in'],
            ['generate-arc.txt', 'Arc outline', 'planning', 'generation profile', 'built-in'],
            ['check-plan.txt', 'Plan check', 'planning', 'generation profile', 'built-in'],
            ['extract-knowledge.txt', 'Knowledge update', 'tracker', 'tracker profile', 'built-in'],
            ['find-appearance.txt', 'Appearance search', 'tracker', 'tracker profile', 'built-in'],
            ['seed-state.txt', 'Standing state seed', 'tracker', 'tracker profile', 'built-in'],
        ]);
        assert.equal(description.editedCount, 0);
    });

    it('a built-in prompt sends its built-in text and lists its placeholders once, in order of first use', () => {
        const knowledgeUpdate = describePrompts(builtInTexts(), {}).prompts[4];

        assert.deepEqual(knowledgeUpdate, {
            name: 'extract-knowledge.txt',
            displayName: 'Knowledge update',
            group: 'tracker',
            runs: 'After every reply: who learned what, beats, clue claims',
            profile: 'tracker profile',
            state: 'built-in',
            text: 'Read {{MESSAGES}} as {{PERSONA}}; claims {{CLAIMED_CLUES}}; again {{MESSAGES}}',
            builtIn: 'Read {{MESSAGES}} as {{PERSONA}}; claims {{CLAIMED_CLUES}}; again {{MESSAGES}}',
            placeholders: ['MESSAGES', 'PERSONA', 'CLAIMED_CLUES'],
            missing: [],
            unknown: [],
        });
    });
});

describe('describePrompts with saved edits', () => {
    beforeEach(() => {
        extension_settings.story_arc = {};
    });

    afterEach(() => {
        delete extension_settings.story_arc;
    });

    it('an edit saved against the current built-in text is edited and sends the edit', () => {
        savePromptEdit('seed-state.txt', 'Seed {{CHARACTER}} briefly', 'Seed {{CHARACTER}}');

        const description = describePrompts(builtInTexts(), extension_settings.story_arc.promptOverrides);
        const seed = description.prompts[6];

        assert.equal(seed.state, 'edited');
        assert.equal(seed.text, 'Seed {{CHARACTER}} briefly');
        assert.equal(seed.builtIn, 'Seed {{CHARACTER}}');
        assert.equal(description.editedCount, 1);
    });

    it('an edit whose built-in text changed since is changed, until Keep mine; a further change makes it changed again', () => {
        savePromptEdit('check-plan.txt', 'Check {{SECRETS}} twice', 'Check {{SECRETS}} (old wording)');
        const texts = builtInTexts();

        assert.equal(describePrompts(texts, extension_settings.story_arc.promptOverrides).prompts[3].state, 'changed');

        keepPromptEdit('check-plan.txt', 'Check {{SECRETS}}');
        const kept = describePrompts(texts, extension_settings.story_arc.promptOverrides).prompts[3];
        assert.equal(kept.state, 'edited');
        assert.equal(kept.text, 'Check {{SECRETS}} twice');

        texts['check-plan.txt'] = 'Check {{SECRETS}} and {{TRIGGERS}}';
        assert.equal(describePrompts(texts, extension_settings.story_arc.promptOverrides).prompts[3].state, 'changed');
    });

    it('reports a removed placeholder as missing and an added one as unknown, by name', () => {
        savePromptEdit('extract-knowledge.txt', 'Read {{MESSAGES}} as {{PERSONA}} in {{SCENE}}', 'Read {{MESSAGES}} as {{PERSONA}}; claims {{CLAIMED_CLUES}}; again {{MESSAGES}}');

        const knowledgeUpdate = describePrompts(builtInTexts(), extension_settings.story_arc.promptOverrides).prompts[4];

        assert.deepEqual(knowledgeUpdate.placeholders, ['MESSAGES', 'PERSONA', 'CLAIMED_CLUES']);
        assert.deepEqual(knowledgeUpdate.missing, ['CLAIMED_CLUES']);
        assert.deepEqual(knowledgeUpdate.unknown, ['SCENE']);
    });

    it('editedCount counts edited and changed prompts, not built-in ones', () => {
        savePromptEdit('ask-questions.txt', 'Ask briefly about {{USER_DIRECTION}}', 'Ask about {{USER_DIRECTION}}');
        savePromptEdit('generate-arc.txt', 'Plan {{TIER_BLOCK}}', 'Plan the old way');
        savePromptEdit('find-appearance.txt', 'Look for {{CHARACTER}} in {{PASSAGES}}', 'Find {{CHARACTER}} in {{PASSAGES}}');

        const description = describePrompts(builtInTexts(), extension_settings.story_arc.promptOverrides);

        assert.deepEqual(description.prompts.map(prompt => prompt.state), ['built-in', 'edited', 'changed', 'built-in', 'built-in', 'edited', 'built-in']);
        assert.equal(description.editedCount, 3);
    });
});
