import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, extensionPromptCalls } from '../tests/mocks/st-mocks.js';
import { noteGenerationType, dropLastSentPastEnd } from '../lib/injection/narrator-prompts.js';

/** ST's extension_prompt_types and extension_prompt_roles.SYSTEM */
const IN_PROMPT = 0;
const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

let injectStoryArcPrompts;
let onChatCompletionPromptReady;
let onMessageDeleted;

before(async () => {
    // index.js registers its listeners in a jQuery ready callback and the
    // progress display looks for its container: neither exists here.
    globalThis.jQuery = () => {};
    globalThis.$ = () => ({ length: 0 });
    ({ injectStoryArcPrompts, onChatCompletionPromptReady, onMessageDeleted } = await import('../index.js'));
});

/** One active episode, its current beat a pressure; Noor in the scene with one fact. */
function storeChatState({ extension = true, tracker = true } = {}) {
    extension_settings.story_arc = { enabled: extension, knowledgeTracker: { enabled: tracker, updateInterval: 1 } };
    chat_metadata.story_arc = {
        version: 1,
        settings: { autoTrack: true, injectionBudget: 3000 },
        arcs: [{
            id: 'crane001-full-id', title: 'The Crane Drop', status: 'active', tier: 'episode', focus: 'normal',
            premise: 'A crane crew on strike blocks the harbour.',
            messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
            beats: [
                { id: 'strike', intention: 'The crew walks off the site', pressure: 'The crane crew wants overtime pay', status: 'active', unlockAfter: [], optional: false },
            ],
        }],
        knowledge: {
            characters: [{ id: 'c1', name: 'Noor', aliases: [] }],
            facts: [{ id: 'f1', text: 'Ellie is Dice', public: false, holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 0 }] }],
            scene: { at: 0, present: ['c1'] },
            lastUpdatedAt: 0,
        },
    };
    chat.length = 0;
    chat.push(
        { is_user: false, is_system: false, name: 'Noor', mes: 'The harbour is quiet.' },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'I walk up to the crane.' },
    );
}

/** The request as chat completion assembles it from what was set: plan in the main prompt, the in-chat parts around the newest message. */
function outgoingRequest() {
    const valueOf = key => extensionPromptCalls.filter(call => call[0] === key).at(-1)[1];
    return [
        { role: 'system', content: `You are the narrator.\n${valueOf('story_arc_plan')}` },
        { role: 'assistant', content: chat[0].mes },
        { role: 'system', content: `${valueOf('story_arc_knowledge')}\n${valueOf('story_arc_names')}` },
        { role: 'user', content: chat[1].mes },
        { role: 'system', content: valueOf('story_arc_signals') },
    ];
}

afterEach(() => {
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
    chat.length = 0;
    extensionPromptCalls.length = 0;
});

describe('injectStoryArcPrompts — every key, where SillyTavern puts it', () => {
    it('sets the plan in the prompt, knowledge and names in chat at depth 1, the signals at depth 0', () => {
        storeChatState();

        injectStoryArcPrompts();

        assert.deepEqual(extensionPromptCalls.map(([key, , position, depth, scan, role]) => [key, position, depth, scan, role]), [
            ['story_arc_plan', IN_PROMPT, 0, false, SYSTEM_ROLE],
            ['story_arc_knowledge', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_signals', IN_CHAT, 0, false, SYSTEM_ROLE],
        ]);
        const [plan, knowledge, names, signals] = extensionPromptCalls.map(call => call[1]);
        assert.ok(plan.startsWith('[STORY ARC - NARRATIVE DIRECTION]'), plan);
        assert.ok(plan.includes('=== FOREGROUNDED: "The Crane Drop" ===\n'), plan);
        assert.ok(plan.includes('CURRENT PRESSURE:\nThe crane crew wants overtime pay\n'), plan);
        assert.ok(plan.endsWith('[END STORY ARC]'), plan);
        assert.ok(knowledge.includes('NOOR (present)\n- Knows: Ellie is Dice (known only to them)'), knowledge);
        assert.ok(names.endsWith('\nNoor'), names);
        assert.ok(signals.includes('CONTINUATION: Continue the story from the end of the most recent'), signals);
    });

    it('sets every key to an empty string while Story Arc is off', () => {
        storeChatState({ extension: false });

        injectStoryArcPrompts();

        assert.deepEqual(extensionPromptCalls, [
            ['story_arc_plan', '', IN_PROMPT, 0, false, SYSTEM_ROLE],
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', '', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_signals', '', IN_CHAT, 0, false, SYSTEM_ROLE],
        ]);
    });

    it('sets the knowledge and names keys empty while only the tracker is off', () => {
        storeChatState({ tracker: false });

        injectStoryArcPrompts();

        const texts = Object.fromEntries(extensionPromptCalls.map(call => [call[0], call[1]]));
        assert.equal(texts.story_arc_knowledge, '');
        assert.equal(texts.story_arc_names, '');
        assert.notEqual(texts.story_arc_plan, '');
        assert.notEqual(texts.story_arc_signals, '');
    });
});

describe('the record of the last send', () => {
    beforeEach(() => {
        storeChatState();
        noteGenerationType('normal', false);
        injectStoryArcPrompts();
    });

    it('keeps the texts as set, where they sat, the stamp and the reply it belongs to', () => {
        onChatCompletionPromptReady({ chat: outgoingRequest(), dryRun: false });

        const lastSent = chat_metadata.story_arc.lastSent;
        assert.equal(lastSent.replyIndex, 2);
        assert.equal(lastSent.newestMessageIndex, 1);
        assert.equal(lastSent.type, 'normal');
        assert.equal(lastSent.stamp, '[Arc: message 2 of ~60]');
        assert.deepEqual(lastSent.parts.map(({ key, position, depth }) => [key, position, depth]), [
            ['story_arc_plan', IN_PROMPT, 0],
            ['story_arc_knowledge', IN_CHAT, 1],
            ['story_arc_names', IN_CHAT, 1],
            ['story_arc_signals', IN_CHAT, 0],
        ]);
        assert.ok(lastSent.parts[0].text.includes('The crane crew wants overtime pay'));
        assert.ok(lastSent.parts[1].text.includes('Ellie is Dice'));
    });

    it('belongs to the newest message for a swipe and a continue; a swipe\'s request reads up to the message before', () => {
        noteGenerationType('swipe', false);
        onChatCompletionPromptReady({ chat: outgoingRequest(), dryRun: false });
        assert.equal(chat_metadata.story_arc.lastSent.replyIndex, 1);
        assert.equal(chat_metadata.story_arc.lastSent.newestMessageIndex, 0);

        noteGenerationType('continue', false);
        onChatCompletionPromptReady({ chat: outgoingRequest(), dryRun: false });
        assert.equal(chat_metadata.story_arc.lastSent.replyIndex, 1);
        assert.equal(chat_metadata.story_arc.lastSent.newestMessageIndex, 1);
    });

    it('a dry run notes no type: the swipe before it still counts', () => {
        noteGenerationType('swipe', false);
        noteGenerationType('normal', true);
        onChatCompletionPromptReady({ chat: outgoingRequest(), dryRun: false });
        assert.equal(chat_metadata.story_arc.lastSent.type, 'swipe');
    });

    it('keeps nothing for a dry run, a quiet generation or a request without Story Arc text', () => {
        onChatCompletionPromptReady({ chat: outgoingRequest(), dryRun: true });
        assert.equal(chat_metadata.story_arc.lastSent, undefined);

        noteGenerationType('quiet', false);
        onChatCompletionPromptReady({ chat: outgoingRequest(), dryRun: false });
        assert.equal(chat_metadata.story_arc.lastSent, undefined);

        noteGenerationType('normal', false);
        onChatCompletionPromptReady({ chat: [{ role: 'user', content: 'Summarize the scene in one line.' }], dryRun: false });
        assert.equal(chat_metadata.story_arc.lastSent, undefined);
    });

    it('keeps a request that carries only the knowledge block, without a stamp', () => {
        chat_metadata.story_arc.arcs = [];
        injectStoryArcPrompts();

        onChatCompletionPromptReady({ chat: outgoingRequest(), dryRun: false });

        const lastSent = chat_metadata.story_arc.lastSent;
        assert.equal(lastSent.stamp, null);
        assert.equal(lastSent.parts[0].text, '');
        assert.ok(lastSent.parts[1].text.includes('Ellie is Dice'));
    });

    it('is not taken when a deletion sets the prompts again', async () => {
        await onMessageDeleted(1);
        assert.equal(chat_metadata.story_arc.lastSent, undefined);
    });

    it('is dropped on a branch that ends before its reply, kept up to the chat end', () => {
        chat_metadata.story_arc.lastSent = { replyIndex: 5, parts: [] };
        assert.equal(dropLastSentPastEnd(5), false);
        assert.ok(chat_metadata.story_arc.lastSent);

        assert.equal(dropLastSentPastEnd(4), true);
        assert.equal(chat_metadata.story_arc.lastSent, undefined);
    });
});
