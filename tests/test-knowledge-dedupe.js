import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyExtractionAnswer, buildKnowledgeBlock } from '../lib/knowledge/ledger.js';

const HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
    + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
    + 'A character not listed here knows only what everyone knows.]';

/** Amy, Steve and Mara, before anyone learns about the diagnostic logs. */
function makeNightShiftLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Amy', aliases: [] },
            { id: 'c2', name: 'Steve', aliases: [] },
            { id: 'c3', name: 'Mara', aliases: [] },
        ],
        facts: [],
        scene: { at: 49, present: ['c1', 'c2'] },
        sceneHistory: [],
        lastUpdatedAt: 49,
    };
}

describe('applyExtractionAnswer joins learned items with the same text', () => {
    it('makes one fact of the actor\'s item and the told item of the live answer', () => {
        const ledger = makeNightShiftLedger();
        const changed = applyExtractionAnswer(ledger, {
            present: ['Amy', 'Steve'],
            newCharacters: [],
            learned: [
                { text: 'Mara from the night shift rewrote Amy\'s diagnostic logs.', public: false, who: ['Mara', 'Steve'], how: 'witnessed', toldBy: null, at: 50 },
                { text: 'Mara from the night shift rewrote Amy\'s diagnostic logs.', public: false, who: ['Amy'], how: 'told', toldBy: 'Steve', at: 51 },
            ],
            revealedSecrets: [],
        }, 50, 51);

        assert.equal(changed, true);
        assert.deepEqual(ledger.facts, [
            {
                id: 'f1',
                text: 'Mara from the night shift rewrote Amy\'s diagnostic logs.',
                public: false,
                holders: [
                    { characterId: 'c3', how: 'witnessed', toldBy: null, at: 50 },
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 50 },
                    { characterId: 'c1', how: 'told', toldBy: 'c2', at: 51 },
                ],
            },
        ]);

        const block = buildKnowledgeBlock(ledger, [
            { is_user: true, is_system: false, name: 'Amy', mes: 'Why would Mara touch my logs?' },
        ]);
        assert.equal(block, [
            HEADER,
            '',
            'AMY (present)',
            '- Knows (told by Steve): Mara from the night shift rewrote Amy\'s diagnostic logs. (shared only with Mara and Steve)',
            '',
            'STEVE (present)',
            '- Knows: Mara from the night shift rewrote Amy\'s diagnostic logs. (shared only with Mara and Amy)',
            '',
            'MARA (talked about, not present)',
            '- Knows: Mara from the night shift rewrote Amy\'s diagnostic logs. (shared only with Steve and Amy)',
        ].join('\n'));
    });

    it('adds holders to a ledger fact whose text differs only in case, spaces and the full stop', () => {
        const ledger = makeNightShiftLedger();
        ledger.facts.push({
            id: 'f1',
            text: 'Mara from the night shift rewrote Amy\'s diagnostic logs.',
            public: false,
            holders: [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 40 }],
        });

        applyExtractionAnswer(ledger, {
            present: ['Amy', 'Steve'],
            newCharacters: [],
            learned: [
                { text: '  mara from the NIGHT shift   rewrote amy\'s diagnostic logs ', public: false, who: ['Mara', 'Steve'], how: 'witnessed', toldBy: null, at: 50 },
                { text: 'The coffee machine on level two is broken.', public: false, who: ['Amy'], how: 'witnessed', toldBy: null, at: 50 },
            ],
            revealedSecrets: [],
        }, 50, 50);

        assert.deepEqual(ledger.facts, [
            {
                id: 'f1',
                text: 'Mara from the night shift rewrote Amy\'s diagnostic logs.',
                public: false,
                holders: [
                    { characterId: 'c3', how: 'witnessed', toldBy: null, at: 40 },
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 50 },
                ],
            },
            {
                id: 'f2',
                text: 'The coffee machine on level two is broken.',
                public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 50 }],
            },
        ]);
    });
});
