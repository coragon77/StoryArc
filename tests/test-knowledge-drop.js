import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dropKnowledgeFrom } from '../lib/knowledge/ledger.js';

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
