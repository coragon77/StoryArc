import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeBlock, dropKnowledgeFrom } from '../lib/knowledge/ledger.js';

const cast = [
    { id: 'gabriel', name: 'Gabriel Marin', aliases: ['Aegis'] },
    { id: 'ellie', name: 'Ellie', aliases: ['Dice'] },
    { id: 'noor', name: 'Noor al-Jamil', aliases: [] },
];

describe('dropKnowledgeFrom — what was learned from message N on is taken back', () => {
    it('removes holders learned at N or later and keeps earlier ones', () => {
        const ledger = {
            characters: cast,
            facts: [
                {
                    id: 'f1', text: 'Noor should lock the gauntlet on with titanium latches', public: false,
                    holders: [
                        { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 },
                        { characterId: 'ellie', how: 'told', toldBy: 'gabriel', at: 2063 },
                        { characterId: 'noor', how: 'told', toldBy: 'ellie', at: 2079 },
                    ],
                },
            ],
            scene: { at: 2070, present: ['gabriel', 'ellie'] },
            lastUpdatedAt: 2070,
        };

        const changed = dropKnowledgeFrom(ledger, 2079);

        assert.equal(changed, true);
        assert.deepEqual(ledger, {
            characters: cast,
            facts: [
                {
                    id: 'f1', text: 'Noor should lock the gauntlet on with titanium latches', public: false,
                    holders: [
                        { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2063 },
                        { characterId: 'ellie', how: 'told', toldBy: 'gabriel', at: 2063 },
                    ],
                },
            ],
            scene: { at: 2070, present: ['gabriel', 'ellie'] },
            lastUpdatedAt: 2070,
        });
    });

    it('removes a fact whose last holder is removed and keeps a fact with a user-entered holder', () => {
        const ledger = {
            characters: cast,
            facts: [
                {
                    id: 'f1', text: 'Aegis called the bench phone at seven', public: false,
                    holders: [
                        { characterId: 'noor', how: 'witnessed', toldBy: null, at: 2079 },
                    ],
                },
                {
                    id: 'f2', text: 'Noor tunes Aegis\'s suit', public: false,
                    holders: [
                        { characterId: 'noor', how: 'user', toldBy: null, at: null },
                        { characterId: 'ellie', how: 'witnessed', toldBy: null, at: 2080 },
                    ],
                },
                {
                    id: 'f3', text: 'Overdrive is Bellweather\'s ringer for Sunday', public: true,
                    holders: [
                        { characterId: 'ellie', how: 'public', toldBy: null, at: 2050 },
                    ],
                },
            ],
            scene: { at: 2070, present: ['ellie'] },
            lastUpdatedAt: 2070,
        };

        const changed = dropKnowledgeFrom(ledger, 2079);

        assert.equal(changed, true);
        assert.deepEqual(ledger.facts, [
            {
                id: 'f2', text: 'Noor tunes Aegis\'s suit', public: false,
                holders: [
                    { characterId: 'noor', how: 'user', toldBy: null, at: null },
                ],
            },
            {
                id: 'f3', text: 'Overdrive is Bellweather\'s ringer for Sunday', public: true,
                holders: [
                    { characterId: 'ellie', how: 'public', toldBy: null, at: 2050 },
                ],
            },
        ]);
    });

    it('resets a scene and a last update at or after N, so the next update starts at N', () => {
        const ledger = {
            characters: cast,
            facts: [],
            scene: { at: 2079, present: ['noor', 'ellie'] },
            lastUpdatedAt: 2081,
        };

        const changed = dropKnowledgeFrom(ledger, 2079);

        assert.equal(changed, true);
        assert.deepEqual(ledger, {
            characters: cast,
            facts: [],
            scene: { at: null, present: [] },
            lastUpdatedAt: 2078,
        });
    });

    it('resets the last update to none when everything from the first message on is dropped', () => {
        const ledger = {
            characters: cast,
            facts: [],
            scene: { at: 0, present: ['ellie'] },
            lastUpdatedAt: 0,
        };

        assert.equal(dropKnowledgeFrom(ledger, 0), true);
        assert.deepEqual(ledger.scene, { at: null, present: [] });
        assert.equal(ledger.lastUpdatedAt, null);
    });

    it('reports false and leaves the ledger as it was when nothing came from N on', () => {
        const ledger = {
            characters: cast,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [
                        { characterId: 'noor', how: 'user', toldBy: null, at: null },
                        { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2040 },
                    ],
                },
            ],
            scene: { at: 2070, present: ['ellie'] },
            lastUpdatedAt: 2070,
        };

        assert.equal(dropKnowledgeFrom(ledger, 2079), false);
        assert.deepEqual(ledger, {
            characters: cast,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [
                        { characterId: 'noor', how: 'user', toldBy: null, at: null },
                        { characterId: 'gabriel', how: 'witnessed', toldBy: null, at: 2040 },
                    ],
                },
            ],
            scene: { at: 2070, present: ['ellie'] },
            lastUpdatedAt: 2070,
        });
    });

    it('reports false for an empty ledger before its first update', () => {
        const ledger = { characters: [], facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null };

        assert.equal(dropKnowledgeFrom(ledger, 0), false);
        assert.deepEqual(ledger, { characters: [], facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null });
    });
});

describe('dropKnowledgeFrom — the scene goes back to the one before the dropped message', () => {
    it('restores the latest earlier scene and drops the later ones from the history', () => {
        const ledger = {
            characters: cast,
            facts: [],
            scene: { at: 44, present: ['noor'] },
            sceneHistory: [
                { at: 38, present: ['gabriel'] },
                { at: 40, present: ['ellie', 'gabriel'] },
                { at: 42, present: ['ellie', 'noor'] },
            ],
            lastUpdatedAt: 44,
        };

        const changed = dropKnowledgeFrom(ledger, 42);

        assert.equal(changed, true);
        assert.deepEqual(ledger, {
            characters: cast,
            facts: [],
            scene: { at: 40, present: ['ellie', 'gabriel'] },
            sceneHistory: [
                { at: 38, present: ['gabriel'] },
            ],
            lastUpdatedAt: 41,
        });
    });

    it('restores the previous scene when only the latest reply is gone, so the block shows its characters present', () => {
        const amyCast = [
            { id: 'c1', name: 'Ellie', aliases: [] },
            { id: 'c2', name: 'Amy', aliases: [] },
        ];
        const ledger = {
            characters: amyCast,
            facts: [
                {
                    id: 'f1', text: 'Amy\'s diagnostic logs were rewritten.', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 42 }],
                },
            ],
            scene: { at: 44, present: ['c1', 'c2'] },
            sceneHistory: [{ at: 42, present: ['c1', 'c2'] }],
            lastUpdatedAt: 44,
        };

        dropKnowledgeFrom(ledger, 44);

        assert.deepEqual(ledger.scene, { at: 42, present: ['c1', 'c2'] });
        assert.deepEqual(ledger.sceneHistory, []);
        const messages = [
            { is_user: true, mes: 'Ellie sits down next to Amy.' },
        ];
        assert.equal(buildKnowledgeBlock(ledger, messages), [
            '[WHO KNOWS WHAT — characters in this scene and characters being talked about. Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for.]',
            '',
            'ELLIE (present)',
            '- Knows: Amy\'s diagnostic logs were rewritten. (known only to them)',
        ].join('\n'));
    });

    it('empties the scene when the history holds no scene before the dropped message', () => {
        const ledger = {
            characters: cast,
            facts: [],
            scene: { at: 44, present: ['noor'] },
            sceneHistory: [{ at: 43, present: ['ellie'] }],
            lastUpdatedAt: 44,
        };

        dropKnowledgeFrom(ledger, 43);

        assert.deepEqual(ledger.scene, { at: null, present: [] });
        assert.deepEqual(ledger.sceneHistory, []);
    });

    it('empties the scene of an old ledger that has no scene history', () => {
        const ledger = {
            characters: cast,
            facts: [],
            scene: { at: 44, present: ['noor'] },
            lastUpdatedAt: 44,
        };

        assert.equal(dropKnowledgeFrom(ledger, 44), true);
        assert.deepEqual(ledger, {
            characters: cast,
            facts: [],
            scene: { at: null, present: [] },
            lastUpdatedAt: 43,
        });
    });
});
