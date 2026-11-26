import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { flushPendingMarks, listClaimedClues, processSignalResults, settleClaimedClues, MARK_FLUSH_WINDOW } from '../lib/injection/signals.js';
import { parseKnowledgeExtractionAnswer, resolvePlantedClues } from '../lib/knowledge/ledger.js';
import { togglePlanItem } from '../lib/planning/arc-edit.js';
import { buildPlanList } from '../lib/ui/arc-manager.js';
import { chat, chat_metadata, extension_settings } from './mocks/st-mocks.js';

/** An episode with two clues and a trigger, none marked yet. */
function makeEpisode() {
    return {
        id: 'epi00001-full-id',
        title: 'The Van',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        messageStart: 0,
        premise: 'Someone is watching.',
        secrets: [],
        foreshadowing: [
            { id: 'grey_van', clue: 'A grey van idles across the street.', planted: false },
            { id: 'cold_coffee', clue: 'Her coffee is cold though she just poured it.', planted: false },
        ],
        triggers: [{ id: 'van_leaves', condition: 'she walks toward the van', action: 'the van pulls away fast', fired: false }],
        estimatedLength: 20,
        beats: [{ id: 'first_look', pressure: 'She feels watched.', intention: 'She has noticed the watcher.', status: 'active', unlockAfter: [] }],
    };
}

const vanMark = { arcId: 'epi00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'grey_van', at: 10 };
const coffeeMark = { arcId: 'epi00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'cold_coffee', at: 12 };
const triggerMark = { arcId: 'epi00001-full-id', list: 'triggers', flag: 'fired', id: 'van_leaves', at: 11 };

function store(pendingMarks, trackerOn) {
    extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: trackerOn } };
    chat_metadata.story_arc = { version: 1, arcs: [makeEpisode()], settings: { autoTrack: true }, pendingMarks: structuredClone(pendingMarks) };
}

function clueOf(clueId) {
    return chat_metadata.story_arc.arcs[0].foreshadowing.find(clue => clue.id === clueId);
}

beforeEach(() => {
    chat.length = 0;
});

afterEach(() => {
    delete extension_settings.story_arc;
    delete chat_metadata.story_arc;
});

describe('flushPendingMarks with the tracker on: a clue claim waits for its check (#87)', () => {
    it('applies neither an unconfirmed claim on a beat completion nor on age, and keeps it queued', async () => {
        store([vanMark], true);

        assert.equal(await flushPendingMarks(11, true), false);
        assert.equal(await flushPendingMarks(10 + MARK_FLUSH_WINDOW, false), false);

        assert.equal(clueOf('grey_van').planted, false);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [vanMark]);
    });

    it('applies a confirmed claim and a trigger mark with their messages, and leaves the unconfirmed one', async () => {
        store([{ ...vanMark, confirmed: true }, triggerMark, coffeeMark], true);

        assert.equal(await flushPendingMarks(13, true), true);

        assert.deepEqual(clueOf('grey_van'), { id: 'grey_van', clue: 'A grey van idles across the street.', planted: true, plantedAt: 10 });
        assert.equal(chat_metadata.story_arc.arcs[0].triggers[0].fired, true);
        assert.equal(chat_metadata.story_arc.arcs[0].triggers[0].firedAt, 11);
        assert.equal(clueOf('cold_coffee').planted, false);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [coffeeMark]);
    });

    it('counts the window from the oldest mark that is ready, not from an unconfirmed older claim', async () => {
        // The claim at 10 would make the window run out at 30; the trigger at 11 only at 31.
        store([vanMark, triggerMark], true);

        assert.equal(await flushPendingMarks(30, false), false);
        assert.equal(await flushPendingMarks(31, false), true);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [vanMark]);
    });
});

describe('flushPendingMarks with the tracker off: a claim counts as written (#87)', () => {
    it('applies an unconfirmed claim with its message', async () => {
        store([vanMark], false);

        assert.equal(await flushPendingMarks(11, true), true);

        assert.deepEqual(clueOf('grey_van'), { id: 'grey_van', clue: 'A grey van idles across the street.', planted: true, plantedAt: 10 });
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, []);
    });
});

describe('listClaimedClues', () => {
    it('lists the clue claims of the messages read, confirmed ones too, by marker ref with message and clue', () => {
        store([vanMark, triggerMark, { ...coffeeMark, confirmed: true }], true);

        assert.deepEqual(listClaimedClues(10, 12), [
            { ref: 'epi00001:grey_van', arcId: 'epi00001-full-id', id: 'grey_van', at: 10, clue: 'A grey van idles across the street.' },
            { ref: 'epi00001:cold_coffee', arcId: 'epi00001-full-id', id: 'cold_coffee', at: 12, clue: 'Her coffee is cold though she just poured it.' },
        ]);
    });

    it('leaves out claims outside the messages read and claims whose clue is gone', () => {
        store([vanMark, coffeeMark, { ...vanMark, id: 'deleted_clue', at: 11 }], true);

        assert.deepEqual(listClaimedClues(11, 11), []);
        assert.deepEqual(listClaimedClues(11, 12).map(claim => claim.id), ['cold_coffee']);
    });

    it('lists nothing without a queue', () => {
        chat_metadata.story_arc = { version: 1, arcs: [makeEpisode()], settings: {} };
        assert.deepEqual(listClaimedClues(0, 99), []);
    });
});

describe('settleClaimedClues', () => {
    const vanClaim = { ref: 'epi00001:grey_van', arcId: 'epi00001-full-id', id: 'grey_van', at: 10 };
    const coffeeClaim = { ref: 'epi00001:cold_coffee', arcId: 'epi00001-full-id', id: 'cold_coffee', at: 12 };

    it('leaves a claim that moved to a newer message since the check, for the update that reads it', () => {
        store([{ ...vanMark, at: 14 }], true);

        assert.deepEqual(settleClaimedClues([vanClaim], []), { confirmed: 0, dropped: 0 });
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [{ ...vanMark, at: 14 }]);
    });

    it('confirms a found claim, drops a checked one not found, and keeps the trigger mark', () => {
        store([vanMark, triggerMark, coffeeMark], true);

        const result = settleClaimedClues([vanClaim, coffeeClaim], ['epi00001:grey_van']);

        assert.deepEqual(result, { confirmed: 1, dropped: 1 });
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [{ ...vanMark, confirmed: true }, triggerMark]);
    });

    it('takes back an earlier confirmation when a re-check does not find the clue', () => {
        store([{ ...vanMark, confirmed: true }], true);

        settleClaimedClues([vanClaim], []);

        assert.deepEqual(chat_metadata.story_arc.pendingMarks, []);
    });

    it('drops an unconfirmed claim before the first message a reply update read, and keeps a confirmed one there', () => {
        const earlyClaim = { ...coffeeMark, at: 5 };
        const earlyConfirmed = { ...vanMark, at: 4, confirmed: true };
        store([earlyClaim, earlyConfirmed, coffeeMark], true);

        const result = settleClaimedClues([], [], 10);

        assert.deepEqual(result, { confirmed: 0, dropped: 1 });
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [earlyConfirmed, coffeeMark]);
    });

    it('keeps unchecked claims without a read start, as a re-extraction of one message settles', () => {
        store([{ ...coffeeMark, at: 5 }], true);

        assert.deepEqual(settleClaimedClues([], []), { confirmed: 0, dropped: 0 });
        assert.equal(chat_metadata.story_arc.pendingMarks.length, 1);
    });
});

describe('a repeated PLANTED marker', () => {
    const marker = () => [{ arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED', fullMatch: '' }];

    it('moves an unconfirmed claim to the newer message', async () => {
        store([vanMark], true);

        await processSignalResults(marker(), chat_metadata.story_arc.arcs, 13);

        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [{ ...vanMark, at: 13 }]);
    });

    it('leaves a confirmed claim where it is', async () => {
        store([{ ...vanMark, confirmed: true }], true);

        await processSignalResults(marker(), chat_metadata.story_arc.arcs, 13);

        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [{ ...vanMark, confirmed: true }]);
    });
});

describe('resolvePlantedClues', () => {
    const claims = [
        { ref: 'epi00001:grey_van', id: 'grey_van' },
        { ref: 'epi00001:cold_coffee', id: 'cold_coffee' },
        { ref: 'act00002:cold_coffee', id: 'cold_coffee' },
    ];

    it('reads a ref with or without its brackets, each once', () => {
        assert.deepEqual(resolvePlantedClues(['[epi00001:grey_van]', 'epi00001:grey_van', ' epi00001:cold_coffee '], claims),
            ['epi00001:grey_van', 'epi00001:cold_coffee']);
    });

    it('takes a bare clue id only when one claim has it, and nothing that was not claimed', () => {
        assert.deepEqual(resolvePlantedClues(['grey_van', 'cold_coffee', 'epi00001:red_door', 'act00002:grey_van'], claims), ['epi00001:grey_van']);
    });
});

describe('parseKnowledgeExtractionAnswer: plantedClues', () => {
    const base = '"present": [], "newCharacters": [], "learned": []';

    it('reads the planted clue ids and drops an unreadable one', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ ${base}, "plantedClues": ["epi00001:grey_van", "", 7, { "clueId": "x" }] }`);
        assert.deepEqual(answer.plantedClues, ['epi00001:grey_van']);
    });

    it('reads a list of the wrong type as empty and keeps the rest of the answer', () => {
        const answer = parseKnowledgeExtractionAnswer(`{ "present": ["Noor"], "newCharacters": [], "learned": [], "plantedClues": "epi00001:grey_van" }`);
        assert.deepEqual(answer.present, ['Noor']);
        assert.deepEqual(answer.plantedClues, []);
    });
});

describe('togglePlanItem drops the message a model mark recorded', () => {
    it('removes plantedAt when a clue is opened by hand, and sets none when planted by hand', () => {
        const clues = [{ id: 'grey_van', clue: 'A grey van.', planted: true, plantedAt: 10 }];

        const opened = togglePlanItem(clues, 'grey_van', 'planted');
        assert.deepEqual(opened, [{ id: 'grey_van', clue: 'A grey van.', planted: false }]);
        assert.deepEqual(togglePlanItem(opened, 'grey_van', 'planted'), [{ id: 'grey_van', clue: 'A grey van.', planted: true }]);
    });
});

describe('the Arc Manager names what a clue claim waits for', () => {
    function waitingTextOf(mark, trackerOn) {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: trackerOn } };
        const html = buildPlanList(makeEpisode(), 'foreshadowing', [mark], false);
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    }

    it('says an unconfirmed claim waits for the tracker, and a confirmed one was found', () => {
        assert.ok(waitingTextOf(vanMark, true).includes('Reported as planted at #10, waiting for the knowledge tracker to find it in the message'));
        assert.ok(waitingTextOf({ ...vanMark, confirmed: true }, true).includes('Reported as planted at #10, found in the message, waiting to be applied'));
    });

    it('says only "waiting to be applied" with the tracker off', () => {
        assert.ok(waitingTextOf(vanMark, false).includes('Reported as planted at #10, waiting to be applied'));
    });
});
