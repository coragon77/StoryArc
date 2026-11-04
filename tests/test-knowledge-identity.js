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

/** One chat message; `messageId` is the Story Arc message id it carries, if any. */
function message(isUser, name, text, messageId) {
    const chatMessage = { is_user: isUser, is_system: false, name, mes: text, extra: {} };
    if (messageId) chatMessage.extra.story_arc_message_id = messageId;
    return chatMessage;
}

/**
 * A workshop chat of seven messages, greeting first. With `withIds`, each
 * message carries the Story Arc message id m0 … m6.
 */
function fillChat({ withIds }) {
    const messageId = index => (withIds ? `m${index}` : undefined);
    chat.length = 0;
    chat.push(
        message(false, 'Noor', 'Welcome to the bay.', messageId(0)),
        message(true, 'Ellie', 'Hi Noor.', messageId(1)),
        message(false, 'Noor', 'Gauntlet on the bench.', messageId(2)),
        message(true, 'Ellie', 'Gabriel wants titanium latches.', messageId(3)),
        message(false, 'Noor', 'Titanium it is.', messageId(4)),
        message(true, 'Ellie', 'Thanks.', messageId(5)),
        message(false, 'Noor', 'Dougal heard you.', messageId(6)),
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
 * Updated through message 6, every reference with its message's message id:
 * f1 Noor witnessed at 1, f2 Noor was told at 3, f3 Dougal witnessed at 6,
 * f4 entered by the user. The scene is from message 6, the one before from 3.
 */
function storeLedgerWithMessageIds() {
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
        fillChat({ withIds: true });
        storeLedgerWithMessageIds();

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
            updateLog: [{ kind: 'rollback', from: 4, factsDropped: ['f2'], holdersDropped: 1, factsRestored: [] }],
        });
    });

    it('when the last read message is gone, the ledger covers up to the last read message left', async () => {
        fillChat({ withIds: true });
        // The player wrote message 7 before the update for it ran: not read, no message id.
        chat.push(message(true, 'Ellie', 'And the pins?'));
        storeLedgerWithMessageIds();

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
            updateLog: [{ kind: 'rollback', from: 6, factsDropped: ['f3'], holdersDropped: 1, factsRestored: [] }],
        });
    });

    it('a ledger from before the message ids still rolls back from the new chat length on', async () => {
        fillChat({ withIds: false });
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

        // As before the message ids: everything from index 4 on goes, whatever it came from.
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
            updateLog: [{ kind: 'rollback', from: 4, factsDropped: ['f3'], holdersDropped: 1, factsRestored: [] }],
        });
    });
});

describe('rollBackKnowledgeFrom and a retraction after a deletion in the middle', () => {
    const FACT_LATCHES_RETRACTED = {
        id: 'f2', text: 'Gabriel wants titanium latches', public: false,
        holders: [{ characterId: 'c1', how: 'told', toldBy: 'c2', at: 3, messageId: 'm3' }],
    };

    /** The ledger with message ids, but message 5 (an out-of-character correction) retracted f2. */
    function storeLedgerWithRetraction() {
        storeLedgerWithMessageIds();
        const ledger = chat_metadata.story_arc.knowledge;
        ledger.facts = ledger.facts.filter(fact => fact.id !== 'f2');
        ledger.retractedFacts = [{ at: 5, messageId: 'm5', fact: structuredClone(FACT_LATCHES_RETRACTED) }];
    }

    beforeEach(() => {
        setSwitches({ tracker: true });
        fillChat({ withIds: true });
    });

    it('a retraction whose correction survives stays, at the correction\'s new index', async () => {
        storeLedgerWithRetraction();

        chat.splice(4, 1);
        await rollBackKnowledgeFrom(chat.length);

        const ledger = chat_metadata.story_arc.knowledge;
        assert.deepEqual(ledger.facts.map(fact => fact.id), ['f1', 'f3', 'f4']);
        assert.deepEqual(ledger.retractedFacts, [{ at: 4, messageId: 'm5', fact: FACT_LATCHES_RETRACTED }]);
        assert.deepEqual(ledger.facts[1].holders, [{ characterId: 'c3', how: 'witnessed', toldBy: null, at: 5, messageId: 'm6' }]);
    });

    it('deleting the correction in the middle gives the retracted fact back', async () => {
        storeLedgerWithRetraction();

        chat.splice(5, 1);
        await rollBackKnowledgeFrom(chat.length);

        const ledger = chat_metadata.story_arc.knowledge;
        assert.deepEqual(ledger.retractedFacts, []);
        assert.deepEqual(ledger.facts.map(fact => fact.id), ['f1', 'f3', 'f4', 'f2']);
        assert.deepEqual(ledger.facts[3], FACT_LATCHES_RETRACTED);
        assert.equal(ledger.lastUpdatedAt, 5);
    });
});

describe('updateKnowledgeAfterSwipe and the message ids', () => {
    it('a swiped message no update has read again is read by the next update even after a deletion before it', async () => {
        setSwitches({ tracker: true });
        fillChat({ withIds: true });
        storeLedgerWithMessageIds();
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
            // Only the swipe's rollback: the deletion took nothing back, so it adds no record.
            updateLog: [{ kind: 'rollback', from: 6, factsDropped: ['f3'], holdersDropped: 1, factsRestored: [] }],
        });
    });

    it('a branch from a swipe whose knowledge a swipe took back reads that swipe again', async () => {
        setSwitches({ tracker: true });
        fillChat({ withIds: true });
        storeLedgerWithMessageIds();
        const reply = chat[6];
        reply.swipes = ['Dougal heard you.', 'Dougal was out.'];
        reply.swipe_info = [{ extra: {} }, { extra: {} }];
        reply.swipe_id = 0;
        installExtraction([JSON.stringify({ present: ['Noor', 'Ellie'], newCharacters: [], learned: [] })]);

        // ST's syncMesToSwipe keeps the shown swipe's extra in its swipe_info,
        // then the switch shows swipe 1 with that swipe's own extra.
        reply.swipe_info[0].extra = structuredClone(reply.extra);
        reply.swipe_id = 1;
        reply.mes = reply.swipes[1];
        reply.extra = structuredClone(reply.swipe_info[1].extra);
        await updateKnowledgeAfterSwipe(6);
        // The re-extraction gave swipe 1 a message id; the id itself is opaque.
        const swipeMessageId = reply.extra.story_arc_message_id;

        // A branch at message 6 with swipe 0 chosen: ST's getBranchChatSnapshot
        // copies the chat and syncSwipeToMes shows swipe 0; the branch keeps the
        // chat metadata whole and loads with its own length.
        const branch = structuredClone(chat);
        branch[6].swipe_id = 0;
        branch[6].mes = branch[6].swipes[0];
        branch[6].extra = structuredClone(branch[6].swipe_info[0].extra);
        chat.splice(0, chat.length, ...branch);
        await rollBackKnowledgeFrom(chat.length);

        // Swipe 0's knowledge (f3) went with the first swipe: the ledger ends
        // before message 6, so the next update reads it again.
        assert.equal(chat[6].extra.story_arc_message_id, undefined);
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
            lastUpdatedAt: 5,
            lastUpdatedMessageId: 'm5',
            // The branch load took nothing back, so it adds no record.
            updateLog: [
                { kind: 'rollback', from: 6, factsDropped: ['f3'], holdersDropped: 1, factsRestored: [] },
                {
                    kind: 'reextract', from: 6, to: 6, messageId: swipeMessageId,
                    answer: { present: 2, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                    factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
                },
            ],
        });
    });
});

describe('the message ids an update leaves on the messages it read', () => {
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
        // The greeting was not read, so it carries no message id; the two read messages carry one each.
        const userMessageId = chat[1].extra.story_arc_message_id;
        const replyMessageId = chat[2].extra.story_arc_message_id;
        chat.splice(0, 1);
        const rolledBack = await rollBackKnowledgeFrom(chat.length);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.equal(rolledBack, true);
        assert.equal(chat[0].extra.story_arc_message_id, userMessageId);
        assert.equal(typeof userMessageId, 'string');
        assert.equal(typeof replyMessageId, 'string');
        assert.notEqual(userMessageId, replyMessageId);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: [
                { id: 'c1', name: 'Noor', aliases: [] },
                { id: 'c2', name: 'Ellie', aliases: [] },
            ],
            facts: [{
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 0, messageId: userMessageId },
                    { characterId: 'c1', how: 'told', toldBy: 'c2', at: 0, messageId: userMessageId },
                ],
            }],
            scene: { at: 1, messageId: replyMessageId, present: ['c1', 'c2'] },
            lastUpdatedAt: 1,
            lastUpdatedMessageId: replyMessageId,
            // Only the update: the deletion moved the entries and took nothing back.
            updateLog: [{
                kind: 'update', from: 1, to: 2, messageId: replyMessageId,
                answer: { present: 2, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                factsCreated: ['f1'], holdersAdded: 2, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            }],
        });
    });
});
