import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService, hideCalls } from '../tests/mocks/st-mocks.js';
import { findNewVersionAfter, proposeRejectedSpan, proposeSpanFromMessage, takeOutRejectedSpan } from '../lib/knowledge/rejection.js';
import { updateKnowledgeAfterEdit, updateKnowledgeAfterReply, updateKnowledgeAfterSwipe } from '../lib/knowledge/ledger.js';
import { getRecentChat } from '../lib/context/chat-history.js';
import { clearTemplateCache } from '../lib/planning/generator.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

const narrator = mes => ({ is_user: false, is_system: false, name: 'Narrator', mes });
const player = mes => ({ is_user: true, is_system: false, name: 'Ellie', mes });

describe('proposeRejectedSpan', () => {
    it('proposes the reply the request is about through the message before the new version (Aegis 411–415)', () => {
        const chatMessages = [
            player('"Dr. Hale can answer your questions."'),
            narrator('Miriam Koster peered down at her.'),
            player('[OOC: Why is it a threat? Report back and stop the RP]'),
            narrator('[OOC: Stopping the RP and reporting back.]'),
            player('[OOC: Yes, rewrite it with a message that makes sense]'),
            narrator('Miriam Koster peered down over her half-moon glasses.'),
        ];
        assert.deepEqual(proposeRejectedSpan(chatMessages, 4, 5), { start: 1, end: 4 });
    });

    it('starts at the latest story reply only, when the rejection reaches back several turns (Paragon 3022–3033)', () => {
        const chatMessages = [
            player('"Well thats for you to figure out?"'),
            narrator('Vasquez folded her arms.'),
            player('"I don\'t want you to go to prison, Elena."'),
            narrator('"I won\'t log tonight\'s meeting," Vasquez said.'),
            player('[OOC: Stop the RP. Vasquez portrayal is very infuriating. Report back]'),
            narrator('[OOC: Pausing the RP and reporting back!]'),
            player('[OOC: Please do. You need to nail this tone, ok?]'),
            narrator('"Well, that\'s for you to figure out, I guess?" Ellie said.'),
        ];
        // The player moves the start back to 1 in the dialog; the proposal starts at 3.
        assert.deepEqual(proposeRejectedSpan(chatMessages, 6, 7), { start: 3, end: 6 });
    });

    it('starts at the request when no story reply comes before it', () => {
        const chatMessages = [player('[OOC: rewrite the intro]'), narrator('The city wakes.')];
        assert.deepEqual(proposeRejectedSpan(chatMessages, 0, 1), { start: 0, end: 0 });
    });
});

describe('proposeSpanFromMessage and findNewVersionAfter', () => {
    it('proposes through the chat\'s end for a reply rejected and never rewritten (Aegis 425–427)', () => {
        const chatMessages = [
            narrator('Hale took the black receiver.'),
            player('[OOC: Ok, I\'ll stop the RP. Damon left TODAY. And suddenly everyone knows?]'),
            narrator('[OOC: Stopping RP. You\'re completely right.]'),
        ];
        assert.deepEqual(proposeSpanFromMessage(chatMessages, 0), { start: 0, end: 2 });
    });

    it('proposes through the message before the next story reply', () => {
        const chatMessages = [
            narrator('Hale took the receiver.'),
            player('[OOC: Rewrite - its getting really boring.]'),
            narrator('Hale took the receiver again.'),
        ];
        assert.deepEqual(proposeSpanFromMessage(chatMessages, 0), { start: 0, end: 1 });
    });

    it('never takes a ticked story reply as the new version (Aegis 419–425)', () => {
        const chatMessages = [
            narrator('419: a captain on the phone.'),
            player('[OOC: Stop the RP. Report back]'),
            narrator('[OOC: Stopping RP and reporting back.]'),
            player('[OOC: Rewrite - its getting really boring.]'),
            narrator('423: Ilyas walks in.'),
            player('[OOC: No. I didn\'t tell you to recycle Ren]'),
            narrator('425: Daybreak on the news.'),
        ];
        assert.equal(findNewVersionAfter(chatMessages, 5, new Set([0, 1, 2, 3, 4, 5])), 6);
        assert.equal(findNewVersionAfter(chatMessages, 3, new Set([0, 1, 2, 3])), 4);
        assert.equal(findNewVersionAfter(chatMessages, 6, new Set()), null);
    });

    it('finds the next story reply when a summary hid every message after the span (Paragon 3023)', () => {
        const hidden = message => ({ ...message, is_system: true });
        const chatMessages = [
            hidden(narrator('3023: "I won\'t log tonight\'s meeting," Vasquez said.')),
            hidden(player('"I don\'t want you to go to prison, Elena."')),
            hidden(narrator('3025: Vasquez shrugs.')),
            hidden(player('[OOC: Stop the RP. Report back]')),
            { ...hidden(narrator('Taken out earlier.')), extra: { story_arc_rejected: true } },
        ];
        assert.deepEqual(proposeSpanFromMessage(chatMessages, 0), { start: 0, end: 1 });
        assert.equal(findNewVersionAfter(chatMessages, 3, new Set([0, 1, 2, 3])), null);
    });
});

// ─── The take-out ───

/**
 * A chat of 416 messages shaped like Aegis 397–415. Message 410 names Jude
 * Callahan; 411 is the rejected story reply; 412–414 the out-of-character
 * exchange; 415 the new version, the chat's last message.
 */
function aegisChat() {
    chat.length = 0;
    for (let index = 0; index < 416; index++) {
        const message = index % 2 === 0 ? player(`Turn ${index}.`) : narrator(`Reply ${index}.`);
        message.extra = { story_arc_message_id: `m${index}`, story_arc_read_text_hash: index };
        chat.push(message);
    }
    chat[410].mes = '"Dr. Hale can answer your questions. Jude Callahan is waiting outside."';
    chat[411].mes = 'Miriam Koster peered down. "My office pulls Hardpoint\'s telemetry at five o\'clock."';
    chat[412].mes = '[OOC: Of course? Why is it a threat? Report back and stop the RP]';
    chat[413].mes = '[OOC: Stopping the RP and reporting back.]';
    chat[414].mes = '[OOC: Yes, rewrite it with a message that makes sense]';
    chat[415].mes = 'Miriam Koster peered down over her half-moon glasses. File 302-M is a sponsorship dossier.';
}

/** The ledger as the update after 415 left it. */
function aegisLedger() {
    return {
        characters: [
            { id: 'c1', name: 'Ellie Masters', aliases: [] },
            { id: 'c2', name: 'Callum Hale', aliases: [] },
            { id: 'c97', name: 'Miriam Koster', aliases: [] },
            { id: 'c98', name: 'Jude Callahan', aliases: [] },
            { id: 'c99', name: 'Capt. Malkin', aliases: [], details: { role: [{ value: 'patrol captain', at: 411, messageId: 'm411' }] } },
        ],
        facts: [
            { id: 'f361', text: 'The re-evaluation stays live.', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 397, messageId: 'm397' },
                { characterId: 'c97', how: 'told', toldBy: 'c2', at: 411, messageId: 'm411' },
            ] },
            { id: 'f380', text: 'Koster pulls the telemetry at five.', public: false, holders: [
                { characterId: 'c97', how: 'witnessed', toldBy: null, at: 411, messageId: 'm411' },
            ] },
            { id: 'f381', text: 'File 302-M is a sponsorship dossier.', public: false, holders: [
                { characterId: 'c97', how: 'witnessed', toldBy: null, at: 411, messageId: 'm411' },
                { characterId: 'c2', how: 'told', toldBy: 'c97', at: 415, messageId: 'm415' },
            ] },
            { id: 'f500', text: 'Koster answers to the Third Floor.', public: false, holders: [
                { characterId: 'c1', how: 'user', toldBy: null, at: null },
                { characterId: 'c97', how: 'witnessed', toldBy: null, at: 411, messageId: 'm411' },
            ] },
        ],
        retractedFacts: [
            { at: 412, messageId: 'm412', fact: { id: 'f390', text: 'Koster threatens Hale.', public: false, holders: [
                { characterId: 'c2', how: 'witnessed', toldBy: null, at: 409, messageId: 'm409' },
            ] } },
            { at: 412, messageId: 'm412', fact: { id: 'f391', text: 'Koster owns the file.', public: false, holders: [
                { characterId: 'c1', how: 'witnessed', toldBy: null, at: 411, messageId: 'm411' },
            ] } },
        ],
        meetings: [
            { at: 409, present: ['c1', 'c97'], messageId: 'm409' },
            { at: 411, present: ['c1', 'c97', 'c99'], messageId: 'm411' },
            { at: 413, present: ['c1', 'c97'], messageId: 'm413' },
        ],
        scene: { at: 413, present: ['c1', 'c97'], messageId: 'm413' },
        sceneHistory: [
            { at: 409, present: ['c1', 'c2'], messageId: 'm409' },
            { at: 411, present: ['c1', 'c97', 'c99'], messageId: 'm411' },
        ],
        lastUpdatedAt: 415,
        lastUpdatedMessageId: 'm415',
        updateLog: [
            { kind: 'update', recordId: 'u1', from: 410, to: 411, items: { characters: ['c98', 'c99'], holders: [], details: [], names: [], scene: null } },
        ],
    };
}

/** An act whose milestone the rejected reply completed, and one still open. */
function aegisArc() {
    return {
        id: 'aegis001-full-id', title: 'Bedside Manner', status: 'active', tier: 'act', focus: 'normal',
        premise: 'Ellie earns a hero role.', messageStart: 0, lastFulfilledAt: 411, estimatedLength: 60,
        secrets: [], foreshadowing: [], triggers: [],
        rulings: [{ id: 'r1', text: 'Why is it a threat?', at: 412, messageId: 'm412' }],
        beats: [
            { id: 'audit', intention: 'Risk audits the clearance', pressure: 'Risk wants numbers', status: 'completed', unlockAfter: [], optional: false,
                completion: { at: 411, messageId: 'm411', unlocked: [], skipped: [], arcCompleted: false, lastFulfilledBefore: 300 } },
            { id: 'sponsor', intention: 'Hale sponsors Ellie', pressure: 'Hale needs cases', status: 'pending', unlockAfter: [], optional: false },
        ],
    };
}

/**
 * The extraction transport: records each prompt and answers with the next
 * queued answer. The template shows only the new messages.
 */
function installExtraction(answers) {
    clearTemplateCache();
    const sentPrompts = [];
    globalThis.fetch = async url => {
        if (String(url).endsWith('extract-knowledge.txt')) return new Response('{{MESSAGES}}');
        throw new Error(`unexpected fetch ${url}`);
    };
    ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
        sentPrompts.push(messages[0].content);
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
    return sentPrompts;
}

function storeAegis({ trackerOn = true } = {}) {
    aegisChat();
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: trackerOn, updateInterval: 1 },
    };
    chat_metadata.story_arc = {
        version: 1,
        arcs: [aegisArc()],
        settings: { autoTrack: true },
        pendingMarks: [{ arcId: 'aegis001-full-id', kind: 'clue', itemId: 'k1', at: 411 }, { arcId: 'aegis001-full-id', kind: 'clue', itemId: 'k2', at: 409 }],
        knowledge: aegisLedger(),
    };
}

/**
 * The re-read of 415. Its prompt shows the ledger without what 415 taught,
 * so f381 is not in it and the answer states the fact as new text.
 */
const rereadAnswer = JSON.stringify({
    present: ['Ellie Masters', 'Miriam Koster'],
    newCharacters: [],
    learned: [{ text: 'File 302-M is a sponsorship dossier.', public: false, who: ['Miriam Koster', 'Callum Hale'], how: 'witnessed', toldBy: null, at: 415 }],
});

function resetAll() {
    globalThis.fetch = originalFetch;
    ConnectionManagerRequestService.sendRequest = originalSendRequest;
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
    chat.length = 0;
    hideCalls.length = 0;
}

const ledger = () => chat_metadata.story_arc.knowledge;
const factOf = factId => ledger().facts.find(fact => fact.id === factId);
const factWithText = text => ledger().facts.find(fact => fact.text === text);
const holdersAt = fact => fact.holders.map(holder => `${holder.characterId}@${holder.at}`);

describe('takeOutRejectedSpan: Aegis 411–414', () => {
    beforeEach(() => storeAegis());
    afterEach(resetAll);

    it('hides and marks the ticked messages in one run', async () => {
        installExtraction([rereadAnswer]);
        const result = await takeOutRejectedSpan([413, 411, 414, 412]);
        await result.reread;

        assert.deepEqual(hideCalls, [[411, 414, false]]);
        for (const index of [411, 412, 413, 414]) {
            assert.equal(chat[index].is_system, true);
            assert.equal(chat[index].extra.story_arc_rejected, true);
        }
        assert.equal(chat[410].is_system, false);
        assert.equal(chat[415].extra.story_arc_rejected, undefined);
        assert.equal(result.taken, 4);
        assert.equal(result.newVersionIndex, 415);
    });

    it('drops what was learned there and keeps the rest, the player\'s entries and corrections included', async () => {
        installExtraction([rereadAnswer]);
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        await result.reread;

        assert.equal(factOf('f380'), undefined);
        assert.deepEqual(holdersAt(factOf('f361')), ['c1@397']);
        assert.deepEqual(holdersAt(factOf('f500')), ['c1@null']);
        // f381 lost its 411 entry; the re-read replaced what 415 taught, the dossier fact read again.
        assert.equal(factOf('f381'), undefined);
        assert.deepEqual(holdersAt(factWithText('File 302-M is a sponsorship dossier.')), ['c97@415', 'c2@415']);
        // The correction at 412 stands; the fact only the rejected reply taught has nothing to keep out.
        assert.deepEqual(ledger().retractedFacts.map(retraction => retraction.fact.id), ['f390']);
        assert.deepEqual(chat_metadata.story_arc.arcs[0].rulings.map(ruling => ruling.at), [412]);
        assert.deepEqual(ledger().meetings.map(meeting => meeting.at), [409, 415]);
    });

    it('puts the scene back to the latest one before the span', async () => {
        installExtraction([JSON.stringify({ present: [], newCharacters: [], learned: [] })]);
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);

        // Before the re-read: the scene of 409, which leaves the history.
        assert.deepEqual(ledger().scene, { at: 409, present: ['c1', 'c2'], messageId: 'm409' });
        assert.deepEqual(ledger().sceneHistory, []);
        await result.reread;
    });

    it('drops a character known only from the span, and keeps one a message outside it names', async () => {
        installExtraction([rereadAnswer]);
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        await result.reread;

        const characterIds = ledger().characters.map(character => character.id);
        assert.deepEqual(characterIds, ['c1', 'c2', 'c97', 'c98']);
        assert.equal(result.charactersDropped, 1);
    });

    it('reopens the beat the rejected reply completed and drops its queued mark', async () => {
        installExtraction([rereadAnswer]);
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        await result.reread;

        const audit = chat_metadata.story_arc.arcs[0].beats[0];
        assert.equal(audit.status, 'active');
        assert.equal(audit.completion, undefined);
        assert.equal(result.beatsReopened, 1);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks.map(mark => mark.itemId), ['k2']);
    });

    it('reads only the new version again, and records the take-out before the re-read', async () => {
        const sentPrompts = installExtraction([rereadAnswer]);
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        await result.reread;

        assert.equal(sentPrompts.length, 1);
        assert.ok(sentPrompts[0].includes('[415] Narrator: Miriam Koster peered down over her half-moon glasses.'));
        assert.ok(!sentPrompts[0].includes('[411]'));
        const kinds = ledger().updateLog.map(record => record.kind);
        assert.deepEqual(kinds.slice(-2), ['rejected', 'reextract']);
        const rejectedRecord = ledger().updateLog.at(-2);
        assert.deepEqual(
            { from: rejectedRecord.from, to: rejectedRecord.to, factsDropped: rejectedRecord.factsDropped, charactersDropped: rejectedRecord.charactersDropped },
            { from: 411, to: 414, factsDropped: ['f380', 'f391'], charactersDropped: ['c99'] },
        );
    });

    it('keeps a fact the new version states that only the rejected reply had taught (the f354 case)', async () => {
        ledger().facts.push({ id: 'f354', text: 'Ellie\'s gel work stopped the discharge.', public: false, holders: [
            { characterId: 'c2', how: 'witnessed', toldBy: null, at: 411, messageId: 'm411' },
        ] });
        installExtraction([JSON.stringify({
            present: ['Ellie Masters'],
            newCharacters: [],
            learned: [{ text: 'Ellie\'s gel work stopped the discharge.', public: false, who: ['Callum Hale'], how: 'witnessed', toldBy: null, at: 415 }],
        })]);
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        // The drop took it: only 411 had taught it.
        assert.equal(factOf('f354'), undefined);
        await result.reread;

        assert.deepEqual(holdersAt(factWithText('Ellie\'s gel work stopped the discharge.')), ['c2@415']);
    });

    it('leaves the new version pending, its read-text hash gone, when the re-read call fails', async () => {
        installExtraction([]);
        ConnectionManagerRequestService.sendRequest = async () => { throw new Error('401 unauthorized'); };
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        await result.reread;

        assert.deepEqual(ledger().pendingReextractions.map(entry => entry.messageId), ['m415']);
        assert.equal(chat[415].extra.story_arc_read_text_hash, undefined);
    });

    it('never reads a rejected message again, after an edit or a swipe switch', async () => {
        const sentPrompts = installExtraction([rereadAnswer]);
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        await result.reread;
        const promptsBefore = sentPrompts.length;

        chat[411].mes = 'Koster smiles and leaves.';
        const edited = await updateKnowledgeAfterEdit(411);
        chat[411].swipes = ['Miriam Koster peered down.', 'Koster smiles and leaves.'];
        chat[411].swipe_id = 0;
        const swiped = await updateKnowledgeAfterSwipe(411);

        assert.equal(sentPrompts.length, promptsBefore);
        assert.deepEqual(edited, { ledgerChanged: false, beatsChanged: false });
        assert.equal(swiped.beatsChanged, false);
    });

    it('refuses a second take-out until the first one\'s re-read is back', async () => {
        let answerReread;
        clearTemplateCache();
        globalThis.fetch = async () => new Response('{{MESSAGES}}');
        ConnectionManagerRequestService.sendRequest = async () => () => (async function* () {
            yield { text: await new Promise(resolve => { answerReread = resolve; }) };
        })();
        const first = await takeOutRejectedSpan([411, 412, 413, 414]);
        await new Promise(resolve => setTimeout(resolve, 10));

        const second = await takeOutRejectedSpan([409]);
        assert.deepEqual(second, { error: 'Story Arc is still reading the latest reply; try again in a moment.' });
        assert.equal(chat[409].is_system, false);

        answerReread(rereadAnswer);
        await first.reread;
        installExtraction([rereadAnswer]);
        const third = await takeOutRejectedSpan([409]);
        await third.reread;
        assert.equal(chat[409].is_system, true);
    });

    it('is refused while a reply update is out, and changes nothing', async () => {
        let answerUpdate;
        clearTemplateCache();
        globalThis.fetch = async () => new Response('{{MESSAGES}}');
        ConnectionManagerRequestService.sendRequest = async () => () => (async function* () {
            yield { text: await new Promise(resolve => { answerUpdate = resolve; }) };
        })();
        chat.push(narrator('Reply 416.'));
        const running = updateKnowledgeAfterReply(416);
        await new Promise(resolve => setTimeout(resolve, 10));

        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        assert.deepEqual(result, { error: 'Story Arc is still reading the latest reply; try again in a moment.' });
        assert.equal(chat[411].is_system, false);
        assert.equal(chat[411].extra.story_arc_rejected, undefined);
        assert.ok(factOf('f380'));

        answerUpdate(JSON.stringify({ present: [], newCharacters: [], learned: [] }));
        await running;
    });
});

describe('takeOutRejectedSpan with the tracker off', () => {
    afterEach(resetAll);

    it('hides and marks, reopens the beat, and leaves the ledger as it was', async () => {
        storeAegis({ trackerOn: false });
        const sentPrompts = installExtraction([]);
        const result = await takeOutRejectedSpan([411, 412, 413, 414]);
        await result.reread;

        assert.deepEqual(hideCalls, [[411, 414, false]]);
        assert.equal(chat[411].extra.story_arc_rejected, true);
        assert.deepEqual(ledger(), aegisLedger());
        assert.equal(chat_metadata.story_arc.arcs[0].beats[0].status, 'active');
        assert.equal(sentPrompts.length, 0);
    });
});

describe('getRecentChat and rejected messages', () => {
    afterEach(resetAll);

    it('skips a message that is marked and hidden, and reads it again once it is unhidden', () => {
        chat.length = 0;
        chat.push(
            narrator('Kept.'),
            { ...narrator('Rejected.'), is_system: true, extra: { story_arc_rejected: true } },
            { ...narrator('Hidden by a summary.'), is_system: true },
        );
        assert.deepEqual(getRecentChat().map(message => message.content), ['Kept.', 'Hidden by a summary.']);

        chat[1].is_system = false;
        assert.deepEqual(getRecentChat().map(message => message.content), ['Kept.', 'Rejected.', 'Hidden by a summary.']);
    });
});
