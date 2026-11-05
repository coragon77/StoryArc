import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteCharacter, lockCharacterDetail, moveFactHolder, restoreRetractedFact } from '../lib/ui/knowledge-popup.js';
import { dropKnowledgeFrom } from '../lib/knowledge/ledger.js';

/** Noor (c1), Kendra Osei (c5) and Marcus (c7); no facts yet. */
function makeLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Noor al-Jamil', aliases: ['Noor'] },
            { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra'] },
            { id: 'c7', name: 'Marcus Vale', aliases: [] },
        ],
        facts: [],
        scene: { at: 40, present: ['c1'] },
        sceneHistory: [],
        lastUpdatedAt: 40,
    };
}

/** makeLedger with the given facts. */
function ledgerWithFacts(facts) {
    return { ...makeLedger(), facts };
}

describe('moveFactHolder', () => {
    it('gives the holder entry to the other character, keeping how, toldBy, at and messageId', () => {
        const before = ledgerWithFacts([{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c1', how: 'witnessed', toldBy: null, at: 12 },
            { characterId: 'c5', how: 'told', toldBy: 'c1', at: 30, messageId: 'm30' },
        ] }]);

        const { ledger, error } = moveFactHolder(before, 'f1', 'c5', 'c7');

        assert.equal(error, null);
        assert.deepEqual(ledger.facts, [{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c1', how: 'witnessed', toldBy: null, at: 12 },
            { characterId: 'c7', how: 'told', toldBy: 'c1', at: 30, messageId: 'm30' },
        ] }]);
    });

    it('drops the moved entry when the target already holds the fact; the target keeps their own', () => {
        const before = ledgerWithFacts([{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c5', how: 'witnessed', toldBy: null, at: 12 },
            { characterId: 'c7', how: 'told', toldBy: 'c1', at: 30 },
        ] }]);

        const { ledger } = moveFactHolder(before, 'f1', 'c5', 'c7');

        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c7', how: 'told', toldBy: 'c1', at: 30 }]);
    });

    it('does not re-point other holders told by the moved-from character', () => {
        const before = ledgerWithFacts([{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c5', how: 'witnessed', toldBy: null, at: 12 },
            { characterId: 'c1', how: 'told', toldBy: 'c5', at: 20 },
        ] }]);

        const { ledger } = moveFactHolder(before, 'f1', 'c5', 'c7');

        assert.deepEqual(ledger.facts[0].holders, [
            { characterId: 'c7', how: 'witnessed', toldBy: null, at: 12 },
            { characterId: 'c1', how: 'told', toldBy: 'c5', at: 20 },
        ]);
    });

    it('reads an entry the target told the mover as witnessed once the target holds it', () => {
        const before = ledgerWithFacts([{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c5', how: 'told', toldBy: 'c7', at: 30 },
        ] }]);

        const { ledger } = moveFactHolder(before, 'f1', 'c5', 'c7');

        assert.deepEqual(ledger.facts[0].holders, [{ characterId: 'c7', how: 'witnessed', toldBy: null, at: 30 }]);
    });

    it('leaves the input ledger untouched', () => {
        const before = ledgerWithFacts([{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c5', how: 'witnessed', toldBy: null, at: 12 },
        ] }]);

        moveFactHolder(before, 'f1', 'c5', 'c7');

        assert.deepEqual(before.facts[0].holders, [{ characterId: 'c5', how: 'witnessed', toldBy: null, at: 12 }]);
    });

    it('refuses a move to the same character, to a character not in the ledger, from a non-holder and on a missing fact', () => {
        const before = ledgerWithFacts([{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c5', how: 'witnessed', toldBy: null, at: 12 },
        ] }]);

        assert.deepEqual(moveFactHolder(before, 'f1', 'c5', 'c5'), { ledger: null, error: 'A holder cannot be moved to themselves.' });
        assert.deepEqual(moveFactHolder(before, 'f1', 'c5', 'c99'), { ledger: null, error: 'This character is no longer in the ledger.' });
        assert.deepEqual(moveFactHolder(before, 'f1', 'c1', 'c7'), { ledger: null, error: 'Noor al-Jamil does not hold this fact.' });
        assert.deepEqual(moveFactHolder(before, 'f9', 'c5', 'c7'), { ledger: null, error: 'This fact is no longer in the ledger.' });
    });

    it('lets a rollback take the moved entry back with its message', () => {
        const before = ledgerWithFacts([{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c1', how: 'witnessed', toldBy: null, at: 12 },
            { characterId: 'c5', how: 'told', toldBy: 'c1', at: 30, messageId: 'm30' },
        ] }]);
        const { ledger } = moveFactHolder(before, 'f1', 'c5', 'c7');

        dropKnowledgeFrom(ledger, 30);

        assert.deepEqual(ledger.facts, [{ id: 'f1', text: 'The vault code is 4471.', public: false, holders: [
            { characterId: 'c1', how: 'witnessed', toldBy: null, at: 12 },
        ] }]);
    });
});

describe('deleteCharacter', () => {
    /** Marcus (c7) holds two facts alone, shares one with Noor, told Kendra one; a retracted fact; a scene history. */
    function makeDeleteLedger() {
        return {
            characters: [
                { id: 'c1', name: 'Noor al-Jamil', aliases: ['Noor'] },
                { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra'], details: {
                    relation: [{ value: { kind: 'sister', of: 'c7' }, at: 20, messageId: 'm20' }],
                } },
                { id: 'c6', name: 'Mateo Reyes', aliases: [], details: {
                    role: [{ value: 'smuggler', at: 8 }],
                    relation: [
                        { value: { kind: 'cousin', of: 'c7' }, at: 9 },
                        { value: { kind: 'friend', of: 'c1' }, at: 22 },
                    ],
                } },
                { id: 'c7', name: 'Marcus Vale', aliases: [] },
            ],
            facts: [
                { id: 'f1', text: 'Marcus owes the guild money.', public: false, holders: [
                    { characterId: 'c7', how: 'witnessed', toldBy: null, at: 10 },
                ] },
                { id: 'f2', text: 'The vault code is 4471.', public: false, holders: [
                    { characterId: 'c7', how: 'witnessed', toldBy: null, at: 12 },
                    { characterId: 'c1', how: 'told', toldBy: 'c7', at: 15, messageId: 'm15' },
                ] },
                { id: 'f3', text: 'The ship leaves at dawn.', public: false, holders: [] },
                { id: 'f4', text: 'The governor is ill.', public: true, holders: [
                    { characterId: 'c7', how: 'witnessed', toldBy: null, at: 18 },
                ] },
            ],
            retractedFacts: [
                { at: 25, fact: { id: 'f5', text: 'Marcus has a twin.', public: false, holders: [
                    { characterId: 'c7', how: 'witnessed', toldBy: null, at: 24 },
                ] } },
                { at: 26, fact: { id: 'f6', text: 'Noor was born in Basra.', public: false, holders: [
                    { characterId: 'c1', how: 'witnessed', toldBy: null, at: 5 },
                    { characterId: 'c7', how: 'witnessed', toldBy: null, at: 5 },
                ] } },
            ],
            scene: { at: 40, present: ['c1', 'c7'] },
            sceneHistory: [{ at: 30, present: ['c7', 'c5'] }, { at: 40, present: ['c1', 'c7'] }],
            lastUpdatedAt: 40,
        };
    }

    it('removes the character and every reference to them, and facts only they held', () => {
        const { ledger, error } = deleteCharacter(makeDeleteLedger(), 'c7');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Noor al-Jamil', aliases: ['Noor'] },
            { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra'] },
            { id: 'c6', name: 'Mateo Reyes', aliases: [], details: {
                role: [{ value: 'smuggler', at: 8 }],
                relation: [{ value: { kind: 'friend', of: 'c1' }, at: 22 }],
            } },
        ]);
        assert.deepEqual(ledger.facts, [
            { id: 'f2', text: 'The vault code is 4471.', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 15, messageId: 'm15' },
            ] },
            { id: 'f3', text: 'The ship leaves at dawn.', public: false, holders: [] },
            { id: 'f4', text: 'The governor is ill.', public: true, holders: [] },
        ]);
        assert.deepEqual(ledger.retractedFacts, [
            { at: 26, fact: { id: 'f6', text: 'Noor was born in Basra.', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 5 },
            ] } },
        ]);
        assert.deepEqual(ledger.scene, { at: 40, present: ['c1'] });
        assert.deepEqual(ledger.sceneHistory, [{ at: 30, present: ['c5'] }, { at: 40, present: ['c1'] }]);
    });

    it('reports the facts that go with the character and how many holder entries they lose elsewhere', () => {
        const { removed } = deleteCharacter(makeDeleteLedger(), 'c7');

        assert.deepEqual(removed, {
            facts: [{ id: 'f1', text: 'Marcus owes the guild money.' }],
            retractedFacts: [{ id: 'f5', text: 'Marcus has a twin.' }],
            holderEntries: 3,
            relations: [{ characterId: 'c5', kind: 'sister' }, { characterId: 'c6', kind: 'cousin' }],
        });
    });

    it('leaves the input ledger untouched', () => {
        const before = makeDeleteLedger();

        deleteCharacter(before, 'c7');

        assert.deepEqual(before, makeDeleteLedger());
    });

    it('adds no scene history or retracted facts to a ledger from before them', () => {
        const before = { ...makeLedger(), sceneHistory: undefined };
        delete before.sceneHistory;

        const { ledger } = deleteCharacter(before, 'c7');

        assert.equal('sceneHistory' in ledger, false);
        assert.equal('retractedFacts' in ledger, false);
    });

    it('refuses while an unnamed relative is named after the character', () => {
        const before = makeDeleteLedger();
        before.characters.push({ id: 'c40', name: '', aliases: [], details: {
            relation: [{ value: { kind: 'mother', of: 'c7' }, at: null, by: 'user' }],
        } });

        assert.deepEqual(deleteCharacter(before, 'c7'), {
            ledger: null,
            error: 'Marcus Vale\'s mother is known only as Marcus Vale\'s relative: give them a name or another relation first.',
        });
    });

    it('refuses a character not in the ledger', () => {
        assert.deepEqual(deleteCharacter(makeLedger(), 'c99'), { ledger: null, error: 'This character is no longer in the ledger.' });
    });
});

describe('restoreRetractedFact', () => {
    /** One live fact f1 and two retracted facts, f2 and f3. */
    function makeRetractionLedger() {
        return {
            ...makeLedger(),
            facts: [{ id: 'f1', text: 'The ship leaves at dawn.', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 10 },
            ] }],
            retractedFacts: [
                { at: 25, fact: { id: 'f2', text: 'Marcus has a twin.', public: false, holders: [
                    { characterId: 'c7', how: 'witnessed', toldBy: null, at: 24, messageId: 'm24' },
                    { characterId: 'c5', how: 'told', toldBy: 'c7', at: 24, messageId: 'm24' },
                ] } },
                { at: 30, fact: { id: 'f3', text: 'Noor was born in Basra.', public: false, holders: [
                    { characterId: 'c1', how: 'witnessed', toldBy: null, at: 5 },
                ] } },
            ],
        };
    }

    it('puts the fact back with its holders as they were and ends its retraction', () => {
        const { ledger, error } = restoreRetractedFact(makeRetractionLedger(), 'f2');

        assert.equal(error, null);
        assert.deepEqual(ledger.facts, [
            { id: 'f1', text: 'The ship leaves at dawn.', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 10 },
            ] },
            { id: 'f2', text: 'Marcus has a twin.', public: false, holders: [
                { characterId: 'c7', how: 'witnessed', toldBy: null, at: 24, messageId: 'm24' },
                { characterId: 'c5', how: 'told', toldBy: 'c7', at: 24, messageId: 'm24' },
            ] },
        ]);
        assert.deepEqual(ledger.retractedFacts, [
            { at: 30, fact: { id: 'f3', text: 'Noor was born in Basra.', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 5 },
            ] } },
        ]);
    });

    it('gives the fact a free id when a fact entered meanwhile took its own', () => {
        const before = makeRetractionLedger();
        before.facts.push({ id: 'f2', text: 'The governor is ill.', public: true, holders: [] });

        const { ledger } = restoreRetractedFact(before, 'f2');

        assert.deepEqual(ledger.facts.map(fact => [fact.id, fact.text]), [
            ['f1', 'The ship leaves at dawn.'],
            ['f2', 'The governor is ill.'],
            ['f3', 'Marcus has a twin.'],
        ]);
    });

    it('leaves the input ledger untouched', () => {
        const before = makeRetractionLedger();

        const { ledger } = restoreRetractedFact(before, 'f2');
        ledger.facts[1].holders[0].at = 99;

        assert.deepEqual(before, makeRetractionLedger());
    });

    it('lets a rollback of the holders\' message take the restored fact back out', () => {
        const { ledger } = restoreRetractedFact(makeRetractionLedger(), 'f2');

        dropKnowledgeFrom(ledger, 24);

        // f2 goes with its holders' message; f3 returns, its correction at 30 being gone too.
        assert.deepEqual(ledger.facts.map(fact => fact.id), ['f1', 'f3']);
    });

    it('refuses a fact that is not retracted', () => {
        assert.deepEqual(restoreRetractedFact(makeRetractionLedger(), 'f1'), { ledger: null, error: 'This fact is no longer retracted.' });
        assert.deepEqual(restoreRetractedFact(makeLedger(), 'f2'), { ledger: null, error: 'This fact is no longer retracted.' });
    });
});

describe('lockCharacterDetail', () => {
    /** Kendra (c5) with a role the story changed and a story relation. */
    function makeDetailLedger() {
        const ledger = makeLedger();
        ledger.characters[1] = { id: 'c5', name: 'Kendra Osei', aliases: ['Kendra'], details: {
            role: [{ value: 'medic', at: 8 }, { value: 'smuggler', at: 20, messageId: 'm20' }],
            relation: [{ value: { kind: 'sister', of: 'c7' }, at: 12 }],
        } };
        return ledger;
    }

    it('adds a player entry with the value the story set last, without changing it', () => {
        const { ledger, error } = lockCharacterDetail(makeDetailLedger(), 'c5', 'role');

        assert.equal(error, null);
        assert.deepEqual(ledger.characters[1].details.role, [
            { value: 'medic', at: 8 },
            { value: 'smuggler', at: 20, messageId: 'm20' },
            { value: 'smuggler', at: null, by: 'user' },
        ]);
    });

    it('locks a relation at its kinship and character', () => {
        const before = makeDetailLedger();

        const { ledger } = lockCharacterDetail(before, 'c5', 'relation');

        assert.deepEqual(ledger.characters[1].details.relation, [
            { value: { kind: 'sister', of: 'c7' }, at: 12 },
            { value: { kind: 'sister', of: 'c7' }, at: null, by: 'user' },
        ]);
        assert.notEqual(ledger.characters[1].details.relation[1].value, before.characters[1].details.relation[0].value);
    });

    it('keeps the locked value when the story\'s entry rolls back', () => {
        const { ledger } = lockCharacterDetail(makeDetailLedger(), 'c5', 'role');

        dropKnowledgeFrom(ledger, 20);

        assert.deepEqual(ledger.characters[1].details.role, [
            { value: 'medic', at: 8 },
            { value: 'smuggler', at: null, by: 'user' },
        ]);
    });

    it('leaves the input ledger untouched', () => {
        const before = makeDetailLedger();

        lockCharacterDetail(before, 'c5', 'role');

        assert.deepEqual(before, makeDetailLedger());
    });

    it('refuses an unknown detail, one already set by the player, an unknown kind and a missing character', () => {
        const locked = lockCharacterDetail(makeDetailLedger(), 'c5', 'role').ledger;

        assert.deepEqual(lockCharacterDetail(makeDetailLedger(), 'c5', 'age'), { ledger: null, error: 'The story has not set Kendra Osei\'s age.' });
        assert.deepEqual(lockCharacterDetail(locked, 'c5', 'role'), { ledger: null, error: 'Kendra Osei\'s role is already set by the player.' });
        assert.deepEqual(lockCharacterDetail(makeDetailLedger(), 'c5', 'height'), { ledger: null, error: 'There is no character detail "height".' });
        assert.deepEqual(lockCharacterDetail(makeDetailLedger(), 'c99', 'role'), { ledger: null, error: 'This character is no longer in the ledger.' });
    });
});
