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

/** A workshop chat: greeting, then user and reply in turn, seven messages. */
function fillChat() {
    chat.length = 0;
    chat.push(
        { is_user: false, is_system: false, name: 'Noor', mes: 'Welcome to the bay.' },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Hi Noor.' },
        { is_user: false, is_system: false, name: 'Noor', mes: 'Gauntlet on the bench.' },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Gabriel wants titanium latches.' },
        { is_user: false, is_system: false, name: 'Noor', mes: 'Titanium it is.' },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Thanks.' },
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
        chat.push({ is_user: false, is_system: false, name: 'Noor', mes: 'Nobody else is here.' });
        const updated = await updateKnowledgeAfterReply(6);

        assert.equal(rolledBack, true);
        assert.equal(updated, true);
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[6] Noor: Nobody else is here.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F2, FACT_F4],
            scene: { at: 6, present: ['c1'] },
            lastUpdatedAt: 6,
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

        assert.equal(updated, true);
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F2, FACT_F4],
            scene: { at: null, present: [] },
            lastUpdatedAt: 5,
        });
    });

    it('switching to an existing swipe re-extracts that one message', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_EARLIER_SWIPE]);
        showSecondSwipe();

        const updated = await updateKnowledgeAfterSwipe(6);

        assert.equal(updated, true);
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[6] Noor: It is on the news.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [
                FACT_F1, FACT_F2, FACT_F4,
                {
                    id: 'f5', text: 'The latches are on the news', public: true,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 6 }],
                },
            ],
            scene: { at: 6, present: ['c1'] },
            lastUpdatedAt: 6,
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

        assert.equal(updated, false);
        assert.deepEqual(sentPrompts, []);
        assert.equal(chat_metadata.story_arc.knowledge.lastUpdatedAt, 4);
    });

    it('with the tracker off a swipe switch only drops, so the next update reads the shown swipe', async () => {
        setSwitches({ tracker: false });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_EARLIER_SWIPE]);
        showSecondSwipe();

        const updated = await updateKnowledgeAfterSwipe(6);

        assert.equal(updated, true);
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
        { characterId: 'c2', how: 'witnessed', toldBy: null, at: 3 },
        { characterId: 'c1', how: 'told', toldBy: 'c2', at: 3 },
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

        assert.equal(updated, true);
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[3] Ellie: Gabriel wants steel latches.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F3, FACT_F4, FACT_STEEL_LATCHES],
            scene: { at: 6, present: ['c1', 'c2', 'c3'] },
            lastUpdatedAt: 6,
        });
    });

    it('editing the latest message takes its scene from the new text', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);
        chat[6].mes = 'Nobody else heard you.';

        const updated = await updateKnowledgeAfterEdit(6);

        assert.equal(updated, true);
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[6] Noor: Nobody else heard you.']);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F2, FACT_F4],
            scene: { at: 6, present: ['c1'] },
            lastUpdatedAt: 6,
        });
    });

    it('an edit of a message no update has read yet changes nothing; the next update reads it', async () => {
        setSwitches({ tracker: true });
        storeLedger();
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 4;
        const sentPrompts = installExtraction([ANSWER_NOOR_ALONE]);

        const updated = await updateKnowledgeAfterEdit(6);

        assert.equal(updated, false);
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [FACT_F1, FACT_F2, FACT_F3, FACT_F4]);
    });

    it('with the tracker off an edit leaves the ledger as it is', async () => {
        setSwitches({ tracker: false });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_EDITED_MESSAGE_3]);

        const updated = await updateKnowledgeAfterEdit(3);

        assert.equal(updated, false);
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

        assert.equal(updated, true);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [FACT_F1, FACT_F3, FACT_F4, FACT_STEEL_LATCHES],
            scene: { at: 8, present: ['c2'] },
            lastUpdatedAt: 8,
        });
    });
});
