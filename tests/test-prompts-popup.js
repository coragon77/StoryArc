/**
 * The Prompts popup's session (#96): what the player's clicks and typing do
 * to the stored edits and to what the popup shows. Built-in texts are short
 * hand-written stand-ins served through fetch; the stored edits are the real
 * extension settings, as loadTemplate reads them.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, getStringHash, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { callLlm, clearTemplateCache, loadTemplate } from '../lib/planning/generator.js';
import {
    startPromptsSession, promptsViewOf, selectPrompt, switchPromptsMode, setPromptsReveal, typePromptDraft, runPromptAction,
    describeStoredPrompts,
} from '../lib/ui/prompts.js';

const BUILT_IN = {
    'analyze-context.txt': 'ANALYSE {{GENRE_BLOCK}}',
    'ask-questions.txt': 'ASK {{USER_DIRECTION}}',
    'generate-arc.txt': 'OUTLINE {{PHASE1_ANALYSIS}}',
    'check-plan.txt': 'CHECK {{SECRETS}}',
    'extract-knowledge.txt': 'EXTRACT {{MESSAGES}} claims {{CLAIMED_CLUES}}',
    'find-appearance.txt': 'FIND {{CHARACTER}}',
    'seed-state.txt': 'SEED {{CHARACTER}}',
};

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/** The stored edits, as the settings hold them. */
function storedEdits() {
    return extension_settings.story_arc.promptOverrides ?? {};
}

/** The selected prompt's description in the popup's view. */
function selectedPrompt(view) {
    return view.prompts.prompts.find(prompt => prompt.name === view.selectedName);
}

describe('the Prompts popup session', () => {
    beforeEach(() => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        globalThis.fetch = async (url) => new Response(BUILT_IN[String(url).split('/').pop()]);
        clearTemplateCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        clearTemplateCache();
    });

    it('opens on the first prompt, in the template, with Reveal off and the stored text as the draft', async () => {
        const view = promptsViewOf(await startPromptsSession());

        assert.equal(view.selectedName, 'analyze-context.txt');
        assert.equal(view.mode, 'template');
        assert.equal(view.revealed, false);
        assert.deepEqual(view.draft, { text: 'ANALYSE {{GENRE_BLOCK}}', missing: [], unknown: [] });
        assert.equal(view.prompts.editedCount, 0);
    });

    it('opens on a prompt whose built-in text changed since the edit, so the note is in view', async () => {
        extension_settings.story_arc.promptOverrides = {
            'seed-state.txt': { text: 'MY SEED {{CHARACTER}}', builtInHash: getStringHash('SEED the old way {{CHARACTER}}') },
        };

        const view = promptsViewOf(await startPromptsSession());

        assert.equal(view.selectedName, 'seed-state.txt');
        assert.equal(selectedPrompt(view).state, 'changed');
        assert.equal(view.draft.text, 'MY SEED {{CHARACTER}}');
    });

    it('Reveal is off again on the next open, after it was switched on', async () => {
        const first = await startPromptsSession();
        switchPromptsMode(first, 'sent');
        setPromptsReveal(first, true);
        assert.equal(promptsViewOf(first).revealed, true);

        const second = await startPromptsSession();

        assert.equal(promptsViewOf(second).revealed, false);
    });

    it('typing checks the draft against the built-in placeholders and stores nothing', async () => {
        const session = await startPromptsSession();
        selectPrompt(session, 'extract-knowledge.txt');

        typePromptDraft(session, 'EXTRACT {{MESSAGES}} in {{SCENE}}');

        assert.deepEqual(promptsViewOf(session).draft, { text: 'EXTRACT {{MESSAGES}} in {{SCENE}}', missing: ['CLAIMED_CLUES'], unknown: ['SCENE'] });
        assert.deepEqual(storedEdits(), {});
    });

    it('Save stores the draft, which loadTemplate sends from the next call on, and offers Undo', async () => {
        const session = await startPromptsSession();
        selectPrompt(session, 'ask-questions.txt');
        typePromptDraft(session, 'ASK BRIEFLY {{USER_DIRECTION}}');

        runPromptAction(session, 'save');

        assert.deepEqual(storedEdits()['ask-questions.txt'], { text: 'ASK BRIEFLY {{USER_DIRECTION}}', builtInHash: getStringHash('ASK {{USER_DIRECTION}}') });
        assert.equal(await loadTemplate('ask-questions.txt'), 'ASK BRIEFLY {{USER_DIRECTION}}');
        const view = promptsViewOf(session);
        assert.equal(selectedPrompt(view).state, 'edited');
        assert.equal(view.prompts.editedCount, 1);
        assert.deepEqual(view.message, { ok: true, text: 'Saved. It is sent from the next call on, in every chat.', undo: true });
    });

    it('Save with a missing placeholder is allowed and says it saved with the warning', async () => {
        const session = await startPromptsSession();
        selectPrompt(session, 'extract-knowledge.txt');
        typePromptDraft(session, 'EXTRACT {{MESSAGES}}');

        runPromptAction(session, 'save');

        assert.equal(storedEdits()['extract-knowledge.txt'].text, 'EXTRACT {{MESSAGES}}');
        assert.deepEqual(promptsViewOf(session).message, { ok: false, text: 'Saved with the warning above. It is sent from the next call on.', undo: true });
    });

    it('saving the built-in text word for word leaves no edit stored', async () => {
        extension_settings.story_arc.promptOverrides = {
            'find-appearance.txt': { text: 'LOOK FOR {{CHARACTER}}', builtInHash: getStringHash('FIND {{CHARACTER}}') },
        };
        const session = await startPromptsSession();
        selectPrompt(session, 'find-appearance.txt');
        typePromptDraft(session, 'FIND {{CHARACTER}}');

        runPromptAction(session, 'save');

        assert.deepEqual(storedEdits(), {});
        assert.equal(selectedPrompt(promptsViewOf(session)).state, 'built-in');
    });

    it('Undo after Save brings the earlier edit back, as it was stored', async () => {
        const oldHash = getStringHash('CHECK the old way {{SECRETS}}');
        extension_settings.story_arc.promptOverrides = { 'check-plan.txt': { text: 'MY CHECK {{SECRETS}}', builtInHash: oldHash } };
        const session = await startPromptsSession();
        selectPrompt(session, 'check-plan.txt');
        typePromptDraft(session, 'MY SECOND CHECK {{SECRETS}}');
        runPromptAction(session, 'save');

        runPromptAction(session, 'undo');

        assert.deepEqual(storedEdits()['check-plan.txt'], { text: 'MY CHECK {{SECRETS}}', builtInHash: oldHash });
        const view = promptsViewOf(session);
        assert.equal(view.draft.text, 'MY CHECK {{SECRETS}}');
        assert.equal(selectedPrompt(view).state, 'changed');
        assert.deepEqual(view.message, { ok: true, text: 'Undone.', undo: false });
    });

    it('Undo after the first Save of a prompt leaves it built-in again', async () => {
        const session = await startPromptsSession();
        selectPrompt(session, 'seed-state.txt');
        typePromptDraft(session, 'MY SEED {{CHARACTER}}');
        runPromptAction(session, 'save');

        runPromptAction(session, 'undo');

        assert.deepEqual(storedEdits(), {});
        assert.equal(promptsViewOf(session).draft.text, 'SEED {{CHARACTER}}');
    });

    it('Reset deletes the edit and shows the built-in text; Undo restores the edit', async () => {
        const hash = getStringHash('OUTLINE {{PHASE1_ANALYSIS}}');
        extension_settings.story_arc.promptOverrides = { 'generate-arc.txt': { text: 'MY OUTLINE {{PHASE1_ANALYSIS}}', builtInHash: hash } };
        const session = await startPromptsSession();
        selectPrompt(session, 'generate-arc.txt');

        runPromptAction(session, 'reset');

        assert.deepEqual(storedEdits(), {});
        assert.equal(await loadTemplate('generate-arc.txt'), 'OUTLINE {{PHASE1_ANALYSIS}}');
        let view = promptsViewOf(session);
        assert.equal(view.draft.text, 'OUTLINE {{PHASE1_ANALYSIS}}');
        assert.deepEqual(view.message, { ok: true, text: 'Reset to the built-in prompt.', undo: true });

        runPromptAction(session, 'undo');

        assert.deepEqual(storedEdits()['generate-arc.txt'], { text: 'MY OUTLINE {{PHASE1_ANALYSIS}}', builtInHash: hash });
        view = promptsViewOf(session);
        assert.equal(view.draft.text, 'MY OUTLINE {{PHASE1_ANALYSIS}}');
    });

    it('Reset from the built-in view returns to the template', async () => {
        extension_settings.story_arc.promptOverrides = {
            'seed-state.txt': { text: 'MY SEED {{CHARACTER}}', builtInHash: getStringHash('SEED the old way {{CHARACTER}}') },
        };
        const session = await startPromptsSession();
        runPromptAction(session, 'show-builtin');
        assert.equal(promptsViewOf(session).mode, 'builtin');

        runPromptAction(session, 'reset');

        assert.equal(promptsViewOf(session).mode, 'template');
    });

    it('Discard changes puts the stored text back in the draft and stores nothing', async () => {
        const session = await startPromptsSession();
        selectPrompt(session, 'find-appearance.txt');
        typePromptDraft(session, 'LOOK {{CHARACTER}}');

        runPromptAction(session, 'discard');

        assert.deepEqual(promptsViewOf(session).draft, { text: 'FIND {{CHARACTER}}', missing: [], unknown: [] });
        assert.deepEqual(storedEdits(), {});
    });

    it('Keep mine keeps the edit, clears the changed state and offers no Undo', async () => {
        extension_settings.story_arc.promptOverrides = {
            'seed-state.txt': { text: 'MY SEED {{CHARACTER}}', builtInHash: getStringHash('SEED the old way {{CHARACTER}}') },
        };
        const session = await startPromptsSession();
        runPromptAction(session, 'show-builtin');

        runPromptAction(session, 'keep');

        assert.deepEqual(storedEdits()['seed-state.txt'], { text: 'MY SEED {{CHARACTER}}', builtInHash: getStringHash('SEED {{CHARACTER}}') });
        const view = promptsViewOf(session);
        assert.equal(selectedPrompt(view).state, 'edited');
        assert.equal(view.mode, 'template');
        assert.deepEqual(view.message, { ok: true, text: 'Kept your edit. This note comes back only if the built-in prompt changes again.', undo: false });
    });

    it('Show built-in and Back to your edit switch the pane; another prompt opens in its template, hidden', async () => {
        const session = await startPromptsSession();
        runPromptAction(session, 'show-builtin');
        assert.equal(promptsViewOf(session).mode, 'builtin');
        runPromptAction(session, 'back');
        assert.equal(promptsViewOf(session).mode, 'template');

        runPromptAction(session, 'show-builtin');
        selectPrompt(session, 'check-plan.txt');
        assert.equal(promptsViewOf(session).mode, 'template');

        switchPromptsMode(session, 'sent');
        setPromptsReveal(session, true);
        selectPrompt(session, 'seed-state.txt');
        const view = promptsViewOf(session);
        assert.equal(view.mode, 'sent');
        assert.equal(view.revealed, false);
    });

    it('each prompt keeps its own unsaved draft while another is chosen', async () => {
        const session = await startPromptsSession();
        selectPrompt(session, 'ask-questions.txt');
        typePromptDraft(session, 'ASK ME {{USER_DIRECTION}}');
        selectPrompt(session, 'check-plan.txt');
        assert.equal(promptsViewOf(session).draft.text, 'CHECK {{SECRETS}}');

        selectPrompt(session, 'ask-questions.txt');

        assert.equal(promptsViewOf(session).draft.text, 'ASK ME {{USER_DIRECTION}}');
    });

    it('typing clears the message of the last Save', async () => {
        const session = await startPromptsSession();
        typePromptDraft(session, 'ANALYSE AGAIN {{GENRE_BLOCK}}');
        runPromptAction(session, 'save');

        typePromptDraft(session, 'ANALYSE ONCE MORE {{GENRE_BLOCK}}');

        assert.equal(promptsViewOf(session).message, null);
    });

    it('Last sent shows the record of the send, with its time and whether it came from the edit', async () => {
        ConnectionManagerRequestService.sendRequest = async () => () => (async function* () { yield { text: 'an answer' }; })();
        extension_settings.story_arc.promptOverrides = {
            'seed-state.txt': { text: 'MY SEED {{CHARACTER}}', builtInHash: getStringHash('SEED {{CHARACTER}}') },
        };
        const before = Date.now();
        await loadTemplate('seed-state.txt');
        await callLlm('MY SEED Noor', { template: 'seed-state.txt', purpose: 'the standing state of Noor' });

        const session = await startPromptsSession();
        selectPrompt(session, 'seed-state.txt');
        switchPromptsMode(session, 'sent');
        const { lastSent } = promptsViewOf(session);

        assert.equal(lastSent.text, 'MY SEED Noor');
        assert.equal(lastSent.purpose, 'the standing state of Noor');
        assert.equal(lastSent.length, 12);
        assert.equal(lastSent.edited, true);
        assert.ok(lastSent.at >= before && lastSent.at <= Date.now(), String(lastSent.at));
    });

    it('describeStoredPrompts counts the edits for the drawer from the stored settings', async () => {
        extension_settings.story_arc.promptOverrides = {
            'ask-questions.txt': { text: 'ASK ME {{USER_DIRECTION}}', builtInHash: getStringHash('ASK {{USER_DIRECTION}}') },
            'seed-state.txt': { text: 'MY SEED {{CHARACTER}}', builtInHash: getStringHash('SEED the old way {{CHARACTER}}') },
        };

        const promptsView = await describeStoredPrompts();

        assert.equal(promptsView.editedCount, 2);
        assert.deepEqual(promptsView.prompts.filter(prompt => prompt.state === 'changed').map(prompt => prompt.name), ['seed-state.txt']);
    });
});
