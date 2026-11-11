import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService, extensionPromptCalls } from '../tests/mocks/st-mocks.js';
import {
    buildKnowledgeBlock,
    buildKnowledgeExtractionVariables,
    dropKnowledgeFrom,
    injectKnowledgeBlock,
    updateKnowledgeAfterReply,
} from '../lib/knowledge/ledger.js';
import { fillTemplate } from '../lib/planning/generator.js';

/**
 * The character details switch (knowledgeTracker.characterDetails): while
 * it is off the narrator and the extraction see what they saw before
 * character details existed, though the ledger holds details.
 */

const TEMPLATE = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');
const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

const PLAIN_HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
    + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
    + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for.]';

/**
 * Kendra (present, knows a fact), Ama (dead, talked about, no fact) and
 * Kendra's unnamed father (talked about, knows a fact). With `withDetails`
 * they carry gender, age, role and status; the father's relation is his
 * record and stays either way, since it is his name.
 */
function makeLedger(withDetails) {
    const fatherRelation = [{ value: { kind: 'father', of: 'c1' }, at: null, by: 'record' }];
    const ledger = {
        characters: [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] },
            { id: 'c2', name: 'Ama Osei', aliases: ['Ama'] },
            { id: 'c3', name: '', aliases: [], details: { relation: fatherRelation } },
        ],
        facts: [
            {
                id: 'f1', text: 'Kendra skipped school on Friday', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 8 }],
            },
            {
                id: 'f2', text: 'The rent is two months late', public: false,
                holders: [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 7 }],
            },
        ],
        scene: { at: 10, present: ['c1'] },
        sceneHistory: [],
        lastUpdatedAt: 10,
    };
    if (withDetails) {
        ledger.characters[0].details = { gender: [{ value: 'female', at: 4 }], age: [{ value: '17', at: 4 }] };
        ledger.characters[1].details = { role: [{ value: 'cleaner', at: 5 }], status: [{ value: 'dead', at: 9 }] };
        ledger.characters[2].details = { relation: fatherRelation, role: [{ value: 'night porter', at: 6 }] };
    }
    return ledger;
}

/** The latest user message talks about Ama and Kendra's father. */
const MESSAGES = [{ is_user: true, is_system: false, name: 'Ellie', mes: "Ama and Kendra Osei's father come up." }];

/** Messages 11 and 12, each already carrying its Story Arc message id. */
function makeChat() {
    const chatMessages = [];
    chatMessages[11] = { name: 'Ellie', is_user: true, mes: 'What does your mom do?', extra: { story_arc_message_id: 'm11' } };
    chatMessages[12] = { name: 'Narrator', is_user: false, mes: 'Kendra shrugs. "She cleans offices."', extra: { story_arc_message_id: 'm12' } };
    return chatMessages;
}

function setSwitches({ tracker = true, characterDetails }) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: tracker, updateInterval: 1, characterDetails },
    };
}

describe('character details switch off — the knowledge block', () => {
    it('prints no details line, no "dead" and the plain header, the same block as for the ledger without details', () => {
        const expectedBlock = [
            PLAIN_HEADER,
            '',
            'KENDRA OSEI (present)',
            '- Knows: Kendra skipped school on Friday (known only to them)',
            '',
            "KENDRA OSEI'S FATHER (talked about, not present)",
            '- Knows: The rent is two months late (known only to them)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(makeLedger(true), MESSAGES, false), expectedBlock);
        assert.equal(buildKnowledgeBlock(makeLedger(false), MESSAGES, false), expectedBlock);
    });

    it('still prints the details while the switch is on', () => {
        const block = buildKnowledgeBlock(makeLedger(true), MESSAGES, true);

        assert.ok(block.includes('- Details: female; 17'), block);
        assert.ok(block.includes('AMA OSEI (dead, talked about, not present)'), block);
    });
});

describe('character details switch off — injectKnowledgeBlock reads the switch', () => {
    afterEach(() => {
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
        extensionPromptCalls.length = 0;
    });

    function injectedBlock(characterDetails) {
        setSwitches({ characterDetails });
        chat_metadata.story_arc = { knowledge: makeLedger(true) };
        chat.length = 0;
        chat.push(...MESSAGES);
        extensionPromptCalls.length = 0;
        injectKnowledgeBlock();
        return extensionPromptCalls[0][1];
    }

    it('injects no details while the switch is off, and for a settings file without the switch', () => {
        assert.ok(!injectedBlock(false).includes('Details'));
        assert.ok(!injectedBlock(undefined).includes('dead'));
    });

    it('injects the details while the switch is on', () => {
        assert.ok(injectedBlock(true).includes('- Details: female; 17'));
    });
});

describe('character details switch off — the extraction prompt', () => {
    function filledPrompt(ledger, withDetails) {
        const variables = buildKnowledgeExtractionVariables(ledger, makeChat(), 11, 'Ellie', [], [], [], withDetails);
        return fillTemplate(TEMPLATE, variables);
    }

    it('lists the characters without details, the unnamed relative by its display name without the unnamed mark', () => {
        const variables = buildKnowledgeExtractionVariables(makeLedger(true), makeChat(), 11, 'Ellie', [], [], [], false);

        assert.equal(variables.CHARACTERS, "- Kendra Osei (also: Kendra)\n- Ama Osei (also: Ama)\n- Kendra Osei's father");
    });

    it('has task 2 and the newCharacters schema as before character details, with no unnamed relative', () => {
        const prompt = filledPrompt(makeLedger(true), false);

        assert.ok(prompt.includes('Do not list a character the ledger already has under another name.\n\nNEW NAMES.'));
        assert.ok(prompt.includes('  "present": ["name"],\n  "newCharacters": [{ "name": "name", "aliases": ["other name"] }],\n  "newNames": ['));
        assert.ok(!prompt.includes('unnamed'));
        assert.ok(!prompt.includes('wasUnnamed'));
        assert.ok(!prompt.includes('kinship'));
    });

    it('asks for unnamed relatives while the switch is on', () => {
        const prompt = filledPrompt(makeLedger(true), true);

        assert.ok(prompt.includes("- Kendra Osei's father (unnamed) — role: night porter; relation: Kendra Osei's father\n"));
        assert.ok(prompt.includes('Do not list a character the ledger already has under another name.\n- A relative of a character in the ledger or in your new characters whom the messages do not name'));
        assert.ok(prompt.includes('and use the new name in the rest of your answer.\n\nNEW NAMES.'));
        assert.ok(prompt.includes('  "newCharacters": [\n    { "name": "name", "aliases": ["other name"] },\n    { "name": "", "aliases": [], "relation": "kinship word, only for an unnamed relative", "of": "name of the other character" },\n    { "name": "the name given on screen", "aliases": [], "wasUnnamed": "the name the characters list shows for an unnamed relative" }\n  ],\n  "newNames": ['));
    });

    it('is the same prompt as for the ledger without details', () => {
        assert.equal(filledPrompt(makeLedger(true), false), filledPrompt(makeLedger(false), false));
    });

    it('has the characters header, task 7 ending and answer end as before character details', () => {
        const prompt = filledPrompt(makeLedger(true), false);

        assert.ok(prompt.includes('== CHARACTERS IN THE LEDGER ==\nEach with the other names they go by.\n- Kendra Osei (also: Kendra)\n'));
        assert.ok(prompt.includes('New direction that contradicts nothing in the plans list is not a ruling either. When in doubt, leave it out.\n\nAnswer with ONLY this JSON object'));
        assert.ok(prompt.includes('"at": <index of the player\'s message> }\n  ]\n}\nWrite either "factId" or "text" in an item, not both. Empty lists are fine.'));
        assert.ok(!prompt.includes('DETAILS'));
        assert.ok(!prompt.includes('"details"'));
        assert.ok(!prompt.includes('details the ledger knows'));
    });

    it('asks for details while the switch is on', () => {
        const prompt = filledPrompt(makeLedger(true), true);

        assert.ok(prompt.includes('Each with the other names they go by, and after a dash the details the ledger knows about them.\n- Kendra Osei (also: Kendra) — gender: female; age: 17\n'));
        assert.ok(prompt.includes('When in doubt, leave it out.\n\n8. DETAILS. The characters list shows'));
        assert.ok(prompt.includes('Out-of-character lines set no detail.\n\nAnswer with ONLY this JSON object'));
        assert.ok(prompt.includes('"at": <index of the player\'s message> }\n  ],\n  "details": [\n    { "character": "name", "kind": "gender | age | role | relation | status", "value": "the detail as a string", "of": "name, only for a relation", "change": "only for a changed detail: the on-screen event", "at": <index of the message> }\n  ]\n}\nWrite either'));
    });
});

/** Task 8 as it was before appearance (lib/knowledge/ledger.js at d8bfb3f), with its blank line. */
const DETAILS_TASK_BEFORE_APPEARANCE = `8. DETAILS. The characters list shows the details the ledger knows about each character. For a character from the ledger, report a detail only when the ledger does not know that kind of detail for the character yet and the new messages state it, or when the new messages show it changing on screen: an event the text shows happening, such as a transfer, a new job, a death, or a dead character seen alive again. A new character from task 2 may carry details too. Write one item per detail:
- "character": the character's name from the ledger or from your new characters.
- "kind": "gender"; "age" (as exact or as vague as the text puts it: "18", "twenty-something"); "role" (the job or place in the world, plus where it puts them: "cleaner, double shifts, Oakland"); "relation" (kinship to another character in the ledger or in your new characters: "mother", "brother", "husband"); or "status" ("dead" when the text shows or states a death; "alive" only for a character the ledger lists as dead whom the text shows alive again, never for a character merely seen or mentioned).
- "value": the detail in a few words, always as a string. For a relation the kinship word only; for a status "alive" or "dead".
- "of": only for a relation, the name of the other character ("Kendra Osei" for Kendra Osei's mother).
- "change": only for a detail the ledger already knows, the on-screen event that changes it, in one short sentence ("Vera transfers to the Wards."). Leave it out for a detail the ledger does not know yet.
- "at": the index in square brackets of the message that states it, one of the new messages.
Record only what the text states. Never guess a detail from a name, a look, a trope or what would be likely. A detail the ledger already knows is not reported again unless the new messages show it changing. A different value merely stated, with no such event, is not a change: do not report it. The ledger's value stays, and the narrator stated it wrongly. Out-of-character lines set no detail.

`;

/** The details list of the answer as it was before appearance. */
const DETAILS_SCHEMA_BEFORE_APPEARANCE = `,
  "details": [
    { "character": "name", "kind": "gender | age | role | relation | status", "value": "the detail as a string", "of": "name, only for a relation", "change": "only for a changed detail: the on-screen event", "at": <index of the message> }
  ]`;

describe('appearance switch off — the extraction prompt', () => {
    /** Kendra with her details and an appearance; the new messages name her. */
    function makeLedgerWithAppearance() {
        const ledger = makeLedger(true);
        ledger.characters[0].details = {
            ...ledger.characters[0].details,
            hair: [{ value: 'tight braids', at: 4 }],
            eyes: [{ value: 'dark brown', at: 4 }],
        };
        return ledger;
    }

    function filledPrompt(ledger, withAppearance) {
        const variables = buildKnowledgeExtractionVariables(ledger, makeChat(), 11, 'Ellie', [], [], [], true, withAppearance);
        return fillTemplate(TEMPLATE, variables);
    }

    it('fills task 8 and the details schema byte for byte as before appearance', () => {
        const withoutArgument = buildKnowledgeExtractionVariables(makeLedgerWithAppearance(), makeChat(), 11, 'Ellie', [], [], [], true);
        const switchedOff = buildKnowledgeExtractionVariables(makeLedgerWithAppearance(), makeChat(), 11, 'Ellie', [], [], [], true, false);

        assert.equal(withoutArgument.DETAILS_TASK, DETAILS_TASK_BEFORE_APPEARANCE);
        assert.equal(withoutArgument.DETAILS_SCHEMA, DETAILS_SCHEMA_BEFORE_APPEARANCE);
        assert.equal(switchedOff.DETAILS_TASK, DETAILS_TASK_BEFORE_APPEARANCE);
        assert.equal(switchedOff.DETAILS_SCHEMA, DETAILS_SCHEMA_BEFORE_APPEARANCE);
    });

    it('lists the characters with their details only, though the ledger holds an appearance and the messages name her', () => {
        const variables = buildKnowledgeExtractionVariables(makeLedgerWithAppearance(), makeChat(), 11, 'Ellie', [], [], [], true, false);

        assert.equal(variables.CHARACTERS,
            "- Kendra Osei (also: Kendra) — gender: female; age: 17\n- Ama Osei (also: Ama) — role: cleaner; status: dead\n- Kendra Osei's father (unnamed) — role: night porter; relation: Kendra Osei's father");
    });

    it('is the same prompt as for the ledger without the appearance', () => {
        assert.equal(filledPrompt(makeLedgerWithAppearance(), false), filledPrompt(makeLedger(true), false));
    });

    it('leaves no appearance placeholder in the prompt, off or on', () => {
        assert.ok(!filledPrompt(makeLedgerWithAppearance(), false).includes('{{'));
        assert.ok(!filledPrompt(makeLedgerWithAppearance(), true).includes('{{'));
    });

    it('asks for the appearance kinds and lists Kendra\'s appearance while the switch is on', () => {
        const prompt = filledPrompt(makeLedgerWithAppearance(), true);

        assert.ok(prompt.includes('- Kendra Osei (also: Kendra) — gender: female; age: 17; hair: tight braids; eyes: dark brown\n'));
        assert.ok(prompt.includes('never for a character merely seen or mentioned). For appearance, the kind is also "ethnicity"'));
        assert.ok(prompt.includes('Out-of-character lines set no detail.\nAppearance is what lasts:'));
        assert.ok(prompt.includes('("Priya cuts her hair short.").\n\nAnswer with ONLY this JSON object'));
        assert.ok(prompt.includes('"kind": "gender | age | role | relation | status | ethnicity | skin | hair | eyes | build | features"'));
    });
});

describe('character details switch — the extraction answer', () => {
    /** Noor in the ledger, updated through message 0; the answer states her age. */
    function storeLedger() {
        chat_metadata.story_arc = {
            knowledge: {
                characters: [{ id: 'c1', name: 'Noor', aliases: [] }],
                facts: [],
                scene: { at: 0, present: ['c1'] },
                lastUpdatedAt: 0,
            },
        };
    }

    const ANSWER_NOOR_IS_THIRTY = JSON.stringify({
        present: ['Noor'], newCharacters: [], learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [],
        details: [{ character: 'Noor', kind: 'age', value: '30', at: 2 }],
    });

    const sentPrompts = [];
    let currentAnswer;

    beforeEach(() => {
        sentPrompts.length = 0;
        currentAnswer = ANSWER_NOOR_IS_THIRTY;
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('extract-knowledge.txt')) return new Response(TEMPLATE);
            throw new Error(`unexpected fetch ${url}`);
        };
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const text = currentAnswer;
            return () => (async function* () { yield { text }; })();
        };
        chat.length = 0;
        chat.push(
            { is_user: false, is_system: false, name: 'Noor', mes: 'Welcome to the bay.', extra: { story_arc_message_id: 'm0' } },
            { is_user: true, is_system: false, name: 'Ellie', mes: 'How old are you?', extra: { story_arc_message_id: 'm1' } },
            { is_user: false, is_system: false, name: 'Noor', mes: 'Thirty this spring.', extra: { story_arc_message_id: 'm2' } },
        );
        storeLedger();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('ignores the answer\'s details while the switch is off, and sends a prompt without the DETAILS task', async () => {
        setSwitches({ characterDetails: false });

        await updateKnowledgeAfterReply(2);

        assert.deepEqual(chat_metadata.story_arc.knowledge.characters, [{ id: 'c1', name: 'Noor', aliases: [] }]);
        assert.equal(sentPrompts.length, 1);
        assert.ok(!sentPrompts[0].includes('8. DETAILS.'));
    });

    /** An answer that adds Noor's unnamed mother and names her unnamed brother Kwame. */
    const ANSWER_WITH_RELATIVES = JSON.stringify({
        present: ['Noor'],
        newCharacters: [
            { name: '', aliases: [], relation: 'mother', of: 'Noor' },
            { name: 'Kwame', aliases: [], wasUnnamed: "Noor's brother" },
        ],
        learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [], details: [],
    });

    /** Noor's unnamed brother joins the stored ledger. */
    function addUnnamedBrother() {
        chat_metadata.story_arc.knowledge.characters.push(
            { id: 'c2', name: '', aliases: [], details: { relation: [{ value: { kind: 'brother', of: 'c1' }, at: null, by: 'record' }] } });
    }

    it('creates no unnamed relative and names none while the switch is off', async () => {
        setSwitches({ characterDetails: false });
        addUnnamedBrother();
        currentAnswer = ANSWER_WITH_RELATIVES;

        await updateKnowledgeAfterReply(2);

        assert.deepEqual(chat_metadata.story_arc.knowledge.characters, [
            { id: 'c1', name: 'Noor', aliases: [] },
            { id: 'c2', name: '', aliases: [], details: { relation: [{ value: { kind: 'brother', of: 'c1' }, at: null, by: 'record' }] } },
            { id: 'c3', name: 'Kwame', aliases: [] },
        ]);
    });

    it('creates and names unnamed relatives while the switch is on', async () => {
        setSwitches({ characterDetails: true });
        addUnnamedBrother();
        currentAnswer = ANSWER_WITH_RELATIVES;

        await updateKnowledgeAfterReply(2);

        assert.deepEqual(chat_metadata.story_arc.knowledge.characters, [
            { id: 'c1', name: 'Noor', aliases: [] },
            { id: 'c2', name: 'Kwame', aliases: [], details: { relation: [{ value: { kind: 'brother', of: 'c1' }, at: null, by: 'record' }] } },
            { id: 'c3', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }] } },
        ]);
    });

    it('records the answer\'s details while the switch is on', async () => {
        setSwitches({ characterDetails: true });

        await updateKnowledgeAfterReply(2);

        assert.deepEqual(chat_metadata.story_arc.knowledge.characters[0].details, { age: [{ value: '30', at: 2, messageId: 'm2' }] });
        assert.ok(sentPrompts[0].includes('8. DETAILS.'));
    });
});

describe('character details switch off — rollback', () => {
    afterEach(() => {
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
    });

    it('still drops the detail entries of a deleted message', () => {
        setSwitches({ characterDetails: false });
        const ledger = makeLedger(true);
        chat_metadata.story_arc = { knowledge: ledger };

        dropKnowledgeFrom(ledger, 6);

        assert.deepEqual(ledger.characters[0].details, { gender: [{ value: 'female', at: 4 }], age: [{ value: '17', at: 4 }] });
        assert.deepEqual(ledger.characters[1].details, { role: [{ value: 'cleaner', at: 5 }] });
        assert.deepEqual(ledger.characters[2].details, { relation: [{ value: { kind: 'father', of: 'c1' }, at: null, by: 'record' }] });
    });
});
