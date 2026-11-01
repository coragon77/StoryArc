import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { rollBackKnowledgeFrom, updateKnowledgeAfterReply, updateKnowledgeAfterSwipe } from '../lib/knowledge/ledger.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/**
 * Replace the extraction template with one that only lists the messages,
 * and the transport with one that answers with the next queued answer text.
 */
function installExtraction(answers) {
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('extract-knowledge.txt')) return new Response('MESSAGES:\n{{MESSAGES}}');
        throw new Error(`unexpected fetch ${url}`);
    };
    ConnectionManagerRequestService.sendRequest = async () => {
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
}

function setSwitches({ tracker }) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: tracker, updateInterval: 1 },
    };
}

/** One chat message; `messageId` is the Story Arc stamp it carries, if any. */
function message(isUser, name, text, messageId) {
    const chatMessage = { is_user: isUser, is_system: false, name, mes: text, extra: {} };
    if (messageId) chatMessage.extra.story_arc_message_id = messageId;
    return chatMessage;
}

/**
 * A workshop chat of seven messages, greeting first. With `stamped`, each
 * message carries the Story Arc stamp m0 … m6.
 */
function fillChat({ stamped }) {
    const stamp = index => (stamped ? `m${index}` : undefined);
    chat.length = 0;
    chat.push(
        message(false, 'Noor', 'Welcome to the bay.', stamp(0)),
        message(true, 'Ellie', 'Hi Noor.', stamp(1)),
        message(false, 'Noor', 'Gauntlet on the bench.', stamp(2)),
        message(true, 'Ellie', 'Gabriel wants titanium latches.', stamp(3)),
        message(false, 'Noor', 'Titanium it is.', stamp(4)),
        message(true, 'Ellie', 'Thanks.', stamp(5)),
        message(false, 'Noor', 'Dougal heard you.', stamp(6)),
    );
}

const CHARACTERS = [
    { id: 'c1', name: 'Noor', aliases: [] },
    { id: 'c2', name: 'Ellie', aliases: [] },
    { id: 'c3', name: 'Dougal', aliases: [] },
];

const FACT_USER = {
    id: 'f4', text: 'Noor tunes the suit', public: false,
    holders: [{ characterId: 'c2', how: 'user', toldBy: null, at: null }],
};

/**
 * Updated through message 6, every reference with its message's stamp:
 * f1 Noor witnessed at 1, f2 Noor was told at 3, f3 Dougal witnessed at 6,
 * f4 entered by the user. The scene is from message 6, the one before from 3.
 */
function storeStampedLedger() {
    chat_metadata.story_arc = {
        knowledge: {
            characters: CHARACTERS,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1, messageId: 'm1' }],
                },
                {
                    id: 'f2', text: 'Gabriel wants titanium latches', public: false,
                    holders: [{ characterId: 'c1', how: 'told', toldBy: 'c2', at: 3, messageId: 'm3' }],
                },
                {
                    id: 'f3', text: 'Ellie ordered the latches for Gabriel', public: false,
                    holders: [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 6, messageId: 'm6' }],
                },
                FACT_USER,
            ],
            scene: { at: 6, messageId: 'm6', present: ['c1', 'c2', 'c3'] },
            sceneHistory: [{ at: 3, messageId: 'm3', present: ['c1', 'c2'] }],
            lastUpdatedAt: 6,
            lastUpdatedMessageId: 'm6',
        },
    };
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    ConnectionManagerRequestService.sendRequest = originalSendRequest;
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
    chat.length = 0;
});

describe('rollBackKnowledgeFrom after a deletion in the middle', () => {
    beforeEach(() => {
        setSwitches({ tracker: true });
    });

    it('removes exactly the knowledge of the deleted messages and moves the later knowledge up', async () => {
        fillChat({ stamped: true });
        storeStampedLedger();

        // The user deletes messages 2, 3 and 4; ST passes only the new length.
        chat.splice(2, 3);
        const rolledBack = await rollBackKnowledgeFrom(chat.length);

        assert.equal(rolledBack, true);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1, messageId: 'm1' }],
                },
                {
                    id: 'f3', text: 'Ellie ordered the latches for Gabriel', public: false,
                    holders: [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 3, messageId: 'm6' }],
                },
                FACT_USER,
            ],
            scene: { at: 3, messageId: 'm6', present: ['c1', 'c2', 'c3'] },
            sceneHistory: [],
            lastUpdatedAt: 3,
            lastUpdatedMessageId: 'm6',
        });
    });

    it('when the last read message is gone, the ledger covers up to the last read message left', async () => {
        fillChat({ stamped: true });
        // The player wrote message 7 before the update for it ran: not read, no stamp.
        chat.push(message(true, 'Ellie', 'And the pins?'));
        storeStampedLedger();

        // The user deletes messages 5 and 6; message 7 moves to 5.
        chat.splice(5, 2);
        const rolledBack = await rollBackKnowledgeFrom(chat.length);

        assert.equal(rolledBack, true);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1, messageId: 'm1' }],
                },
                {
                    id: 'f2', text: 'Gabriel wants titanium latches', public: false,
                    holders: [{ characterId: 'c1', how: 'told', toldBy: 'c2', at: 3, messageId: 'm3' }],
                },
                FACT_USER,
            ],
            scene: { at: 3, messageId: 'm3', present: ['c1', 'c2'] },
            sceneHistory: [],
            lastUpdatedAt: 4,
            lastUpdatedMessageId: 'm4',
        });
    });

    it('a ledger from before the stamps still rolls back from the new chat length on', async () => {
        fillChat({ stamped: false });
        chat_metadata.story_arc = {
            knowledge: {
                characters: CHARACTERS,
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
                    FACT_USER,
                ],
                scene: { at: 6, present: ['c1', 'c2', 'c3'] },
                sceneHistory: [{ at: 3, present: ['c1', 'c2'] }],
                lastUpdatedAt: 6,
            },
        };

        chat.splice(2, 3);
        const rolledBack = await rollBackKnowledgeFrom(chat.length);

        // As before the stamps: everything from index 4 on goes, whatever it came from.
        assert.equal(rolledBack, true);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }],
                },
                {
                    id: 'f2', text: 'Gabriel wants titanium latches', public: false,
                    holders: [{ characterId: 'c1', how: 'told', toldBy: 'c2', at: 3 }],
                },
                FACT_USER,
            ],
            scene: { at: 3, present: ['c1', 'c2'] },
            sceneHistory: [],
            lastUpdatedAt: 3,
        });
    });
});

describe('updateKnowledgeAfterSwipe and the stamps', () => {
    it('a swiped message no update has read again is read by the next update even after a deletion before it', async () => {
        setSwitches({ tracker: true });
        fillChat({ stamped: true });
        storeStampedLedger();
        // ST points swipe_id at the slot the generation is about to fill.
        chat[6].swipes = ['Dougal heard you.'];
        chat[6].swipe_id = 1;
        installExtraction([]);

        await updateKnowledgeAfterSwipe(6);
        // The new swipe's generation fails, and the user deletes message 5.
        chat.splice(5, 1);
        await rollBackKnowledgeFrom(chat.length);

        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: CHARACTERS,
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1, messageId: 'm1' }],
                },
                {
                    id: 'f2', text: 'Gabriel wants titanium latches', public: false,
                    holders: [{ characterId: 'c1', how: 'told', toldBy: 'c2', at: 3, messageId: 'm3' }],
                },
                FACT_USER,
            ],
            scene: { at: 3, messageId: 'm3', present: ['c1', 'c2'] },
            sceneHistory: [],
            lastUpdatedAt: 4,
            lastUpdatedMessageId: 'm4',
        });
    });
});

describe('the stamps an update leaves on the messages it read', () => {
    beforeEach(() => {
        setSwitches({ tracker: true });
    });

    it('knowledge learned in an update follows its message when an earlier message is deleted', async () => {
        chat.length = 0;
        chat.push(
            message(false, 'Noor', 'Welcome to the bay.'),
            message(true, 'Ellie', 'I am Dice, Noor.'),
            message(false, 'Noor', 'I know. Gauntlet on the bench.'),
        );
        chat_metadata.story_arc = {
            knowledge: {
                characters: [
                    { id: 'c1', name: 'Noor', aliases: [] },
                    { id: 'c2', name: 'Ellie', aliases: [] },
                ],
                facts: [],
                scene: { at: null, present: [] },
                lastUpdatedAt: null,
            },
        };
        installExtraction([JSON.stringify({
            present: ['Noor', 'Ellie'],
            newCharacters: [],
            learned: [{ text: 'Ellie is Dice', public: false, who: ['Noor'], how: 'told', toldBy: 'Ellie', at: 1 }],
        })]);

        const updated = await updateKnowledgeAfterReply(2);
        // The greeting was not read, so it carries no stamp; the two read messages carry one each.
        const userStamp = chat[1].extra.story_arc_message_id;
        const replyStamp = chat[2].extra.story_arc_message_id;
        chat.splice(0, 1);
        const rolledBack = await rollBackKnowledgeFrom(chat.length);

        assert.equal(updated, true);
        assert.equal(rolledBack, true);
        assert.equal(chat[0].extra.story_arc_message_id, userStamp);
        assert.equal(typeof userStamp, 'string');
        assert.equal(typeof replyStamp, 'string');
        assert.notEqual(userStamp, replyStamp);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: [
                { id: 'c1', name: 'Noor', aliases: [] },
                { id: 'c2', name: 'Ellie', aliases: [] },
            ],
            facts: [{
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 0, messageId: userStamp },
                    { characterId: 'c1', how: 'told', toldBy: 'c2', at: 0, messageId: userStamp },
                ],
            }],
            scene: { at: 1, messageId: replyStamp, present: ['c1', 'c2'] },
            lastUpdatedAt: 1,
            lastUpdatedMessageId: replyStamp,
        });
    });
});
