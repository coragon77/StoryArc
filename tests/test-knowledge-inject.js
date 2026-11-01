import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, extensionPromptCalls } from '../tests/mocks/st-mocks.js';
import { injectKnowledgeBlock, rollBackKnowledgeFrom } from '../lib/knowledge/ledger.js';

/** ST's extension_prompt_types.IN_CHAT and extension_prompt_roles.SYSTEM */
const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

function setSwitches({ extension, tracker }) {
    extension_settings.story_arc = { enabled: extension, knowledgeTracker: { enabled: tracker, updateInterval: 1 } };
}

/** Noor in the scene, the only one knowing a fact; Dougal (also present) has no line. */
function storeLedger() {
    chat_metadata.story_arc = {
        knowledge: {
            characters: [
                { id: 'c1', name: 'Noor', aliases: [] },
                { id: 'c2', name: 'Dougal', aliases: [] },
            ],
            facts: [{
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 3 }],
            }],
            scene: { at: 3, present: ['c1', 'c2'] },
            lastUpdatedAt: 3,
        },
    };
}

const EXPECTED_BLOCK = [
    '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
        + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
        + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
        + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for.]',
    '',
    'NOOR (present)',
    '- Knows: Ellie is Dice (known only to them)',
].join('\n');

describe('injectKnowledgeBlock', () => {
    beforeEach(() => {
        extensionPromptCalls.length = 0;
        chat.length = 0;
        chat.push({ is_user: true, is_system: false, name: 'Ellie', mes: 'I wave at Noor.' });
        storeLedger();
    });

    afterEach(() => {
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('sets the block in-chat at depth 1 with the system role while the tracker is on', () => {
        setSwitches({ extension: true, tracker: true });

        injectKnowledgeBlock();

        assert.deepEqual(extensionPromptCalls, [
            ['story_arc_knowledge', EXPECTED_BLOCK, IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets the key to an empty string while the tracker is off', () => {
        setSwitches({ extension: true, tracker: false });

        injectKnowledgeBlock();

        assert.deepEqual(extensionPromptCalls, [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets the key to an empty string while Story Arc itself is off', () => {
        setSwitches({ extension: false, tracker: true });

        injectKnowledgeBlock();

        assert.deepEqual(extensionPromptCalls, [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('builds the block again after a rollback, so a regenerated reply does not see what the replaced reply taught', async () => {
        // ST fires GENERATION_STARTED (where the block is first built) before a
        // regenerate deletes the old reply; the rollback runs after it, but
        // before ST assembles the prompt (Paragon 2283, 2026-11-01).
        setSwitches({ extension: true, tracker: true });
        chat.length = 0;
        chat.push(
            { is_user: false, is_system: false, name: 'Noor', mes: 'The bay is quiet.' },
            { is_user: true, is_system: false, name: 'Ellie', mes: 'I wave at Noor.' },
            { is_user: false, is_system: false, name: 'Noor', mes: 'Noor waves back.' },
        );

        await rollBackKnowledgeFrom(3);

        assert.deepEqual(extensionPromptCalls, [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets the key to an empty string when the ledger has nothing to show', () => {
        setSwitches({ extension: true, tracker: true });
        chat_metadata.story_arc.knowledge.facts = [];

        injectKnowledgeBlock();

        assert.deepEqual(extensionPromptCalls, [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });
});
