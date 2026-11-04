import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, extensionPromptCalls } from '../tests/mocks/st-mocks.js';
import { completeBeats } from '../lib/planning/beat-completion.js';

/** ST's extension_prompt_types.IN_CHAT and extension_prompt_roles.SYSTEM */
const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

const WHO_KNOWS_WHAT_HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
    + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
    + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for.]';

let injectStoryArcPrompts;
let onMessageDeleted;

before(async () => {
    // index.js registers its listeners in a jQuery ready callback and the
    // progress display looks for its container: neither exists here.
    globalThis.jQuery = () => {};
    globalThis.$ = () => ({ length: 0 });
    ({ injectStoryArcPrompts, onMessageDeleted } = await import('../index.js'));
});

/** The last value set under `key`, from the recorded setExtensionPrompt calls. */
function lastPromptSetUnder(key) {
    const calls = extensionPromptCalls.filter(call => call[0] === key);
    return calls[calls.length - 1];
}

/** Four messages; a regenerate deletes the last one, the reply at 3. */
function fillChat() {
    chat.length = 0;
    chat.push(
        { is_user: false, is_system: false, name: 'Noor', mes: 'The bay is quiet.' },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'I take off my mask in front of Noor.' },
        { is_user: false, is_system: false, name: 'Noor', mes: 'Noor stares at her.' },
        { is_user: false, is_system: false, name: 'Noor', mes: 'Dougal walks in and sees the mask.' },
    );
}

afterEach(() => {
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
    chat.length = 0;
    extensionPromptCalls.length = 0;
});

describe('onMessageDeleted — the prompts are set again after a regenerate deletes the old reply', () => {
    beforeEach(() => {
        extensionPromptCalls.length = 0;
        fillChat();
    });

    it('the knowledge block keeps what was learned before the deleted reply and drops what it taught', async () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, updateInterval: 1 } };
        chat_metadata.story_arc = {
            version: 1,
            arcs: [],
            settings: {},
            knowledge: {
                characters: [
                    { id: 'c1', name: 'Noor', aliases: [] },
                    { id: 'c2', name: 'Dougal', aliases: [] },
                ],
                facts: [
                    { id: 'f1', text: 'Ellie is Dice', public: false, holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }] },
                    { id: 'f2', text: 'Ellie wears a mask', public: false, holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 3 }] },
                ],
                scene: { at: 3, present: ['c1', 'c2'] },
                sceneHistory: [{ at: 1, present: ['c1'] }],
                lastUpdatedAt: 3,
            },
        };
        // GENERATION_STARTED builds the block while the old reply is still there.
        injectStoryArcPrompts();
        assert.deepEqual(lastPromptSetUnder('story_arc_knowledge'), ['story_arc_knowledge', [
            WHO_KNOWS_WHAT_HEADER,
            '',
            'NOOR (present)',
            '- Knows: Ellie is Dice (known only to them)',
            '',
            'DOUGAL (present)',
            '- Knows: Ellie wears a mask (known only to them)',
        ].join('\n'), IN_CHAT, 1, false, SYSTEM_ROLE]);

        // Then ST deletes the reply at 3 and fires MESSAGE_DELETED with the new length.
        chat.length = 3;
        await onMessageDeleted(3);

        assert.deepEqual(lastPromptSetUnder('story_arc_knowledge'), ['story_arc_knowledge', [
            WHO_KNOWS_WHAT_HEADER,
            '',
            'NOOR (present)',
            '- Knows: Ellie is Dice (known only to them)',
        ].join('\n'), IN_CHAT, 1, false, SYSTEM_ROLE]);
    });

    it('the beat check offers again the beat the deleted reply completed', async () => {
        // Tracker off: the narrator recognises beats through the BEAT CHECK.
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: false, updateInterval: 1 } };
        chat_metadata.story_arc = {
            version: 1,
            settings: { autoTrack: true },
            arcs: [{
                id: 'crane001-full-id', title: 'The Crane Drop', status: 'active', tier: 'act', focus: 'normal',
                messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
                beats: [
                    { id: 'brody_refuses', intention: 'Brody refuses an order from Julian in front of the crew', status: 'active', unlockAfter: [], optional: false },
                    { id: 'crane_moved', intention: 'The crane is moved at night', status: 'active', unlockAfter: [], optional: false },
                ],
            }],
        };
        const beatCheckLine = 'If the story has already brought this about — "Brody refuses an order from Julian in front of the crew" — output exactly: <!-- [ARC_SIGNAL:crane001:brody_refuses:COMPLETE] -->';
        await completeBeats([{ arcId: 'crane001', beatId: 'brody_refuses', at: 3 }], chat_metadata.story_arc.arcs);
        injectStoryArcPrompts();
        const staleSignals = lastPromptSetUnder('story_arc_signals');
        assert.equal(staleSignals[1].includes(beatCheckLine), false, staleSignals[1]);

        chat.length = 3;
        await onMessageDeleted(3);

        const rebuiltSignals = lastPromptSetUnder('story_arc_signals');
        assert.equal(rebuiltSignals[1].includes(beatCheckLine), true, rebuiltSignals[1]);
        assert.deepEqual(rebuiltSignals.slice(2), [IN_CHAT, 0, false, SYSTEM_ROLE]);
    });
});
