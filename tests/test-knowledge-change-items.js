import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import {
    updateKnowledgeAfterReply, updateKnowledgeAfterEdit, updateKnowledgeAfterSwipe, rollBackKnowledgeFrom,
    dropKnowledgeFrom, listChangeItems,
} from '../lib/knowledge/ledger.js';
import { markChangeItemReviewed, saveLedgerEdit, startKnowledgeUndoSession, undoLedgerEdit, unmarkChangeItemReviewed } from '../lib/ui/knowledge-popup.js';

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

function setSwitches() {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: true, updateInterval: 1, characterDetails: true },
    };
}

/** A workshop chat of seven messages, each with the Story Arc message id m0 … m6 already. */
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

/** Noor and Ellie; f1 Noor witnessed at 1; updated through message 2. No updateLog, no reviewed marks. */
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

/** One answer that does a bit of everything the record lists. */
const ANSWER_EVERYTHING = JSON.stringify({
    present: ['Noor', 'Ellie', 'Gabriel'],
    newCharacters: [{ name: 'Gabriel', aliases: [] }],
    newNames: [{ character: 'Noor', name: 'Wrench' }],
    learned: [{ text: 'Gabriel wants titanium latches', public: false, who: ['Noor'], how: 'witnessed', toldBy: null, at: 3 }],
    retracted: [{ factId: 'f1', at: 5 }],
    details: [{ character: 'Ellie', kind: 'gender', value: 'female', at: 4 }],
});

describe('update records list their items', () => {
    beforeEach(() => {
        fillChat();
        setSwitches();
        storeLedger();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('an update lists the characters, holders, details, names, retractions and scene it created', async () => {
        installExtraction([ANSWER_EVERYTHING]);

        await updateKnowledgeAfterReply(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{
            kind: 'update', from: 3, to: 6, messageId: 'm6',
            answer: { present: 3, newCharacters: 1, learned: 1, retracted: 1, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
            factsCreated: ['f2'], holdersAdded: 1, factsRetracted: ['f1'], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 1, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 1, newNamesRefused: 0, newNamesUnknown: 0,
            items: {
                characters: ['c3'],
                holders: [{ factId: 'f2', characterId: 'c1', messageId: 'm3' }],
                details: [{ characterId: 'c2', kind: 'gender', messageId: 'm4' }],
                names: [{ characterId: 'c1', name: 'Wrench' }],
                scene: ['c1', 'c2', 'c3'],
            },
        }]);
    });

    it('a re-extraction of an older message lists its items and no scene, which it leaves alone', async () => {
        installExtraction([JSON.stringify({
            present: ['Noor'],
            newCharacters: [],
            learned: [{ text: 'Ellie is Dice', public: false, who: ['Noor', 'Ellie'], how: 'witnessed', toldBy: null, at: 1 }],
            details: [{ character: 'Noor', kind: 'role', value: 'mechanic', at: 1 }],
        })]);

        await updateKnowledgeAfterEdit(1);

        assert.deepEqual(chat_metadata.story_arc.knowledge.updateLog, [{
            kind: 'reextract', from: 1, to: 1, messageId: 'm1',
            answer: { present: 1, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 0 },
            factsCreated: ['f1'], holdersAdded: 2, factsRetracted: [], beatsCompleted: 0, rulingsStored: 0,
            detailsSet: 1, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: {
                characters: [],
                holders: [
                    { factId: 'f1', characterId: 'c1', messageId: 'm1' },
                    { factId: 'f1', characterId: 'c2', messageId: 'm1' },
                ],
                details: [{ characterId: 'c1', kind: 'role', messageId: 'm1' }],
                names: [],
                scene: null,
            },
        }]);
        assert.deepEqual(chat_metadata.story_arc.knowledge.scene, { at: 2, messageId: 'm2', present: ['c1', 'c2'] });
    });

    it('the relative the story named lists its new name, not a new character', async () => {
        chat_metadata.story_arc.knowledge.characters.push({
            id: 'c3', name: '', aliases: [],
            details: { relation: [{ value: { kind: 'mother', of: 'c2' }, at: null, by: 'record' }] },
        });
        installExtraction([JSON.stringify({
            present: ['Noor', 'Ellie'],
            newCharacters: [{ name: 'Maren', aliases: [], wasUnnamed: "Ellie's mother" }],
            learned: [],
        })]);

        await updateKnowledgeAfterReply(6);

        const record = chat_metadata.story_arc.knowledge.updateLog.at(-1);
        assert.deepEqual(record.items, {
            characters: [], holders: [], details: [], names: [{ characterId: 'c3', name: 'Maren' }], scene: null,
        });
    });
});

describe('the item keys of a record', () => {
    it('a new record gives every item a key of its message id, its kind and the item ids', () => {
        const record = {
            kind: 'update', from: 3, to: 6, messageId: 'm6', factsRetracted: ['f1'],
            items: {
                characters: ['c3'],
                holders: [{ factId: 'f2', characterId: 'c1', messageId: 'm3' }],
                details: [{ characterId: 'c2', kind: 'gender', messageId: 'm4' }],
                names: [{ characterId: 'c1', name: 'Wrench' }],
                scene: ['c1', 'c3'],
            },
        };

        assert.deepEqual(listChangeItems(record).map(item => item.key), [
            'm6:update:character:c3',
            'm6:update:holder:f2:c1',
            'm6:update:detail:c2:gender',
            'm6:update:name:c1:Wrench',
            'm6:update:retracted:f1',
            'm6:update:scene:c1:c3',
        ]);
        assert.deepEqual(listChangeItems(record)[2], {
            key: 'm6:update:detail:c2:gender', kind: 'detail', detailKind: 'gender', characterId: 'c2', messageId: 'm4',
        });
    });

    it('a record from before the items, a skip and a rollback list none', () => {
        assert.deepEqual(listChangeItems({
            kind: 'update', from: 3, to: 6, messageId: 'm6', factsCreated: ['f2'], holdersAdded: 2, factsRetracted: ['f1'],
        }), []);
        assert.deepEqual(listChangeItems({ kind: 'skipped', from: 3, to: 6, reason: 'no answer' }), []);
        assert.deepEqual(listChangeItems({
            kind: 'rollback', from: 3, factsDropped: ['f2'], holdersDropped: 2, factsRestored: [], detailsDropped: 0,
        }), []);
    });
});

/** The item keys of the update ANSWER_EVERYTHING records over messages 3 to 6. */
const EVERYTHING_KEYS = {
    character: 'm6:update:character:c3',
    holder: 'm6:update:holder:f2:c1',
    detail: 'm6:update:detail:c2:gender',
    name: 'm6:update:name:c1:Wrench',
    retracted: 'm6:update:retracted:f1',
    scene: 'm6:update:scene:c1:c2:c3',
};

describe('a rollback drops the reviewed marks of the items it removes', () => {
    beforeEach(async () => {
        fillChat();
        setSwitches();
        storeLedger();
        installExtraction([ANSWER_EVERYTHING]);
        await updateKnowledgeAfterReply(6);
        chat_metadata.story_arc.knowledge.reviewedMarks = Object.values(EVERYTHING_KEYS);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('deleting messages 4 on drops the marks of the detail, the retraction and the scene', async () => {
        chat.length = 4;
        await rollBackKnowledgeFrom(4);

        assert.deepEqual(chat_metadata.story_arc.knowledge.reviewedMarks, [
            'm6:update:character:c3', 'm6:update:holder:f2:c1', 'm6:update:name:c1:Wrench',
        ]);
    });

    it('deleting message 4 in the middle drops only the mark of the detail learned there', async () => {
        chat.splice(4, 1);
        await rollBackKnowledgeFrom(6);

        assert.deepEqual(chat_metadata.story_arc.knowledge.reviewedMarks, [
            'm6:update:character:c3', 'm6:update:holder:f2:c1', 'm6:update:name:c1:Wrench',
            'm6:update:retracted:f1', 'm6:update:scene:c1:c2:c3',
        ]);
    });

    it('a swipe of message 5 drops the marks of the retraction and the scene', async () => {
        chat[5].swipes = ['Thanks.', 'Cheers.'];
        chat[5].swipe_id = 2;
        await updateKnowledgeAfterSwipe(5);

        assert.deepEqual(chat_metadata.story_arc.knowledge.reviewedMarks, [
            'm6:update:character:c3', 'm6:update:holder:f2:c1', 'm6:update:detail:c2:gender', 'm6:update:name:c1:Wrench',
        ]);
    });

    it('an edit of message 3 drops the mark of the holder learned there and keeps the others', async () => {
        installExtraction([JSON.stringify({ present: ['Noor'], newCharacters: [], learned: [] })]);

        await updateKnowledgeAfterEdit(3);

        assert.deepEqual(chat_metadata.story_arc.knowledge.reviewedMarks, [
            'm6:update:character:c3', 'm6:update:detail:c2:gender', 'm6:update:name:c1:Wrench',
            'm6:update:retracted:f1', 'm6:update:scene:c1:c2:c3',
        ]);
    });
});

describe('the reviewed marks on ledgers from before them', () => {
    it('a rollback of a ledger with a count-only log and no marks works as before and adds no marks', () => {
        const ledger = {
            characters: [{ id: 'c1', name: 'Noor', aliases: [] }],
            facts: [{
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 4 }],
            }],
            scene: { at: 4, present: ['c1'] },
            lastUpdatedAt: 4,
            updateLog: [{
                kind: 'update', from: 3, to: 4, messageId: null,
                answer: { present: 1, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0 },
                factsCreated: ['f1'], holdersAdded: 1, factsRetracted: [], beatsCompleted: 0,
            }],
        };

        const changed = dropKnowledgeFrom(ledger, 4);

        assert.equal(changed, true);
        assert.deepEqual(ledger, {
            characters: [{ id: 'c1', name: 'Noor', aliases: [] }],
            facts: [],
            scene: { at: null, present: [] },
            lastUpdatedAt: 3,
            updateLog: [
                {
                    kind: 'update', from: 3, to: 4, messageId: null,
                    answer: { present: 1, newCharacters: 0, learned: 1, retracted: 0, revealedSecrets: 0, fulfilled: 0 },
                    factsCreated: ['f1'], holdersAdded: 1, factsRetracted: [], beatsCompleted: 0,
                },
                { kind: 'rollback', from: 4, factsDropped: ['f1'], holdersDropped: 1, factsRestored: [], detailsDropped: 0 },
            ],
        });
    });

    it('a rollback keeps the mark of a scene that left the scene history long before it', () => {
        const ledger = {
            characters: [{ id: 'c1', name: 'Noor', aliases: [] }],
            facts: [{
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 40, messageId: 'm40' }],
            }],
            // The scene of m6 left the history ten updates ago.
            scene: { at: 40, messageId: 'm40', present: ['c1'] },
            sceneHistory: [{ at: 30, messageId: 'm30', present: ['c1'] }],
            lastUpdatedAt: 40,
            updateLog: [{
                kind: 'update', from: 3, to: 6, messageId: 'm6', factsRetracted: [],
                items: { characters: [], holders: [], details: [], names: [], scene: ['c1'] },
            }],
            reviewedMarks: ['m6:update:scene:c1'],
        };

        dropKnowledgeFrom(ledger, 40);

        assert.deepEqual(ledger.reviewedMarks, ['m6:update:scene:c1']);
    });

    it('two scene changes of the same message have two keys', () => {
        const reextract = scene => ({
            kind: 'reextract', from: 6, to: 6, messageId: 'm6', factsRetracted: [],
            items: { characters: [], holders: [], details: [], names: [], scene },
        });

        assert.deepEqual(listChangeItems(reextract(['c1'])).map(item => item.key), ['m6:reextract:scene:c1']);
        assert.deepEqual(listChangeItems(reextract(['c1', 'c2'])).map(item => item.key), ['m6:reextract:scene:c1:c2']);
    });

    it('a rollback drops a mark whose record is no longer in the log', () => {
        const ledger = {
            characters: [{ id: 'c1', name: 'Noor', aliases: [] }],
            facts: [{
                id: 'f1', text: 'Ellie is Dice', public: false,
                holders: [{ characterId: 'c1', how: 'witnessed', toldBy: null, at: 4, messageId: 'm4' }],
            }],
            scene: { at: 4, messageId: 'm4', present: ['c1'] },
            lastUpdatedAt: 4,
            updateLog: [{
                kind: 'update', from: 4, to: 4, messageId: 'm4', factsRetracted: [],
                items: { characters: [], holders: [{ factId: 'f1', characterId: 'c1', messageId: 'm4' }], details: [], names: [], scene: null },
            }],
            reviewedMarks: ['m1:update:character:c1', 'm4:update:holder:f1:c1'],
        };

        dropKnowledgeFrom(ledger, 9);

        assert.deepEqual(ledger.reviewedMarks, ['m4:update:holder:f1:c1']);
    });
});

describe('marking a change item as reviewed', () => {
    const ledgerWithLog = () => ({
        characters: [{ id: 'c1', name: 'Noor', aliases: [] }, { id: 'c3', name: 'Gabriel', aliases: [] }],
        facts: [],
        scene: { at: 6, messageId: 'm6', present: ['c1'] },
        lastUpdatedAt: 6,
        updateLog: [{
            kind: 'update', from: 3, to: 6, messageId: 'm6', factsRetracted: [],
            items: { characters: ['c3'], holders: [], details: [], names: [{ characterId: 'c1', name: 'Wrench' }], scene: null },
        }],
    });

    it('marks an item of the log on a ledger without marks, leaving the ledger it got alone', () => {
        const ledger = ledgerWithLog();

        const result = markChangeItemReviewed(ledger, 'm6:update:character:c3');

        assert.equal(result.error, null);
        assert.deepEqual(result.ledger.reviewedMarks, ['m6:update:character:c3']);
        assert.equal(ledger.reviewedMarks, undefined);
    });

    it('marks an item once only', () => {
        const ledger = { ...ledgerWithLog(), reviewedMarks: ['m6:update:character:c3'] };

        const result = markChangeItemReviewed(ledger, 'm6:update:character:c3');

        assert.deepEqual(result.ledger.reviewedMarks, ['m6:update:character:c3']);
    });

    it('refuses a key no record of the log lists', () => {
        const result = markChangeItemReviewed(ledgerWithLog(), 'm2:update:character:c9');

        assert.deepEqual(result, { ledger: null, error: 'This change is no longer in the update log.' });
    });

    it('unmarks an item and keeps the other marks', () => {
        const ledger = { ...ledgerWithLog(), reviewedMarks: ['m6:update:character:c3', 'm6:update:name:c1:Wrench'] };

        const result = unmarkChangeItemReviewed(ledger, 'm6:update:character:c3');

        assert.equal(result.error, null);
        assert.deepEqual(result.ledger.reviewedMarks, ['m6:update:name:c1:Wrench']);
        assert.deepEqual(ledger.reviewedMarks, ['m6:update:character:c3', 'm6:update:name:c1:Wrench']);
    });
});

describe('saveLedgerEdit — a reviewed mark saved through the popup', () => {
    it('stores the marks on the stored ledger', async () => {
        const storedLedger = {
            characters: [{ id: 'c3', name: 'Gabriel', aliases: [] }],
            facts: [],
            scene: { at: 6, messageId: 'm6', present: [] },
            lastUpdatedAt: 6,
            updateLog: [{
                kind: 'update', from: 3, to: 6, messageId: 'm6', factsRetracted: [],
                items: { characters: ['c3'], holders: [], details: [], names: [], scene: null },
            }],
        };
        const previousJquery = globalThis.$;
        globalThis.$ = () => ({ length: 0 });
        chat_metadata.story_arc = { knowledge: storedLedger };
        try {
            await saveLedgerEdit(markChangeItemReviewed(storedLedger, 'm6:update:character:c3'));

            assert.deepEqual(chat_metadata.story_arc.knowledge.reviewedMarks, ['m6:update:character:c3']);
        } finally {
            globalThis.$ = previousJquery;
            delete chat_metadata.story_arc;
        }
    });

    it('undo takes a mark back', async () => {
        const storedLedger = {
            characters: [{ id: 'c3', name: 'Gabriel', aliases: [] }],
            facts: [],
            scene: { at: 6, messageId: 'm6', present: [] },
            lastUpdatedAt: 6,
            updateLog: [{
                kind: 'update', from: 3, to: 6, messageId: 'm6', factsRetracted: [],
                items: { characters: ['c3'], holders: [], details: [], names: [], scene: null },
            }],
            reviewedMarks: [],
        };
        const previousJquery = globalThis.$;
        globalThis.$ = () => ({ length: 0 });
        chat_metadata.story_arc = { knowledge: storedLedger };
        startKnowledgeUndoSession();
        try {
            await saveLedgerEdit(markChangeItemReviewed(storedLedger, 'm6:update:character:c3'));
            const { error } = await undoLedgerEdit();

            assert.equal(error, null);
            assert.deepEqual(chat_metadata.story_arc.knowledge.reviewedMarks, []);
        } finally {
            globalThis.$ = previousJquery;
            delete chat_metadata.story_arc;
        }
    });
});
