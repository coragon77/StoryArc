import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { applyExtractionAnswer, parseKnowledgeExtractionAnswer, buildKnowledgeExtractionVariables, updateKnowledgeAfterReply } from '../lib/knowledge/ledger.js';
import { fillTemplate } from '../lib/planning/generator.js';
import { printTakenNames, listCharactersWithNames } from '../lib/knowledge/names.js';

/** A ledger with Kendra Osei (codename unknown so far) and Mateo Reyes, updated through message 9. */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] },
            { id: 'c2', name: 'Mateo Reyes', aliases: ['Switchback'] },
        ],
        facts: [],
        scene: { at: 9, present: [] },
        lastUpdatedAt: 9,
    };
}

function answerWith(fields) {
    return { present: [], newCharacters: [], learned: [], ...fields };
}

describe('parseKnowledgeExtractionAnswer reads the newNames list', () => {
    const base = '"present": [], "newCharacters": [], "learned": []';

    it('reads a new name of a ledger character', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "newNames": [{ "character": "Kendra Osei", "name": "Anvil" }] }`);

        assert.deepEqual(answer.newNames, [{ character: 'Kendra Osei', name: 'Anvil' }]);
    });

    it('reads an answer without the list as one with no new names', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base} }`);

        assert.deepEqual(answer.newNames, []);
    });

    it('drops keys outside the item shape', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "newNames": [{ "character": "Kendra Osei", "name": "Anvil", "why": "she unmasks" }] }`);

        assert.deepEqual(answer.newNames, [{ character: 'Kendra Osei', name: 'Anvil' }]);
    });

    it('rejects the whole answer for a list that is not a list', () => {
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "newNames": "Anvil" }`), null);
    });

    it('rejects the whole answer for an item without a character or a name', () => {
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "newNames": [{ "name": "Anvil" }] }`), null);
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "newNames": [{ "character": "Kendra Osei" }] }`), null);
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "newNames": [{ "character": "Kendra Osei", "name": " " }] }`), null);
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "newNames": [{ "character": 3, "name": "Anvil" }] }`), null);
        assert.equal(parseKnowledgeExtractionAnswer(`{ ${base}, "newNames": ["Anvil"] }`), null);
    });
});

describe('applyExtractionAnswer adds a new name as an alias', () => {
    it('adds the name to the record the answer names, trimmed', () => {
        const ledger = makeLedger();
        const newNameCounts = {};

        const changed = applyExtractionAnswer(ledger, answerWith({ newNames: [{ character: 'Kendra Osei', name: ' Anvil ' }] }), 10, 11, undefined, {}, newNameCounts);

        assert.equal(changed, true);
        assert.deepEqual(ledger.characters[0], { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra', 'Anvil'] });
        assert.deepEqual(newNameCounts, { newNamesAdded: 1, newNamesRefused: 0, newNamesUnknown: 0 });
    });

    it('finds the record by an alias, ignoring case', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWith({ newNames: [{ character: 'switchback', name: 'Mat' }] }), 10, 11);

        assert.deepEqual(ledger.characters[1], { id: 'c2', name: 'Mateo Reyes', aliases: ['Switchback', 'Mat'] });
    });

    it('refuses a name another record has as its name or alias, ignoring case, and counts it', () => {
        const ledger = makeLedger();
        const newNameCounts = {};

        applyExtractionAnswer(ledger, answerWith({ newNames: [
            { character: 'Kendra Osei', name: 'SWITCHBACK' },
            { character: 'Kendra Osei', name: 'mateo reyes' },
        ] }), 10, 11, undefined, {}, newNameCounts);

        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] },
            { id: 'c2', name: 'Mateo Reyes', aliases: ['Switchback'] },
        ]);
        assert.deepEqual(newNameCounts, { newNamesAdded: 0, newNamesRefused: 2, newNamesUnknown: 0 });
    });

    it('changes nothing for a name the record has already', () => {
        const ledger = makeLedger();
        const newNameCounts = {};

        applyExtractionAnswer(ledger, answerWith({ newNames: [
            { character: 'Kendra Osei', name: 'kendra' },
            { character: 'Kendra', name: 'Kendra Osei' },
        ] }), 10, 11, undefined, {}, newNameCounts);

        assert.deepEqual(ledger.characters[0], { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'] });
        assert.deepEqual(newNameCounts, { newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0 });
    });

    it('ignores an item for a character the ledger does not have, and counts it', () => {
        const ledger = makeLedger();
        const newNameCounts = {};

        applyExtractionAnswer(ledger, answerWith({ newNames: [{ character: 'Vera Lin', name: 'Fletchette' }] }), 10, 11, undefined, {}, newNameCounts);

        assert.equal(ledger.characters.length, 2);
        assert.ok(ledger.characters.every(character => !character.aliases.includes('Fletchette')));
        assert.deepEqual(newNameCounts, { newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 1 });
    });

    it('does not create a new character the same answer lists under the new name', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWith({
            newCharacters: [{ name: 'Anvil', aliases: [] }],
            newNames: [{ character: 'Kendra Osei', name: 'Anvil' }],
        }), 10, 11);

        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra', 'Anvil'] },
            { id: 'c2', name: 'Mateo Reyes', aliases: ['Switchback'] },
        ]);
    });

    it('resolves the new name in the present list, a learned holder and a details item of the same answer', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWith({
            present: ['Anvil'],
            learned: [{ text: 'The vault code is 4471.', public: false, who: ['Anvil'], how: 'witnessed', toldBy: null, at: 11 }],
            details: [{ character: 'Anvil', kind: 'role', value: 'Ward, Brockton Bay', at: 11 }],
            newNames: [{ character: 'Kendra Osei', name: 'Anvil' }],
        }), 10, 11);

        assert.deepEqual(ledger.scene, { at: 11, present: ['c1'] });
        assert.deepEqual(ledger.facts, [
            { id: 'f1', text: 'The vault code is 4471.', public: false, holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 11 }] },
        ]);
        assert.deepEqual(ledger.characters[0].details, { role: [{ value: 'Ward, Brockton Bay', at: 11 }] });
    });

    it('adds a name only once when two items of one answer give it to two records', () => {
        const ledger = makeLedger();
        const newNameCounts = {};

        applyExtractionAnswer(ledger, answerWith({ newNames: [
            { character: 'Kendra Osei', name: 'Anvil' },
            { character: 'Mateo Reyes', name: 'anvil' },
        ] }), 10, 11, undefined, {}, newNameCounts);

        assert.deepEqual(ledger.characters[0].aliases, ['Kendra', 'Anvil']);
        assert.deepEqual(ledger.characters[1].aliases, ['Switchback']);
        assert.deepEqual(newNameCounts, { newNamesAdded: 1, newNamesRefused: 1, newNamesUnknown: 0 });
    });
});

describe('a new name is a name of the one character it was given to', () => {
    it('does not add a new character the answer lists under an alias the ledger has, as before new names', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWith({ newCharacters: [{ name: 'switchback', aliases: [] }] }), 10, 11);

        assert.equal(ledger.characters.length, 2);
    });

    it('is a taken name of that character for the narrator', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWith({ newNames: [{ character: 'Kendra Osei', name: 'Anvil' }] }), 10, 11);

        assert.deepEqual(printTakenNames(ledger), ['Anvil', 'Kendra', 'Mateo', 'Osei', 'Reyes', 'Switchback']);
    });

    it('flags a new character of the same answer who shares it, pointing at that character', () => {
        const ledger = makeLedger();

        applyExtractionAnswer(ledger, answerWith({
            newCharacters: [{ name: 'Anvil Dunn', aliases: [] }],
            newNames: [{ character: 'Kendra Osei', name: 'Anvil' }],
        }), 10, 11);

        assert.deepEqual(ledger.characters[2], { id: 'c3', name: 'Anvil Dunn', aliases: [], nameClash: { names: ['Anvil'], at: 11 } });
        assert.deepEqual(listCharactersWithNames(ledger, ['Anvil'], 'c3').map(character => character.id), ['c1']);
    });
});

describe('the extraction prompt asks for new names', () => {
    const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');
    const filledPrompt = withDetails => fillTemplate(template, buildKnowledgeExtractionVariables(makeLedger(), [], 0, 'Amy', [], [], [], withDetails));

    for (const withDetails of [true, false]) {
        it(`asks for the newNames list with character details ${withDetails ? 'on' : 'off'}`, () => {
            const prompt = filledPrompt(withDetails);

            assert.ok(prompt.includes('NEW NAMES.'));
            assert.ok(prompt.includes('Never as a guess'));
            assert.ok(prompt.includes('  "newNames": [\n    { "character": "name from the ledger", "name": "the new name" }\n  ],\n'));
        });
    }
});

describe('the update log counts the new names', () => {
    const originalSendRequest = ConnectionManagerRequestService.sendRequest;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        chat.length = 0;
        for (let index = 0; index <= 11; index++) {
            chat.push({ is_user: index % 2 === 1, is_system: false, name: index % 2 === 1 ? 'Amy' : 'Narrator', mes: `Message ${index}.`, extra: {} });
        }
        extension_settings.story_arc = {
            enabled: true,
            defaultConnectionProfile: 'profile-1',
            knowledgeTracker: { enabled: true, updateInterval: 1, characterDetails: true },
        };
        chat_metadata.story_arc = { knowledge: makeLedger() };
        const answerText = JSON.stringify({
            present: ['Anvil'], newCharacters: [], learned: [],
            newNames: [
                { character: 'Kendra Osei', name: 'Anvil' },
                { character: 'Kendra Osei', name: 'Switchback' },
                { character: 'Vera Lin', name: 'Fletchette' },
            ],
        });
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('extract-knowledge.txt')) return new Response('MESSAGES:\n{{MESSAGES}}');
            throw new Error(`unexpected fetch ${url}`);
        };
        ConnectionManagerRequestService.sendRequest = async () => () => (async function* () { yield { text: answerText }; })();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('records the names added, refused for another record and ignored for an unknown character', async () => {
        await updateKnowledgeAfterReply(11);

        const ledger = chat_metadata.story_arc.knowledge;
        assert.deepEqual(ledger.characters[0].aliases, ['Kendra', 'Anvil']);
        const record = ledger.updateLog.at(-1);
        assert.equal(record.kind, 'update');
        assert.deepEqual(
            { newNamesAdded: record.newNamesAdded, newNamesRefused: record.newNamesRefused, newNamesUnknown: record.newNamesUnknown },
            { newNamesAdded: 1, newNamesRefused: 1, newNamesUnknown: 1 },
        );
    });
});
