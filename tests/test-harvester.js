import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { harvestContext } from '../lib/context/harvester.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

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
