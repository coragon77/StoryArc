import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import { updateKnowledgeAfterReply, updateKnowledgeAfterEdit, rollBackKnowledgeFrom } from '../lib/knowledge/ledger.js';

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

function setSwitches({ tracker = true, interval = 1 } = {}) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: tracker, updateInterval: interval, characterDetails: true },
    };
}

/**
 * A workshop chat: greeting, then user and reply in turn, seven messages,
 * each with the Story Arc message id m0 … m6 already.
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

/** Noor and Ellie; f1 Noor witnessed at 1; updated through message 2. No updateLog yet. */
function storeLedger() {
    chat_metadata.story_arc = {
        knowledge: {
            characters: [
                { id: 'c1', name: 'Noor', aliases: [] },
                { id: 'c2', name: 'Ellie', aliases: [] },
            ],
            facts: [{
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 1, messageId: 'm1' }],
            }],
            scene: { at: 2, messageId: 'm2', present: ['c1', 'c2'] },
            lastUpdatedAt: 2,
            lastUpdatedMessageId: 'm2',
        },
    };
}

const ANSWER_NOOR_LEARNS_LATCHES = JSON.stringify({
    present: ['Noor', 'Ellie'],
    newCharacters: [],
    learned: [{
        text: 'Gabriel wants the gauntlet locked on with titanium latches',
        public: false, who: ['Noor'], how: 'told', toldBy: 'Ellie', at: 3,
    }],
});

const ANSWER_NOTHING_LEARNED = JSON.stringify({ present: ['Noor'], newCharacters: [], learned: [] });

describe('the knowledge update log', () => {
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

    it('records an update that creates a fact, on a ledger that had no log yet', async () => {
        setSwitches();
        storeLedger();
        installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{
            kind: 'update', from: 3, to: 6, messageId: 'm6',
            answer: { present: 2, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
            factsCreated: ['f2'], holdersAdded: 2, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [{ factId: 'f2', characterId: 'c2', messageId: 'm3' }, { factId: 'f2', characterId: 'c1', messageId: 'm3' }], details: [], names: [], scene: null },
        }]);
    });

    it('records an update whose answer learned nothing', async () => {
        setSwitches();
        storeLedger();
        installExtraction([ANSWER_NOTHING_LEARNED]);

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{
            kind: 'update', from: 3, to: 6, messageId: 'm6',
            answer: { present: 1, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
            factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [], details: [], names: [], scene: ['c1'] },
        }]);
    });

    it('records a failed call as a skip and leaves the rest of the ledger alone', async () => {
        setSwitches();
        storeLedger();
        installExtraction([]);
        ConnectionManagerRequestService.sendRequest = async () => { throw new Error('profile not found'); };

        await updateKnowledgeAfterReply(6);

        const ledger = chat_metadata.story_arc.knowledge;
        assert.deepEqual(ledger.updateLog, [{ kind: 'skipped', from: 3, to: 6, reason: 'no answer' }]);
        assert.equal(ledger.lastUpdatedAt, 2);
        assert.deepEqual(ledger.facts.map(fact => fact.id), ['f1']);
    });

    it('records an unreadable answer as a skip', async () => {
        setSwitches();
        storeLedger();
        installExtraction(['Sorry, I cannot help with that.']);

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{ kind: 'skipped', from: 3, to: 6, reason: 'no answer' }]);
    });

    it('records a skip when the reply changed during the call', async () => {
        setSwitches();
        storeLedger();
        installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);
        const sendRequest = ConnectionManagerRequestService.sendRequest;
        ConnectionManagerRequestService.sendRequest = async (...args) => {
            chat[6].mes = 'Come back at five.';
            return sendRequest(...args);
        };

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{ kind: 'skipped', from: 3, to: 6, reason: 'chat changed' }]);
    });

    it('writes nothing into another chat loaded during the call', async () => {
        setSwitches();
        storeLedger();
        installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);
        const sendRequest = ConnectionManagerRequestService.sendRequest;
        ConnectionManagerRequestService.sendRequest = async (...args) => {
            chat_metadata.story_arc = {
                knowledge: { characters: [], facts: [], scene: { at: null, present: [] }, sceneHistory: [], lastUpdatedAt: null },
            };
            return sendRequest(...args);
        };

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge, {
            characters: [], facts: [], scene: { at: null, present: [] }, sceneHistory: [], lastUpdatedAt: null,
        });
    });

    it('records a skip when the ledger was rolled back during the call', async () => {
        setSwitches();
        storeLedger();
        installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);
        const sendRequest = ConnectionManagerRequestService.sendRequest;
        ConnectionManagerRequestService.sendRequest = async (...args) => {
            chat_metadata.story_arc.knowledge.lastUpdatedAt = 1;
            return sendRequest(...args);
        };

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{ kind: 'skipped', from: 3, to: 6, reason: 'ledger moved' }]);
    });

    it('records nothing while the tracker is off or the update interval is not reached', async () => {
        setSwitches({ tracker: false });
        storeLedger();
        installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);
        await updateKnowledgeAfterReply(6);

        setSwitches({ interval: 3 });
        await updateKnowledgeAfterReply(6);

        assert.equal(chat_metadata.story_arc.knowledge.updateLog, undefined);
    });

    it('keeps the newest twenty records', async () => {
        setSwitches();
        storeLedger();
        chat_metadata.story_arc.knowledge.updateLog = Array.from({ length: 20 }, (unused, index) =>
            ({ kind: 'skipped', from: index, to: index, reason: 'no answer' }));
        installExtraction([]);
        ConnectionManagerRequestService.sendRequest = async () => { throw new Error('profile not found'); };

        await updateKnowledgeAfterReply(6);

        const updateLog = chat_metadata.story_arc.knowledge.updateLog;
        assert.equal(updateLog.length, 20);
        assert.deepEqual(updateLog[0], { kind: 'skipped', from: 1, to: 1, reason: 'no answer' });
        assert.deepEqual(updateLog[18], { kind: 'skipped', from: 19, to: 19, reason: 'no answer' });
        assert.deepEqual(updateLog[19], { kind: 'skipped', from: 3, to: 6, reason: 'no answer' });
    });

    it('records a rollback that drops a fact, after the update that created it', async () => {
        setSwitches();
        storeLedger();
        installExtraction([ANSWER_NOOR_LEARNS_LATCHES]);
        await updateKnowledgeAfterReply(6);

        chat.length = 3;
        await rollBackKnowledgeFrom(3);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [
            {
                kind: 'update', from: 3, to: 6, messageId: 'm6',
                answer: { present: 2, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
                factsCreated: ['f2'], holdersAdded: 2, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [{ factId: 'f2', characterId: 'c2', messageId: 'm3' }, { factId: 'f2', characterId: 'c1', messageId: 'm3' }], details: [], names: [], scene: null },
            },
            { kind: 'rollback', from: 3, factsDropped: ['f2'], holdersDropped: 2, factsRestored: [], detailsDropped: 0 },
        ]);
    });

    it('records a rollback that brings a retracted fact back', async () => {
        setSwitches();
        storeLedger();
        chat_metadata.story_arc.knowledge.retractedFacts = [{
            at: 5, messageId: 'm5',
            fact: {
                id: 'f2', text: 'Noor owns the bay', public: false,
                holders: [{ characterId: 'c2', how: 'witnessed', toldBy: null, at: 4, messageId: 'm4' }],
            },
        }];

        chat.length = 5;
        await rollBackKnowledgeFrom(5);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [
            { kind: 'rollback', from: 5, factsDropped: [], holdersDropped: 0, factsRestored: ['f2'], detailsDropped: 0 },
        ]);
    });

    it('records no rollback that changed nothing', async () => {
        setSwitches();
        storeLedger();

        await rollBackKnowledgeFrom(7);

        assert.equal(chat_metadata.story_arc.knowledge.updateLog, undefined);
    });

    it('records the re-extraction of an edited message', async () => {
        setSwitches();
        storeLedger();
        installExtraction([JSON.stringify({
            present: ['Noor', 'Ellie'],
            newCharacters: [],
            learned: [{ text: 'Ellie is Dice', public: false, who: ['Noor'], how: 'witnessed', toldBy: null, at: 1 }],
        })]);

        await updateKnowledgeAfterEdit(1);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{
            kind: 'reextract', from: 1, to: 1, messageId: 'm1',
            answer: { present: 2, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
            factsCreated: ['f1'], holdersAdded: 1, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [{ factId: 'f1', characterId: 'c1', messageId: 'm1' }], details: [], names: [], scene: null },
        }]);
    });

    it('counts the details an update set, changed and ignored as restatements, without their values', async () => {
        setSwitches();
        storeLedger();
        chat_metadata.story_arc.knowledge.characters[0].details = {
            role: [{ value: 'mechanic, Halstead bay', at: 1, messageId: 'm1' }],
            age: [{ value: '30s', at: 1, messageId: 'm1' }],
        };
        installExtraction([JSON.stringify({
            present: ['Noor', 'Ellie'], newCharacters: [], learned: [],
            details: [
                { character: 'Ellie', kind: 'gender', value: 'female', at: 3 },
                { character: 'Noor', kind: 'role', value: 'head mechanic, Halstead bay', change: 'Gabriel promotes her.', at: 4 },
                { character: 'Noor', kind: 'age', value: '50s', at: 4 },
                { character: 'Noor', kind: 'gender', value: 'female', at: 4 },
                { character: 'Noor', kind: 'gender', value: 'female', at: 6 },
            ],
        })]);

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{
            kind: 'update', from: 3, to: 6, messageId: 'm6',
            answer: { present: 2, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
            factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 2, detailsChanged: 1, restatementsIgnored: 1, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [], details: [{ characterId: 'c1', kind: 'role', messageId: 'm4' }, { characterId: 'c1', kind: 'gender', messageId: 'm4' }, { characterId: 'c2', kind: 'gender', messageId: 'm3' }], names: [], scene: null },
        }]);
    });

    it('counts the details of a re-extraction', async () => {
        setSwitches();
        storeLedger();
        chat_metadata.story_arc.knowledge.characters[1].details = { age: [{ value: '17', at: 0, messageId: 'm0' }] };
        installExtraction([JSON.stringify({
            present: ['Noor', 'Ellie'], newCharacters: [], learned: [],
            details: [{ character: 'Ellie', kind: 'age', value: 19, at: 1 }],
        })]);

        await updateKnowledgeAfterEdit(1);

        const record = chat_metadata.story_arc.knowledge.updateLog[0];
        assert.equal(record.kind, 'reextract');
        assert.deepEqual(
            { detailsSet: record.detailsSet, detailsChanged: record.detailsChanged, restatementsIgnored: record.restatementsIgnored },
            { detailsSet: 0, detailsChanged: 0, restatementsIgnored: 1 },
        );
    });

    it('records a failed re-extraction as a skip', async () => {
        setSwitches();
        storeLedger();
        installExtraction([]);
        ConnectionManagerRequestService.sendRequest = async () => { throw new Error('profile not found'); };

        await updateKnowledgeAfterEdit(1);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{ kind: 'skipped', from: 1, to: 1, reason: 'no answer' }]);
    });
});

describe('the knowledge update log: details the player locked', () => {
    beforeEach(() => {
        fillChat();
        setSwitches();
        storeLedger();
        // The player set Noor's gender and role in the Knowledge popup.
        chat_metadata.story_arc.knowledge.characters[0].details = {
            gender: [{ value: 'female', at: null, by: 'user' }],
            role: [
                { value: 'mechanic', at: 0, messageId: 'm0' },
                { value: 'chief mechanic, Bay 3', at: null, by: 'user' },
            ],
        };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('an update skips a locked kind and counts the skips', async () => {
        installExtraction([JSON.stringify({
            present: ['Noor', 'Ellie'],
            newCharacters: [],
            learned: [],
            details: [
                { character: 'Noor', kind: 'gender', value: 'male', at: 4 },
                { character: 'Noor', kind: 'role', value: 'welder', at: 4 },
                { character: 'Ellie', kind: 'age', value: '17', at: 5 },
            ],
        })]);

        await updateKnowledgeAfterReply(6);

        const knowledge = chat_metadata.story_arc.knowledge;
        assert.deepEqual(knowledge.characters[0].details, {
            gender: [{ value: 'female', at: null, by: 'user' }],
            role: [
                { value: 'mechanic', at: 0, messageId: 'm0' },
                { value: 'chief mechanic, Bay 3', at: null, by: 'user' },
            ],
        });
        assert.deepEqual(knowledge.characters[1].details, { age: [{ value: '17', at: 5, messageId: 'm5' }] });
        assert.deepEqual(knowledge.updateLog, [{
            kind: 'update', from: 3, to: 6, messageId: 'm6',
            answer: { present: 2, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
            factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 1, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 2,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [], details: [{ characterId: 'c2', kind: 'age', messageId: 'm5' }], names: [], scene: null },
        }]);
    });

    it('a re-extraction counts its locked skips too', async () => {
        installExtraction([JSON.stringify({
            present: ['Noor', 'Ellie'],
            newCharacters: [],
            learned: [],
            details: [{ character: 'Noor', kind: 'gender', value: 'male', at: 1 }],
        })]);

        await updateKnowledgeAfterEdit(1);

        const knowledge = chat_metadata.story_arc.knowledge;
        assert.deepEqual(knowledge.characters[0].details.gender, [{ value: 'female', at: null, by: 'user' }]);
        assert.deepEqual(knowledge.updateLog, [{
            kind: 'reextract', from: 1, to: 1, messageId: 'm1',
            answer: { present: 2, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
            factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 1,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [], details: [], names: [], scene: null },
        }]);
    });
});
