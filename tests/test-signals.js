import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignals, processSignalResults, stripSignalsFromMessage, scrubArcInternals, promoteNextBeats } from '../lib/injection/signals.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

/** Store a copy of the arcs, so the stored arc changes only through updateArc. */
function storeCopies(...arcs) {
    chat_metadata.story_arc = { version: 1, arcs: structuredClone(arcs), settings: {} };
    return chat_metadata.story_arc.arcs;
}

describe('parseSignals', () => {
    it('parses a single signal', () => {
        const signals = parseSignals('Story text here.\n[ARC_SIGNAL:abc123:beat_1:COMPLETE]');
        assert.equal(signals.length, 1);
        assert.equal(signals[0].arcId, 'abc123');
        assert.equal(signals[0].beatId, 'beat_1');
    });

    it('parses multiple signals', () => {
        const text = 'Text\n[ARC_SIGNAL:arc1:beat_1:COMPLETE]\n[ARC_SIGNAL:arc2:beat_2:COMPLETE]';
        const signals = parseSignals(text);
        assert.equal(signals.length, 2);
    });

    it('returns empty array for no signals', () => {
        assert.deepEqual(parseSignals('Just regular story text'), []);
    });

    it('returns empty array for null/empty input', () => {
        assert.deepEqual(parseSignals(null), []);
        assert.deepEqual(parseSignals(''), []);
    });

    it('handles signals with underscores and hyphens in IDs', () => {
        const signals = parseSignals('[ARC_SIGNAL:arc-1:valdris_dinner:COMPLETE]');
        assert.equal(signals[0].arcId, 'arc-1');
        assert.equal(signals[0].beatId, 'valdris_dinner');
    });

    it('parses the HTML-comment-wrapped form', () => {
        const signals = parseSignals('<!-- [ARC_SIGNAL:abc123:lean_in:COMPLETE] -->\n\nStory text.');
        assert.equal(signals.length, 1);
        assert.equal(signals[0].arcId, 'abc123');
        assert.equal(signals[0].beatId, 'lean_in');
    });

    it('parses and strips a comment marker written without spaces or with two spaces, leaving no stray comment delimiters', () => {
        global.$ = () => ({ length: 0 });
        for (const marker of ['<!--[ARC_SIGNAL:abc123:lean_in:COMPLETE]-->', '<!--  [ARC_SIGNAL:abc123:lean_in:COMPLETE]  -->']) {
            const signals = parseSignals(`${marker}\nStory text.`);
            assert.equal(signals.length, 1, marker);
            assert.equal(signals[0].fullMatch, marker);

            chat.length = 0;
            chat.push({ mes: `${marker}\nStory text.` });
            stripSignalsFromMessage(0);
            assert.equal(chat[0].mes, 'Story text.', marker);
        }
    });
});

describe('stripSignalsFromMessage', () => {
    it('removes a comment-wrapped marker including the leading blank lines', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: '<!-- [ARC_SIGNAL:abc123:lean_in:COMPLETE] -->\n\nStory text.' });

        stripSignalsFromMessage(0);

        assert.equal(chat[0].mes, 'Story text.');
    });

    it('removes a bare marker from an old-format message', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: '[ARC_SIGNAL:abc123:lean_in:COMPLETE]\n\nStory text.' });

        stripSignalsFromMessage(0);

        assert.equal(chat[0].mes, 'Story text.');
    });

    it('leaves a message without a marker byte-identical, surrounding whitespace included', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: '  Story text.\n\n' });

        stripSignalsFromMessage(0);

        assert.equal(chat[0].mes, '  Story text.\n\n');
    });

    it('is a no-op for an index past the end of the chat', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: 'Story text.' });

        stripSignalsFromMessage(5);

        assert.deepEqual(chat, [{ mes: 'Story text.' }]);
    });
});

describe('scrubArcInternals', () => {
    const arcs = [{
        id: '46fcef53-aaaa-bbbb',
        beats: [
            { id: 'sensory_bleed' },
            { id: 'explicit_pursuit' },
            { id: 'climax' },
        ],
    }];

    it('removes leaked beat and arc ids from tracker blocks, leaving prose intact', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: 'The sensory bleed hit her hard.\n\n<!--\nsensory_bleed beat COMPLETE. Next: explicit_pursuit begins (arc 46fcef53).\n-->' });

        scrubArcInternals(0, arcs);

        assert.equal(chat[0].mes, 'The sensory bleed hit her hard.\n\n<!--\n… beat COMPLETE. Next: … begins (arc …).\n-->');
    });

    it('removes leaked secret ids too — an OOC analysis once named one beside its content', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: '- **Apex** has gauntlets with an unauthorized tether (secret: scrimmage_collar_trophy_gambit)' });

        scrubArcInternals(0, [{ id: '46fcef53-aaaa-bbbb', beats: [], secrets: [{ id: 'scrimmage_collar_trophy_gambit' }] }]);

        assert.equal(chat[0].mes, '- **Apex** has gauntlets with an unauthorized tether (secret: …)');
    });

    it('leaves plain-word beat ids alone — they are indistinguishable from prose', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: 'The climax of the evening came quietly.' });

        scrubArcInternals(0, arcs);

        assert.equal(chat[0].mes, 'The climax of the evening came quietly.');
    });

    it('is a no-op for an index past the end of the chat and for a missing or empty arc list', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: 'sensory_bleed leaked.' });

        scrubArcInternals(5, arcs);
        scrubArcInternals(0, undefined);
        scrubArcInternals(0, []);

        assert.deepEqual(chat, [{ mes: 'sensory_bleed leaked.' }]);
    });

    it('scrubs item ids of an arc without an id, skipping items without one', () => {
        global.$ = () => ({ length: 0 });
        chat.length = 0;
        chat.push({ mes: 'Tracker: cold_open done.' });

        scrubArcInternals(0, [{ beats: [{ id: 'cold_open' }, { intention: 'a beat with no id' }] }]);

        assert.equal(chat[0].mes, 'Tracker: … done.');
    });
});

describe('processSignalResults', () => {
    function makeArc() {
        return {
            id: 'arc12345-full-id',
            title: 'Test Arc',
            status: 'active',
            beats: [
                { id: 'b1', intention: 'first', status: 'active', unlockAfter: [], optional: false },
                { id: 'b2', intention: 'second', status: 'pending', unlockAfter: [], optional: false },
                { id: 'b3', intention: 'third', status: 'locked', unlockAfter: ['b2'], optional: false },
            ],
        };
    }

    it('completes the active beat and leaves the arc without an active beat', async () => {
        const arc = makeArc();
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b1', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.beats[0].status, 'completed');
        // No promotion here — that waits for the next user message.
        assert.equal(arc.beats[1].status, 'pending');
        assert.equal(arc.beats.some(b => b.status === 'active'), false);
    });

    it('ignores signals for pending beats', async () => {
        const arc = makeArc();
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b2', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.beats[1].status, 'pending');
        assert.equal(arc.beats[0].status, 'active');
    });

    it('ignores signals for locked beats', async () => {
        const arc = makeArc();
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b3', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.beats[2].status, 'locked');
        assert.equal(arc.beats[0].status, 'active');
    });

    it('accepts only the first completion per arc in one message', async () => {
        const arc = makeArc();
        arc.beats[1].status = 'active';
        const { completedBeats } = await processSignalResults([
            { arcId: 'arc12345', beatId: 'b1', status: 'COMPLETE' },
            { arcId: 'arc12345', beatId: 'b2', status: 'COMPLETE' },
        ], [arc]);
        assert.deepEqual(completedBeats, ['b1']);
        assert.equal(arc.beats[0].status, 'completed');
        assert.equal(arc.beats[1].status, 'active');
    });

    it('allows one completion in each of two arcs in the same message', async () => {
        const first = makeArc();
        const second = makeArc();
        second.id = 'arc99999-full-id';
        const { completedBeats } = await processSignalResults([
            { arcId: 'arc12345', beatId: 'b1', status: 'COMPLETE' },
            { arcId: 'arc99999', beatId: 'b1', status: 'COMPLETE' },
        ], [first, second]);
        assert.deepEqual(completedBeats, ['b1', 'b1']);
        assert.equal(first.beats[0].status, 'completed');
        assert.equal(second.beats[0].status, 'completed');
    });

    it('unlocks gated beats when their prerequisites are complete', async () => {
        const arc = makeArc();
        arc.beats[1].status = 'active';
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b2', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.beats[2].status, 'pending');
    });

    it('marks the arc completed when the last non-optional beat completes', async () => {
        const arc = {
            id: 'arc12345-full-id',
            title: 'Single Beat Arc',
            status: 'active',
            beats: [
                { id: 'b1', intention: 'only', status: 'active', unlockAfter: [], optional: false },
                { id: 'b2', intention: 'extra', status: 'pending', unlockAfter: [], optional: true },
            ],
        };
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b1', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.status, 'completed');
    });

    it('unlocks a beat waiting on two others only once both are completed', async () => {
        const arc = makeArc();
        arc.beats[1].status = 'active';
        arc.beats[2].unlockAfter = ['b1', 'b2'];

        await processSignalResults([{ arcId: 'arc12345', beatId: 'b1', verb: 'COMPLETE' }], [arc], 5);
        assert.equal(arc.beats[2].status, 'locked');

        await processSignalResults([{ arcId: 'arc12345', beatId: 'b2', verb: 'COMPLETE' }], [arc], 6);
        assert.equal(arc.beats[2].status, 'pending');
    });

    it('keeps a beat locked, without throwing, when it waits on a beat id that does not exist', async () => {
        const arc = makeArc();
        arc.beats[2].unlockAfter = ['b1', 'ghost'];
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b1', verb: 'COMPLETE' }], [arc], 5);
        assert.equal(arc.beats[2].status, 'locked');
    });

    it('reports updated false when every signal was ignored', async () => {
        const arc = makeArc();
        const result = await processSignalResults([
            { arcId: 'zzz99999', beatId: 'b1', verb: 'COMPLETE' },   // unknown arc
            { arcId: 'arc12345', beatId: 'ghost', verb: 'COMPLETE' }, // unknown beat
            { arcId: 'arc12345', beatId: 'b2', verb: 'COMPLETE' },    // pending beat
        ], [arc], 5);
        assert.deepEqual(result, { updated: false, completedBeats: [] });
        assert.deepEqual(arc.beats.map(b => b.status), ['active', 'pending', 'locked']);
    });

    it('skips signals for an unknown arc or beat and still applies a later valid one', async () => {
        const arc = makeArc();
        const result = await processSignalResults([
            { arcId: 'zzz99999', beatId: 'b1', verb: 'COMPLETE' },
            { arcId: 'arc12345', beatId: 'ghost', verb: 'COMPLETE' },
            { arcId: 'arc12345', beatId: 'b1', verb: 'COMPLETE' },
        ], [arc], 5);
        assert.deepEqual(result, { updated: true, completedBeats: ['b1'] });
        assert.equal(arc.beats[0].status, 'completed');
    });

    it('persists the new beats, the arc status and lastFulfilledAt through updateArc', async () => {
        const arc = {
            id: 'arc12345-full-id',
            title: 'Single Beat Arc',
            status: 'active',
            lastFulfilledAt: 0,
            beats: [{ id: 'b1', intention: 'only', status: 'active', unlockAfter: [], optional: false }],
        };
        const [stored] = storeCopies(arc);

        await processSignalResults([{ arcId: 'arc12345', beatId: 'b1', verb: 'COMPLETE' }], [arc], 7);

        assert.equal(stored.beats[0].status, 'completed');
        assert.equal(stored.status, 'completed');
        assert.equal(stored.lastFulfilledAt, 7);
    });
});

describe('promoteNextBeats', () => {
    it('activates the first pending beat when no beat is active', async () => {
        const arc = {
            id: 'arc12345-full-id',
            title: 'Test Arc',
            beats: [
                { id: 'b1', intention: 'first', status: 'completed' },
                { id: 'b2', intention: 'second', status: 'pending' },
                { id: 'b3', intention: 'third', status: 'pending' },
            ],
        };
        const promoted = await promoteNextBeats([arc]);
        assert.equal(promoted, true);
        assert.equal(arc.beats[1].status, 'active');
        assert.equal(arc.beats[2].status, 'pending');
    });

    it('leaves an arc that already has an active beat alone', async () => {
        const arc = {
            id: 'arc12345-full-id',
            title: 'Test Arc',
            beats: [
                { id: 'b1', intention: 'first', status: 'active' },
                { id: 'b2', intention: 'second', status: 'pending' },
            ],
        };
        const promoted = await promoteNextBeats([arc]);
        assert.equal(promoted, false);
        assert.equal(arc.beats[1].status, 'pending');
    });

    it('does not promote locked beats', async () => {
        const arc = {
            id: 'arc12345-full-id',
            title: 'Test Arc',
            beats: [
                { id: 'b1', intention: 'first', status: 'completed' },
                { id: 'b2', intention: 'second', status: 'locked' },
            ],
        };
        const promoted = await promoteNextBeats([arc]);
        assert.equal(promoted, false);
        assert.equal(arc.beats[1].status, 'locked');
    });

    it('promotes in every arc that needs it', async () => {
        const first = {
            id: 'arc11111-full-id',
            title: 'First',
            beats: [{ id: 'b1', intention: 'a', status: 'pending' }],
        };
        const second = {
            id: 'arc22222-full-id',
            title: 'Second',
            beats: [{ id: 'b1', intention: 'b', status: 'pending' }],
        };
        const promoted = await promoteNextBeats([first, second]);
        assert.equal(promoted, true);
        assert.equal(first.beats[0].status, 'active');
        assert.equal(second.beats[0].status, 'active');
    });

    it('persists the promotion through updateArc', async () => {
        const episode = {
            id: 'arc12345-full-id',
            title: 'Episode',
            tier: 'episode',
            beats: [
                { id: 'b1', intention: 'first', status: 'completed' },
                { id: 'b2', intention: 'second', status: 'pending' },
            ],
        };
        const act = {
            id: 'act12345-full-id',
            title: 'Act',
            tier: 'act',
            beats: [
                { id: 'm1', intention: 'first', status: 'pending' },
                { id: 'm2', intention: 'second', status: 'pending' },
            ],
        };
        const [storedEpisode, storedAct] = storeCopies(episode, act);

        await promoteNextBeats([episode, act]);

        assert.deepEqual(storedEpisode.beats.map(b => b.status), ['completed', 'active']);
        assert.deepEqual(storedAct.beats.map(b => b.status), ['active', 'active']);
    });
});

describe('milestones (act / saga)', () => {
    function makeAct() {
        return {
            id: 'act12345-full-id',
            title: 'Test Act',
            status: 'active',
            tier: 'act',
            beats: [
                { id: 'm1', intention: 'first', status: 'active', unlockAfter: [], optional: false },
                { id: 'm2', intention: 'second', status: 'active', unlockAfter: [], optional: false },
                { id: 'm3', intention: 'third', status: 'active', unlockAfter: [], optional: false },
            ],
        };
    }

    it('a marker for any milestone completes it and leaves the others active', async () => {
        const arc = makeAct();
        await processSignalResults([{ arcId: 'act12345', beatId: 'm3', status: 'COMPLETE' }], [arc]);
        assert.equal(arc.beats[2].status, 'completed');
        assert.equal(arc.beats[0].status, 'active');
        assert.equal(arc.beats[1].status, 'active');
        assert.equal(arc.status, 'active');
    });

    it('a second marker in the same message is ignored', async () => {
        const arc = makeAct();
        const { completedBeats } = await processSignalResults([
            { arcId: 'act12345', beatId: 'm2', status: 'COMPLETE' },
            { arcId: 'act12345', beatId: 'm1', status: 'COMPLETE' },
        ], [arc]);
        assert.deepEqual(completedBeats, ['m2']);
        assert.equal(arc.beats[0].status, 'active');
    });

    it('promotion does not re-hide milestones and repairs any pending one', async () => {
        const arc = makeAct();
        arc.beats[0].status = 'completed';
        arc.beats[2].status = 'pending';
        const promoted = await promoteNextBeats([arc]);
        assert.equal(promoted, true);
        assert.deepEqual(arc.beats.map(b => b.status), ['completed', 'active', 'active']);
    });

    it('promotion leaves an act with every milestone active or completed alone', async () => {
        const arc = makeAct();
        arc.beats[1].status = 'completed';
        const promoted = await promoteNextBeats([arc]);
        assert.equal(promoted, false);
        assert.deepEqual(arc.beats.map(b => b.status), ['active', 'completed', 'active']);
    });

    it('a saga with no active milestone gets all of them activated at once', async () => {
        const arc = makeAct();
        arc.tier = 'saga';
        for (const beat of arc.beats) beat.status = 'pending';
        await promoteNextBeats([arc]);
        assert.ok(arc.beats.every(b => b.status === 'active'));
    });
});
