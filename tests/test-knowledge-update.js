import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { updateKnowledgeAfterReply } from '../lib/knowledge/ledger.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/**
 * Replace the extraction template with one that only lists the messages,
 * and the connection profile's transport with one that records each prompt
 * and answers with the next queued answer text.
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

function setSwitches({ tracker, interval = 1 }) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: tracker, updateInterval: interval },
    };
}

/** Noor and Ellie in the ledger, updated through message 2. */
function storeLedger(lastUpdatedAt = 2) {
    chat_metadata.story_arc = {
        knowledge: {
            characters: [
                { id: 'c1', name: 'Noor', aliases: [] },
                { id: 'c2', name: 'Ellie', aliases: ['Dice'] },
            ],
            facts: [{
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }],
            }],
            scene: { at: 2, present: ['c1', 'c2'] },
            lastUpdatedAt,
        },
    };
}

/** The ledger storeLedger(2) writes, spelled out again for comparisons. */
const LEDGER_AS_STORED = {
    characters: [
        { id: 'c1', name: 'Noor', aliases: [] },
        { id: 'c2', name: 'Ellie', aliases: ['Dice'] },
    ],
    facts: [{
        id: 'f1', text: 'Ellie is Dice', public: false,
        holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }],
    }],
    scene: { at: 2, present: ['c1', 'c2'] },
    lastUpdatedAt: 2,
};

/**
 * A workshop chat: greeting, then user and reply in turn. Each message
 * carries the Story Arc message id m0 … m6 already, so the ids an update
 * stores are known in advance.
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
        { is_user: false, is_system: false, name: 'Noor', mes: 'Come back at four.', extra: { story_arc_message_id: 'm6' } },
    );
}

const ANSWER_NOOR_LEARNS_LATCHES = JSON.stringify({
    present: ['Noor', 'Ellie'],
    newCharacters: [],
    learned: [{
        text: 'Gabriel wants the gauntlet locked on with titanium latches',
        public: false, who: ['Noor'], how: 'told', toldBy: 'Ellie', at: 3,
    }],
});

/** The extraction prompt for messages 3 to 6 of the workshop chat. */
const MESSAGES_3_TO_6 = [
    'MESSAGES:',
    '[3] Ellie: Gabriel wants titanium latches.',
    '',
    '[4] Noor: Titanium it is.',
    '',
    '[5] Ellie: Thanks.',
    '',
    '[6] Noor: Come back at four.',
].join('\n');

describe('updateKnowledgeAfterReply', () => {
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

    it('makes no extraction call while the tracker is off', async () => {
        setSwitches({ tracker: false });
        storeLedger();
        const sentPrompts = installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);

        const updated = await updateKnowledgeAfterReply(4);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(chat_metadata.story_arc.knowledge, LEDGER_AS_STORED);
    });

    it('with interval 2 waits for the second reply, then reads every message since the last update', async () => {
        setSwitches({ tracker: true, interval: 2 });
        storeLedger(2);
        const sentPrompts = installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);
        const laterMessages = chat.splice(5);

        const updatedAfterFirstReply = await updateKnowledgeAfterReply(4);
        assert.deepEqual(updatedAfterFirstReply, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(sentPrompts, []);

        chat.push(...laterMessages);
        const updatedAfterSecondReply = await updateKnowledgeAfterReply(6);

        assert.deepEqual(updatedAfterSecondReply, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(sentPrompts, [MESSAGES_3_TO_6]);
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: [
                { id: 'c1', name: 'Noor', aliases: [] },
                { id: 'c2', name: 'Ellie', aliases: ['Dice'] },
            ],
            facts: [
                {
                    id: 'f1', text: 'Ellie is Dice', public: false,
                    holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }],
                },
                {
                    id: 'f2', text: 'Gabriel wants the gauntlet locked on with titanium latches', public: false,
                    holders: [
                        { characterId: 'c2', how: 'witnessed', toldBy: null, at: 3, messageId: 'm3' },
                        { characterId: 'c1', how: 'told', toldBy: 'c2', at: 3, messageId: 'm3' },
                    ],
                },
            ],
            scene: { at: 6, messageId: 'm6', present: ['c1', 'c2'] },
            sceneHistory: [{ at: 2, present: ['c1', 'c2'] }],
            lastUpdatedAt: 6,
            lastUpdatedMessageId: 'm6',
            updateLog: [{
                kind: 'update', from: 3, to: 6, messageId: 'm6',
                answer: { present: 2, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0 },
                factsCreated: ['f2'], holdersAdded: 2, factsRetracted: [], beatsCompleted: 0,
            }],
        });
    });

    it('changes nothing but the log on an unreadable answer and reads the same messages again next time', async () => {
        setSwitches({ tracker: true, interval: 1 });
        storeLedger(2);
        const sentPrompts = installExtraction(['Sorry, I cannot help with that.', ANSWER_NOOR_LEARNS_LATCHES]);

        const updatedFirst = await updateKnowledgeAfterReply(6);
        assert.deepEqual(updatedFirst, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            ...LEDGER_AS_STORED,
            updateLog: [{ kind: 'skipped', from: 3, to: 6, reason: 'no answer' }],
        });

        const updatedSecond = await updateKnowledgeAfterReply(6);
        assert.deepEqual(updatedSecond, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(sentPrompts, [MESSAGES_3_TO_6, MESSAGES_3_TO_6]);
        assert.equal(chat_metadata.story_arc.knowledge.lastUpdatedAt, 6);
    });

    it('changes nothing but the log when the call fails', async () => {
        setSwitches({ tracker: true, interval: 1 });
        storeLedger(2);
        installExtraction([]);
        ConnectionManagerRequestService.sendRequest = async () => { throw new Error('profile not found'); };

        const updated = await updateKnowledgeAfterReply(6);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            ...LEDGER_AS_STORED,
            updateLog: [{ kind: 'skipped', from: 3, to: 6, reason: 'no answer' }],
        });
    });

    it('reads only the latest exchange of a chat whose ledger was never updated', async () => {
        setSwitches({ tracker: true, interval: 3 });
        storeLedger(null);
        const sentPrompts = installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);

        const updated = await updateKnowledgeAfterReply(6);

        assert.deepEqual(updated, { ledgerChanged: true, beatsChanged: false });
        assert.deepEqual(sentPrompts, ['MESSAGES:\n[5] Ellie: Thanks.\n\n[6] Noor: Come back at four.']);
        assert.equal(chat_metadata.story_arc.knowledge.lastUpdatedAt, 6);
    });

    it('keeps a fact entered by hand while the extraction call was out', async () => {
        setSwitches({ tracker: true, interval: 1 });
        storeLedger(2);
        const sentPrompts = installExtraction([]);
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            // The player adds a fact in the Knowledge popup meanwhile, and the
            // popup stores a new ledger object.
            const ledger = chat_metadata.story_arc.knowledge;
            chat_metadata.story_arc.knowledge = {
                ...ledger,
                facts: [...ledger.facts, {
                    id: 'f2', text: 'Noor tunes Aegis\'s suit', public: false,
                    holders: [{ characterId: 'c1', how: 'user', toldBy: null, at: null }],
                }],
            };
            return () => (async function* () { yield { text: ANSWER_NOOR_LEARNS_LATCHES }; })();
        };

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.facts, [
            {
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1 }],
            },
            {
                id: 'f2', text: 'Noor tunes Aegis\'s suit', public: false,
                holders: [{ characterId: 'c1', how: 'user', toldBy: null, at: null }],
            },
            {
                id: 'f3', text: 'Gabriel wants the gauntlet locked on with titanium latches', public: false,
                holders: [
                    { characterId: 'c2', how: 'witnessed', toldBy: null, at: 3, messageId: 'm3' },
                    { characterId: 'c1', how: 'told', toldBy: 'c2', at: 3, messageId: 'm3' },
                ],
            },
        ]);
    });

    it('does not apply an answer about a reply that was swiped during the call', async () => {
        setSwitches({ tracker: true, interval: 1 });
        storeLedger(2);
        const sentPrompts = installExtraction([]);
        ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
            sentPrompts.push(messages[0].content);
            chat[6].mes = 'Leave it with me.';
            return () => (async function* () { yield { text: ANSWER_NOOR_LEARNS_LATCHES }; })();
        };

        const updated = await updateKnowledgeAfterReply(6);

        assert.deepEqual(updated, { ledgerChanged: false, beatsChanged: false });
        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            ...LEDGER_AS_STORED,
            updateLog: [{ kind: 'skipped', from: 3, to: 6, reason: 'chat changed' }],
        });
    });
});
