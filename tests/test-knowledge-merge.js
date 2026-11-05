import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chat_metadata, chat } from '../tests/mocks/st-mocks.js';
import { buildKnowledgeContent, mergeCharacters } from '../lib/ui/knowledge-popup.js';
import { applyExtractionAnswer, dropKnowledgeFrom, rollBackKnowledgeFrom } from '../lib/knowledge/ledger.js';
import { buildTakenNamesBlock, listCharactersWithNames } from '../lib/knowledge/names.js';

/** Kendra Osei (c5) and her codename Anvil (c28) as two records, and Noor (c1). */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Noor al-Jamil', aliases: ['Noor'] },
            { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra'] },
            { id: 'c28', name: 'Anvil', aliases: ['The Anvil'] },
        ],
        facts: [],
        scene: { at: 40, present: ['c1'] },
        sceneHistory: [],
        lastUpdatedAt: 40,
    };
}

/** makeLedger with the characters replaced or added by id. */
function ledgerWithCharacters(...changedCharacters) {
    const ledger = makeLedger();
    for (const changedCharacter of changedCharacters) {
        const index = ledger.characters.findIndex(character => character.id === changedCharacter.id);
        if (index === -1) {
            ledger.characters.push(changedCharacter);
        } else {
            ledger.characters[index] = changedCharacter;
        }
    }
    return ledger;
}

/** makeLedger with the given facts. */
function ledgerWithFacts(facts) {
    return { ...makeLedger(), facts };
}

describe('mergeCharacters — names', () => {
    it('makes the other record\'s name and aliases aliases of the main record and removes the other', () => {
        const { ledger, error } = mergeCharacters(makeLedger(), 'c5', 'c28');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Noor al-Jamil', aliases: ['Noor'] },
            { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra', 'Anvil', 'The Anvil'] },
        ]);
    });

    it('drops an alias the main record already has or goes by, ignoring case', () => {
        const before = ledgerWithCharacters({ id: 'c28', name: 'Anvil', aliases: ['kendra', 'KENDRA OSEI'] });

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.characters[1], { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra', 'Anvil'] });
    });

    it('refuses a merge that would give the main record a name a third record has, ignoring case', () => {
        const before = ledgerWithCharacters({ id: 'c28', name: 'Anvil', aliases: ['noor'] });

        const { ledger, error } = mergeCharacters(before, 'c5', 'c28');

        assert.equal(ledger, null);
        assert.equal(error, '"noor" is already a name of Noor al-Jamil.');
    });

    it('gives an unnamed main record the other record\'s name', () => {
        const mother = { id: 'c40', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }] } };
        const hala = { id: 'c41', name: 'Hala', aliases: ['Mrs. al-Jamil'] };

        const { ledger, error } = mergeCharacters(ledgerWithCharacters(mother, hala), 'c40', 'c41');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[3], {
            id: 'c40', name: 'Hala', aliases: ['Mrs. al-Jamil'],
            details: { relation: [{ value: { kind: 'mother', of: 'c1' }, at: null, by: 'record' }] },
        });
        assert.equal(ledger.characters.length, 4);
    });

    it('refuses a merge that leaves an unnamed record with neither a name nor a relation', () => {
        const mother = { id: 'c40', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c41' }, at: null, by: 'record' }] } };
        const daughter = { id: 'c41', name: '', aliases: [], details: { relation: [{ value: { kind: 'daughter', of: 'c40' }, at: null, by: 'record' }] } };

        const { ledger, error } = mergeCharacters(ledgerWithCharacters(mother, daughter), 'c40', 'c41');

        assert.equal(ledger, null);
        assert.equal(error, 'An unnamed relative needs a relation. Give them a name first.');
    });

    it('refuses to merge a record into itself', () => {
        const { ledger, error } = mergeCharacters(makeLedger(), 'c5', 'c5');
        assert.equal(ledger, null);
        assert.equal(error, 'A character cannot be merged into themselves.');
    });

    it('refuses a record that is no longer in the ledger', () => {
        const { ledger, error } = mergeCharacters(makeLedger(), 'c5', 'c99');
        assert.equal(ledger, null);
        assert.equal(error, 'This character is no longer in the ledger.');
    });

    it('leaves the ledger it was given untouched', () => {
        const before = {
            ...makeLedger(),
            facts: [{ id: 'f1', text: 'Anvil lifts the truck', public: false, holders: [{ characterId: 'c28', how: 'witnessed', toldBy: null, at: 12 }] }],
            scene: { at: 40, present: ['c28'] },
            sceneHistory: [{ at: 30, present: ['c28'] }],
            retractedFacts: [{ at: 25, fact: { id: 'f9', text: 'Anvil is a man', public: false, holders: [{ characterId: 'c28', how: 'witnessed', toldBy: null, at: 20 }] } }],
        };
        const copy = structuredClone(before);

        mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(before, copy);
    });
});

describe('mergeCharacters — references', () => {
    it('moves a holder entry to the main record with its message', () => {
        const before = ledgerWithFacts([
            { id: 'f1', text: 'The truck weighs two tons', public: false, holders: [{ characterId: 'c28', how: 'witnessed', toldBy: null, at: 12, messageId: 'm12' }] },
        ]);

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c5', how: 'witnessed', toldBy: null, at: 12, messageId: 'm12' }]);
    });

    it('points toldBy at the main record', () => {
        const before = ledgerWithFacts([
            { id: 'f2', text: 'The bridge is out', public: false, holders: [{ characterId: 'c1', how: 'told', toldBy: 'c28', at: 15, messageId: 'm15' }] },
        ]);

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c1', how: 'told', toldBy: 'c5', at: 15, messageId: 'm15' }]);
    });

    it('puts the main record in the scene once', () => {
        const before = { ...makeLedger(), scene: { at: 40, messageId: 'm40', present: ['c28', 'c1', 'c5'] } };

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.scene, { at: 40, messageId: 'm40', present: ['c5', 'c1'] });
    });

    it('puts the main record in every scene of the scene history', () => {
        const before = {
            ...makeLedger(),
            sceneHistory: [
                { at: 10, messageId: 'm10', present: ['c28'] },
                { at: 20, present: ['c5', 'c28', 'c1'] },
            ],
        };

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.sceneHistory, [
            { at: 10, messageId: 'm10', present: ['c5'] },
            { at: 20, present: ['c5', 'c1'] },
        ]);
    });

    it('moves the holder entries of a retracted fact, keeping the retraction', () => {
        const before = {
            ...makeLedger(),
            retractedFacts: [{
                at: 25, messageId: 'm25',
                fact: { id: 'f9', text: 'Anvil is a man', public: false, holders: [
                    { characterId: 'c28', how: 'witnessed', toldBy: null, at: 22, messageId: 'm22' },
                    { characterId: 'c5', how: 'witnessed', toldBy: null, at: 24 },
                    { characterId: 'c1', how: 'told', toldBy: 'c28', at: 23 },
                ] },
            }],
        };

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.retractedFacts, [{
            at: 25, messageId: 'm25',
            fact: { id: 'f9', text: 'Anvil is a man', public: false, holders: [
                { characterId: 'c5', how: 'witnessed', toldBy: null, at: 22, messageId: 'm22' },
                { characterId: 'c1', how: 'told', toldBy: 'c5', at: 23 },
            ] },
        }]);
    });

    it('adds no scene history or retracted facts to a ledger from before them', () => {
        const { sceneHistory, ...before } = makeLedger();

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.equal('sceneHistory' in ledger, false);
        assert.equal('retractedFacts' in ledger, false);
    });

    it('points the relations of other records at the main record, keeping their messages', () => {
        const mateo = { id: 'c6', name: 'Mateo Reyes', aliases: [], details: { relation: [{ value: { kind: 'brother', of: 'c28' }, at: 30, messageId: 'm30' }] } };

        const { ledger } = mergeCharacters(ledgerWithCharacters(mateo), 'c5', 'c28');

        assert.deepEqual(ledger.characters[2], {
            id: 'c6', name: 'Mateo Reyes', aliases: [],
            details: { relation: [{ value: { kind: 'brother', of: 'c5' }, at: 30, messageId: 'm30' }] },
        });
    });

    it('refuses a merge that leaves two unnamed relatives with one display name', () => {
        const anvilsMother = { id: 'c40', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c28' }, at: null, by: 'record' }] } };
        const kendrasMother = { id: 'c41', name: '', aliases: [], details: { relation: [{ value: { kind: 'mother', of: 'c5' }, at: null, by: 'record' }] } };

        const { ledger, error } = mergeCharacters(ledgerWithCharacters(anvilsMother, kendrasMother), 'c5', 'c28');

        assert.equal(ledger, null);
        assert.equal(error, 'Kendra Osei\'s mother would be in the ledger twice: merge those two first.');
    });
});

describe('mergeCharacters — two holder entries for one character', () => {
    it('keeps the earliest message when neither is the player\'s', () => {
        const before = ledgerWithFacts([{
            id: 'f3', text: 'The vault code is 7713', public: false, holders: [
                { characterId: 'c5', how: 'witnessed', toldBy: null, at: 20, messageId: 'm20' },
                { characterId: 'c28', how: 'told', toldBy: 'c1', at: 8, messageId: 'm8' },
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 6 },
            ],
        }]);

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.facts[0].holders, [
            { characterId: 'c5', how: 'told', toldBy: 'c1', at: 8, messageId: 'm8' },
            { characterId: 'c1', how: 'witnessed', toldBy: null, at: 6 },
        ]);
    });

    it('keeps the player\'s entry over any message', () => {
        const before = ledgerWithFacts([{
            id: 'f4', text: 'Kendra fears heights', public: false, holders: [
                { characterId: 'c28', how: 'witnessed', toldBy: null, at: 3, messageId: 'm3' },
                { characterId: 'c5', how: 'user', toldBy: null, at: null },
            ],
        }]);

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c5', how: 'user', toldBy: null, at: null }]);
    });

    it('keeps the main record\'s entry when both come from one message, whichever is listed first', () => {
        const before = ledgerWithFacts([{
            id: 'f5', text: 'The bridge is out', public: false, holders: [
                { characterId: 'c28', how: 'told', toldBy: 'c1', at: 9 },
                { characterId: 'c5', how: 'witnessed', toldBy: null, at: 9 },
            ],
        }]);

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c5', how: 'witnessed', toldBy: null, at: 9 }]);
    });

    it('turns an entry the other record told the main record into a witnessed one', () => {
        const before = ledgerWithFacts([{
            id: 'f6', text: 'The suit runs hot', public: false, holders: [
                { characterId: 'c5', how: 'told', toldBy: 'c28', at: 11, messageId: 'm11' },
            ],
        }]);

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c5', how: 'witnessed', toldBy: null, at: 11, messageId: 'm11' }]);
    });
});

describe('mergeCharacters — details', () => {
    it('keeps the main record\'s kinds and takes the other\'s where the main record has none, with their messages', () => {
        const kendra = { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra'], details: { role: [{ value: 'firefighter', at: 5, messageId: 'm5' }] } };
        const anvil = { id: 'c28', name: 'Anvil', aliases: [], details: {
            role: [{ value: 'cape', at: 9 }],
            gender: [{ value: 'female', at: 9, messageId: 'm9' }, { value: 'woman', at: null, by: 'user' }],
        } };

        const { ledger } = mergeCharacters(ledgerWithCharacters(kendra, anvil), 'c5', 'c28');

        assert.deepEqual(ledger.characters[1].details, {
            role: [{ value: 'firefighter', at: 5, messageId: 'm5' }],
            gender: [{ value: 'female', at: 9, messageId: 'm9' }, { value: 'woman', at: null, by: 'user' }],
        });
    });

    it('drops the relation of the other record to the main record, which would relate the record to itself', () => {
        const anvil = { id: 'c28', name: 'Anvil', aliases: [], details: { relation: [{ value: { kind: 'alter ego', of: 'c5' }, at: 14 }] } };

        const { ledger } = mergeCharacters(ledgerWithCharacters(anvil), 'c5', 'c28');

        assert.deepEqual(ledger.characters[1], { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra', 'Anvil'] });
    });

    it('drops the main record\'s relation to the other record, so the other\'s relation fills the kind', () => {
        // Kendra was recorded as Anvil's daughter, Anvil as Noor's daughter: one person, Noor's daughter.
        const kendra = { id: 'c5', name: 'Kendra Osei', aliases: [], details: { relation: [{ value: { kind: 'daughter', of: 'c28' }, at: 4 }] } };
        const anvil = { id: 'c28', name: 'Anvil', aliases: [], details: { relation: [{ value: { kind: 'daughter', of: 'c1' }, at: 7, messageId: 'm7' }] } };

        const { ledger } = mergeCharacters(ledgerWithCharacters(kendra, anvil), 'c5', 'c28');

        assert.deepEqual(ledger.characters[1].details, { relation: [{ value: { kind: 'daughter', of: 'c1' }, at: 7, messageId: 'm7' }] });
    });
});

describe('mergeCharacters — reused-name flag', () => {
    it('removes the other record with its flag', () => {
        const anvil = { id: 'c28', name: 'Anvil', aliases: [], nameClash: { names: ['Kendra'], at: 30 } };

        const { ledger } = mergeCharacters(ledgerWithCharacters(anvil), 'c5', 'c28');

        assert.deepEqual(ledger.characters.map(character => character.id), ['c1', 'c5']);
    });

    it('clears the main record\'s flag when its flagged names are now its own', () => {
        const kendra = { id: 'c5', name: 'Kendra Anvil', aliases: [], nameClash: { names: ['Anvil'], at: 30, messageId: 'm30' } };

        const { ledger } = mergeCharacters(ledgerWithCharacters(kendra), 'c5', 'c28');

        assert.deepEqual(ledger.characters[1], { id: 'c5', name: 'Kendra Anvil', aliases: ['Anvil', 'The Anvil'] });
    });

    it('keeps the main record\'s flag while a third record still has a flagged name', () => {
        const kendra = { id: 'c5', name: 'Kendra Noor', aliases: [], nameClash: { names: ['Noor'], at: 30 } };

        const { ledger } = mergeCharacters(ledgerWithCharacters(kendra), 'c5', 'c28');

        assert.deepEqual(ledger.characters[1].nameClash, { names: ['Noor'], at: 30 });
    });
});

describe('mergeCharacters — rollback after a merge', () => {
    /** Anvil learned f1 at message 2 and f2 at message 3; Kendra entered f3 by hand. */
    function makeMergedLedger() {
        const before = ledgerWithFacts([
            { id: 'f1', text: 'The truck weighs two tons', public: false, holders: [{ characterId: 'c28', how: 'witnessed', toldBy: null, at: 2, messageId: 'm2' }] },
            { id: 'f2', text: 'The bridge is out', public: false, holders: [{ characterId: 'c28', how: 'witnessed', toldBy: null, at: 3, messageId: 'm3' }] },
            { id: 'f3', text: 'Kendra fears heights', public: false, holders: [{ characterId: 'c5', how: 'user', toldBy: null, at: null }] },
        ]);
        before.scene = { at: 3, messageId: 'm3', present: ['c28'] };
        before.lastUpdatedAt = 3;
        return mergeCharacters(before, 'c5', 'c28').ledger;
    }

    it('drops a moved entry with its message on a swipe or regeneration', () => {
        const ledger = makeMergedLedger();

        dropKnowledgeFrom(ledger, 3);

        assert.deepEqual(ledger.facts.map(fact => fact.id), ['f1', 'f3']);
        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c5', how: 'witnessed', toldBy: null, at: 2, messageId: 'm2' }]);
    });

    it('drops a moved entry whose message was deleted and moves the one after it', async () => {
        chat_metadata.story_arc = { knowledge: makeMergedLedger() };
        chat.length = 0;
        // Message 2 (m2) deleted: m3 is now message 2.
        chat.push(
            { is_user: false, is_system: false, name: 'Narrator', mes: 'Message 0.', extra: { story_arc_message_id: 'm0' } },
            { is_user: true, is_system: false, name: 'Amy', mes: 'Message 1.', extra: { story_arc_message_id: 'm1' } },
            { is_user: false, is_system: false, name: 'Narrator', mes: 'Message 3.', extra: { story_arc_message_id: 'm3' } },
        );

        await rollBackKnowledgeFrom(3);

        const ledger = chat_metadata.story_arc.knowledge;
        assert.deepEqual(ledger.facts.map(fact => fact.id), ['f2', 'f3']);
        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c5', how: 'witnessed', toldBy: null, at: 2, messageId: 'm3' }]);
        chat.length = 0;
        delete chat_metadata.story_arc;
    });
});

describe('mergeCharacters — the taken names see one character', () => {
    it('lists the merged record\'s names in the taken-names block once each', () => {
        const before = {
            characters: [
                { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra'] },
                { id: 'c28', name: 'Anvil', aliases: ['The Anvil', 'Osei'] },
            ],
            facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null,
        };

        const { ledger } = mergeCharacters(before, 'c5', 'c28');

        assert.equal(buildTakenNamesBlock(ledger).split('\n')[1], 'Anvil, Kendra, Osei');
    });

    it('flags a new character who reuses names of both merged records against the one merged character', () => {
        const { ledger } = mergeCharacters(makeLedger(), 'c5', 'c28');

        applyExtractionAnswer(ledger, { present: [], newCharacters: [{ name: 'Kendra Anvil', aliases: [] }], learned: [] }, 41, 42);

        const newCharacter = ledger.characters[2];
        assert.deepEqual(newCharacter.nameClash, { names: ['Kendra', 'Anvil'], at: 42 });
        assert.deepEqual(listCharactersWithNames(ledger, ['Kendra', 'Anvil'], newCharacter.id).map(character => character.id), ['c5']);
        const html = buildKnowledgeContent(ledger, []);
        assert.ok(html.includes('"Kendra" is also a name of Kendra Osei.'));
        assert.ok(html.includes('"Anvil" is also a name of Kendra Osei.'));
    });
});

describe('buildKnowledgeContent — Merge into…', () => {
    it('offers each character row the other records, sorted by display name', () => {
        const html = buildKnowledgeContent(makeLedger(), []);

        const kendraRow = html.slice(html.indexOf('data-character-id="c5"'), html.indexOf('data-character-id="c28"'));
        const mergeSelect = kendraRow.slice(kendraRow.indexOf('story-arc-merge-target'));
        assert.match(mergeSelect, /^story-arc-merge-target"><option value="c28">Anvil<\/option><option value="c1">Noor al-Jamil<\/option><\/select>/);
    });
});
