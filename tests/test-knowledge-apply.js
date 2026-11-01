import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyExtractionAnswer, buildKnowledgeBlock, dropKnowledgeFrom } from '../lib/knowledge/ledger.js';
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
        const ledger = createEmptyKnowledgeLedger();
        applyExtractionAnswer(ledger, {
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
            sceneHistory: [],
            lastUpdatedAt: 2080,
        });
    });

    it('adds a holder to a known fact and does not duplicate one already there', () => {
        const ledger = makeBreakfastLedger();
        applyExtractionAnswer(ledger, {
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
        const ledger = makeBreakfastLedger();
        applyExtractionAnswer(ledger, {
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
        expected.sceneHistory = [{ at: 2063, present: ['c1', 'c2'] }];
        expected.lastUpdatedAt = 2070;
        assert.deepEqual(ledger, expected);
    });

    it('resolves an alias in who, in toldBy and in present to its character, ignoring case', () => {
        const ledger = makeBreakfastLedger();
        applyExtractionAnswer(ledger, {
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

    it('changes the ledger it was given and says so', () => {
        const ledger = makeBreakfastLedger();
        const changed = applyExtractionAnswer(ledger, {
            present: ['Noor'],
            newCharacters: [{ name: 'Noor', aliases: [] }],
            learned: [{ factId: 'f1', public: false, who: ['Noor'], how: 'witnessed', toldBy: null, at: 2090 }],
        }, 2090, 2090);

        assert.equal(changed, true);
        assert.deepEqual(ledger.characters[2], { id: 'c3', name: 'Noor', aliases: [] });
        assert.deepEqual(ledger.facts[0].holders[2], { characterId: 'c3', how: 'witnessed', toldBy: null, at: 2090 });
        assert.deepEqual(ledger.scene, { at: 2090, present: ['c3'] });
        assert.equal(ledger.lastUpdatedAt, 2090);
    });

    it('says nothing changed when the answer repeats what the ledger already holds', () => {
        const ledger = makeBreakfastLedger();
        const changed = applyExtractionAnswer(ledger, {
            present: ['Ellie', 'Gabriel Marin'],
            newCharacters: [{ name: 'Dice', aliases: [] }],
            learned: [{ factId: 'f1', public: false, who: ['Ellie'], how: 'told', toldBy: 'Gabriel Marin', at: 2063 }],
        }, 2063, 2063);

        assert.equal(changed, false);
        assert.deepEqual(ledger, makeBreakfastLedger());
    });
});

describe('applyExtractionAnswer — the scene history', () => {
    it('keeps the scene it replaces in the history, also on an old ledger without one', () => {
        const ledger = makeBreakfastLedger();
        applyExtractionAnswer(ledger, { present: ['Ellie'], newCharacters: [], learned: [] }, 2064, 2065);

        assert.deepEqual(ledger.scene, { at: 2065, present: ['c1'] });
        assert.deepEqual(ledger.sceneHistory, [{ at: 2063, present: ['c1', 'c2'] }]);
    });

    it('keeps the scene it replaces when only the message moves on', () => {
        const ledger = makeBreakfastLedger();
        ledger.sceneHistory = [{ at: 2050, present: ['c2'] }];
        applyExtractionAnswer(ledger, { present: ['Ellie', 'Gabriel Marin'], newCharacters: [], learned: [] }, 2064, 2065);

        assert.deepEqual(ledger.scene, { at: 2065, present: ['c1', 'c2'] });
        assert.deepEqual(ledger.sceneHistory, [
            { at: 2050, present: ['c2'] },
            { at: 2063, present: ['c1', 'c2'] },
        ]);
    });

    it('keeps at most ten earlier scenes, dropping the oldest', () => {
        const ledger = makeBreakfastLedger();
        ledger.sceneHistory = [
            { at: 2053, present: ['c1'] }, { at: 2054, present: ['c1'] }, { at: 2055, present: ['c1'] },
            { at: 2056, present: ['c1'] }, { at: 2057, present: ['c1'] }, { at: 2058, present: ['c1'] },
            { at: 2059, present: ['c1'] }, { at: 2060, present: ['c1'] }, { at: 2061, present: ['c1'] },
            { at: 2062, present: ['c2'] },
        ];
        applyExtractionAnswer(ledger, { present: ['Gabriel Marin'], newCharacters: [], learned: [] }, 2064, 2065);

        assert.deepEqual(ledger.sceneHistory, [
            { at: 2054, present: ['c1'] }, { at: 2055, present: ['c1'] }, { at: 2056, present: ['c1'] },
            { at: 2057, present: ['c1'] }, { at: 2058, present: ['c1'] }, { at: 2059, present: ['c1'] },
            { at: 2060, present: ['c1'] }, { at: 2061, present: ['c1'] }, { at: 2062, present: ['c2'] },
            { at: 2063, present: ['c1', 'c2'] },
        ]);
    });

    it('replaces the scene of the same message without keeping it, as an edit re-extracts it', () => {
        const ledger = makeBreakfastLedger();
        applyExtractionAnswer(ledger, { present: ['Gabriel Marin'], newCharacters: [], learned: [] }, 2063, 2063);

        assert.deepEqual(ledger.scene, { at: 2063, present: ['c2'] });
        assert.equal(ledger.sceneHistory, undefined);
    });

    it('keeps no scene from before the first update', () => {
        const ledger = createEmptyKnowledgeLedger();
        applyExtractionAnswer(ledger, { present: [], newCharacters: [{ name: 'Ellie', aliases: [] }], learned: [] }, 0, 3);

        assert.deepEqual(ledger.scene, { at: 3, present: [] });
        assert.deepEqual(ledger.sceneHistory, []);
    });

    it('goes back to the scene before a swiped reply once that reply is dropped', () => {
        // Reply 44 (Ellie and Amy in the scene) is swiped away; the scene of reply 42 comes back.
        const ledger = createEmptyKnowledgeLedger();
        const newCharacters = [{ name: 'Ellie', aliases: [] }, { name: 'Amy', aliases: [] }];
        applyExtractionAnswer(ledger, { present: ['Ellie', 'Amy'], newCharacters, learned: [] }, 41, 42);
        applyExtractionAnswer(ledger, { present: ['Ellie'], newCharacters: [], learned: [] }, 43, 44);

        dropKnowledgeFrom(ledger, 44);

        assert.deepEqual(ledger, {
            characters: [
                { id: 'c1', name: 'Ellie', aliases: [] },
                { id: 'c2', name: 'Amy', aliases: [] },
            ],
            facts: [],
            scene: { at: 42, present: ['c1', 'c2'] },
            sceneHistory: [],
            lastUpdatedAt: 43,
        });
    });
});

describe('applying an extraction answer, then building the block', () => {
    it('makes the teller of a told fact its holder, so a talked-about teller knows it and has told only the listener', () => {
        // Breakfast at 2063: Gabriel tells Ellie about the latches. The answer
        // names only the listener in "who", as the prompt asks.
        const ledger = createEmptyKnowledgeLedger();
        applyExtractionAnswer(ledger, {
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
        applyExtractionAnswer(ledger, {
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
