import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { rollBackKnowledgeFrom, updateKnowledgeAfterReply, updateKnowledgeAfterSwipe, updateKnowledgeAfterEdit } from '../lib/knowledge/ledger.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/**
 * Replace the extraction template with one that only lists the messages,
 * and the transport with one that records each prompt and answers with the
 * next queued answer text.
 */
function installExtraction(answers) {
    const sentPrompts = [];
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('extract-knowledge.txt')) return new Response('MESSAGES:\n{{MESSAGES}}');
        throw new Error(`unexpected fetch ${url}`);
    };
    ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
        sentPrompts.push(messages[0].content);
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
    return sentPrompts;
}

function setSwitches({ tracker }) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: tracker, updateInterval: 1 },
    };
}

/**
 * A workshop chat: greeting, then user and reply in turn, seven messages.
 * Messages 0 to 5 carry the Story Arc message id m0 … m5 already, so the ids
 * an update stores are known in advance. Message 6 carries none: every
 * swipe takes its message id, and the extraction that reads it gives it a new one.
 */
function fillChat() {
    chat.length = 0;
    chat.push(
        { is_user: false, is_system: false, name: 'Noor', mes: 'Welcome to the bay.', extra: { story_arc_message_id: 'm0' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Hi Noor.', extra: { story_arc_message_id: 'm1' } },
        { is_user: false, is_system: false, name: 'Noor', mes: 'Gauntlet on the bench.', extra: { story_arc_message_id: 'm2' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Gabriel wants titanium latches.', extra: { story_arc_message_id: 'm3' } },
        { is_user: false, is_system: false, name: 'Noor', mes: 'Titanium it is.', extra: { story_arc_message_id: 'm4' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Thanks.', extra: { story_arc_message_id: 'm5' } },
        {
            is_user: false, is_system: false, name: 'Noor', mes: 'Dougal heard you.',
            swipe_id: 0, swipes: ['Dougal heard you.'],
        },
    );
}

/**
 * Noor and Ellie and Dougal, updated through message 6:
 * f1 Noor witnessed at 1, f2 Noor was told at 3, f3 Dougal witnessed at 6,
 * f4 entered by the user. The scene is from message 6.
 */
function storeLedger() {
    chat_metadata.story_arc = {
        knowledge: {
            characters: [
                { id: 'c1', name: 'Noor', aliases: [] },
                { id: 'c2', name: 'Ellie', aliases: [] },
                { id: 'c3', name: 'Dougal', aliases: [] },
            ],
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }],
                },
                {
                    id: 'f2', text: 'Gabriel wants titanium latches', public: false,
                    holders: [{ characterId: 'c1', how: 'told', toldBy: 'c2', at: 3 }],
                },
                {
                    id: 'f3', text: 'Ellie ordered the latches for Gabriel', public: false,
                    holders: [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 6 }],
                },
                {
                    id: 'f4', text: 'Noor tunes the suit', public: false,
                    holders: [{ characterId: 'c2', how: 'user', toldBy: null, at: null }],
                },
            ],
            scene: { at: 6, present: ['c1', 'c2', 'c3'] },
            lastUpdatedAt: 6,
        },
    };
}

const CHARACTERS = [
    { id: 'c1', name: 'Noor', aliases: [] },
    { id: 'c2', name: 'Ellie', aliases: [] },
    { id: 'c3', name: 'Dougal', aliases: [] },
];
const FACT_F1 = {
    id: 'f1', text: 'Ellie is Dice', public: false,
    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }],
};
const FACT_F2 = {
    id: 'f2', text: 'Gabriel wants titanium latches', public: false,
    holders: [{ characterId: 'c1', how: 'told', toldBy: 'c2', at: 3 }],
};
const FACT_F3 = {
    id: 'f3', text: 'Ellie ordered the latches for Gabriel', public: false,
    holders: [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 6 }],
};
const FACT_F4 = {
    id: 'f4', text: 'Noor tunes the suit', public: false,
    holders: [{ characterId: 'c2', how: 'user', toldBy: null, at: null }],
};

/** The answer for a reply in which Noor alone is present and learns nothing. */
const ANSWER_NOOR_ALONE = JSON.stringify({ present: ['Noor'], newCharacters: [], learned: [] });

describe('rollBackKnowledgeFrom', () => {
    beforeEach(() => {
        fillChat();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('a regeneration removes the discarded reply\'s knowledge before the new reply is extracted', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);

        // ST deletes the last reply and passes the new chat length ...
        chat.length = 6;
        const rolledBack = await rollBackKnowledgeFrom(6);
        // ... then the new reply arrives at the same index.
        chat.push({ is_user: false, is_system: false, name: 'Noor', mes: 'Nobody else is here.', extra: { story_arc_message_id: 'm6b' } });
        const updated = await updateKnowledgeAfterReply(6);

        assert.equal(rolledBack, true);
        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[6] Noor: Nobody else is here.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F2, FACT_F4],
            scene: { at: 6, messageId: 'm6b', present: ['c1'] },
            lastUpdatedAt: 6,
            lastUpdatedMessageId: 'm6b',
            updateLog: [
                { kind: 'rollback', from: 6, factsDropped: ['f3'], holdersDropped: 1, factsRestored: [], detailsDropped: 0 },
                {
                    kind: 'update', recordId: 'u1', from: 6, to: 6, messageId: 'm6b',
                    answer: { present: 1, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                    factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [], details: [], names: [], scene: ['c1'] },
                },
            ],
        });
    });

    it('a branch made before the last messages starts without their knowledge', async () => {
        setSwitches({ tracker: true });
        storeLedger();

        // The branch ends at message 2: ST copied the ledger whole.
        chat.length = 3;
        const rolledBack = await rollBackKnowledgeFrom(chat.length);

        assert.equal(rolledBack, true);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F4],
            scene: { at: null, present: [] },
            lastUpdatedAt: 2,
            updateLog: [{ kind: 'rollback', from: 3, factsDropped: ['f2', 'f3'], holdersDropped: 2, factsRestored: [], detailsDropped: 0 }],
        });
    });

    it('changes nothing when the chat is as long as the ledger', async () => {
        setSwitches({ tracker: false });
        storeLedger();

        const rolledBack = await rollBackKnowledgeFrom(7);

        assert.equal(rolledBack, false);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F3, FACT_F4]);
    });
});

/** The answer for the earlier swipe of message 6: Noor alone, and the latches are on the news. */
const ANSWER_EARLIER_SWIPE = JSON.stringify({
    present: ['Noor'],
    newCharacters: [],
    learned: [{ text: 'The latches are on the news', public: true, who: ['Noor'], how: 'witnessed', toldBy: null, at: 6 }],
});

/** Message 6 has two swipes and shows the second one. */
function showSecondSwipe() {
    chat[6].swipes = ['Dougal heard you.', 'It is on the news.'];
    chat[6].swipe_id = 1;
    chat[6].mes = 'It is on the news.';
}

describe('updateKnowledgeAfterSwipe', () => {
    beforeEach(() => {
        fillChat();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('a swipe that generates a new reply drops from the swiped message on and makes no call', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);
        // ST points swipe_id at the slot the generation is about to fill.
        chat[6].swipe_id = 1;

        const updated = await updateKnowledgeAfterSwipe(6);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F2, FACT_F4],
            scene: { at: null, present: [] },
            lastUpdatedAt: 5,
            lastUpdatedMessageId: 'm5',
            updateLog: [{ kind: 'rollback', from: 6, factsDropped: ['f3'], holdersDropped: 1, factsRestored: [], detailsDropped: 0 }],
        });
    });

    it('switching to an existing swipe re-extracts that one message', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_EARLIER_SWIPE]);
        showSecondSwipe();

        const updated = await updateKnowledgeAfterSwipe(6);
        // The re-extraction gave the shown swipe a message id; the id itself is opaque.
        const swipeMessageId = chat[6].extra.story_arc_message_id;

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.equal(typeof swipeMessageId, 'string');
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[6] Noor: It is on the news.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [
                FACT_F1, FACT_F2, FACT_F4,
                {
                    id: 'f5', text: 'The latches are on the news', public: true,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 6, messageId: swipeMessageId }],
                },
            ],
            scene: { at: 6, messageId: swipeMessageId, present: ['c1'] },
            lastUpdatedAt: 6,
            lastUpdatedMessageId: swipeMessageId,
            updateLog: [
                { kind: 'rollback', from: 6, factsDropped: ['f3'], holdersDropped: 1, factsRestored: [], detailsDropped: 0 },
                {
                    kind: 'reextract', recordId: 'u1', from: 6, to: 6, messageId: swipeMessageId,
                    answer: { present: 1, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                    factsCreated: ['f5'], holdersAdded: 1, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [{ factId: 'f5', characterId: 'c1', messageId: swipeMessageId }], details: [], names: [], scene: ['c1'] },
                },
            ],
        });
    });

    it('a swipe switch on a message no update has read yet changes nothing; the next update reads it', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        chat_metadata.story_arc.knowledge.facts = [FACT_F1, FACT_F2, FACT_F4];
        chat_metadata.story_arc.knowledge.scene = { at: 4, present: ['c1'] };
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 4;
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);
        showSecondSwipe();

        const updated = await updateKnowledgeAfterSwipe(6);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.equal(chat_metadata.story_arc.knowledge.lastUpdatedAt, 4);
    });

    it('with the tracker off a swipe switch only drops, so the next update reads the shown swipe', async () => {
        setSwitches({ tracker: false });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_EARLIER_SWIPE]);
        showSecondSwipe();

        const updated = await updateKnowledgeAfterSwipe(6);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F4]);
        assert.equal(chat_metadata.story_arc.knowledge.lastUpdatedAt, 5);
    });

    it('drops the late answer when the user swiped again during the call', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        installExtraction([]);
        showSecondSwipe();
        ConnectionManagerRequestService.sendRequest = async () => {
            chat[6].swipe_id = 0;
            chat[6].mes = 'Dougal heard you.';
            return () => (async function* () { yield { text: ANSWER_EARLIER_SWIPE }; })();
        };

        await updateKnowledgeAfterSwipe(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F4]);
        assert.equal(chat_metadata.story_arc.knowledge.lastUpdatedAt, 5);
    });

    it('drops the late answer when a reply update read the message during the call', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        installExtraction([]);
        showSecondSwipe();
        ConnectionManagerRequestService.sendRequest = async () => {
            // The next reply's update covered messages 6 to 8 meanwhile.
            chat_metadata.story_arc.knowledge.lastUpdatedAt = 8;
            return () => (async function* () { yield { text: ANSWER_EARLIER_SWIPE }; })();
        };

        await updateKnowledgeAfterSwipe(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F4]);
        assert.equal(chat_metadata.story_arc.knowledge.lastUpdatedAt, 8);
    });
});

/** The answer for the edited message 3: Ellie now tells Noor about steel latches. */
const ANSWER_EDITED_MESSAGE_3 = JSON.stringify({
    present: ['Ellie'],
    newCharacters: [],
    learned: [{ text: 'Gabriel wants steel latches', public: false, who: ['Noor'], how: 'told', toldBy: 'Ellie', at: 3 }],
});

/** Fact f5 as applying ANSWER_EDITED_MESSAGE_3 creates it. */
const FACT_STEEL_LATCHES = {
    id: 'f5', text: 'Gabriel wants steel latches', public: false,
    holders: [
        { characterId: 'c2', how: 'witnessed', toldBy: null, at: 3, messageId: 'm3' },
        { characterId: 'c1', how: 'told', toldBy: 'c2', at: 3, messageId: 'm3' },
    ],
};

describe('updateKnowledgeAfterEdit', () => {
    beforeEach(() => {
        fillChat();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('editing an old message re-extracts only that message and keeps later knowledge', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_EDITED_MESSAGE_3]);
        chat[3].mes = 'Gabriel wants steel latches.';

        const updated = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[3] Ellie: Gabriel wants steel latches.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F3, FACT_F4, FACT_STEEL_LATCHES],
            scene: { at: 6, present: ['c1', 'c2', 'c3'] },
            // The ledger had no meetings: its scene became the first. Ellie alone at 3 is none.
            meetings: [{ at: 6, present: ['c1', 'c2', 'c3'] }],
            lastUpdatedAt: 6,
            // The edit's own drop of message 3 (f2) is no rollback record.
            updateLog: [{
                kind: 'reextract', recordId: 'u1', from: 3, to: 3, messageId: 'm3',
                answer: { present: 1, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                factsCreated: ['f5'], holdersAdded: 2, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [{ factId: 'f5', characterId: 'c2', messageId: 'm3' }, { factId: 'f5', characterId: 'c1', messageId: 'm3' }], details: [], names: [], scene: null },
            }],
        });
    });

    it('a failed re-extraction of an edited message keeps what the ledger learned there, its meeting included', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        const meetings = [
            { at: 3, present: ['c1', 'c2'] },
            { at: 6, present: ['c1', 'c2', 'c3'] },
        ];
        chat_metadata.story_arc.knowledge.meetings = structuredClone(meetings);
        installExtraction(['not an answer']);
        chat[3].mes = 'Gabriel wants steel latches.';

        const updated = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F3, FACT_F4]);
        assert.deepEqual(chat_metadata.story_arc.knowledge.meetings, meetings);
    });

    it('editing a message between the scene and the end of the ledger leaves the scene and its history as they were', async () => {
        // After a rollback the scene is from message 4 while the ledger covers through 6.
        setSwitches({ tracker: true });
        storeLedger();
        chat_metadata.story_arc.knowledge.scene = { at: 4, present: ['c1', 'c2'] };
        chat_metadata.story_arc.knowledge.sceneHistory = [{ at: 2, present: ['c1'] }];
        installExtraction([ANSWER_NOOR_ALONE]);
        chat[5].mes = 'Thanks, Noor.';

        const updated = await updateKnowledgeAfterEdit(5);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F2, FACT_F3, FACT_F4],
            scene: { at: 4, present: ['c1', 'c2'] },
            sceneHistory: [{ at: 2, present: ['c1'] }],
            // The ledger had no meetings: its scene became the first. Noor alone at 5 is none.
            meetings: [{ at: 4, present: ['c1', 'c2'] }],
            lastUpdatedAt: 6,
            updateLog: [{
                kind: 'reextract', recordId: 'u1', from: 5, to: 5, messageId: 'm5',
                answer: { present: 1, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [], details: [], names: [], scene: null },
            }],
        });
    });

    it('editing the latest message takes its scene from the new text', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);
        // The update that read message 6 gave it a message id; an edit keeps the message's extra.
        chat[6].extra = { story_arc_message_id: 'm6' };
        chat[6].mes = 'Nobody else heard you.';

        const updated = await updateKnowledgeAfterEdit(6);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[6] Noor: Nobody else heard you.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F2, FACT_F4],
            scene: { at: 6, messageId: 'm6', present: ['c1'] },
            lastUpdatedAt: 6,
            lastUpdatedMessageId: 'm6',
            updateLog: [{
                kind: 'reextract', recordId: 'u1', from: 6, to: 6, messageId: 'm6',
                answer: { present: 1, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [], details: [], names: [], scene: ['c1'] },
            }],
        });
    });

    it('an edit of a message no update has read yet changes nothing; the next update reads it', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 4;
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);

        const updated = await updateKnowledgeAfterEdit(6);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F3, FACT_F4]);
    });

    it('with the tracker off an edit leaves the ledger as it is', async () => {
        setSwitches({ tracker: false });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_EDITED_MESSAGE_3]);

        const updated = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F3, FACT_F4]);
    });

    it('still applies the edit\'s answer when a reply update moved the ledger on during the call', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        installExtraction([]);
        chat[3].mes = 'Gabriel wants steel latches.';
        ConnectionManagerRequestService.sendRequest = async () => {
            // The next reply's update covered messages 7 and 8 meanwhile.
            chat_metadata.story_arc.knowledge.lastUpdatedAt = 8;
            chat_metadata.story_arc.knowledge.scene = { at: 8, present: ['c2'] };
            return () => (async function* () { yield { text: ANSWER_EDITED_MESSAGE_3 }; })();
        };

        const updated = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F3, FACT_F4, FACT_STEEL_LATCHES],
            scene: { at: 8, present: ['c2'] },
            lastUpdatedAt: 8,
            updateLog: [{
                kind: 'reextract', recordId: 'u1', from: 3, to: 3, messageId: 'm3',
                answer: { present: 1, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                factsCreated: ['f5'], holdersAdded: 2, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, detailsRefined: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [{ factId: 'f5', characterId: 'c2', messageId: 'm3' }, { factId: 'f5', characterId: 'c1', messageId: 'm3' }], details: [], names: [], scene: null },
            }],
        });
    });
});

describe('rollBackKnowledgeFrom when the last read message is gone and the appearance search gave a later one an id', () => {
    /**
     * A chat of 105 messages, the tracker updating every 3 replies. The last
     * update read 97 to 100 (m97 … m100) and the scene before it is from 97;
     * 101 to 104 are not read yet. The player accepted an appearance finding
     * from the unread 103, so it carries the id m103, created and marked by
     * the search, and Noor's hair entry.
     * With `withHashes`, the read messages carry read-text hashes; without,
     * the ledger is from before them and only the ids an update gave show
     * what was read.
     */
    function setUp({ withHashes }) {
        extension_settings.story_arc = {
            enabled: true,
            defaultConnectionProfile: 'profile-1',
            knowledgeTracker: { enabled: true, updateInterval: 3, characterDetails: true, appearance: true },
        };
        chat.length = 0;
        for (let index = 0; index < 105; index++) {
            chat.push({ is_user: index % 2 === 1, is_system: false, name: index % 2 === 1 ? 'Ellie' : 'Noor', mes: `Line ${index}.`, extra: {} });
        }
        for (const index of [97, 98, 99, 100]) {
            chat[index].extra.story_arc_message_id = `m${index}`;
            if (withHashes) chat[index].extra.story_arc_read_text_hash = 1000 + index;
        }
        chat[103].extra.story_arc_message_id = 'm103';
        chat[103].extra.story_arc_message_id_by_search = true;
        chat_metadata.story_arc = {
            knowledge: {
                characters: [{ id: 'c1', name: 'Noor', aliases: [], details: { hair: [{ value: 'dark braids', at: 103, messageId: 'm103' }] } }],
                facts: [{
                    id: 'f1', text: 'The gauntlet is cracked', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 99, messageId: 'm99' }],
                }],
                scene: { at: 100, messageId: 'm100', present: ['c1'] },
                sceneHistory: [{ at: 97, messageId: 'm97', present: ['c1'] }],
                lastUpdatedAt: 100,
                lastUpdatedMessageId: 'm100',
            },
        };
    }

    afterEach(() => {
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('ends the ledger at the last message an update read, not at the one whose id the search created', async () => {
        setUp({ withHashes: true });

        // The player deletes message 100; ST passes only the new length.
        chat.splice(100, 1);
        await rollBackKnowledgeFrom(chat.length);

        const knowledge = chat_metadata.story_arc.knowledge;
        assert.equal(knowledge.lastUpdatedAt, 99);
        assert.equal(knowledge.lastUpdatedMessageId, 'm99');
        assert.deepEqual(knowledge.scene, { at: 97, messageId: 'm97', present: ['c1'] });
        // The accepted finding follows its message, now at 102.
        assert.deepEqual(knowledge.characters[0].details, { hair: [{ value: 'dark braids', at: 102, messageId: 'm103' }] });
    });

    it('in a ledger from before read-text hashes, a message an update gave its id counts as read', async () => {
        setUp({ withHashes: false });

        chat.splice(100, 1);
        await rollBackKnowledgeFrom(chat.length);

        const knowledge = chat_metadata.story_arc.knowledge;
        assert.equal(knowledge.lastUpdatedAt, 99);
        assert.equal(knowledge.lastUpdatedMessageId, 'm99');
    });
});

describe('updateKnowledgeAfterEdit on a hidden message', () => {
    beforeEach(() => {
        fillChat();
        setSwitches({ tracker: true });
        storeLedger();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('a hidden message an update read (it carries a message id) is read again as shown and stays hidden', async () => {
        const sentPrompts = installExtraction([ANSWER_EDITED_MESSAGE_3, ANSWER_EDITED_MESSAGE_3]);
        chat[3].is_system = true;
        chat[3].mes = 'Gabriel wants steel latches.';

        // ST fires MESSAGE_EDITED, then MESSAGE_UPDATED while the first call runs.
        const edited = updateKnowledgeAfterEdit(3);
        const updatedDuringCall = await updateKnowledgeAfterEdit(3);
        await edited;
        // A cancelled edit later fires MESSAGE_UPDATED with the same text.
        const cancelled = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(sentPrompts, ['MESSAGES:\n[3] Ellie: Gabriel wants steel latches.']);
        assert.deepEqual(updatedDuringCall, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(cancelled, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F3, FACT_F4, FACT_STEEL_LATCHES]);
        assert.equal(chat[3].is_system, true);
    });

    it('a hidden message read before message ids (holder entries at its index, no id) is read again and gets an id', async () => {
        const sentPrompts = installExtraction([ANSWER_EDITED_MESSAGE_3]);
        chat[3] = { is_user: true, is_system: true, name: 'Ellie', mes: 'Gabriel wants steel latches.' };

        await updateKnowledgeAfterEdit(3);

        const messageId = chat[3].extra.story_arc_message_id;
        assert.equal(typeof messageId, 'string');
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[3] Ellie: Gabriel wants steel latches.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F3, FACT_F4, {
            ...FACT_STEEL_LATCHES,
            holders: FACT_STEEL_LATCHES.holders.map(holder => ({ ...holder, messageId })),
        }]);
        assert.equal(chat[3].is_system, true);
    });

    it('a hidden message no update read (no message id, nothing at its index) makes no call and changes nothing', async () => {
        const sentPrompts = installExtraction([ANSWER_EDITED_MESSAGE_3]);
        chat[2].is_system = true;
        delete chat[2].extra.story_arc_message_id;
        chat[2].mes = 'Gauntlet and latches on the bench.';
        const ledgerBefore = structuredClone(chat_metadata.story_arc.knowledge);

        const updated = await updateKnowledgeAfterEdit(2);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge, ledgerBefore);
        assert.equal(chat[2].extra.story_arc_read_text_hash, undefined);
    });

    it('a hidden message with an id an update gave it, no read-text hash and nothing learned there counts as read: its edit extracts again', async () => {
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);
        chat[2].is_system = true;
        chat[2].mes = 'Gauntlet and latches on the bench.';

        await updateKnowledgeAfterEdit(2);

        assert.deepEqual(sentPrompts, ['MESSAGES:\n[2] Noor: Gauntlet and latches on the bench.']);
        assert.equal(chat[2].is_system, true);
    });

    it('a hidden message whose id the appearance search created (an accepted appearance entry, no read) makes no call and keeps the entry', async () => {
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);
        chat[2].is_system = true;
        chat[2].extra.story_arc_message_id_by_search = true;
        chat[2].mes = 'Gauntlet and latches on the bench.';
        const noor = chat_metadata.story_arc.knowledge.characters[0];
        noor.details = { hair: [{ value: 'dark braids', at: 2, messageId: 'm2' }] };
        const ledgerBefore = structuredClone(chat_metadata.story_arc.knowledge);

        // MESSAGE_EDITED and MESSAGE_UPDATED of one edit.
        const edited = await updateKnowledgeAfterEdit(2);
        const updated = await updateKnowledgeAfterEdit(2);

        assert.deepEqual(edited, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge, ledgerBefore);
        assert.deepEqual(chat_metadata.story_arc.knowledge.characters[0].details, { hair: [{ value: 'dark braids', at: 2, messageId: 'm2' }] });
        assert.equal(chat[2].extra.story_arc_read_text_hash, undefined);
    });

    it('a hidden message whose id the search created but which a read-text hash shows read counts as read', async () => {
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);
        // The hash of the text an update read (any number other than the new text's).
        chat[2].extra.story_arc_read_text_hash = 12345;
        chat[2].extra.story_arc_message_id_by_search = true;
        chat[2].is_system = true;
        chat[2].mes = 'Gauntlet and latches on the bench.';

        await updateKnowledgeAfterEdit(2);

        assert.deepEqual(sentPrompts, ['MESSAGES:\n[2] Noor: Gauntlet and latches on the bench.']);
        assert.equal(chat[2].is_system, true);
    });

    it('a hidden message read before message ids whose only trace is a holder of a fact retracted later counts as read', async () => {
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);
        chat_metadata.story_arc.knowledge.retractedFacts = [{
            at: 5,
            fact: {
                id: 'f5', text: 'The gauntlet is cracked', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 2 }],
            },
        }];
        chat[2] = { is_user: false, is_system: true, name: 'Noor', mes: 'Gauntlet and latches on the bench.' };

        await updateKnowledgeAfterEdit(2);

        assert.deepEqual(sentPrompts, ['MESSAGES:\n[2] Noor: Gauntlet and latches on the bench.']);
    });
});

describe('updateKnowledgeAfterEdit acts only on a text that changed since it was read', () => {
    beforeEach(() => {
        fillChat();
        setSwitches({ tracker: true });
        storeLedger();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('ST\'s edit fires MESSAGE_EDITED and MESSAGE_UPDATED: the second event makes no call and keeps the re-extracted knowledge', async () => {
        const sentPrompts = installExtraction([ANSWER_EDITED_MESSAGE_3, ANSWER_EDITED_MESSAGE_3]);
        chat[3].mes = 'Gabriel wants steel latches.';

        await updateKnowledgeAfterEdit(3);
        const second = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(second, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[3] Ellie: Gabriel wants steel latches.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F3, FACT_F4, FACT_STEEL_LATCHES]);
    });

    it('a cancelled edit of a message a reply update read (MESSAGE_UPDATED, same text) makes no call', async () => {
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 4;
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE, ANSWER_NOOR_ALONE]);
        await updateKnowledgeAfterReply(6);

        const updated = await updateKnowledgeAfterEdit(5);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.equal(sentPrompts.length, 1);
    });

    it('a rewrite by another extension after the read (MESSAGE_UPDATED alone) re-extracts the new text', async () => {
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 4;
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE, ANSWER_NOOR_ALONE]);
        await updateKnowledgeAfterReply(6);
        chat[5].mes = 'Thanks, Noor.';

        const updated = await updateKnowledgeAfterEdit(5);

        assert.equal(updated.ledgerChanged, true);
        assert.deepEqual(sentPrompts.slice(1), ['MESSAGES:\n[5] Ellie: Thanks, Noor.']);
    });

    it('after a failed re-extraction, saving the same text again tries again', async () => {
        const sentPrompts = installExtraction(['not an answer', ANSWER_EDITED_MESSAGE_3]);
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);

        const retried = await updateKnowledgeAfterEdit(3);

        assert.equal(retried.ledgerChanged, true);
        assert.equal(sentPrompts.length, 2);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F3, FACT_F4, FACT_STEEL_LATCHES]);
    });

    it('a message edited during a reply update keeps the old text\'s hash, so its next event re-extracts', async () => {
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 4;
        const sentPrompts = installExtraction([]);
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            // Another extension rewrote message 5 while the call ran.
            if (sentPrompts.length === 1) chat[5].mes = 'Thanks, Noor.';
            return () => (async function* () { yield { text: ANSWER_NOOR_ALONE }; })();
        };
        await updateKnowledgeAfterReply(6);

        await updateKnowledgeAfterEdit(5);

        assert.deepEqual(sentPrompts.slice(1), ['MESSAGES:\n[5] Ellie: Thanks, Noor.']);
    });

    it('a second edit to another text re-extracts again', async () => {
        const sentPrompts = installExtraction([ANSWER_EDITED_MESSAGE_3, ANSWER_EDITED_MESSAGE_3]);
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);
        chat[3].mes = 'Gabriel wants steel latches, polished.';

        await updateKnowledgeAfterEdit(3);

        assert.deepEqual(sentPrompts, [
            'MESSAGES:\n[3] Ellie: Gabriel wants steel latches.',
            'MESSAGES:\n[3] Ellie: Gabriel wants steel latches, polished.',
        ]);
    });
});

describe('a re-extraction whose call failed is tried again with the next reply update', () => {
    beforeEach(() => {
        fillChat();
        setSwitches({ tracker: true });
        storeLedger();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    /** The player's next message and the narrator's reply. */
    function pushExchange() {
        chat.push(
            { is_user: true, is_system: false, name: 'Ellie', mes: 'And then?' },
            { is_user: false, is_system: false, name: 'Noor', mes: 'Then we wait.' },
        );
    }

    const factTexts = () => chat_metadata.story_arc.knowledge.facts.map(fact => fact.text);

    it('the next reply update reads the message again, and a success ends the retries', async () => {
        const sentPrompts = installExtraction(['not an answer', ANSWER_NOOR_ALONE, ANSWER_EDITED_MESSAGE_3, ANSWER_NOOR_ALONE]);
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);

        pushExchange();
        await updateKnowledgeAfterReply(8);
        pushExchange();
        await updateKnowledgeAfterReply(10);

        assert.equal(sentPrompts.length, 4);
        assert.equal(sentPrompts[2], 'MESSAGES:\n[3] Ellie: Gabriel wants steel latches.');
        assert.ok(factTexts().includes('Gabriel wants steel latches'));
        assert.ok(!factTexts().includes('Gabriel wants titanium latches'));
        assert.equal(chat_metadata.story_arc.knowledge.pendingReextractions, undefined);
    });

    it('a message whose call fails three times is not tried again, and keeps what the ledger learned there', async () => {
        const sentPrompts = installExtraction([
            'not an answer', ANSWER_NOOR_ALONE, 'not an answer', ANSWER_NOOR_ALONE, 'not an answer', ANSWER_NOOR_ALONE,
        ]);
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);

        for (const replyIndex of [8, 10, 12]) {
            pushExchange();
            await updateKnowledgeAfterReply(replyIndex);
        }

        // A cancelled edit or a rewrite event with the same text, after the third failure.
        const eventAfterGivingUp = await updateKnowledgeAfterEdit(3);

        // The edit, then three reply updates; the first two each tried message 3 again.
        assert.equal(sentPrompts.length, 6);
        assert.equal(sentPrompts.filter(prompt => prompt.includes('[3] Ellie')).length, 3);
        assert.deepEqual(eventAfterGivingUp, { ledgerChanged: false, beatsChanged: false });
        assert.ok(factTexts().includes('Gabriel wants titanium latches'));
        assert.deepEqual(chat_metadata.story_arc.knowledge.pendingReextractions.map(entry => [entry.messageId, entry.tries]), [['m3', 3]]);
    });

    it('a new edit of a message that failed before starts its tries again', async () => {
        installExtraction(['not an answer', 'not an answer', 'not an answer']);
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);
        await updateKnowledgeAfterEdit(3);

        chat[3].mes = 'Gabriel wants bronze latches.';
        await updateKnowledgeAfterEdit(3);

        assert.deepEqual(chat_metadata.story_arc.knowledge.pendingReextractions.map(entry => [entry.messageId, entry.tries]), [['m3', 1]]);
    });

    it('a reply arriving during the retry gets its update but starts no second retry', async () => {
        const answers = ['not an answer', ANSWER_NOOR_ALONE, ANSWER_EDITED_MESSAGE_3, ANSWER_NOOR_ALONE];
        const sentPrompts = [];
        let updateDuringRetry = null;
        globalThis.fetch = async () => new Response('MESSAGES:\n{{MESSAGES}}');
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            const text = answers.shift();
            // The third call is the retry; a reply arrives while it runs.
            if (sentPrompts.length === 3) {
                pushExchange();
                updateDuringRetry = await updateKnowledgeAfterReply(chat.length - 1);
            }
            return () => (async function* () { yield { text }; })();
        };
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);
        pushExchange();

        await updateKnowledgeAfterReply(8);

        assert.equal(updateDuringRetry.ledgerChanged, true);
        // The edit and one retry read message 3; the update during the retry did not retry it again.
        assert.equal(sentPrompts.filter(prompt => prompt.includes('[3] Ellie')).length, 2);
        assert.equal(sentPrompts.length, 4);
        assert.equal(chat_metadata.story_arc.knowledge.pendingReextractions, undefined);
    });

    it('a message whose retry needs no call (the next update read it anyway) leaves the retries', async () => {
        const sentPrompts = installExtraction(['not an answer', ANSWER_NOOR_ALONE]);
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);
        // A rollback took the ledger back before message 3, so the next update reads it.
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 2;

        pushExchange();
        await updateKnowledgeAfterReply(8);

        assert.equal(sentPrompts.length, 2);
        assert.ok(sentPrompts[1].includes('[3] Ellie: Gabriel wants steel latches.'), sentPrompts[1]);
        assert.equal(chat_metadata.story_arc.knowledge.pendingReextractions, undefined);
    });

    it('a message deleted before its retry leaves the retries without a call', async () => {
        const sentPrompts = installExtraction(['not an answer', ANSWER_NOOR_ALONE, ANSWER_NOOR_ALONE]);
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);
        chat.splice(3, 1);
        await rollBackKnowledgeFrom(chat.length);

        pushExchange();
        await updateKnowledgeAfterReply(chat.length - 1);

        assert.equal(sentPrompts.length, 2);
        assert.equal(chat_metadata.story_arc.knowledge.pendingReextractions, undefined);
    });
});

describe('an index the answer gives outside the messages it covered', () => {
    beforeEach(() => {
        fillChat();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    /** The ledger of storeLedger as it was after message 4: no f3, scene from 4. */
    function storeLedgerThrough4() {
        storeLedger();
        const ledger = chat_metadata.story_arc.knowledge;
        ledger.facts = ledger.facts.filter(fact => fact.id !== 'f3');
        ledger.scene = { at: 4, present: ['c1', 'c2'] };
        ledger.lastUpdatedAt = 4;
    }

    it('a fact placed before the covered messages still goes with a regeneration of the reply it came from', async () => {
        setSwitches({ tracker: true });
        storeLedgerThrough4();
        installExtraction([JSON.stringify({
            present: ['Noor', 'Dougal'],
            newCharacters: [],
            learned: [{ text: 'Dougal heard about the latches', public: false, who: ['Dougal'], how: 'witnessed', toldBy: null, at: 0 }],
        })]);
        await updateKnowledgeAfterReply(6);

        const changed = await rollBackKnowledgeFrom(6);

        assert.equal(changed, true);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F4]);
    });

    it('a fact the edit of a message placed elsewhere is taken back by the next edit of that message', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        installExtraction([
            JSON.stringify({
                present: ['Ellie'],
                newCharacters: [],
                learned: [{ text: 'Gabriel wants steel latches', public: false, who: ['Noor'], how: 'told', toldBy: 'Ellie', at: 0 }],
            }),
            ANSWER_NOOR_ALONE,
        ]);
        chat[3].mes = 'Gabriel wants steel latches.';
        await updateKnowledgeAfterEdit(3);

        chat[3].mes = 'Gabriel wants latches.';
        await updateKnowledgeAfterEdit(3);

        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F3, FACT_F4]);
    });

    it('a secret revealed early in the covered messages stays when only the last reply is regenerated', async () => {
        setSwitches({ tracker: true });
        storeLedgerThrough4();
        chat_metadata.story_arc.arcs = [{
            id: 'arc-crane',
            status: 'active',
            messageStart: 0,
            estimatedLength: 40,
            beats: [{ id: 'b1', status: 'active' }],
            secrets: [{ id: 'the_drop', content: 'Julian plans to drop the crane on the Annex', revealPhase: 'any', disclosed: false, holders: [] }],
        }];
        installExtraction([JSON.stringify({
            present: ['Noor', 'Ellie'],
            newCharacters: [],
            learned: [],
            revealedSecrets: [{ secretId: 'the_drop', text: 'Julian means to drop the crane', heardBy: ['Noor'], at: 5 }],
        })]);
        await updateKnowledgeAfterReply(6);

        await rollBackKnowledgeFrom(6);

        const revealedFact = chat_metadata.story_arc.knowledge.facts.find(fact => fact.secret);
        assert.deepEqual(revealedFact?.holders, [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 5, messageId: 'm5' }]);
    });
});
