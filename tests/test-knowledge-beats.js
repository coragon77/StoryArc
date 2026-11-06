import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import {
    listRecognisableBeats,
    buildKnowledgeExtractionVariables,
    parseKnowledgeExtractionAnswer,
    resolveFulfilledBeats,
    updateKnowledgeAfterReply,
    updateKnowledgeAfterSwipe,
    updateKnowledgeAfterEdit,
} from '../lib/knowledge/ledger.js';
import { completeBeats } from '../lib/planning/beat-completion.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/** An act with one done beat, two active ones and one pending. */
function craneAct() {
    return {
        id: 'crane001-full-id', title: 'The Crane Drop', status: 'active', tier: 'act', focus: 'normal',
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
        beats: [
            { id: 'permit_shown', intention: 'Julian has shown the crew the forged permit', status: 'completed', unlockAfter: [], optional: false },
            { id: 'brody_refuses', intention: 'Brody refuses an order from Julian in front of the crew', status: 'active', unlockAfter: [], optional: false },
            { id: 'crane_moved', intention: 'The crane is moved at night', status: 'active', unlockAfter: [], optional: false },
            { id: 'crane_falls', intention: 'The crane comes down on the Annex', status: 'pending', unlockAfter: [], optional: false },
        ],
    };
}

/** An act in background focus with one active milestone. */
function driveAct() {
    return {
        id: 'drive002-full-id', title: 'The Drive', status: 'active', tier: 'act', focus: 'background',
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
        beats: [
            { id: 'drive_handed', intention: 'Vera hands Ellie the flash drive', status: 'active', unlockAfter: [], optional: false },
        ],
    };
}

/** A paused act with an active beat. */
function pausedAct() {
    return {
        id: 'sleep003-full-id', title: 'The Sleeper', status: 'active', tier: 'act', focus: 'paused', pausedAt: 1,
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
        beats: [
            { id: 'sleeper_wakes', intention: 'The sleeper agent receives the code word', status: 'active', unlockAfter: [], optional: false },
        ],
    };
}

/** A completed arc with a beat that is still active. */
function completedArc() {
    return {
        id: 'done0004-full-id', title: 'Old Business', status: 'completed', tier: 'act', focus: 'normal',
        messageStart: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
        beats: [{ id: 'old_beat', intention: 'Something long settled', status: 'active', unlockAfter: [], optional: false }],
    };
}

const EMPTY_LEDGER = { characters: [], facts: [], scene: { at: null, present: [] }, lastUpdatedAt: null };

describe('DEVELOPMENTS in the extraction input', () => {
    it('lists each arc that is not paused: active beats by id, done beats without ids', () => {
        const developments = listRecognisableBeats([craneAct(), driveAct(), pausedAct(), completedArc()]);

        const variables = buildKnowledgeExtractionVariables(EMPTY_LEDGER, [], 0, 'Ellie', [], developments);

        assert.equal(variables.DEVELOPMENTS, [
            'Arc "The Crane Drop":',
            '- [crane001:brody_refuses] Brody refuses an order from Julian in front of the crew',
            '- [crane001:crane_moved] The crane is moved at night',
            '  done:',
            '  - Julian has shown the crew the forged permit',
            '',
            'Arc "The Drive":',
            '- [drive002:drive_handed] Vera hands Ellie the flash drive',
        ].join('\n'));
    });

    it('leaves out an arc without an active beat, and writes (none) when nothing is left', () => {
        const betweenBeats = craneAct();
        betweenBeats.beats = betweenBeats.beats.map(beat => ({ ...beat, status: beat.status === 'active' ? 'completed' : beat.status }));

        const developments = listRecognisableBeats([betweenBeats, pausedAct()]);
        const variables = buildKnowledgeExtractionVariables(EMPTY_LEDGER, [], 0, 'Ellie', [], developments);

        assert.deepEqual(developments, []);
        assert.equal(variables.DEVELOPMENTS, '(none)');
    });

    it('writes (none) without developments', () => {
        const variables = buildKnowledgeExtractionVariables(EMPTY_LEDGER, [], 0, 'Ellie');
        assert.equal(variables.DEVELOPMENTS, '(none)');
    });
});

describe('parseKnowledgeExtractionAnswer: fulfilled', () => {
    const base = '"present": ["Noor"], "newCharacters": [], "learned": []';

    it('reads the fulfilled items and drops keys outside the shape', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "fulfilled": [{ "developmentId": "crane001:brody_refuses", "at": 4, "why": "he says no" }] }`);
        assert.deepEqual(answer.fulfilled, [{ developmentId: 'crane001:brody_refuses', at: 4 }]);
    });

    it('reads a missing list as empty, so an answer of the old shape stays valid', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base} }`);
        assert.deepEqual(answer, { present: ['Noor'], newCharacters: [], newNames: [], learned: [], revealedSecrets: [], retracted: [], fulfilled: [], rulings: [], details: [] });
    });

    it('reads a list of the wrong type as empty and keeps the rest of the answer', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "fulfilled": "crane001:brody_refuses" }`);
        assert.deepEqual(answer.present, ['Noor']);
        assert.deepEqual(answer.fulfilled, []);
    });

    it('drops an unreadable item and keeps the readable ones', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "fulfilled": [
            { "developmentId": "crane001:brody_refuses" },
            { "developmentId": "", "at": 4 },
            { "developmentId": "crane001:crane_moved", "at": 3 }
        ] }`);
        assert.deepEqual(answer.fulfilled, [{ developmentId: 'crane001:crane_moved', at: 3 }]);
    });
});

describe('resolveFulfilledBeats', () => {
    const developments = listRecognisableBeats([craneAct(), driveAct(), pausedAct()]);

    it('resolves a listed active beat to its full arc id and beat id', () => {
        const resolved = resolveFulfilledBeats([{ developmentId: 'drive002:drive_handed', at: 4 }], developments, 3, 4);
        assert.deepEqual(resolved, [{ arcId: 'drive002-full-id', beatId: 'drive_handed', at: 4 }]);
    });

    it('drops an unknown id, a done, a pending and a paused arc\'s beat', () => {
        const resolved = resolveFulfilledBeats([
            { developmentId: 'crane001:no_such_beat', at: 4 },
            { developmentId: 'crane001:permit_shown', at: 4 },
            { developmentId: 'crane001:crane_falls', at: 4 },
            { developmentId: 'sleep003:sleeper_wakes', at: 4 },
        ], developments, 3, 4);
        assert.deepEqual(resolved, []);
    });

    it('drops an `at` outside the messages the call read', () => {
        const resolved = resolveFulfilledBeats([
            { developmentId: 'crane001:brody_refuses', at: 2 },
            { developmentId: 'crane001:crane_moved', at: 5 },
            { developmentId: 'drive002:drive_handed', at: 3 },
        ], developments, 3, 4);
        assert.deepEqual(resolved, [{ arcId: 'drive002-full-id', beatId: 'drive_handed', at: 3 }]);
    });
});

// ─── Through the update paths ───

/**
 * Replace the extraction template with one that shows only the developments,
 * and the transport with one that records each prompt and answers with the
 * next queued answer, after running `duringCall` if given.
 */
function installExtraction(answers, duringCall) {
    const sentPrompts = [];
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('extract-knowledge.txt')) return new Response('DEVELOPMENTS:\n{{DEVELOPMENTS}}');
        throw new Error(`unexpected fetch ${url}`);
    };
    ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
        sentPrompts.push(messages[0].content);
        if (duringCall) duringCall();
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
    return sentPrompts;
}

/** The tracker on, interval 1; the chat's arcs, autoTrack and queued marks; a ledger read up to `lastUpdatedAt`. */
function storeChat({ arcs, autoTrack = true, pendingMarks = [], lastUpdatedAt = 2 }) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: true, updateInterval: 1 },
    };
    chat_metadata.story_arc = {
        version: 1,
        arcs,
        settings: { autoTrack },
        pendingMarks,
        knowledge: {
            characters: [{ id: 'c1', name: 'Noor', aliases: [] }, { id: 'c2', name: 'Ellie', aliases: [] }],
            facts: [],
            scene: { at: 2, present: ['c1', 'c2'] },
            lastUpdatedAt,
        },
    };
}

/** Messages 0–2 were read and carry ids; the latest exchange, 3 and 4, carries none yet. */
function fillChat() {
    chat.length = 0;
    chat.push(
        { is_user: false, is_system: false, name: 'Noor', mes: 'The site is quiet.', extra: { story_arc_message_id: 'm0' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Where is Julian?', extra: { story_arc_message_id: 'm1' } },
        { is_user: false, is_system: false, name: 'Noor', mes: 'Up in the cabin.', extra: { story_arc_message_id: 'm2' } },
        { is_user: true, is_system: false, name: 'Ellie', mes: 'Julian tells Brody to move the crane.' },
        { is_user: false, is_system: false, name: 'Noor', mes: 'Brody folds his arms: "No. Not tonight."' },
    );
}

function answerFulfilling(...fulfilled) {
    return JSON.stringify({ present: ['Noor', 'Ellie'], newCharacters: [], learned: [], fulfilled });
}

function beatOf(arcId, beatId) {
    const arc = chat_metadata.story_arc.arcs.find(candidate => candidate.id === arcId);
    return arc.beats.find(beat => beat.id === beatId);
}

describe('updateKnowledgeAfterReply: beat recognition', () => {
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

    it('completes a fulfilled beat; its record names the message id the extraction gave', async () => {
        storeChat({ arcs: [craneAct()] });
        installExtraction([answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 4 })]);

        const result = await updateKnowledgeAfterReply(4);
        const assignedMessageId = chat[4].extra.story_arc_message_id;

        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: true });
        assert.equal(typeof assignedMessageId, 'string');
        assert.deepEqual(beatOf('crane001-full-id', 'brody_refuses'), {
            id: 'brody_refuses', intention: 'Brody refuses an order from Julian in front of the crew',
            status: 'completed', unlockAfter: [], optional: false,
            completion: { at: 4, unlocked: [], arcCompleted: false, lastFulfilledBefore: 0, messageId: assignedMessageId },
        });
        assert.equal(chat_metadata.story_arc.arcs[0].lastFulfilledAt, 4);
    });

    it('sends the developments of the chat\'s arcs', async () => {
        storeChat({ arcs: [craneAct(), pausedAct()] });
        const sentPrompts = installExtraction([answerFulfilling()]);

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(sentPrompts, [[
            'DEVELOPMENTS:',
            'Arc "The Crane Drop":',
            '- [crane001:brody_refuses] Brody refuses an order from Julian in front of the crew',
            '- [crane001:crane_moved] The crane is moved at night',
            '  done:',
            '  - Julian has shown the crew the forged permit',
        ].join('\n')]);
    });

    it('takes one completion per arc per message', async () => {
        storeChat({ arcs: [craneAct()] });
        installExtraction([answerFulfilling(
            { developmentId: 'crane001:brody_refuses', at: 4 },
            { developmentId: 'crane001:crane_moved', at: 4 },
        )]);

        await updateKnowledgeAfterReply(4);

        assert.equal(beatOf('crane001-full-id', 'brody_refuses').status, 'completed');
        assert.equal(beatOf('crane001-full-id', 'crane_moved').status, 'active');
    });

    it('applies the queued marks when a beat completed', async () => {
        const arc = craneAct();
        arc.foreshadowing = [{ id: 'clue_rust', clue: 'Rust on the crane bolts', planted: false }];
        storeChat({ arcs: [arc], pendingMarks: [{ arcId: arc.id, list: 'foreshadowing', flag: 'planted', id: 'clue_rust', at: 3 }] });
        installExtraction([answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 4 })]);

        await updateKnowledgeAfterReply(4);

        assert.equal(chat_metadata.story_arc.arcs[0].foreshadowing[0].planted, true);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, []);
    });

    it('leaves the queued marks waiting when no beat completed', async () => {
        const arc = craneAct();
        arc.foreshadowing = [{ id: 'clue_rust', clue: 'Rust on the crane bolts', planted: false }];
        const mark = { arcId: arc.id, list: 'foreshadowing', flag: 'planted', id: 'clue_rust', at: 3 };
        storeChat({ arcs: [arc], pendingMarks: [mark] });
        installExtraction([answerFulfilling({ developmentId: 'crane001:permit_shown', at: 4 })]);

        const result = await updateKnowledgeAfterReply(4);

        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: false });
        assert.equal(chat_metadata.story_arc.arcs[0].foreshadowing[0].planted, false);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [{ arcId: 'crane001-full-id', list: 'foreshadowing', flag: 'planted', id: 'clue_rust', at: 3 }]);
    });

    it('completes nothing when the reply changed during the call', async () => {
        storeChat({ arcs: [craneAct()] });
        installExtraction(
            [answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 4 })],
            () => { chat[4].mes = 'Brody nods and climbs into the cab.'; },
        );

        const result = await updateKnowledgeAfterReply(4);

        assert.deepEqual(result, { ledgerChanged: false, beatsChanged: false });
        assert.equal(beatOf('crane001-full-id', 'brody_refuses').status, 'active');
        assert.equal(chat_metadata.story_arc.arcs[0].lastFulfilledAt, 0);
    });

    it('completes nothing at a message sent during the call, which the prompt did not list', async () => {
        storeChat({ arcs: [craneAct()] });
        installExtraction(
            [answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 5 })],
            () => { chat.push({ is_user: true, is_system: false, name: 'Ellie', mes: 'Brody, please.' }); },
        );

        await updateKnowledgeAfterReply(4);

        assert.equal(beatOf('crane001-full-id', 'brody_refuses').status, 'active');
        assert.equal(chat_metadata.story_arc.arcs[0].lastFulfilledAt, 0);
    });

    it('with autoTrack off sends no developments and completes nothing', async () => {
        storeChat({ arcs: [craneAct()], autoTrack: false });
        const sentPrompts = installExtraction([answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 4 })]);

        const result = await updateKnowledgeAfterReply(4);

        assert.deepEqual(sentPrompts, ['DEVELOPMENTS:\n(none)']);
        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: false });
        assert.equal(beatOf('crane001-full-id', 'brody_refuses').status, 'active');
    });

    it('logs only counts, never beat ids or texts', async () => {
        storeChat({ arcs: [craneAct()] });
        installExtraction([answerFulfilling(
            { developmentId: 'crane001:brody_refuses', at: 4 },
            { developmentId: 'crane001:crane_moved', at: 4 },
        )]);

        await updateKnowledgeAfterReply(4);

        const updateLog = chat_metadata.story_arc.knowledge.updateLog;
        assert.deepEqual(updateLog, [{
            kind: 'update', recordId: 'u1', from: 3, to: 4, messageId: chat[4].extra.story_arc_message_id,
            answer: { present: 2, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 2, rulings: 0 },
            factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 1, rulingsStored: 0,
            detailsSet: 0, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
            items: { characters: [], holders: [], details: [], names: [], scene: null },
        }]);
        const logText = JSON.stringify(updateLog);
        for (const internal of ['crane001', 'brody_refuses', 'crane_moved', 'Brody refuses']) {
            assert.equal(logText.includes(internal), false, internal);
        }
    });
});

describe('updateKnowledgeAfterSwipe and updateKnowledgeAfterEdit: beat recognition', () => {
    beforeEach(() => {
        fillChat();
        // The latest exchange was read already and carries ids.
        chat[3].extra = { story_arc_message_id: 'm3' };
        chat[4].extra = { story_arc_message_id: 'm4' };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        ConnectionManagerRequestService.sendRequest = originalSendRequest;
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('a switch to an existing swipe completes the beat its text fulfils', async () => {
        storeChat({ arcs: [craneAct()], lastUpdatedAt: 4 });
        chat[4].swipes = ['Brody climbs into the cab.', 'Brody folds his arms: "No. Not tonight."'];
        chat[4].swipe_id = 1;
        installExtraction([answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 4 })]);

        const result = await updateKnowledgeAfterSwipe(4);

        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: true });
        const completion = beatOf('crane001-full-id', 'brody_refuses').completion;
        assert.equal(completion.at, 4);
        // The swipe lost its old id; the re-extraction gave it a new one.
        assert.notEqual(completion.messageId, 'm4');
        assert.equal(completion.messageId, chat[4].extra.story_arc_message_id);
    });

    it('an edit reopens the beat completed at the message, and the re-extraction completes it again', async () => {
        storeChat({ arcs: [craneAct()], lastUpdatedAt: 4 });
        await completeBeats([{ arcId: 'crane001', beatId: 'brody_refuses', at: 4 }], chat_metadata.story_arc.arcs);
        const sentPrompts = installExtraction([answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 4 })]);

        const result = await updateKnowledgeAfterEdit(4);

        // The extraction saw the beat open again.
        assert.ok(sentPrompts[0].includes('- [crane001:brody_refuses] Brody refuses'), sentPrompts[0]);
        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: true });
        assert.deepEqual(beatOf('crane001-full-id', 'brody_refuses').completion,
            { at: 4, unlocked: [], arcCompleted: false, lastFulfilledBefore: 0, messageId: 'm4' });
    });

    it('an edit completed again keeps lastFulfilledAt at a later completion', async () => {
        chat.push(
            { is_user: true, is_system: false, name: 'Ellie', mes: 'Then we wait.', extra: { story_arc_message_id: 'm5' } },
            { is_user: false, is_system: false, name: 'Noor', mes: 'At midnight the crane rolls.', extra: { story_arc_message_id: 'm6' } },
        );
        storeChat({ arcs: [craneAct()], lastUpdatedAt: 6 });
        const arcs = chat_metadata.story_arc.arcs;
        await completeBeats([{ arcId: 'crane001', beatId: 'brody_refuses', at: 4 }], arcs);
        await completeBeats([{ arcId: 'crane001', beatId: 'crane_moved', at: 6 }], arcs);
        installExtraction([answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 4 })]);

        await updateKnowledgeAfterEdit(4);

        assert.equal(beatOf('crane001-full-id', 'brody_refuses').status, 'completed');
        assert.equal(arcs[0].lastFulfilledAt, 6);
    });

    it('an edit whose new text fulfils nothing leaves the beat open', async () => {
        storeChat({ arcs: [craneAct()], lastUpdatedAt: 4 });
        await completeBeats([{ arcId: 'crane001', beatId: 'brody_refuses', at: 4 }], chat_metadata.story_arc.arcs);
        installExtraction([answerFulfilling()]);

        const result = await updateKnowledgeAfterEdit(4);

        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: true });
        assert.equal(beatOf('crane001-full-id', 'brody_refuses').status, 'active');
        assert.equal(beatOf('crane001-full-id', 'brody_refuses').completion, undefined);
        assert.equal(chat_metadata.story_arc.arcs[0].lastFulfilledAt, 0);
    });

    it('an edit of an older message with nothing reopened offers no beats', async () => {
        chat.push(
            { is_user: true, is_system: false, name: 'Ellie', mes: 'Then we wait.', extra: { story_arc_message_id: 'm5' } },
            { is_user: false, is_system: false, name: 'Noor', mes: 'At midnight the crane rolls.', extra: { story_arc_message_id: 'm6' } },
        );
        storeChat({ arcs: [craneAct(), driveAct()], lastUpdatedAt: 6 });
        const sentPrompts = installExtraction([answerFulfilling({ developmentId: 'crane001:brody_refuses', at: 4 })]);

        const result = await updateKnowledgeAfterEdit(4);

        assert.deepEqual(sentPrompts, ['DEVELOPMENTS:\n(none)']);
        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: false });
        // Active now, but the answer cannot complete it at the older message.
        assert.equal(beatOf('crane001-full-id', 'brody_refuses').status, 'active');
    });

    it('an edit of an older message offers only the beats reopened at it', async () => {
        chat.push(
            { is_user: true, is_system: false, name: 'Ellie', mes: 'Then we wait.', extra: { story_arc_message_id: 'm5' } },
            { is_user: false, is_system: false, name: 'Noor', mes: 'At midnight the crane rolls.', extra: { story_arc_message_id: 'm6' } },
        );
        storeChat({ arcs: [craneAct(), driveAct()], lastUpdatedAt: 6 });
        await completeBeats([{ arcId: 'crane001', beatId: 'brody_refuses', at: 4 }], chat_metadata.story_arc.arcs);
        const sentPrompts = installExtraction([answerFulfilling(
            { developmentId: 'crane001:crane_moved', at: 4 },
            { developmentId: 'drive002:drive_handed', at: 4 },
        )]);

        await updateKnowledgeAfterEdit(4);

        assert.deepEqual(sentPrompts, [[
            'DEVELOPMENTS:',
            'Arc "The Crane Drop":',
            '- [crane001:brody_refuses] Brody refuses an order from Julian in front of the crew',
            '  done:',
            '  - Julian has shown the crew the forged permit',
        ].join('\n')]);
        // Beats that were not reopened cannot complete at the edited message.
        assert.equal(beatOf('crane001-full-id', 'crane_moved').status, 'active');
        assert.equal(beatOf('drive002-full-id', 'drive_handed').status, 'active');
    });

    it('an edit of the last message offers every active beat', async () => {
        storeChat({ arcs: [craneAct(), driveAct()], lastUpdatedAt: 4 });
        const sentPrompts = installExtraction([answerFulfilling({ developmentId: 'drive002:drive_handed', at: 4 })]);

        const result = await updateKnowledgeAfterEdit(4);

        assert.deepEqual(sentPrompts, [[
            'DEVELOPMENTS:',
            'Arc "The Crane Drop":',
            '- [crane001:brody_refuses] Brody refuses an order from Julian in front of the crew',
            '- [crane001:crane_moved] The crane is moved at night',
            '  done:',
            '  - Julian has shown the crew the forged permit',
            '',
            'Arc "The Drive":',
            '- [drive002:drive_handed] Vera hands Ellie the flash drive',
        ].join('\n')]);
        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: true });
        assert.equal(beatOf('drive002-full-id', 'drive_handed').status, 'completed');
    });

    it('with autoTrack off an edit keeps the completion', async () => {
        storeChat({ arcs: [craneAct()], autoTrack: false, lastUpdatedAt: 4 });
        await completeBeats([{ arcId: 'crane001', beatId: 'brody_refuses', at: 4 }], chat_metadata.story_arc.arcs);
        installExtraction([answerFulfilling()]);

        const result = await updateKnowledgeAfterEdit(4);

        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: false });
        assert.equal(beatOf('crane001-full-id', 'brody_refuses').status, 'completed');
    });
});
