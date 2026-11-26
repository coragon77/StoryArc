/**
 * The last prompt Story Arc sent per template (#94): callLlm records it, in
 * memory for the session, and readLastSentPrompt reads it back. The
 * transport is the Connection Manager mock, as in the knowledge tests.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { callLlm, readLastSentPrompt, prepareArc, generateArc, clearTemplateCache } from '../lib/planning/generator.js';
import { updateKnowledgeAfterReply, updateKnowledgeAfterEdit } from '../lib/knowledge/ledger.js';
import { searchAppearance } from '../lib/knowledge/appearance-search.js';
import { seedStandingStateAfterUpdate } from '../lib/knowledge/state-seed.js';
import { savePromptEdit, resetPromptEdit } from '../lib/planning/prompt-edits.js';

const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/** Answer every call with `text`; return the prompts sent, in call order. */
function installTransport(text = 'an answer') {
    const sentPrompts = [];
    ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
        sentPrompts.push(messages[0].content);
        return () => (async function* () { yield { text }; })();
    };
    return sentPrompts;
}

describe('the last prompt sent per template', () => {
    afterEach(() => {
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
    });

    it('reads a call sent with a template back filled in, with its time, purpose and length', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        installTransport();
        const before = Date.now();

        await callLlm('Noor knows the latch code.', { template: 'seed-state.txt', purpose: 'the standing state of Noor' });

        const record = readLastSentPrompt('seed-state.txt');
        assert.equal(record.text, 'Noor knows the latch code.');
        assert.equal(record.purpose, 'the standing state of Noor');
        assert.equal(record.length, 26);
        assert.ok(record.sentAt >= before && record.sentAt <= Date.now(), String(record.sentAt));
    });

    it('a later call for the same template replaces the record; another template keeps its own', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        installTransport();

        await callLlm('first analysis', { template: 'analyze-context.txt', purpose: 'planning an arc' });
        await callLlm('the outline', { template: 'generate-arc.txt', purpose: 'planning an arc' });
        await callLlm('second analysis', { template: 'analyze-context.txt', purpose: 're-planning The Quiet Debt' });

        assert.equal(readLastSentPrompt('analyze-context.txt').text, 'second analysis');
        assert.equal(readLastSentPrompt('analyze-context.txt').purpose, 're-planning The Quiet Debt');
        assert.equal(readLastSentPrompt('generate-arc.txt').text, 'the outline');
    });

    it('a template never sent reads as none, and a call without a template records nothing', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        installTransport();

        await callLlm('no template here');

        assert.equal(readLastSentPrompt('check-plan.txt'), null);
        assert.equal(readLastSentPrompt('undefined'), null);
    });

    it('records the prompt even when the call fails, since it was sent', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        ConnectionManagerRequestService.sendRequest = async () => { throw new Error('Got response status 401: Unauthorized'); };

        await assert.rejects(callLlm('sent, then refused', { template: 'find-appearance.txt', purpose: 'the appearance search for Noor' }));

        assert.equal(readLastSentPrompt('find-appearance.txt').text, 'sent, then refused');
    });

    it('writes nothing to the extension settings or the chat metadata', async () => {
        extension_settings.story_arc = { enabled: true, defaultConnectionProfile: 'profile-1' };
        chat_metadata.story_arc = { version: 1, arcs: [] };
        const settingsBefore = JSON.stringify(extension_settings);
        const metadataBefore = JSON.stringify(chat_metadata);
        installTransport();

        await callLlm('a long filled prompt', { template: 'extract-knowledge.txt', purpose: 'the update after reply #83' });

        assert.equal(JSON.stringify(extension_settings), settingsBefore);
        assert.equal(JSON.stringify(chat_metadata), metadataBefore);
    });
});

// ─── Every caller that fills a template names it ───

describe('the planning calls leave their filled prompts as the last sent', () => {
    const originalFetch = globalThis.fetch;
    const MINIMAL_TEMPLATES = {
        'analyze-context.txt': 'ANALYSE {{GENRE_BLOCK}}',
        'ask-questions.txt': 'ASK {{USER_DIRECTION}}',
        'generate-arc.txt': 'OUTLINE {{PHASE1_ANALYSIS}}',
        'check-plan.txt': 'CHECK',
    };
    const context = {
        character: null,
        persona: { name: '', description: '' },
        lorebook: { constants: [], arcSummaries: [], recent: [] },
        chatHistory: [],
        existingArcs: [],
        cast: [],
    };
    const generatedPlan = JSON.stringify({
        title: 'The Quiet Debt',
        premise: 'A debt comes due.',
        beats: [{ id: 'favour', pressure: 'The favours keep coming.', intention: 'She has refused a favour.' }],
        secrets: [],
        triggers: [],
    });
    const planCheckAnswer = JSON.stringify({ revealed: [], rewrites: [], links: [] });

    /** A stored episode being re-planned. */
    function storedEpisode() {
        return {
            id: 'arc-1', title: 'The Quiet Debt', status: 'active', tier: 'episode', focus: 'spotlight',
            messageStart: 100, lastFulfilledAt: 130, direction: 'She pays.', premise: 'A debt comes due.',
            themes: [], tone: '', directives: [], antiPatterns: [], secrets: [], foreshadowing: [],
            beats: [{ id: 'summons', intention: 'She has received the summons.', status: 'active', unlockAfter: [] }],
            escalation: '', triggers: [], characters: [], estimatedLength: 14,
        };
    }

    /** Serve MINIMAL_TEMPLATES and answer each call with the next text. */
    function installBackend(answers) {
        globalThis.fetch = async (url) => new Response(MINIMAL_TEMPLATES[String(url).split('/').pop()]);
        ConnectionManagerRequestService.sendRequest = async () => {
            const text = answers.shift();
            return () => (async function* () { yield { text }; })();
        };
    }

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

    it('a new arc: the analysis, the questions, the outline and the plan check, each as planning an arc', async () => {
        installBackend(['She owes more than money.', '{ "questions": [] }', generatedPlan, planCheckAnswer]);

        const prepared = await prepareArc(context, 'A debt.');
        const result = await generateArc(context, 'A debt.', {}, { analysis: prepared.analysis });

        assert.equal(result.error, null);
        assert.equal(readLastSentPrompt('analyze-context.txt').text, 'ANALYSE ');
        assert.equal(readLastSentPrompt('ask-questions.txt').text, 'ASK A debt.');
        assert.equal(readLastSentPrompt('generate-arc.txt').text, 'OUTLINE She owes more than money.');
        assert.equal(readLastSentPrompt('check-plan.txt').text, 'CHECK');
        for (const template of ['analyze-context.txt', 'ask-questions.txt', 'generate-arc.txt', 'check-plan.txt']) {
            assert.equal(readLastSentPrompt(template).purpose, 'planning an arc', template);
        }
    });

    it('marks a prompt filled from the player\'s edit as from the edit, a built-in one as not', async () => {
        installBackend(['She owes more than money.', '{ "questions": [] }']);
        savePromptEdit('analyze-context.txt', 'MY ANALYSIS {{GENRE_BLOCK}}', 'ANALYSE {{GENRE_BLOCK}}');

        await prepareArc(context, 'A debt.');

        assert.equal(readLastSentPrompt('analyze-context.txt').text, 'MY ANALYSIS ');
        assert.equal(readLastSentPrompt('analyze-context.txt').usedEdit, true);
        assert.equal(readLastSentPrompt('ask-questions.txt').usedEdit, false);
    });

    it('keeps the from-the-edit mark as it was at the send when the edit is reset later', async () => {
        installBackend(['She owes more than money.', '{ "questions": [] }']);
        savePromptEdit('analyze-context.txt', 'MY ANALYSIS {{GENRE_BLOCK}}', 'ANALYSE {{GENRE_BLOCK}}');
        await prepareArc(context, 'A debt.');

        resetPromptEdit('analyze-context.txt');

        assert.equal(readLastSentPrompt('analyze-context.txt').usedEdit, true);
    });

    it('a re-plan: every planning call is re-planning the arc by its title', async () => {
        installBackend(['She owes more than money.', '{ "questions": [] }', 'Again she owes.', generatedPlan, planCheckAnswer]);
        const reviseArc = storedEpisode();

        await prepareArc({ ...context, existingArcs: [reviseArc] }, 'Tighten the screws.', {}, { reviseArc });
        const result = await generateArc({ ...context, existingArcs: [reviseArc] }, 'Tighten the screws.', {}, { reviseArc });

        assert.equal(result.error, null);
        assert.equal(readLastSentPrompt('generate-arc.txt').text, 'OUTLINE Again she owes.');
        for (const template of ['analyze-context.txt', 'ask-questions.txt', 'generate-arc.txt', 'check-plan.txt']) {
            assert.equal(readLastSentPrompt(template).purpose, 're-planning The Quiet Debt', template);
        }
    });
});

describe('the tracker calls leave their filled prompts as the last sent', () => {
    const originalFetch = globalThis.fetch;
    const TRACKER_TEMPLATES = {
        'extract-knowledge.txt': 'EXTRACT\n{{MESSAGES}}',
        'find-appearance.txt': 'FIND {{CHARACTER}}',
        'seed-state.txt': 'SEED {{CHARACTER}}',
    };

    /** Serve TRACKER_TEMPLATES and answer every call with `text`. */
    function installTracker(text) {
        clearTemplateCache();
        globalThis.fetch = async (url) => new Response(TRACKER_TEMPLATES[String(url).split('/').pop()]);
        ConnectionManagerRequestService.sendRequest = async () => () => (async function* () { yield { text }; })();
    }

    /** Ellie and Noor in a four-message chat, the ledger read up to message 1. */
    function storeChat(knowledgeTracker = {}) {
        extension_settings.story_arc = {
            enabled: true,
            defaultConnectionProfile: 'profile-1',
            knowledgeTracker: { enabled: true, updateInterval: 1, ...knowledgeTracker },
        };
        chat.length = 0;
        chat.push(
            { is_user: true, is_system: false, name: 'Ellie', mes: 'Hello.', extra: { story_arc_message_id: 'm0' } },
            { is_user: false, is_system: false, name: 'Noor', mes: 'Hi.', extra: { story_arc_message_id: 'm1' } },
            { is_user: true, is_system: false, name: 'Ellie', mes: 'Gabriel wants steel latches.', extra: { story_arc_message_id: 'm2' } },
            { is_user: false, is_system: false, name: 'Noor', mes: 'Steel it is.', extra: { story_arc_message_id: 'm3' } },
        );
        chat_metadata.story_arc = {
            version: 1,
            arcs: [],
            knowledge: {
                characters: [{ id: 'c1', name: 'Noor', aliases: [] }, { id: 'c2', name: 'Ellie', aliases: [] }],
                facts: [],
                scene: { at: 1, present: ['c1', 'c2'] },
                lastUpdatedAt: 1,
            },
        };
    }

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
        clearTemplateCache();
    });

    it('the update after a reply names the reply', async () => {
        storeChat();
        installTracker(JSON.stringify({ present: ['Noor', 'Ellie'], newCharacters: [], learned: [] }));

        await updateKnowledgeAfterReply(3);

        const record = readLastSentPrompt('extract-knowledge.txt');
        assert.ok(record.text.startsWith('EXTRACT\n'), record.text);
        assert.ok(record.text.includes('Steel it is.'), record.text);
        assert.equal(record.purpose, 'the update after reply #3');
    });

    it('the re-extraction of an edited message names the message', async () => {
        storeChat();
        installTracker(JSON.stringify({ present: ['Noor'], newCharacters: [], learned: [] }));

        await updateKnowledgeAfterEdit(1);

        const record = readLastSentPrompt('extract-knowledge.txt');
        assert.ok(record.text.includes('Hi.'), record.text);
        assert.ok(!record.text.includes('Steel it is.'), record.text);
        assert.equal(record.purpose, 're-reading message #1');
    });

    it('the appearance search names the character', async () => {
        storeChat({ characterDetails: true });
        installTracker(JSON.stringify({ appearance: [] }));
        const ledger = chat_metadata.story_arc.knowledge;
        const searchChat = [{ name: 'Narrator', is_user: false, is_system: false, mes: 'Noor had grey eyes and short black hair.' }];

        await searchAppearance(ledger, 'c1', searchChat, 'Ellie');

        const record = readLastSentPrompt('find-appearance.txt');
        assert.equal(record.text, 'FIND Noor');
        assert.equal(record.purpose, 'the appearance search for Noor');
        assert.equal(record.length, 9);
    });

    it('the standing state seed names the character', async () => {
        storeChat({ characterDetails: true, standingState: true });
        const knowledge = chat_metadata.story_arc.knowledge;
        for (let number = 1; number <= 40; number++) {
            knowledge.facts.push({ id: `f${number}`, text: `Noor fact ${number}.`, public: false, holders: [{ characterId: 'c1', how: 'witnessed', at: 1 }] });
        }
        installTracker(JSON.stringify({ style: 'curt', manner: '', stances: [] }));

        await seedStandingStateAfterUpdate();

        const record = readLastSentPrompt('seed-state.txt');
        assert.equal(record.text, 'SEED Noor');
        assert.equal(record.purpose, 'the standing state of Noor');
    });
});
