import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService, extensionPromptCalls } from '../tests/mocks/st-mocks.js';
import {
    applyExtractionAnswer,
    buildKnowledgeBlock,
    buildKnowledgeExtractionVariables,
    characterDetailTexts,
    dropKnowledgeFrom,
    parseKnowledgeExtractionAnswer,
    updateKnowledgeAfterReply,
} from '../lib/knowledge/ledger.js';
import { harvestContext } from '../lib/context/harvester.js';
import { listStoryArcPrompts } from '../lib/injection/narrator-prompts.js';

/** The knowledge block the next generation would get. */
function knowledgePromptText() {
    return listStoryArcPrompts().find(prompt => prompt.key === 'story_arc_knowledge').text;
}

/**
 * Appearance (design 2026-11-11, Part A): the six appearance kinds in the
 * extraction answer, the refinement rule of the apply, the extraction
 * input, the knowledge block's appearance line, and the planner, which
 * sees none.
 */

const TEMPLATE = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');
const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

const HEADER_WITH_DETAILS = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
    + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
    + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for. '
    + 'A character keeps the details listed for them; a detail changes only when the story shows it changing.]';

/** An extraction answer with nothing but the given details items. */
function answerWithDetails(details) {
    return { present: [], newCharacters: [], newNames: [], learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [], details };
}

describe('parseKnowledgeExtractionAnswer — appearance kinds', () => {
    it('reads an item of each appearance kind', () => {
        const answer = parseKnowledgeExtractionAnswer(JSON.stringify({
            present: [], newCharacters: [], learned: [],
            details: [
                { character: 'Priya', kind: 'ethnicity', value: 'Indian', at: 4 },
                { character: 'Priya', kind: 'skin', value: 'warm brown', at: 4 },
                { character: 'Priya', kind: 'hair', value: ' dark glossy curls ', at: 4 },
                { character: 'Priya', kind: 'eyes', value: 'warm brown', at: 5 },
                { character: 'Priya', kind: 'build', value: 'petite, five-two', at: 5 },
                { character: 'Priya', kind: 'features', value: 'freckles; scar over the left eyebrow', at: 5, change: 'Priya falls off her bike.' },
            ],
        }));

        assert.deepEqual(answer.details, [
            { character: 'Priya', kind: 'ethnicity', value: 'Indian', at: 4 },
            { character: 'Priya', kind: 'skin', value: 'warm brown', at: 4 },
            { character: 'Priya', kind: 'hair', value: 'dark glossy curls', at: 4 },
            { character: 'Priya', kind: 'eyes', value: 'warm brown', at: 5 },
            { character: 'Priya', kind: 'build', value: 'petite, five-two', at: 5 },
            { character: 'Priya', kind: 'features', value: 'freckles; scar over the left eyebrow', change: 'Priya falls off her bike.', at: 5 },
        ]);
    });

    it('still rejects the whole answer for an unknown kind', () => {
        const answer = parseKnowledgeExtractionAnswer(JSON.stringify({
            present: [], newCharacters: [], learned: [],
            details: [
                { character: 'Priya', kind: 'hair', value: 'dark', at: 4 },
                { character: 'Priya', kind: 'clothing', value: 'red hoodie', at: 4 },
            ],
        }));

        assert.equal(answer, null);
    });
});

describe('applyExtractionAnswer — appearance and refinement', () => {
    /** Priya with one stored entry of `kind`, at message 3. */
    function ledgerWithPriya(kind, value) {
        return {
            characters: [{ id: 'c1', name: 'Priya Mehta', aliases: ['Priya'], details: { [kind]: [{ value, at: 3 }] } }],
            facts: [],
            scene: { at: 3, present: [] },
            lastUpdatedAt: 3,
        };
    }

    function applyOne(ledger, item) {
        const detailCounts = {};
        applyExtractionAnswer(ledger, answerWithDetails([{ character: 'Priya', ...item }]), 4, 6, undefined, detailCounts);
        return detailCounts;
    }

    const REFINED_ONCE = { detailsSet: 0, detailsChanged: 0, detailsRefined: 1, restatementsIgnored: 0, detailsLocked: 0 };
    const IGNORED_ONCE = { detailsSet: 0, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 1, detailsLocked: 0 };

    it('"dark hair" → "dark glossy curls, about shoulder length" refines: the kind\'s own word is left out', () => {
        const ledger = ledgerWithPriya('hair', 'dark hair');

        const detailCounts = applyOne(ledger, { kind: 'hair', value: 'dark glossy curls, about shoulder length', at: 5 });

        assert.deepEqual(ledger.characters[0].details.hair, [
            { value: 'dark hair', at: 3 },
            { value: 'dark glossy curls, about shoulder length', at: 5 },
        ]);
        assert.deepEqual(detailCounts, REFINED_ONCE);
    });

    it('"dark hair" → "dark glossy curls, shoulder length hair" refines', () => {
        const ledger = ledgerWithPriya('hair', 'dark hair');

        const detailCounts = applyOne(ledger, { kind: 'hair', value: 'dark glossy curls, shoulder length hair', at: 5 });

        assert.deepEqual(ledger.characters[0].details.hair, [
            { value: 'dark hair', at: 3 },
            { value: 'dark glossy curls, shoulder length hair', at: 5 },
        ]);
        assert.deepEqual(detailCounts, REFINED_ONCE);
    });

    it('"freckles" → "freckles; tattoo on the wrist" refines', () => {
        const ledger = ledgerWithPriya('features', 'freckles');

        const detailCounts = applyOne(ledger, { kind: 'features', value: 'freckles; tattoo on the wrist', at: 6 });

        assert.deepEqual(ledger.characters[0].details.features, [
            { value: 'freckles', at: 3 },
            { value: 'freckles; tattoo on the wrist', at: 6 },
        ]);
        assert.deepEqual(detailCounts, REFINED_ONCE);
    });

    it('"five-two" → "petite, five-two" refines', () => {
        const ledger = ledgerWithPriya('build', 'five-two');

        const detailCounts = applyOne(ledger, { kind: 'build', value: 'petite, five-two', at: 4 });

        assert.deepEqual(ledger.characters[0].details.build, [
            { value: 'five-two', at: 3 },
            { value: 'petite, five-two', at: 4 },
        ]);
        assert.deepEqual(detailCounts, REFINED_ONCE);
    });

    it('"dark hair" → "black hair" is a restatement and is ignored', () => {
        const ledger = ledgerWithPriya('hair', 'dark hair');

        const detailCounts = applyOne(ledger, { kind: 'hair', value: 'black hair', at: 5 });

        assert.deepEqual(ledger.characters[0].details.hair, [{ value: 'dark hair', at: 3 }]);
        assert.deepEqual(detailCounts, IGNORED_ONCE);
    });

    it('"dark glossy curls" → "dark curls" is a restatement: a shorter text never refines', () => {
        const ledger = ledgerWithPriya('hair', 'dark glossy curls');

        const detailCounts = applyOne(ledger, { kind: 'hair', value: 'dark curls', at: 5 });

        assert.deepEqual(ledger.characters[0].details.hair, [{ value: 'dark glossy curls', at: 3 }]);
        assert.deepEqual(detailCounts, IGNORED_ONCE);
    });

    it('"freckles" → "no freckles" is a restatement: a negation keeps the old word and takes it back', () => {
        const ledger = ledgerWithPriya('features', 'freckles');

        const detailCounts = applyOne(ledger, { kind: 'features', value: 'no freckles', at: 5 });

        assert.deepEqual(ledger.characters[0].details.features, [{ value: 'freckles', at: 3 }]);
        assert.deepEqual(detailCounts, IGNORED_ONCE);
    });

    it('"long dark" → "dark, no longer long" is a restatement', () => {
        const ledger = ledgerWithPriya('hair', 'long dark');

        const detailCounts = applyOne(ledger, { kind: 'hair', value: 'dark, no longer long', at: 5 });

        assert.deepEqual(ledger.characters[0].details.hair, [{ value: 'long dark', at: 3 }]);
        assert.deepEqual(detailCounts, IGNORED_ONCE);
    });

    it('a negation the stored value already has does not block a refinement', () => {
        const ledger = ledgerWithPriya('features', 'no tattoos');

        const detailCounts = applyOne(ledger, { kind: 'features', value: 'no tattoos; freckles', at: 5 });

        assert.deepEqual(ledger.characters[0].details.features, [{ value: 'no tattoos', at: 3 }, { value: 'no tattoos; freckles', at: 5 }]);
        assert.deepEqual(detailCounts, REFINED_ONCE);
    });

    it('a different appearance value with `change` is a change, not a refinement', () => {
        const ledger = ledgerWithPriya('hair', 'dark');

        const detailCounts = applyOne(ledger, { kind: 'hair', value: 'dark pixie cut', change: 'Priya cuts her hair short.', at: 5 });

        assert.deepEqual(ledger.characters[0].details.hair, [{ value: 'dark', at: 3 }, { value: 'dark pixie cut', at: 5 }]);
        assert.deepEqual(detailCounts, { detailsSet: 0, detailsChanged: 1, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 0 });
    });

    it('sets an appearance kind the ledger does not know yet', () => {
        const ledger = ledgerWithPriya('hair', 'dark');

        const detailCounts = applyOne(ledger, { kind: 'eyes', value: 'warm brown', at: 5 });

        assert.deepEqual(ledger.characters[0].details, { hair: [{ value: 'dark', at: 3 }], eyes: [{ value: 'warm brown', at: 5 }] });
        assert.deepEqual(detailCounts, { detailsSet: 1, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 0 });
    });

    it('skips a locked appearance kind, even for a refinement', () => {
        const ledger = ledgerWithPriya('hair', 'dark');
        ledger.characters[0].details.hair.push({ value: 'dark', at: null, by: 'user' });

        const detailCounts = applyOne(ledger, { kind: 'hair', value: 'dark glossy curls', at: 5 });

        assert.deepEqual(ledger.characters[0].details.hair, [{ value: 'dark', at: 3 }, { value: 'dark', at: null, by: 'user' }]);
        assert.deepEqual(detailCounts, { detailsSet: 0, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 1 });
    });

    it('never refines a detail kind: "cleaner" → "cleaner, double shifts" stays a restatement', () => {
        const ledger = ledgerWithPriya('role', 'cleaner');

        const detailCounts = applyOne(ledger, { kind: 'role', value: 'cleaner, double shifts', at: 5 });

        assert.deepEqual(ledger.characters[0].details.role, [{ value: 'cleaner', at: 3 }]);
        assert.deepEqual(detailCounts, IGNORED_ONCE);
    });

    it('a rollback of the refining message brings the shorter value back', () => {
        const ledger = ledgerWithPriya('hair', 'dark');
        applyOne(ledger, { kind: 'hair', value: 'dark glossy curls', at: 5 });

        dropKnowledgeFrom(ledger, 5);

        assert.deepEqual(ledger.characters[0].details.hair, [{ value: 'dark', at: 3 }]);
    });
});

describe('buildKnowledgeExtractionVariables — appearance in the characters list', () => {
    /**
     * Priya with details and an appearance, Ellie with an appearance only,
     * Julian and Solomon Stern sharing the name word "Stern" (Julian has it
     * as an alias), Julian with an appearance.
     */
    function makeLedger() {
        return {
            characters: [
                {
                    id: 'c1', name: 'Priya Mehta', aliases: ['Priya'],
                    details: {
                        gender: [{ value: 'female', at: 1 }],
                        hair: [{ value: 'dark glossy curls', at: 1 }],
                        ethnicity: [{ value: 'Indian', at: 1 }],
                    },
                },
                { id: 'c2', name: 'Ellie Lin', aliases: ['Ellie'], details: { eyes: [{ value: 'green', at: 2 }] } },
                { id: 'c3', name: 'Julian Stern', aliases: ['Stern'], details: { build: [{ value: 'tall', at: 2 }] } },
                { id: 'c4', name: 'Solomon Stern', aliases: [] },
            ],
            facts: [],
            scene: { at: 2, present: [] },
            lastUpdatedAt: 2,
        };
    }

    function charactersList(messages, withAppearance) {
        const chatMessages = [];
        messages.forEach((message, offset) => {
            chatMessages[10 + offset] = { name: 'Narrator', is_user: false, is_system: false, ...message };
        });
        return buildKnowledgeExtractionVariables(makeLedger(), chatMessages, 10, 'Ellie', [], [], [], true, withAppearance).CHARACTERS;
    }

    it('adds the appearance, in kind order after the details, only for a character the new messages name', () => {
        const list = charactersList([{ mes: 'Priya tucks a curl behind her ear.' }], true);

        assert.equal(list, [
            '- Priya Mehta (also: Priya) — gender: female; ethnicity: Indian; hair: dark glossy curls',
            '- Ellie Lin (also: Ellie)',
            '- Julian Stern (also: Stern)',
            '- Solomon Stern',
        ].join('\n'));
    });

    it('gives none to a character named only inside a status block', () => {
        const list = charactersList([{ mes: 'The bell rings.\n<trk>Ellie: at home</trk>' }], true);

        assert.equal(list, [
            '- Priya Mehta (also: Priya) — gender: female',
            '- Ellie Lin (also: Ellie)',
            '- Julian Stern (also: Stern)',
            '- Solomon Stern',
        ].join('\n'));
    });

    it('gives none for a shared name word, which names nobody', () => {
        const list = charactersList([{ mes: 'Stern nods at the door.' }], true);

        assert.equal(list, [
            '- Priya Mehta (also: Priya) — gender: female',
            '- Ellie Lin (also: Ellie)',
            '- Julian Stern (also: Stern)',
            '- Solomon Stern',
        ].join('\n'));
    });

    it('gives none for a name in a hidden message', () => {
        const list = charactersList([{ mes: 'Ellie waves.', is_system: true }, { mes: 'The bell rings.' }], true);

        assert.equal(list, [
            '- Priya Mehta (also: Priya) — gender: female',
            '- Ellie Lin (also: Ellie)',
            '- Julian Stern (also: Stern)',
            '- Solomon Stern',
        ].join('\n'));
    });

    it('gives none while appearance is off', () => {
        const list = charactersList([{ mes: 'Priya and Ellie walk in with Julian Stern.' }], false);

        assert.equal(list, [
            '- Priya Mehta (also: Priya) — gender: female',
            '- Ellie Lin (also: Ellie)',
            '- Julian Stern (also: Stern)',
            '- Solomon Stern',
        ].join('\n'));
    });
});

describe('buildKnowledgeBlock — the appearance line', () => {
    /**
     * Priya present with details and a full appearance, Ellie present with
     * only an appearance, Vera talked about with an appearance and a fact.
     */
    function makeLedger() {
        return {
            characters: [
                {
                    id: 'c1', name: 'Priya Mehta', aliases: ['Priya'],
                    details: {
                        gender: [{ value: 'female', at: 1 }],
                        age: [{ value: '17', at: 1 }],
                        features: [{ value: 'freckles', at: 1 }],
                        build: [{ value: 'petite, five-two', at: 1 }],
                        eyes: [{ value: 'warm brown', at: 1 }],
                        hair: [{ value: 'dark', at: 1 }, { value: 'dark glossy curls, about shoulder length', at: 2 }],
                        skin: [{ value: 'warm brown', at: 1 }],
                        ethnicity: [{ value: 'Indian', at: 1 }],
                    },
                },
                { id: 'c2', name: 'Ellie Lin', aliases: ['Ellie'], details: { hair: [{ value: 'blonde', at: 2 }] } },
                { id: 'c3', name: 'Vera Lin', aliases: ['Vera'], details: { eyes: [{ value: 'grey', at: 2 }] } },
            ],
            facts: [{
                id: 'f1', text: 'Vera joined the Wards', public: false,
                holders: [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 2 }],
            }],
            scene: { at: 2, present: ['c1', 'c2'] },
            meetings: [{ at: 2, present: ['c1', 'c2'] }],
            lastUpdatedAt: 2,
        };
    }

    const MESSAGES = [{ is_user: true, is_system: false, name: 'Ellie', mes: 'Where is Vera tonight?' }];
    const HEADER_WITH_DETAILS_AND_MEETINGS = `${HEADER_WITH_DETAILS.slice(0, -1)} `
        + 'A character knows the face, looks and voice only of someone they have met: '
        + 'a name on their Has met line, or someone the story put in front of them on-screen. Hearing a name is not meeting.]';

    it('prints the present characters\' appearance in kind order, ethnicity unlabelled, and none for the talked-about one', () => {
        const block = buildKnowledgeBlock(makeLedger(), MESSAGES, true, true);

        assert.equal(block, [
            HEADER_WITH_DETAILS_AND_MEETINGS,
            '',
            'PRIYA MEHTA (present)',
            '- Details: female; 17',
            '- Appearance: Indian; skin warm brown; hair dark glossy curls, about shoulder length; eyes warm brown; build petite, five-two; features freckles',
            '- Has met: Ellie Lin',
            '',
            'ELLIE LIN (present)',
            '- Appearance: hair blonde',
            '- Has met: Priya Mehta',
            '',
            'VERA LIN (talked about, not present)',
            '- Knows: Vera joined the Wards (known only to them)',
        ].join('\n'));
    });

    it('gives a present character with only an appearance a section and the block the details sentence', () => {
        const ledger = {
            characters: [{ id: 'c2', name: 'Ellie Lin', aliases: ['Ellie'], details: { hair: [{ value: 'blonde', at: 2 }] } }],
            facts: [],
            scene: { at: 2, present: ['c2'] },
            lastUpdatedAt: 2,
        };

        assert.equal(buildKnowledgeBlock(ledger, MESSAGES, true, true), [
            HEADER_WITH_DETAILS,
            '',
            'ELLIE LIN (present)',
            '- Appearance: hair blonde',
        ].join('\n'));
    });

    it('prints the block byte for byte as before appearance while appearance is off, or details are', () => {
        const expectedWithoutAppearance = [
            HEADER_WITH_DETAILS_AND_MEETINGS,
            '',
            'PRIYA MEHTA (present)',
            '- Details: female; 17',
            '- Has met: Ellie Lin',
            '',
            'ELLIE LIN (present)',
            '- Has met: Priya Mehta',
            '',
            'VERA LIN (talked about, not present)',
            '- Knows: Vera joined the Wards (known only to them)',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(makeLedger(), MESSAGES, true, false), expectedWithoutAppearance);
        assert.equal(buildKnowledgeBlock(makeLedger(), MESSAGES, true), expectedWithoutAppearance);
        assert.ok(!buildKnowledgeBlock(makeLedger(), MESSAGES, false, true).includes('Appearance'));
    });
});

describe('the planner sees no appearance', () => {
    const ledger = {
        characters: [{
            id: 'c1', name: 'Priya Mehta', aliases: ['Priya'],
            details: {
                age: [{ value: '17', at: 1 }],
                hair: [{ value: 'dark glossy curls', at: 1 }],
                ethnicity: [{ value: 'Indian', at: 1 }],
            },
        }],
        facts: [],
        scene: { at: 1, present: [] },
        lastUpdatedAt: 1,
    };

    it('characterDetailTexts returns the detail kinds only', () => {
        assert.deepEqual(characterDetailTexts(ledger, ledger.characters[0]), { age: '17' });
    });

    it('the harvested cast carries no appearance kind while appearance is on', async () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, characterDetails: true, appearance: true } };
        chat_metadata.story_arc = { version: 1, arcs: [], settings: {}, pendingMarks: [], knowledge: ledger };
        try {
            const context = await harvestContext();
            assert.deepEqual(context.cast, [{ name: 'Priya Mehta', aliases: ['Priya'], details: { age: '17' } }]);
        } finally {
            delete chat_metadata.story_arc;
            delete extension_settings.story_arc;
        }
    });
});

describe('the appearance switch — the extraction answer and the block', () => {
    /** Noor in the ledger with dark hair, updated through message 0; the answer refines the hair. */
    function storeLedger() {
        chat_metadata.story_arc = {
            knowledge: {
                characters: [{ id: 'c1', name: 'Noor', aliases: [], details: { hair: [{ value: 'dark', at: 0, messageId: 'm0' }] } }],
                facts: [],
                scene: { at: 0, present: ['c1'] },
                lastUpdatedAt: 0,
            },
        };
    }

    const ANSWER_NOOR_HAIR_AND_AGE = JSON.stringify({
        present: ['Noor'], newCharacters: [], learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [],
        details: [
            { character: 'Noor', kind: 'hair', value: 'dark braids', at: 2 },
            { character: 'Noor', kind: 'age', value: '30', at: 2 },
        ],
    });

    const sentPrompts = [];

    function setSwitches(appearance) {
        extension_settings.story_arc = {
            enabled: true,
            defaultConnectionProfile: 'profile-1',
            knowledgeTracker: { enabled: true, updateInterval: 1, characterDetails: true, appearance },
        };
    }

    beforeEach(() => {
        sentPrompts.length = 0;
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('extract-knowledge.txt')) return new Response(TEMPLATE);
            throw new Error(`unexpected fetch ${url}`);
        };
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const text = ANSWER_NOOR_HAIR_AND_AGE;
            return () => (async function* () { yield { text }; })();
        };
        chat.length = 0;
        chat.push(
            { is_user: false, is_system: false, name: 'Noor', mes: 'Welcome to the bay.', extra: { story_arc_message_id: 'm0' } },
            { is_user: true, is_system: false, name: 'Ellie', mes: 'How old are you, Noor?', extra: { story_arc_message_id: 'm1' } },
            { is_user: false, is_system: false, name: 'Noor', mes: 'Thirty this spring. She tugs at her dark braids.', extra: { story_arc_message_id: 'm2' } },
        );
        storeLedger();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
        extensionPromptCalls.length = 0;
    });

    it('drops the appearance item without a count while the switch is off, and records the age', async () => {
        setSwitches(false);

        await updateKnowledgeAfterReply(2);

        const knowledge = chat_metadata.story_arc.knowledge;
        assert.deepEqual(knowledge.characters[0].details, {
            hair: [{ value: 'dark', at: 0, messageId: 'm0' }],
            age: [{ value: '30', at: 2, messageId: 'm2' }],
        });
        const record = knowledge.updateLog[0];
        assert.deepEqual(
            [record.detailsSet, record.detailsChanged, record.detailsRefined, record.restatementsIgnored, record.detailsLocked],
            [1, 0, 0, 0, 0]);
        assert.ok(!sentPrompts[0].includes('Appearance is what lasts'));
    });

    it('records a refinement and counts it in the update record while the switch is on', async () => {
        setSwitches(true);

        await updateKnowledgeAfterReply(2);

        const knowledge = chat_metadata.story_arc.knowledge;
        assert.deepEqual(knowledge.characters[0].details, {
            hair: [{ value: 'dark', at: 0, messageId: 'm0' }, { value: 'dark braids', at: 2, messageId: 'm2' }],
            age: [{ value: '30', at: 2, messageId: 'm2' }],
        });
        const record = knowledge.updateLog[0];
        assert.deepEqual(
            [record.detailsSet, record.detailsChanged, record.detailsRefined, record.restatementsIgnored, record.detailsLocked],
            [1, 0, 1, 0, 0]);
        assert.deepEqual(record.items.details, [
            { characterId: 'c1', kind: 'hair', messageId: 'm2' },
            { characterId: 'c1', kind: 'age', messageId: 'm2' },
        ]);
        assert.ok(sentPrompts[0].includes('- Noor — hair: dark\n'));
        assert.ok(sentPrompts[0].includes('Appearance is what lasts'));
    });

    it('injects the appearance line only while the switch is on', () => {
        chat_metadata.story_arc.knowledge.characters[0].details.gender = [{ value: 'female', at: 0 }];

        setSwitches(true);
        assert.equal(knowledgePromptText(), [HEADER_WITH_DETAILS, '', 'NOOR (present)', '- Details: female', '- Appearance: hair dark'].join('\n'));

        setSwitches(false);
        assert.equal(knowledgePromptText(), [HEADER_WITH_DETAILS, '', 'NOOR (present)', '- Details: female'].join('\n'));
    });
});
