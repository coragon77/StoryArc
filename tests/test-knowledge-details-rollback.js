import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { dropKnowledgeFrom, rollBackKnowledgeFrom, updateKnowledgeAfterEdit } from '../lib/knowledge/ledger.js';

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
        knowledgeTracker: { enabled: tracker, updateInterval: 1, characterDetails: true },
    };
}

/** Seven messages of the Paragon chat, 0 to 6, each with its Story Arc message id m0 … m6. */
function fillChat() {
    chat.length = 0;
    chat.push(
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Lunch at Westbrook.', extra: { story_arc_message_id: 'm0' } },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Kendra, a junior at Westbrook High, waves.', extra: { story_arc_message_id: 'm1' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'What does your mom do?', extra: { story_arc_message_id: 'm2' } },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Kendra shrugs. "Mom cleans offices. Double shifts."', extra: { story_arc_message_id: 'm3' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Free on Friday?', extra: { story_arc_message_id: 'm4' } },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Mom is on nights at Highland Hospital now. Dao nods.', extra: { story_arc_message_id: 'm5' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Great.', extra: { story_arc_message_id: 'm6' } },
    );
}

/**
 * Kendra, her mother Ama and Dao, read through message 6.
 * Kendra: role at 1 (m1), age entered by the player.
 * Ama: role cleaner at 3 (m3), changed to nurse at 5 (m5); relation at 3 (m3).
 * Dao: gender at 5 without a message id (the index rule decides for it).
 */
function makeLedger() {
    return {
        characters: [
            {
                id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'],
                details: {
                    role: [{ value: 'student, Westbrook High', at: 1, messageId: 'm1' }],
                    age: [{ value: '17', at: null, by: 'user' }],
                },
            },
            {
                id: 'c2', name: 'Ama Osei', aliases: [],
                details: {
                    role: [
                        { value: 'cleaner, double shifts', at: 3, messageId: 'm3' },
                        { value: 'nurse, Highland Hospital', at: 5, messageId: 'm5' },
                    ],
                    relation: [{ value: { kind: 'mother', of: 'c1' }, at: 3, messageId: 'm3' }],
                },
            },
            {
                id: 'c3', name: 'Dao', aliases: [],
                details: { gender: [{ value: 'male', at: 5 }] },
            },
        ],
        facts: [],
        scene: { at: 6, messageId: 'm6', present: ['c1'] },
        sceneHistory: [],
        lastUpdatedAt: 6,
        lastUpdatedMessageId: 'm6',
    };
}

const KENDRA = {
    id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'],
    details: {
        role: [{ value: 'student, Westbrook High', at: 1, messageId: 'm1' }],
        age: [{ value: '17', at: null, by: 'user' }],
    },
};

describe('dropKnowledgeFrom — character details follow the index rule', () => {
    it('dropping the newest entry of a kind restores the previous value, dropping the only one makes it unknown', () => {
        const ledger = makeLedger();

        const changed = dropKnowledgeFrom(ledger, 5);

        assert.equal(changed, true);
        assert.deepEqual(ledger.characters, [
            KENDRA,
            {
                id: 'c2', name: 'Ama Osei', aliases: [],
                details: {
                    role: [{ value: 'cleaner, double shifts', at: 3, messageId: 'm3' }],
                    relation: [{ value: { kind: 'mother', of: 'c1' }, at: 3, messageId: 'm3' }],
                },
            },
            // Dao's only detail is gone: the record stays, with no details left.
            { id: 'c3', name: 'Dao', aliases: [] },
        ]);
        assert.deepEqual(ledger.updateLog, [
            { kind: 'rollback', from: 5, factsDropped: [], holdersDropped: 0, factsRestored: [], detailsDropped: 2 },
        ]);
    });

    it('a kind whose every entry is dropped disappears from the details', () => {
        const ledger = makeLedger();

        dropKnowledgeFrom(ledger, 3);

        assert.deepEqual(ledger.characters, [
            KENDRA,
            { id: 'c2', name: 'Ama Osei', aliases: [] },
            { id: 'c3', name: 'Dao', aliases: [] },
        ]);
        assert.equal(ledger.updateLog[0].detailsDropped, 4);
    });

    it('keeps the player\'s entries through a rollback of the whole chat', () => {
        const ledger = makeLedger();

        dropKnowledgeFrom(ledger, 0);

        assert.deepEqual(ledger.characters, [
            { id: 'c1', name: 'Kendra Osei', aliases: ['Kendra'], details: { age: [{ value: '17', at: null, by: 'user' }] } },
            { id: 'c2', name: 'Ama Osei', aliases: [] },
            { id: 'c3', name: 'Dao', aliases: [] },
        ]);
        assert.equal(ledger.updateLog[0].detailsDropped, 5);
    });

    it('records no rollback when no detail entry is at or after the first gone message', () => {
        const ledger = makeLedger();

        // Nothing at 7 or later: details, scene and coverage all stay.
        assert.equal(dropKnowledgeFrom(ledger, 7), false);
        assert.deepEqual(ledger.characters, makeLedger().characters);
        assert.equal(ledger.updateLog, undefined);
    });
});

describe('rollBackKnowledgeFrom — character details follow their messages by id', () => {
    beforeEach(() => {
        fillChat();
    });

    afterEach(() => {
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('deleting messages in the middle drops their entries and moves later ones to the new index', async () => {
        setSwitches({ tracker: false });
        chat_metadata.story_arc = { knowledge: makeLedger() };

        // The player deletes messages 2 and 3; ST passes the new length, 5.
        chat.splice(2, 2);
        const changed = await rollBackKnowledgeFrom(chat.length);

        assert.equal(changed, true);
        const ledger = chat_metadata.story_arc.knowledge;
        assert.deepEqual(ledger.characters, [
            KENDRA,
            {
                id: 'c2', name: 'Ama Osei', aliases: [],
                // The nurse entry's message m5 is now message 3.
                details: { role: [{ value: 'nurse, Highland Hospital', at: 3, messageId: 'm5' }] },
            },
            // No message id: the index rule drops the entry at 5, the new length.
            { id: 'c3', name: 'Dao', aliases: [] },
        ]);
        assert.equal(ledger.updateLog.at(-1).detailsDropped, 3);
    });

    it('a branch that ends before a detail\'s message carries only the earlier details', async () => {
        setSwitches({ tracker: true });
        chat_metadata.story_arc = { knowledge: makeLedger() };

        // The branch ends at message 2: ST copied the ledger whole.
        chat.length = 3;
        await rollBackKnowledgeFrom(chat.length);

        assert.deepEqual(chat_metadata.story_arc.knowledge.characters, [
            KENDRA,
            { id: 'c2', name: 'Ama Osei', aliases: [] },
            { id: 'c3', name: 'Dao', aliases: [] },
        ]);
    });
});

describe('updateKnowledgeAfterEdit — the edit drops only the details set at that message', () => {
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

    it('the re-extraction reads the edited message with its details unknown again', async () => {
        setSwitches({ tracker: true });
        chat_metadata.story_arc = { knowledge: makeLedger() };
        // The player corrects message 5: no hospital, and Dao is a woman.
        chat[5].mes = 'Mom is still cleaning offices. Dao, her friend, nods; she knows.';
        installExtraction([JSON.stringify({
            present: ['Kendra'], newCharacters: [], learned: [],
            details: [{ character: 'Dao', kind: 'gender', value: 'female', at: 5 }],
        })]);

        await updateKnowledgeAfterEdit(5);

        assert.deepEqual(chat_metadata.story_arc.knowledge.characters, [
            KENDRA,
            {
                id: 'c2', name: 'Ama Osei', aliases: [],
                details: {
                    role: [{ value: 'cleaner, double shifts', at: 3, messageId: 'm3' }],
                    relation: [{ value: { kind: 'mother', of: 'c1' }, at: 3, messageId: 'm3' }],
                },
            },
            { id: 'c3', name: 'Dao', aliases: [], details: { gender: [{ value: 'female', at: 5, messageId: 'm5' }] } },
        ]);
    });
});
