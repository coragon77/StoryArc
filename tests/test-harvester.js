import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { harvestContext } from '../lib/context/harvester.js';
import { chat, chat_metadata, extension_settings } from './mocks/st-mocks.js';

describe('harvestContext — story messages only', () => {
    async function withChat(messages, arcs, fn) {
        chat.length = 0;
        chat.push(...messages);
        chat_metadata.story_arc = { version: 1, arcs, settings: {}, pendingMarks: [] };
        try {
            return await fn();
        } finally {
            chat.length = 0;
            delete chat_metadata.story_arc;
        }
    }

    // An abandoned arc still counts: its ids are no more story than an active one's.
    const abandonedAct = {
        id: 'c3310c73-64c1-4415-8dbe-31b496dc425e',
        title: 'Trade Dress',
        status: 'abandoned',
        tier: 'act',
        focus: 'normal',
        beats: [{ id: 'soma_scrimmage_showdown', status: 'active' }],
        secrets: [{ id: 'scrimmage_collar_trophy_gambit', content: 'x', revealPhase: 'climax', disclosed: false }],
        triggers: [],
        foreshadowing: [],
    };

    it('drops a message that names a plan id, keeps the OOC critique next to it', async () => {
        const critique = { is_user: true, name: 'Ellie', mes: '[OOC: I think you have written yourself in a corner - the whole weighing plot is bullshit.]' };
        const analysis = { is_user: false, name: 'Paragon', mes: '[OOC: Stopping.\n- **Apex** has gauntlets with an unauthorized neural-static tether (secret: scrimmage_collar_trophy_gambit)]' };
        const story = { is_user: false, name: 'Paragon', mes: 'Ellie hooked one thumb into the zipper of her backpack.' };

        const context = await withChat([critique, analysis, story], [abandonedAct], () => harvestContext());

        assert.deepEqual(context.chatHistory.map(message => message.content), [
            '[OOC: I think you have written yourself in a corner - the whole weighing plot is bullshit.]',
            'Ellie hooked one thumb into the zipper of her backpack.',
        ]);
    });

    it('drops a message carrying the injection header or a signal marker', async () => {
        const pastedPrompt = { is_user: true, name: 'Ellie', mes: 'Why did you do this?\n[STORY ARC - NARRATIVE DIRECTION]\n=== ACT: "Trade Dress" ===' };
        const marker = { is_user: false, name: 'Paragon', mes: '<!-- [ARC_SIGNAL:c3310c73:beat_3:COMPLETE] -->\nShe ran.' };
        const story = { is_user: false, name: 'Paragon', mes: 'The freight elevator clanked to a halt.' };

        const context = await withChat([pastedPrompt, marker, story], [], () => harvestContext());

        assert.deepEqual(context.chatHistory.map(message => message.content), ['The freight elevator clanked to a halt.']);
    });
});

describe('harvestContext — the cast', () => {
    const storedLedger = {
        characters: [
            { id: 'c1', name: 'Julian Sterling', aliases: ['Jules'] },
            { id: 'c2', name: 'Priya', aliases: [] },
        ],
        facts: [],
        scene: { at: 0, present: [] },
        lastUpdatedAt: 0,
    };

    async function harvestWithTracker(trackerOn) {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: trackerOn } };
        chat_metadata.story_arc = { version: 1, arcs: [], settings: {}, pendingMarks: [], knowledge: storedLedger };
        try {
            return await harvestContext();
        } finally {
            delete chat_metadata.story_arc;
            delete extension_settings.story_arc;
        }
    }

    it('is the ledger\'s characters with their aliases, in ledger order, while the tracker is on', async () => {
        const context = await harvestWithTracker(true);

        assert.deepEqual(context.cast, [
            { name: 'Julian Sterling', aliases: ['Jules'], details: {} },
            { name: 'Priya', aliases: [], details: {} },
        ]);
    });

    it('is empty while the tracker is off', async () => {
        const context = await harvestWithTracker(false);

        assert.deepEqual(context.cast, []);
    });

    it('counts the cast in the token estimate', async () => {
        const withCast = await harvestWithTracker(true);
        const withoutCast = await harvestWithTracker(false);

        // "Julian Sterling Jules\nPriya" is 27 characters, 28 with the joining newline:
        // 7 more tokens at four characters per token.
        assert.equal(withCast.estimatedTokens - withoutCast.estimatedTokens, 7);
    });
});

describe('harvestContext — the cast\'s details', () => {
    // Ellie's age was set by the player; her role changed once, so the
    // later entry is the current one; her relation points at Mara by id.
    const ledgerWithDetails = {
        characters: [
            {
                id: 'c1', name: 'Ellie Masters', aliases: ['Dice'],
                details: {
                    age: [{ value: '18', at: null, by: 'user' }],
                    role: [
                        { value: 'junior at Westbrook High', at: 12 },
                        { value: 'uncertified Ward, senior at Westbrook High', at: 340 },
                    ],
                    relation: [{ value: { kind: 'sister', of: 'c2' }, at: 50 }],
                },
            },
            { id: 'c2', name: 'Mara Masters', aliases: [] },
        ],
        facts: [],
        scene: { at: 0, present: [] },
        lastUpdatedAt: 0,
    };

    async function harvestWithDetails(characterDetails) {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, characterDetails } };
        chat_metadata.story_arc = { version: 1, arcs: [], settings: {}, pendingMarks: [], knowledge: ledgerWithDetails };
        try {
            return await harvestContext();
        } finally {
            delete chat_metadata.story_arc;
            delete extension_settings.story_arc;
        }
    }

    it('gives each member the current value of every known kind, a relation by name', async () => {
        const context = await harvestWithDetails(true);

        assert.deepEqual(context.cast, [
            {
                name: 'Ellie Masters',
                aliases: ['Dice'],
                details: { age: '18', role: 'uncertified Ward, senior at Westbrook High', relation: 'Mara Masters\'s sister' },
            },
            { name: 'Mara Masters', aliases: [], details: {} },
        ]);
    });

    it('gives no details while character details are off', async () => {
        const context = await harvestWithDetails(false);

        assert.deepEqual(context.cast.map(member => member.details), [{}, {}]);
    });
});
