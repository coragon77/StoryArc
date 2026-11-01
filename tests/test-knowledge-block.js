import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeBlock } from '../lib/knowledge/ledger.js';
import { createEmptyKnowledgeLedger } from '../lib/core/constants.js';

const HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character speaks and acts only from their own list. '
    + 'Knowledge moves between characters only on-screen.]';

/** The workshop scene of the spec's appendix, cut down to five facts. */
function makeWorkshopLedger() {
    return {
        characters: [
            { id: 'noor', name: 'Noor', aliases: ['Al-Jamil'] },
            { id: 'dougal', name: 'Dougal', aliases: [] },
            { id: 'gabriel', name: 'Gabriel Marin', aliases: ['Aegis', 'Mr. Marin'] },
            { id: 'ellie', name: 'Ellie', aliases: ['Dice'] },
        ],
        facts: [
            {
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'noor', how: 'witnessed', toldBy: null, at: 100 }],
            },
            {
                id: 'f2', text: 'Gabriel Marin is Aegis', public: false,
                holders: [
                    { characterId: 'noor', how: 'user', toldBy: null, at: null },
                    { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2000 },
                ],
            },
            {
                id: 'f3', text: 'Vera Lin broke into the Annex last night', public: false,
                holders: [
                    { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2050 },
                    { characterId: 'ellie', how: 'witnessed', toldBy: null, at: 2050 },
                ],
            },
            {
                id: 'f4', text: 'Noor should lock the gauntlet on with titanium latches', public: false,
                holders: [
                    { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 },
                    { characterId: 'ellie', how: 'told', toldBy: 'gabriel', at: 2063 },
                ],
            },
            {
                id: 'f5', text: 'the kiln router logged 42.08 kHz queries overnight', public: false,
                holders: [{ characterId: 'dougal', how: 'witnessed', toldBy: null, at: 2070 }],
            },
        ],
        scene: { at: 2078, present: ['noor', 'dougal'] },
        lastUpdatedAt: 2078,
    };
}

function message(isUser, text) {
    return { is_user: isUser, is_system: false, name: isUser ? 'Ellie' : 'Narrator', mes: text };
}

describe('buildKnowledgeBlock', () => {
    it('gives an empty string for an empty ledger', () => {
        assert.equal(buildKnowledgeBlock(createEmptyKnowledgeLedger(), []), '');
    });

    it('covers the characters present and the one the latest message names, in the card format', () => {
        const messages = [
            message(false, 'Noor looks up from the bench. Dougal is out back.'),
            message(true, 'I drop my bag on the bench. "Gabriel Marin says hi."'),
        ];

        const expected = [
            HEADER,
            '',
            'NOOR (present)',
            '- Knows: Gabriel Marin is Aegis',
            '- Knows: Ellie is Dice',
            '- Does not know: the kiln router logged 42.08 kHz queries overnight',
            '- Does not know: Noor should lock the gauntlet on with titanium latches',
            '- Does not know: Vera Lin broke into the Annex last night',
            '',
            'DOUGAL (present)',
            '- Knows: the kiln router logged 42.08 kHz queries overnight',
            '- Does not know: Gabriel Marin is Aegis',
            '- Does not know: Noor should lock the gauntlet on with titanium latches',
            '- Does not know: Vera Lin broke into the Annex last night',
            '- Does not know: Ellie is Dice',
            '',
            'GABRIEL MARIN (talked about, not present)',
            '- Knows: Noor should lock the gauntlet on with titanium latches',
            '- Knows: Vera Lin broke into the Annex last night',
            '- Knows: Gabriel Marin is Aegis',
            '- Does not know: the kiln router logged 42.08 kHz queries overnight',
            '- Does not know: Ellie is Dice',
            '- Has told only Ellie: Noor should lock the gauntlet on with titanium latches',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(makeWorkshopLedger(), messages), expected);
    });

    it('covers a character the latest reply names only by an alias', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['noor'];
        const messages = [
            message(true, 'I wave at Noor.'),
            message(false, 'Somewhere above the workshop, Aegis lands on the roof.'),
        ];

        const expected = [
            HEADER,
            '',
            'NOOR (present)',
            '- Knows: Gabriel Marin is Aegis',
            '- Knows: Ellie is Dice',
            '- Does not know: Noor should lock the gauntlet on with titanium latches',
            '- Does not know: Vera Lin broke into the Annex last night',
            '',
            'GABRIEL MARIN (talked about, not present)',
            '- Knows: Noor should lock the gauntlet on with titanium latches',
            '- Knows: Vera Lin broke into the Annex last night',
            '- Knows: Gabriel Marin is Aegis',
            '- Does not know: Ellie is Dice',
            '- Has told only Ellie: Noor should lock the gauntlet on with titanium latches',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, messages), expected);
    });

    it('says who told a character what they know', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = ['ellie'];

        const expected = [
            HEADER,
            '',
            'ELLIE (present)',
            '- Knows (told by Gabriel Marin): Noor should lock the gauntlet on with titanium latches',
            '- Knows: Vera Lin broke into the Annex last night',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, [message(true, 'I head to the workshop.')]), expected);
    });

    it('prints neither a public fact nor a fact held only through the plan', () => {
        const ledger = {
            characters: [
                { id: 'noor', name: 'Noor', aliases: [] },
                { id: 'julian', name: 'Julian', aliases: [] },
            ],
            facts: [
                {
                    id: 'promo', text: 'Overdrive unravels synthetic suits', public: true,
                    holders: [
                        { characterId: 'noor', how: 'public', toldBy: null, at: 1990 },
                        { characterId: 'julian', how: 'public', toldBy: null, at: 1990 },
                    ],
                },
                {
                    id: 'crane', text: 'Julian plans to drop a crane on the arena', public: false,
                    holders: [{ characterId: 'julian', how: 'plan', toldBy: null, at: null }],
                },
                {
                    id: 'window', text: 'the kiln-room window was broken overnight', public: false,
                    holders: [{ characterId: 'noor', how: 'witnessed', toldBy: null, at: 2075 }],
                },
            ],
            scene: { at: 2078, present: ['noor', 'julian'] },
            lastUpdatedAt: 2078,
        };

        const expected = [
            HEADER,
            '',
            'NOOR (present)',
            '- Knows: the kiln-room window was broken overnight',
            '',
            'JULIAN (present)',
            '- Does not know: the kiln-room window was broken overnight',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('keeps the five newest entries of a list longer than its cap', () => {
        const facts = [];
        for (let at = 1; at <= 7; at++) {
            facts.push({
                id: `f${at}`, text: `fact ${at}`, public: false,
                holders: [{ characterId: 'noor', how: 'witnessed', toldBy: null, at }],
            });
        }
        const ledger = {
            characters: [
                { id: 'noor', name: 'Noor', aliases: [] },
                { id: 'dougal', name: 'Dougal', aliases: [] },
            ],
            facts,
            scene: { at: 7, present: ['noor', 'dougal'] },
            lastUpdatedAt: 7,
        };

        const expected = [
            HEADER,
            '',
            'NOOR (present)',
            '- Knows: fact 7',
            '- Knows: fact 6',
            '- Knows: fact 5',
            '- Knows: fact 4',
            '- Knows: fact 3',
            '',
            'DOUGAL (present)',
            '- Does not know: fact 7',
            '- Does not know: fact 6',
            '- Does not know: fact 5',
            '- Does not know: fact 4',
            '- Does not know: fact 3',
        ].join('\n');

        assert.equal(buildKnowledgeBlock(ledger, []), expected);
    });

    it('gives an empty string when no character is present or talked about', () => {
        const ledger = makeWorkshopLedger();
        ledger.scene.present = [];
        const messages = [message(true, 'I head out.'), message(false, 'The street is empty.')];

        assert.equal(buildKnowledgeBlock(ledger, messages), '');
    });
});
