import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyExtractionAnswer, buildKnowledgeBlock } from '../lib/knowledge/ledger.js';
import { createEmptyKnowledgeLedger } from '../lib/core/constants.js';

/** The workshop cast after breakfast: Gabriel told Ellie about the titanium latches. */
function makeBreakfastLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Ellie', aliases: ['Dice'] },
            { id: 'c2', name: 'Gabriel Marin', aliases: ['Aegis', 'Mr. Marin'] },
        ],
        facts: [
            {
                id: 'f1',
                text: 'Noor should lock the gauntlet on with titanium latches.',
                public: false,
                holders: [
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2060 },
                    { characterId: 'c1', how: 'told', toldBy: 'c2', at: 2063 },
                ],
            },
        ],
        scene: { at: 2063, present: ['c1', 'c2'] },
        lastUpdatedAt: 2063,
    };
}

describe('applyExtractionAnswer', () => {
    it('adds new characters, creates facts with holders and sets the scene', () => {
        const ledger = applyExtractionAnswer(createEmptyKnowledgeLedger(), {
            present: ['Noor', 'Ellie'],
            newCharacters: [
                { name: 'Ellie', aliases: ['Dice'] },
                { name: 'Noor', aliases: ['Al-Jamil'] },
            ],
            learned: [
                { text: 'Ellie is Dice.', public: false, who: ['Noor', 'Ellie'], how: 'witnessed', toldBy: null, at: 2079 },
                { text: 'The gauntlet session is this afternoon.', public: false, who: ['Noor'], how: 'told', toldBy: 'Ellie', at: 2080 },
                { text: 'Overdrive is Bellweather\'s ringer for Sunday.', public: true, who: ['Ellie'], how: 'witnessed', toldBy: null, at: 2080 },
            ],
        }, 2079, 2080);

        assert.deepEqual(ledger, {
            characters: [
                { id: 'c1', name: 'Ellie', aliases: ['Dice'] },
                { id: 'c2', name: 'Noor', aliases: ['Al-Jamil'] },
            ],
            facts: [
                {
                    id: 'f1',
                    text: 'Ellie is Dice.',
                    public: false,
                    holders: [
                        { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2079 },
                        { characterId: 'c1', how: 'witnessed', toldBy: null, at: 2079 },
                    ],
                },
                {
                    id: 'f2',
                    text: 'The gauntlet session is this afternoon.',
                    public: false,
                    holders: [
                        { characterId: 'c1', how: 'witnessed', toldBy: null, at: 2080 },
                        { characterId: 'c2', how: 'told', toldBy: 'c1', at: 2080 },
                    ],
                },
                {
                    id: 'f3',
                    text: 'Overdrive is Bellweather\'s ringer for Sunday.',
                    public: true,
                    holders: [
                        { characterId: 'c1', how: 'witnessed', toldBy: null, at: 2080 },
                    ],
                },
            ],
            scene: { at: 2080, present: ['c2', 'c1'] },
            lastUpdatedAt: 2080,
        });
    });

    it('adds a holder to a known fact and does not duplicate one already there', () => {
        const ledger = applyExtractionAnswer(makeBreakfastLedger(), {
            present: ['Ellie'],
            newCharacters: [{ name: 'Noor', aliases: [] }],
            learned: [
                { factId: 'f1', public: false, who: ['Noor', 'Ellie'], how: 'told', toldBy: 'Ellie', at: 2081 },
            ],
        }, 2081, 2081);

        assert.deepEqual(ledger.facts, [
            {
                id: 'f1',
                text: 'Noor should lock the gauntlet on with titanium latches.',
                public: false,
                holders: [
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2060 },
                    { characterId: 'c1', how: 'told', toldBy: 'c2', at: 2063 },
                    { characterId: 'c3', how: 'told', toldBy: 'c1', at: 2081 },
                ],
            },
        ]);
    });

    it('ignores unknown names and unknown fact ids', () => {
        const ledger = applyExtractionAnswer(makeBreakfastLedger(), {
            present: ['Ellie', 'Dougal'],
            newCharacters: [],
            learned: [
                { factId: 'f1', public: false, who: ['Dougal'], how: 'witnessed', toldBy: null, at: 2070 },
                { factId: 'f9', public: false, who: ['Ellie'], how: 'witnessed', toldBy: null, at: 2070 },
                { text: 'The kiln router logged odd queries.', public: false, who: ['Dougal'], how: 'witnessed', toldBy: null, at: 2070 },
            ],
        }, 2070, 2070);

        const expected = makeBreakfastLedger();
        expected.scene = { at: 2070, present: ['c1'] };
        expected.lastUpdatedAt = 2070;
        assert.deepEqual(ledger, expected);
    });

    it('resolves an alias in who, in toldBy and in present to its character, ignoring case', () => {
        const ledger = applyExtractionAnswer(makeBreakfastLedger(), {
            present: ['dice', 'Mr. Marin'],
            newCharacters: [],
            learned: [
                { text: 'Gabriel Marin is Aegis.', public: false, who: ['DICE'], how: 'told', toldBy: 'aegis', at: 2075 },
            ],
        }, 2075, 2075);

        assert.deepEqual(ledger.facts[1], {
            id: 'f2',
            text: 'Gabriel Marin is Aegis.',
            public: false,
            holders: [
                { characterId: 'c2', how: 'witnessed', toldBy: null, at: 2075 },
                { characterId: 'c1', how: 'told', toldBy: 'c2', at: 2075 },
            ],
        });
        assert.deepEqual(ledger.characters, makeBreakfastLedger().characters);
        assert.deepEqual(ledger.scene, { at: 2075, present: ['c1', 'c2'] });
    });

    it('does not change the ledger it was given', () => {
        const before = makeBreakfastLedger();
        applyExtractionAnswer(before, {
            present: ['Noor'],
            newCharacters: [{ name: 'Noor', aliases: [] }],
            learned: [{ factId: 'f1', public: false, who: ['Noor'], how: 'witnessed', toldBy: null, at: 2090 }],
        }, 2090, 2090);

        assert.deepEqual(before, makeBreakfastLedger());
    });
});

describe('applying an extraction answer, then building the block', () => {
    it('makes the teller of a told fact its holder, so a talked-about teller knows it and has told only the listener', () => {
        // Breakfast at 2063: Gabriel tells Ellie about the latches. The answer
        // names only the listener in "who", as the prompt asks.
        const afterBreakfast = applyExtractionAnswer(createEmptyKnowledgeLedger(), {
            present: ['Ellie', 'Gabriel Marin'],
            newCharacters: [
                { name: 'Ellie', aliases: ['Dice'] },
                { name: 'Gabriel Marin', aliases: ['Aegis'] },
            ],
            learned: [
                { text: 'Noor should lock the gauntlet on with titanium latches.', public: false, who: ['Ellie'], how: 'told', toldBy: 'Gabriel Marin', at: 2063 },
            ],
        }, 2062, 2063);
        // The workshop at 2079: Ellie arrives at Noor's bench; nobody learns anything.
        const ledger = applyExtractionAnswer(afterBreakfast, {
            present: ['Ellie', 'Noor'],
            newCharacters: [{ name: 'Noor', aliases: [] }],
            learned: [],
        }, 2078, 2079);

        const messages = [
            { is_user: true, mes: 'Aegis had some thoughts on the cuff.' },
            { is_user: false, mes: 'Noor looks up from the bench.' },
        ];
        assert.equal(buildKnowledgeBlock(ledger, messages), [
            '[WHO KNOWS WHAT — characters in this scene and characters being talked about. Each character speaks and acts only from their own list. Knowledge moves between characters only on-screen.]',
            '',
            'ELLIE (present)',
            '- Knows (told by Gabriel Marin): Noor should lock the gauntlet on with titanium latches.',
            '',
            'NOOR (present)',
            '- Does not know: Noor should lock the gauntlet on with titanium latches.',
            '',
            'GABRIEL MARIN (talked about, not present)',
            '- Knows: Noor should lock the gauntlet on with titanium latches.',
            '- Has told only Ellie: Noor should lock the gauntlet on with titanium latches.',
        ].join('\n'));
    });
});
