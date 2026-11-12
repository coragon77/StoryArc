import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, extensionPromptCalls } from '../tests/mocks/st-mocks.js';
let injectStoryArcPrompts;

before(async () => {
    // index.js registers its listeners in a jQuery ready callback and the
    // progress display looks for its container: neither exists here.
    globalThis.jQuery = () => {};
    globalThis.$ = () => ({ length: 0 });
    ({ injectStoryArcPrompts } = await import('../index.js'));
});

/** Set every Story Arc prompt, as before a generation, and return the calls for the knowledge and names keys. */
function injectKnowledgeCalls() {
    extensionPromptCalls.length = 0;
    injectStoryArcPrompts();
    return extensionPromptCalls.filter(call => call[0] === 'story_arc_knowledge' || call[0] === 'story_arc_names');
}

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

/** The taken-names block for Noor and Dougal. */
const EXPECTED_NAMES = [
    '[NAMES ALREADY IN THIS STORY — first names, surnames and codenames of characters who have appeared. '
        + 'A new character gets none of these names, as a first name, as a surname or as part of a double or hyphenated surname: adding a second surname does not make a taken name new. '
        + 'Only a relative of the character who has a name may share it, and only when the story says how they are related. '
        + 'Characters already in the story keep their names.]',
    'Dougal, Noor',
].join('\n');

describe('injectStoryArcPrompts — the knowledge and names keys', () => {
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

    it('sets the knowledge block and the taken names in-chat at depth 1 with the system role while the tracker is on', () => {
        setSwitches({ extension: true, tracker: true });

        assert.deepEqual(injectKnowledgeCalls(), [
            ['story_arc_knowledge', EXPECTED_BLOCK, IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', EXPECTED_NAMES, IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets both keys to an empty string while the tracker is off', () => {
        setSwitches({ extension: true, tracker: false });

        assert.deepEqual(injectKnowledgeCalls(), [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', '', IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets both keys to an empty string while the tracker is off, even when the ledger holds character details', () => {
        setSwitches({ extension: true, tracker: false });
        chat_metadata.story_arc.knowledge.characters[0].details = {
            role: [{ value: 'mechanic, the Annex workshop', at: 3 }],
            status: [{ value: 'dead', at: 3 }],
        };

        assert.deepEqual(injectKnowledgeCalls(), [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', '', IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets both keys to an empty string while Story Arc itself is off', () => {
        setSwitches({ extension: false, tracker: true });

        assert.deepEqual(injectKnowledgeCalls(), [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', '', IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets the knowledge key empty but keeps the taken names when the ledger has no fact to show', () => {
        setSwitches({ extension: true, tracker: true });
        chat_metadata.story_arc.knowledge.facts = [];

        assert.deepEqual(injectKnowledgeCalls(), [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', EXPECTED_NAMES, IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets the names key to an empty string when the ledger has no character', () => {
        setSwitches({ extension: true, tracker: true });
        chat_metadata.story_arc.knowledge.characters = [];
        chat_metadata.story_arc.knowledge.facts = [];
        chat_metadata.story_arc.knowledge.scene = { at: null, present: [] };

        assert.deepEqual(injectKnowledgeCalls(), [
            ['story_arc_knowledge', '', IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', '', IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });

    it('sets the same names text byte for byte when the scene and the facts changed in between', () => {
        setSwitches({ extension: true, tracker: true });
        const namesBefore = injectKnowledgeCalls().filter(call => call[0] === 'story_arc_names');
        const knowledge = chat_metadata.story_arc.knowledge;
        knowledge.scene = { at: 5, present: ['c2'] };
        knowledge.facts.push({
            id: 'f2', text: 'Dougal fixed the drone', public: true,
            holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 5 }],
        });

        const namesAfter = injectKnowledgeCalls().filter(call => call[0] === 'story_arc_names');

        assert.deepEqual([...namesBefore, ...namesAfter], [
            ['story_arc_names', EXPECTED_NAMES, IN_CHAT, 1, false, SYSTEM_ROLE],
            ['story_arc_names', EXPECTED_NAMES, IN_CHAT, 1, false, SYSTEM_ROLE],
        ]);
    });
});
