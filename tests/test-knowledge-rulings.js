import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extension_settings, chat_metadata, chat, ConnectionManagerRequestService } from '../tests/mocks/st-mocks.js';
import {
    parseKnowledgeExtractionAnswer,
    updateKnowledgeAfterReply,
    updateKnowledgeAfterSwipe,
    updateKnowledgeAfterEdit,
} from '../lib/knowledge/ledger.js';
import { clearTemplateCache } from '../lib/planning/generator.js';

const originalFetch = globalThis.fetch;
const originalSendRequest = ConnectionManagerRequestService.sendRequest;

/** An act with a premise, one completed milestone and two open ones. */
function sirenAct() {
    return {
        id: 'siren001-full-id', title: 'Streets of the Jackpot Siren', status: 'active', tier: 'act', focus: 'normal',
        premise: 'Siren works the casino strip as a sidekick riding with Aegis, her defender.',
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
        beats: [
            { id: 'first_patrol', intention: 'Siren and Aegis patrol together', pressure: 'Aegis wants a partner on the strip', status: 'completed', unlockAfter: [], optional: false },
            { id: 'heist', intention: 'The Siren foils the casino heist', pressure: 'A crew is casing the Golden Reel', status: 'active', unlockAfter: [], optional: false },
            { id: 'case_file', intention: 'The detective opens a case file on Siren', pressure: 'The police want her statement on record', status: 'pending', unlockAfter: ['heist'], optional: false },
        ],
    };
}

/** A second act in background focus. */
function mentorAct() {
    return {
        id: 'mentor02-full-id', title: 'Sundown', status: 'active', tier: 'act', focus: 'background',
        premise: 'Sundown becomes Siren\'s partner in the field.',
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
        beats: [
            { id: 'team_up', intention: 'Sundown and Siren fight side by side', pressure: 'Sundown wants to go back to the field', status: 'active', unlockAfter: [], optional: false },
        ],
    };
}

/** A paused act. */
function pausedAct() {
    return {
        id: 'sleep003-full-id', title: 'The Sleeper', status: 'active', tier: 'act', focus: 'paused', pausedAt: 1,
        premise: 'A sleeper agent waits in the city council.',
        messageStart: 0, lastFulfilledAt: 0, estimatedLength: 60, secrets: [], foreshadowing: [], triggers: [],
        beats: [
            { id: 'sleeper_wakes', intention: 'The sleeper agent receives the code word', pressure: 'Someone is sending coded radio messages', status: 'active', unlockAfter: [], optional: false },
        ],
    };
}

/**
 * Replace the extraction template with one that shows only the plans (or
 * the given template), and the transport with one that records each prompt
 * and answers with the next queued answer.
 */
function installExtraction(answers, template = 'PLANS:\n{{PLANS}}') {
    // The generator caches templates by name; each test brings its own.
    clearTemplateCache();
    const sentPrompts = [];
    globalThis.fetch = async (url) => {
        if (String(url).endsWith('extract-knowledge.txt')) return new Response(template);
        throw new Error(`unexpected fetch ${url}`);
    };
    ConnectionManagerRequestService.sendRequest = async (profileId, messages) => {
        sentPrompts.push(messages[0].content);
        const text = answers.shift();
        return () => (async function* () { yield { text }; })();
    };
    return sentPrompts;
}

/** The tracker on (unless `trackerOn` is false), interval 1; a ledger read up to message 2. */
function storeChat({ arcs, trackerOn = true, autoTrack = true }) {
    extension_settings.story_arc = {
        enabled: true,
        defaultConnectionProfile: 'profile-1',
        knowledgeTracker: { enabled: trackerOn, updateInterval: 1 },
    };
    chat_metadata.story_arc = {
        version: 1,
        arcs,
        settings: { autoTrack },
        pendingMarks: [],
        knowledge: {
            characters: [{ id: 'c1', name: 'Siren', aliases: [] }, { id: 'c2', name: 'Aegis', aliases: [] }],
            facts: [],
            scene: { at: 2, present: ['c1', 'c2'] },
            lastUpdatedAt: 2,
        },
    };
}

/** Messages 0–2 were read; the latest exchange, 3 (the player) and 4 (the narrator), was not. */
function fillChat(playerText = '[OOC: Aegis is NOT her defender.   He barely tolerates her.] Siren walks the strip alone.') {
    chat.length = 0;
    chat.push(
        { is_user: false, is_system: false, name: 'Narrator', mes: 'The strip glows.', extra: { story_arc_message_id: 'm0' } },
        { is_user: true, is_system: false, name: 'Siren', mes: 'I head out.', extra: { story_arc_message_id: 'm1' } },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Neon hums overhead.', extra: { story_arc_message_id: 'm2' } },
        { is_user: true, is_system: false, name: 'Siren', mes: playerText },
        { is_user: false, is_system: false, name: 'Narrator', mes: 'Siren walks alone. Aegis watches from a rooftop, not her defender tonight.' },
    );
}

function answerWithRulings(rulings, extra = {}) {
    return JSON.stringify({ present: ['Siren'], newCharacters: [], learned: [], fulfilled: [], rulings, ...extra });
}

function arcOf(arcId) {
    return chat_metadata.story_arc.arcs.find(candidate => candidate.id === arcId);
}

function resetChat() {
    globalThis.fetch = originalFetch;
    ConnectionManagerRequestService.sendRequest = originalSendRequest;
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
    chat.length = 0;
}

describe('PLANS OF THE STORY ARCS in the extraction input', () => {
    beforeEach(() => fillChat());
    afterEach(resetChat);

    it('lists each arc that is not paused by its short id and title, with its premise and open pressures', async () => {
        storeChat({ arcs: [sirenAct(), mentorAct(), pausedAct()] });
        const sentPrompts = installExtraction([answerWithRulings([])]);

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(sentPrompts, [[
            'PLANS:',
            '[siren001] "Streets of the Jackpot Siren"',
            'Premise: Siren works the casino strip as a sidekick riding with Aegis, her defender.',
            'Pressures:',
            '- A crew is casing the Golden Reel',
            '- The police want her statement on record',
            '',
            '[mentor02] "Sundown"',
            'Premise: Sundown becomes Siren\'s partner in the field.',
            'Pressures:',
            '- Sundown wants to go back to the field',
        ].join('\n')]);
    });

    it('lists the plans with autoTrack off too: rulings do not follow beat recognition', async () => {
        storeChat({ arcs: [mentorAct()], autoTrack: false });
        const sentPrompts = installExtraction([answerWithRulings([])]);

        await updateKnowledgeAfterReply(4);

        assert.equal(sentPrompts[0], [
            'PLANS:',
            '[mentor02] "Sundown"',
            'Premise: Sundown becomes Siren\'s partner in the field.',
            'Pressures:',
            '- Sundown wants to go back to the field',
        ].join('\n'));
    });

    it('writes (none) when every arc is paused', async () => {
        storeChat({ arcs: [pausedAct()] });
        const sentPrompts = installExtraction([answerWithRulings([])]);

        await updateKnowledgeAfterReply(4);

        assert.equal(sentPrompts[0], 'PLANS:\n(none)');
    });
});

describe('updateKnowledgeAfterReply: rulings', () => {
    beforeEach(() => fillChat());
    afterEach(resetChat);

    it('stores the player\'s quote, as it stands in the message, with the message index and id on the named arc', async () => {
        storeChat({ arcs: [sirenAct(), mentorAct()] });
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'aegis is not her defender. he barely tolerates her.', at: 3 }])]);

        const result = await updateKnowledgeAfterReply(4);
        const assignedMessageId = chat[3].extra.story_arc_message_id;

        assert.equal(typeof assignedMessageId, 'string');
        assert.deepEqual(arcOf('siren001-full-id').rulings, [
            { id: 'r1', text: 'Aegis is NOT her defender.   He barely tolerates her.', at: 3, messageId: assignedMessageId },
        ]);
        assert.equal(arcOf('mentor02-full-id').rulings, undefined);
        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: true });
    });

    it('stores nothing for a paraphrase, a quote from the narrator\'s message, or an unknown arc id', async () => {
        storeChat({ arcs: [sirenAct()] });
        installExtraction([answerWithRulings([
            { arcs: ['siren001'], quote: 'Aegis is not her protector', at: 3 },
            { arcs: ['siren001'], quote: 'not her defender tonight', at: 4 },
            { arcs: ['nosuch99'], quote: 'Aegis is NOT her defender.', at: 3 },
        ])]);

        const result = await updateKnowledgeAfterReply(4);

        assert.equal(arcOf('siren001-full-id').rulings, undefined);
        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: false });
    });

    it('stores nothing at a message outside the messages it read', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat[1].mes = '[OOC: Aegis is NOT her defender.]';
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Aegis is NOT her defender.', at: 1 }])]);

        await updateKnowledgeAfterReply(4);

        assert.equal(arcOf('siren001-full-id').rulings, undefined);
    });

    it('stores nothing against a paused arc, which the plans left out', async () => {
        storeChat({ arcs: [pausedAct()] });
        installExtraction([answerWithRulings([{ arcs: ['sleep003'], quote: 'Aegis is NOT her defender.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        assert.equal(arcOf('sleep003-full-id').rulings, undefined);
    });

    it('stores a ruling naming two arcs on both', async () => {
        storeChat({ arcs: [sirenAct(), mentorAct()] });
        installExtraction([answerWithRulings([{ arcs: ['siren001', 'mentor02'], quote: 'Aegis is NOT her defender.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);
        const assignedMessageId = chat[3].extra.story_arc_message_id;

        const expected = [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: assignedMessageId }];
        assert.deepEqual(arcOf('siren001-full-id').rulings, expected);
        assert.deepEqual(arcOf('mentor02-full-id').rulings, expected);
    });

    it('skips a repeat of an open ruling\'s text, but not of an answered one\'s', async () => {
        const arc = sirenAct();
        arc.rulings = [
            { id: 'r1', text: 'Aegis is not her defender.', at: 1, messageId: 'm1' },
            { id: 'r2', text: 'He barely tolerates her.', at: 1, messageId: 'm1', answeredAt: 2 },
        ];
        storeChat({ arcs: [arc] });
        installExtraction([answerWithRulings([
            { arcs: ['siren001'], quote: 'AEGIS is NOT her defender.', at: 3 },
            { arcs: ['siren001'], quote: 'He barely tolerates her.', at: 3 },
        ])]);

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(arcOf('siren001-full-id').rulings, [
            { id: 'r1', text: 'Aegis is not her defender.', at: 1, messageId: 'm1' },
            { id: 'r2', text: 'He barely tolerates her.', at: 1, messageId: 'm1', answeredAt: 2 },
            { id: 'r3', text: 'He barely tolerates her.', at: 3, messageId: chat[3].extra.story_arc_message_id },
        ]);
    });

    it('with the tracker off makes no call and stores no ruling', async () => {
        storeChat({ arcs: [sirenAct()], trackerOn: false });
        const sentPrompts = installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Aegis is NOT her defender.', at: 3 }])]);

        const result = await updateKnowledgeAfterReply(4);

        assert.deepEqual(sentPrompts, []);
        assert.deepEqual(result, { ledgerChanged: false, beatsChanged: false });
        assert.equal(arcOf('siren001-full-id').rulings, undefined);
    });

    it('a broken rulings list leaves the learned facts and the completions applied', async () => {
        storeChat({ arcs: [sirenAct()] });
        installExtraction([answerWithRulings('Aegis is NOT her defender.', {
            learned: [{ text: 'Siren walks the strip alone', public: false, who: ['Siren'], how: 'witnessed', toldBy: null, at: 4 }],
            fulfilled: [{ developmentId: 'siren001:heist', at: 4 }],
        })]);

        await updateKnowledgeAfterReply(4);

        const facts = chat_metadata.story_arc.knowledge.facts;
        assert.deepEqual(facts.map(fact => fact.text), ['Siren walks the strip alone']);
        assert.equal(arcOf('siren001-full-id').beats.find(beat => beat.id === 'heist').status, 'completed');
        assert.equal(arcOf('siren001-full-id').rulings, undefined);
    });

    it('logs the count of rulings stored, never their text', async () => {
        storeChat({ arcs: [sirenAct(), mentorAct()] });
        installExtraction([answerWithRulings([{ arcs: ['siren001', 'mentor02'], quote: 'Aegis is NOT her defender.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        const updateLog = chat_metadata.story_arc.knowledge.updateLog;
        assert.deepEqual(updateLog, [{
            kind: 'update', from: 3, to: 4, messageId: chat[4].extra.story_arc_message_id,
            answer: { present: 1, newCharacters: 0, learned: 0, retracted: 0, revealedSecrets: 0, fulfilled: 0, rulings: 1 },
            factsCreated: [], holdersAdded: 0, factsRetracted: [], beatsCompleted: 0, rulingsStored: 2,
            detailsSet: 0, detailsChanged: 0, restatementsIgnored: 0, detailsLocked: 0,
            newNamesAdded: 0, newNamesRefused: 0, newNamesUnknown: 0,
        }]);
        assert.equal(JSON.stringify(updateLog).toLowerCase().includes('defender'), false);
    });
});

describe('updateKnowledgeAfterSwipe and updateKnowledgeAfterEdit: rulings', () => {
    beforeEach(() => fillChat());
    afterEach(resetChat);

    it('the re-extraction of an edited player message stores the ruling the new text states', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 4;
        chat[3].mes = '[OOC: Comics, not police procedural.] I wave at the crowd.';
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Comics, not police procedural.', at: 3 }])]);

        const result = await updateKnowledgeAfterEdit(3);

        assert.deepEqual(arcOf('siren001-full-id').rulings, [
            { id: 'r1', text: 'Comics, not police procedural.', at: 3, messageId: chat[3].extra.story_arc_message_id },
        ]);
        assert.equal(result.beatsChanged, true);
    });

    it('a second report of the same message and text, as after a re-extraction, is skipped', async () => {
        // Through a swipe switch: an edit removes the message's rulings
        // before its re-extraction (test-ruling-rollback.js), a swipe does not.
        const arc = sirenAct();
        arc.rulings = [{ id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 }];
        storeChat({ arcs: [arc] });
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 3;
        chat.length = 4;
        chat[3].extra = { story_arc_message_id: 'm3' };
        chat[3].swipes = ['I head home.', '[OOC: Aegis is NOT her defender.]'];
        chat[3].swipe_id = 1;
        chat[3].mes = '[OOC: Aegis is NOT her defender.]';
        const sentPrompts = installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Aegis is NOT her defender.', at: 3 }])]);

        await updateKnowledgeAfterSwipe(3);

        assert.equal(sentPrompts.length, 1);

        assert.deepEqual(arcOf('siren001-full-id').rulings, [
            { id: 'r1', text: 'Aegis is NOT her defender.', at: 3, messageId: 'm3', answeredAt: 4 },
        ]);
    });

    it('a switch to an existing swipe of a player message stores its ruling', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 3;
        chat.length = 4;
        chat[3].swipes = ['I head home.', '[OOC: Aegis is NOT her defender.]'];
        chat[3].swipe_id = 1;
        chat[3].mes = '[OOC: Aegis is NOT her defender.]';
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Aegis is NOT her defender.', at: 3 }])]);

        await updateKnowledgeAfterSwipe(3);

        assert.deepEqual(arcOf('siren001-full-id').rulings.map(ruling => ruling.text), ['Aegis is NOT her defender.']);
    });
});

describe('the context message before the window in the extraction input', () => {
    beforeEach(() => fillChat());
    afterEach(resetChat);

    it('lists the latest message before the new messages with its index', async () => {
        storeChat({ arcs: [sirenAct()] });
        const sentPrompts = installExtraction([answerWithRulings([])], 'BEFORE:\n{{CONTEXT_MESSAGE}}');

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(sentPrompts, ['BEFORE:\n[2] Narrator: Neon hums overhead.']);
    });

    it('skips a hidden message for the next earlier one', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat[2].is_system = true;
        const sentPrompts = installExtraction([answerWithRulings([])], 'BEFORE:\n{{CONTEXT_MESSAGE}}');

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(sentPrompts, ['BEFORE:\n[1] Siren: I head out.']);
    });
});

describe('updateKnowledgeAfterReply: a ruling given as a bare pick', () => {
    const optionsText = '[OOC: Two ways on. 1) Siren works   the strip alone. 2) Aegis rides along as her defender.]';
    beforeEach(() => fillChat('[OOC: Option one] Siren heads out.'));
    afterEach(resetChat);

    it('stores the pick with the option it picks, found in the context message before the window', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat[2].mes = optionsText;
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Option one', chose: 'siren works the strip alone.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(arcOf('siren001-full-id').rulings, [
            { id: 'r1', text: 'Option one', chose: 'Siren works   the strip alone.', at: 3, messageId: chat[3].extra.story_arc_message_id },
        ]);
    });

    it('accepts an option found in a narrator message inside the window', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat_metadata.story_arc.knowledge.lastUpdatedAt = 1;
        chat[2].mes = optionsText;
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Option one', chose: 'Siren works the strip alone.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(arcOf('siren001-full-id').rulings, [
            { id: 'r1', text: 'Option one', chose: 'Siren works   the strip alone.', at: 3, messageId: chat[3].extra.story_arc_message_id },
        ]);
    });

    it('drops the ruling when the option is found nowhere', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat[2].mes = optionsText;
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Option one', chose: 'Siren leaves the city', at: 3 }])]);

        const result = await updateKnowledgeAfterReply(4);

        assert.equal(arcOf('siren001-full-id').rulings, undefined);
        assert.deepEqual(result, { ledgerChanged: true, beatsChanged: false });
    });

    it('drops the ruling when the option is found only in a player\'s message', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat[2].mes = optionsText;
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Option one', chose: 'Siren heads out.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        assert.equal(arcOf('siren001-full-id').rulings, undefined);
    });

    it('drops the ruling when the option is found only in a narrator message after the pick', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat[2].mes = optionsText;
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Option one', chose: 'Aegis watches from a rooftop', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        assert.equal(arcOf('siren001-full-id').rulings, undefined);
    });

    it('stores a second "Option one" that picks another option than the open one', async () => {
        const arc = sirenAct();
        arc.rulings = [{ id: 'r1', text: 'Option one', chose: 'Siren takes the day shift.', at: 1, messageId: 'm1' }];
        storeChat({ arcs: [arc] });
        chat[2].mes = optionsText;
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Option one', chose: 'Siren works the strip alone.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(arcOf('siren001-full-id').rulings, [
            { id: 'r1', text: 'Option one', chose: 'Siren takes the day shift.', at: 1, messageId: 'm1' },
            { id: 'r2', text: 'Option one', chose: 'Siren works   the strip alone.', at: 3, messageId: chat[3].extra.story_arc_message_id },
        ]);
    });

    it('skips a pick that repeats an open pick and its option', async () => {
        const arc = sirenAct();
        arc.rulings = [{ id: 'r1', text: 'Option one', chose: 'Siren works the strip alone.', at: 1, messageId: 'm1' }];
        storeChat({ arcs: [arc] });
        chat[2].mes = optionsText;
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'option one', chose: 'Siren works the strip alone.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        assert.deepEqual(arcOf('siren001-full-id').rulings, [
            { id: 'r1', text: 'Option one', chose: 'Siren works the strip alone.', at: 1, messageId: 'm1' },
        ]);
    });

    it('drops the ruling when the option is found only in a hidden message before the window', async () => {
        storeChat({ arcs: [sirenAct()] });
        chat[2].mes = optionsText;
        chat[2].is_system = true;
        installExtraction([answerWithRulings([{ arcs: ['siren001'], quote: 'Option one', chose: 'Siren works the strip alone.', at: 3 }])]);

        await updateKnowledgeAfterReply(4);

        assert.equal(arcOf('siren001-full-id').rulings, undefined);
    });
});

describe('parseKnowledgeExtractionAnswer: rulings', () => {
    const base = '"present": ["Siren"], "newCharacters": [], "learned": []';

    it('reads the rulings, a broken item dropped and the readable ones kept', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "rulings": [
            { "arcs": ["siren001"], "quote": "Aegis is not her defender", "at": 3, "why": "contradicts the premise" },
            { "arcs": [], "quote": "no arc", "at": 3 },
            { "arcs": ["siren001"], "quote": "", "at": 3 },
            { "arcs": ["siren001"], "quote": "no index" }
        ] }`);
        assert.deepEqual(answer.rulings, [{ arcs: ['siren001'], quote: 'Aegis is not her defender', at: 3 }]);
    });

    it('reads the chosen option of a bare pick; a null or blank one reads as none, one of the wrong type drops the item', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "rulings": [
            { "arcs": ["siren001"], "quote": "Option one", "chose": "Siren works the strip alone.", "at": 3 },
            { "arcs": ["siren001"], "quote": "Aegis is not her defender", "chose": null, "at": 3 },
            { "arcs": ["siren001"], "quote": "Comics, not police procedural", "chose": "  ", "at": 3 },
            { "arcs": ["siren001"], "quote": "Lets go with 3", "chose": 3, "at": 3 }
        ] }`);
        assert.deepEqual(answer.rulings, [
            { arcs: ['siren001'], quote: 'Option one', chose: 'Siren works the strip alone.', at: 3 },
            { arcs: ['siren001'], quote: 'Aegis is not her defender', at: 3 },
            { arcs: ['siren001'], quote: 'Comics, not police procedural', at: 3 },
        ]);
    });

    it('reads a list of the wrong type as empty and keeps the rest of the answer', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "fulfilled": [{ "developmentId": "siren001:heist", "at": 4 }], "rulings": { "arcs": ["siren001"] } }`);
        assert.deepEqual(answer.present, ['Siren']);
        assert.deepEqual(answer.fulfilled, [{ developmentId: 'siren001:heist', at: 4 }]);
        assert.deepEqual(answer.rulings, []);
    });
});

describe('extract-knowledge.txt: rulings', () => {
    const template = readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');

    it('holds the plans section and its placeholder', () => {
        assert.ok(template.includes('== PLANS OF THE STORY ARCS ==\n'), 'missing the plans section');
        assert.ok(template.includes('{{PLANS}}'), 'missing {{PLANS}}');
    });

    it('asks for the player\'s out-of-character lines that contradict a listed premise or pressure, quoted exactly', () => {
        assert.ok(template.includes('7. OVERRULED.'), 'missing task 7');
        assert.ok(template.includes(
            'For every out-of-character line of the player in the new messages that says the story must differ from a premise or a pressure in the plans list, write one item:'),
        'missing the contradiction rule');
        assert.ok(template.includes(
            '- "quote": the player\'s words that state the ruling, copied exactly from the message, the shortest span that states it whole.'),
        'missing the exact quote');
        assert.ok(template.includes('Only the player\'s own out-of-character lines count, never the narrator\'s.'), 'missing the player-only rule');
        assert.ok(template.includes('"rulings": ['), 'missing the rulings list in the answer');
    });

    it('names the message before the window as already read, for the options a ruling picks from only', () => {
        assert.ok(template.includes(
            '== MESSAGE BEFORE THE NEW MESSAGES ==\n'
            + 'Already read, with its index in square brackets. Report nothing from it: it is here only for the options a ruling picks from, '
            + 'when a new message of the player answers options offered in it.\n{{CONTEXT_MESSAGE}}\n\n== NEW MESSAGES =='),
        'missing the read-only context message');
    });

    it('describes the chosen option of a bare pick, copied exactly from the narrator\'s message', () => {
        assert.ok(template.includes(
            '- "chose": only when the player\'s line is a bare pick of an option the narrator offered out of character ("Option one", "Lets go with 3"): '
            + 'the option it picks, copied exactly from the narrator\'s message, which is the message before the new messages or one of the new messages. '
            + 'Leave it out otherwise.'),
        'missing the chosen option in task 7');
        assert.ok(template.includes('"chose": "only for a bare pick: the option it picks, copied exactly"'), 'missing chose in the answer shape');
    });
});
