import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignals, processSignalResults, flushPendingMarks, dropPendingMark, dropPendingMarksFrom, scrubArcInternals, MARK_FLUSH_WINDOW } from '../lib/injection/signals.js';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { togglePlanItem } from '../lib/planning/arc-edit.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

function makeEpisode(overrides = {}) {
    return {
        id: 'epi00001-full-id',
        title: 'The Van',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        messageStart: 0,
        premise: 'Someone is watching.',
        tone: '',
        themes: [],
        directives: [],
        antiPatterns: [],
        secrets: [],
        foreshadowing: [{ id: 'grey_van', clue: 'A grey van idles across the street.', target: 'secret:watcher', planted: false }],
        triggers: [{ id: 'van_leaves', condition: 'she walks toward the van', action: 'the van pulls away fast', fired: false }],
        estimatedLength: 20,
        beats: [
            { id: 'first_look', pressure: 'She feels watched.', intention: 'She has noticed the watcher.', status: 'active', unlockAfter: [], optional: false },
            { id: 'second_look', pressure: 'The feeling grows.', intention: 'She has confronted it.', status: 'pending', unlockAfter: [], optional: false },
        ],
        ...overrides,
    };
}

function store(...arcs) {
    chat_metadata.story_arc = { version: 1, arcs, settings: { autoTrack: true } };
}

beforeEach(() => {
    chat.length = 0;
    delete chat_metadata.story_arc;
});

describe('parseSignals — verbs', () => {
    it('reads COMPLETE, PLANTED and FIRED', () => {
        const signals = parseSignals('<!-- [ARC_SIGNAL:epi00001:grey_van:PLANTED] -->\n<!-- [ARC_SIGNAL:epi00001:van_leaves:FIRED] -->\n[ARC_SIGNAL:epi00001:first_look:COMPLETE]\nText.');
        assert.deepEqual(signals.map(s => [s.beatId, s.verb]), [['grey_van', 'PLANTED'], ['van_leaves', 'FIRED'], ['first_look', 'COMPLETE']]);
    });

    it('ignores an unknown verb', () => {
        assert.deepEqual(parseSignals('[ARC_SIGNAL:epi00001:grey_van:DONE]'), []);
    });
});

describe('PLANT CHECK in the in-chat block', () => {
    it('lists unplanted clues and unfired triggers of a normal episode', () => {
        const text = buildSignalInjection([makeEpisode()]);
        assert.ok(text.includes('PLANT CHECK:'));
        assert.ok(text.includes('If the story has already planted this clue — "A grey van idles across the street." — output exactly: <!-- [ARC_SIGNAL:epi00001:grey_van:PLANTED] -->'));
        assert.ok(text.includes('If the story has already shown this happen — "the van pulls away fast" — output exactly: <!-- [ARC_SIGNAL:epi00001:van_leaves:FIRED] -->'));
    });

    it('lists nothing for a saga in normal focus, whose section shows no clues', () => {
        const text = buildSignalInjection([makeEpisode({ tier: 'saga', estimatedLength: 800 })]);
        assert.equal(text.includes('PLANT CHECK'), false);
        assert.equal(text.includes('grey_van'), false);
    });

    it('lists the clues of a spotlit saga', () => {
        const text = buildSignalInjection([makeEpisode({ tier: 'saga', focus: 'spotlight', estimatedLength: 800 })]);
        assert.ok(text.includes('[ARC_SIGNAL:epi00001:grey_van:PLANTED]'));
    });

    it('lists nothing for a paused arc', () => {
        assert.equal(buildSignalInjection([makeEpisode({ focus: 'paused' })]).includes('PLANT CHECK'), false);
    });

    it('drops planted clues and fired triggers', () => {
        const arc = makeEpisode();
        arc.foreshadowing[0].planted = true;
        arc.triggers[0].fired = true;
        assert.equal(buildSignalInjection([arc]).includes('PLANT CHECK'), false);
    });
});

describe('queued marks keep the prompt byte-identical until a flush', () => {
    it('queues a PLANTED mark without touching the prompt', async () => {
        const arc = makeEpisode();
        store(arc);
        const planBefore = buildInjection([arc]);
        const checkBefore = buildSignalInjection([arc]);

        await processSignalResults([{ arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED' }], [arc], 5);

        assert.equal(arc.foreshadowing[0].planted, false);
        assert.equal(chat_metadata.story_arc.pendingMarks.length, 1);
        assert.equal(buildInjection([arc]), planBefore);
        assert.equal(buildSignalInjection([arc]), checkBefore);
    });

    it('does not queue the same item twice', async () => {
        const arc = makeEpisode();
        store(arc);
        const signal = { arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED' };
        assert.equal((await processSignalResults([signal], [arc], 5)).updated, true);
        assert.equal((await processSignalResults([signal], [arc], 6)).updated, false);
        assert.equal(chat_metadata.story_arc.pendingMarks.length, 1);
    });

    it('queues exactly one entry for a new mark, on a chat that had no Story Arc state yet', async () => {
        const arc = makeEpisode();
        assert.equal(chat_metadata.story_arc, undefined);
        const result = await processSignalResults([{ arcId: 'epi00001', beatId: 'van_leaves', verb: 'FIRED' }], [arc], 5);
        assert.equal(result.updated, true);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [
            { arcId: 'epi00001-full-id', list: 'triggers', flag: 'fired', id: 'van_leaves', at: 5 },
        ]);
    });

    it('does not queue an item that is already planted', async () => {
        const arc = makeEpisode();
        arc.foreshadowing[0].planted = true;
        store(arc);
        const result = await processSignalResults([{ arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED' }], [arc], 5);
        assert.equal(result.updated, false);
        assert.equal(chat_metadata.story_arc.pendingMarks, undefined);
    });

    it('queues the same item id separately per arc and per list, and different items in one list', async () => {
        const first = makeEpisode({
            foreshadowing: [
                { id: 'shared_id', clue: 'A clue.', target: 'x', planted: false },
                { id: 'grey_van', clue: 'A grey van.', target: 'x', planted: false },
            ],
            triggers: [{ id: 'shared_id', condition: 'c', action: 'a', fired: false }],
        });
        const second = makeEpisode({
            id: 'epi00002-full-id',
            foreshadowing: [{ id: 'shared_id', clue: 'Another clue.', target: 'x', planted: false }],
        });
        store(first, second);
        await processSignalResults([
            { arcId: 'epi00001', beatId: 'shared_id', verb: 'PLANTED' },
            { arcId: 'epi00001', beatId: 'shared_id', verb: 'FIRED' },
            { arcId: 'epi00002', beatId: 'shared_id', verb: 'PLANTED' },
            { arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED' },
        ], [first, second], 5);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks.map(m => [m.arcId, m.list, m.id]), [
            ['epi00001-full-id', 'foreshadowing', 'shared_id'],
            ['epi00001-full-id', 'triggers', 'shared_id'],
            ['epi00002-full-id', 'foreshadowing', 'shared_id'],
            ['epi00001-full-id', 'foreshadowing', 'grey_van'],
        ]);
    });

    it('lets a beat complete in the same message as a mark', async () => {
        const arc = makeEpisode();
        store(arc);
        const { completedBeats } = await processSignalResults([
            { arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED' },
            { arcId: 'epi00001', beatId: 'van_leaves', verb: 'FIRED' },
            { arcId: 'epi00001', beatId: 'first_look', verb: 'COMPLETE' },
        ], [arc], 5);
        assert.deepEqual(completedBeats, ['first_look']);
        assert.equal(chat_metadata.story_arc.pendingMarks.length, 2);
    });

    it('waits while the window runs and no beat completes', async () => {
        const arc = makeEpisode();
        store(arc);
        await processSignalResults([{ arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED' }], [arc], 5);
        assert.equal(await flushPendingMarks(5 + MARK_FLUSH_WINDOW - 1, false), false);
        assert.equal(arc.foreshadowing[0].planted, false);
    });

    it('applies the queue when the window has run out', async () => {
        assert.equal(MARK_FLUSH_WINDOW, 20);
        const arc = makeEpisode();
        store(arc);
        await processSignalResults([{ arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED' }], [arc], 5);
        assert.equal(await flushPendingMarks(25, false), true);
        assert.equal(arc.foreshadowing[0].planted, true);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, []);
        assert.equal(buildInjection([arc]).includes('A grey van idles'), false);
    });

    it('applies the queue at once when a beat completed, whose change costs the cache anyway', async () => {
        const arc = makeEpisode();
        store(arc);
        await processSignalResults([{ arcId: 'epi00001', beatId: 'van_leaves', verb: 'FIRED' }], [arc], 5);
        assert.equal(await flushPendingMarks(6, true), true);
        assert.equal(arc.triggers[0].fired, true);
    });

    it('ignores a mark for an unknown item', async () => {
        const arc = makeEpisode();
        store(arc);
        const result = await processSignalResults([{ arcId: 'epi00001', beatId: 'no_such_clue', verb: 'PLANTED' }], [arc], 5);
        assert.equal(result.updated, false);
        assert.equal(chat_metadata.story_arc.pendingMarks, undefined);
    });

    it('returns false for an empty queue, whether or not a beat completed', async () => {
        assert.equal(await flushPendingMarks(30, true), false);  // no Story Arc state at all
        store(makeEpisode());
        assert.equal(await flushPendingMarks(30, true), false);  // no queue
        chat_metadata.story_arc.pendingMarks = [];
        assert.equal(await flushPendingMarks(30, false), false);
        assert.equal(await flushPendingMarks(30, true), false);
    });

    it('skips a queued mark whose arc, list or item was deleted and still applies the others', async () => {
        const arc = makeEpisode({
            foreshadowing: [
                { id: 'grey_van', clue: 'A grey van.', target: 'x', planted: false },
                { id: 'wet_prints', clue: 'Wet footprints.', target: 'x', planted: false },
            ],
        });
        const withoutTriggers = makeEpisode({ id: 'epi00002-full-id' });
        delete withoutTriggers.triggers;
        store(arc, withoutTriggers);
        chat_metadata.story_arc.pendingMarks = [
            { arcId: 'gone0000-full-id', list: 'foreshadowing', flag: 'planted', id: 'grey_van', at: 5 },
            { arcId: 'epi00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'deleted_clue', at: 5 },
            { arcId: 'epi00002-full-id', list: 'triggers', flag: 'fired', id: 'van_leaves', at: 5 },
            { arcId: 'epi00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'wet_prints', at: 5 },
        ];

        const warnings = [];
        const originalWarn = console.warn;
        console.warn = message => warnings.push(message);
        try {
            assert.equal(await flushPendingMarks(6, true), true);
        } finally {
            console.warn = originalWarn;
        }

        assert.equal(arc.foreshadowing[1].planted, true);
        assert.equal(arc.foreshadowing[0].planted, false);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, []);
        assert.deepEqual(warnings, [
            '[Story Arc] Dropped queued mark: arc "gone0000-full-id" or item "grey_van" no longer exists',
            '[Story Arc] Dropped queued mark: arc "epi00001-full-id" or item "deleted_clue" no longer exists',
            '[Story Arc] Dropped queued mark: arc "epi00002-full-id" or item "van_leaves" no longer exists',
        ]);
    });

    it('drops a queued mark so a hand toggle survives the flush', async () => {
        const arc = makeEpisode();
        store(arc);
        await processSignalResults([{ arcId: 'epi00001', beatId: 'grey_van', verb: 'PLANTED' }], [arc], 5);
        dropPendingMark('epi00001-full-id', 'foreshadowing', 'grey_van');
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, []);
    });

    it('drops only the mark matching arc, list and item', () => {
        store(makeEpisode());
        chat_metadata.story_arc.pendingMarks = [
            { arcId: 'epi00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'grey_van', at: 5 },
            { arcId: 'epi00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'wet_prints', at: 5 },
            { arcId: 'epi00001-full-id', list: 'triggers', flag: 'fired', id: 'grey_van', at: 5 },
            { arcId: 'epi00002-full-id', list: 'foreshadowing', flag: 'planted', id: 'grey_van', at: 5 },
        ];
        dropPendingMark('epi00001-full-id', 'foreshadowing', 'grey_van');
        assert.deepEqual(chat_metadata.story_arc.pendingMarks.map(m => [m.arcId, m.list, m.id]), [
            ['epi00001-full-id', 'foreshadowing', 'wet_prints'],
            ['epi00001-full-id', 'triggers', 'grey_van'],
            ['epi00002-full-id', 'foreshadowing', 'grey_van'],
        ]);
    });

    it('drops nothing, without throwing, when there is no queue or no Story Arc state', () => {
        dropPendingMark('epi00001-full-id', 'foreshadowing', 'grey_van');
        assert.equal(chat_metadata.story_arc, undefined);
        store(makeEpisode());
        dropPendingMark('epi00001-full-id', 'foreshadowing', 'grey_van');
        assert.equal(chat_metadata.story_arc.pendingMarks, undefined);
    });
});

describe('dropPendingMarksFrom — the reply a report came from is gone', () => {
    it('drops the reports of the removed messages and keeps earlier ones', () => {
        store(makeEpisode());
        chat_metadata.story_arc.pendingMarks = [
            { arcId: 'epi00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'grey_van', at: 2019 },
            { arcId: 'epi00001-full-id', list: 'triggers', flag: 'fired', id: 'van_leaves', at: 2023 },
            { arcId: 'epi00002-full-id', list: 'foreshadowing', flag: 'planted', id: 'wet_prints', at: 2024 },
        ];

        const dropped = dropPendingMarksFrom(2023);

        assert.equal(dropped, true);
        assert.deepEqual(chat_metadata.story_arc.pendingMarks.map(mark => mark.id), ['grey_van']);
    });

    it('reports false and keeps the queue when no report came from the removed messages', () => {
        store(makeEpisode());
        chat_metadata.story_arc.pendingMarks = [
            { arcId: 'epi00001-full-id', list: 'foreshadowing', flag: 'planted', id: 'grey_van', at: 2019 },
        ];

        assert.equal(dropPendingMarksFrom(2023), false);
        assert.equal(chat_metadata.story_arc.pendingMarks.length, 1);
    });

    it('drops nothing, without throwing, when there is no queue or no Story Arc state', () => {
        assert.equal(dropPendingMarksFrom(0), false);
        store(makeEpisode());
        assert.equal(dropPendingMarksFrom(0), false);
    });
});

describe('scrubArcInternals — clue and trigger ids', () => {
    it('removes leaked clue and trigger ids from the message', () => {
        global.$ = () => ({ length: 0 });
        chat.push({ mes: 'Tracker: grey_van planted, van_leaves pending.' });
        scrubArcInternals(0, [makeEpisode()]);
        assert.equal(chat[0].mes, 'Tracker: … planted, … pending.');
    });
});

describe('togglePlanItem', () => {
    it('flips one item and leaves the input untouched', () => {
        const items = [{ id: 'a', planted: false }, { id: 'b', planted: true }];
        assert.deepEqual(togglePlanItem(items, 'a', 'planted'), [{ id: 'a', planted: true }, { id: 'b', planted: true }]);
        assert.equal(items[0].planted, false);
    });
});
