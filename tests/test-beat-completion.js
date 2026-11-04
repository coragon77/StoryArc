import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { completeBeats, reopenCompletionsFrom } from '../lib/planning/beat-completion.js';
import { completeBeat } from '../lib/planning/arc-edit.js';
import { processSignalResults, promoteNextBeats } from '../lib/injection/signals.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

/** Put the arcs into chat_metadata as they are; returns the stored arcs. */
function storeArcs(...arcs) {
    chat_metadata.story_arc = { version: 1, arcs, settings: {} };
    return arcs;
}

/** Replace the chat with `length` messages carrying the message ids m0, m1, … */
function chatWithIds(length) {
    chat.length = 0;
    for (let index = 0; index < length; index++) {
        chat.push({ mes: `message ${index}`, extra: { story_arc_message_id: `m${index}` } });
    }
}

/**
 * An episode at messageStart 2: b1 active, b2 locked until b1, b3 pending,
 * b4 optional.
 */
function episode() {
    return {
        id: 'epi00001-full-id',
        title: 'Test Episode',
        tier: 'episode',
        focus: 'normal',
        status: 'active',
        messageStart: 2,
        lastFulfilledAt: 2,
        estimatedLength: 20,
        beats: [
            { id: 'b1', intention: 'first', status: 'active', unlockAfter: [], optional: false },
            { id: 'b2', intention: 'second', status: 'locked', unlockAfter: ['b1'], optional: false },
            { id: 'b3', intention: 'third', status: 'pending', unlockAfter: [], optional: false },
            { id: 'b4', intention: 'extra', status: 'pending', unlockAfter: [], optional: true },
        ],
    };
}

/** An act at messageStart 2 with three active milestones. */
function act() {
    return {
        id: 'act00001-full-id',
        title: 'Test Act',
        tier: 'act',
        focus: 'normal',
        status: 'active',
        messageStart: 2,
        lastFulfilledAt: 2,
        estimatedLength: 60,
        beats: [
            { id: 'm1', intention: 'one', status: 'active', unlockAfter: [], optional: false },
            { id: 'm2', intention: 'two', status: 'active', unlockAfter: [], optional: false },
            { id: 'm3', intention: 'three', status: 'active', unlockAfter: [], optional: false },
        ],
    };
}

function statuses(arc) {
    return arc.beats.map(beat => beat.status);
}

beforeEach(() => {
    chatWithIds(8);
});

describe('completeBeats — rules', () => {
    it('completes an active beat and promotes nothing', async () => {
        const [arc] = storeArcs(episode());
        const result = await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        assert.deepEqual(result, { updated: true, completedBeats: ['b1'] });
        // b2 unlocks to pending, b3 stays pending: no beat is active until the user's turn.
        assert.deepEqual(statuses(arc), ['completed', 'pending', 'pending', 'pending']);
        assert.equal(arc.lastFulfilledAt, 5);
    });

    it('ignores pending, locked and unknown beats, unknown arcs and arcs that are not active', async () => {
        const [arc, finished] = storeArcs(episode(), { ...act(), status: 'completed' });
        const result = await completeBeats([
            { arcId: 'epi00001', beatId: 'b3', at: 5 },
            { arcId: 'epi00001', beatId: 'b2', at: 5 },
            { arcId: 'epi00001', beatId: 'ghost', at: 5 },
            { arcId: 'zzz99999', beatId: 'b1', at: 5 },
            { arcId: 'act00001', beatId: 'm1', at: 5 },
        ], [arc, finished]);
        assert.deepEqual(result, { updated: false, completedBeats: [] });
        assert.deepEqual(statuses(arc), ['active', 'locked', 'pending', 'pending']);
        assert.deepEqual(statuses(finished), ['active', 'active', 'active']);
        assert.equal(arc.lastFulfilledAt, 2);
    });

    it('takes one completion per arc per message, the first in the list', async () => {
        const [arc] = storeArcs(act());
        const result = await completeBeats([
            { arcId: 'act00001', beatId: 'm2', at: 5 },
            { arcId: 'act00001', beatId: 'm1', at: 5 },
            { arcId: 'act00001', beatId: 'm3', at: 6 },
        ], [arc]);
        assert.deepEqual(result.completedBeats, ['m2', 'm3']);
        assert.deepEqual(statuses(arc), ['active', 'completed', 'completed']);
        assert.equal(arc.lastFulfilledAt, 6);
    });

    it('lets two arcs each complete a beat in the same message', async () => {
        const [first, second] = storeArcs(episode(), act());
        const result = await completeBeats([
            { arcId: 'epi00001', beatId: 'b1', at: 5 },
            { arcId: 'act00001', beatId: 'm1', at: 5 },
        ], [first, second]);
        assert.deepEqual(result.completedBeats, ['b1', 'm1']);
    });

    it('completes the arc when no non-optional beat is left', async () => {
        const arc = act();
        arc.beats[0].status = 'completed';
        arc.beats[1].status = 'completed';
        storeArcs(arc);
        await completeBeats([{ arcId: 'act00001', beatId: 'm3', at: 6 }], [arc]);
        assert.equal(arc.status, 'completed');
    });

    it('leaves the arc active while a non-optional beat is open', async () => {
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        assert.equal(arc.status, 'active');
    });
});

describe('completeBeats — completion record', () => {
    it('records the message index, its message id and what reopening undoes', async () => {
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        assert.deepEqual(arc.beats[0].completion, {
            at: 5,
            messageId: 'm5',
            unlocked: ['b2'],
            arcCompleted: false,
            lastFulfilledBefore: 2,
        });
    });

    it('records that the completion completed the arc', async () => {
        const arc = act();
        arc.beats[0].status = 'completed';
        arc.beats[1].status = 'completed';
        storeArcs(arc);
        await completeBeats([{ arcId: 'act00001', beatId: 'm3', at: 6 }], [arc]);
        assert.equal(arc.beats[2].completion.arcCompleted, true);
    });

    it('names a message without a Story Arc message id by index only, and gives it none', async () => {
        chat[5] = { mes: 'a reply from a chat with the tracker off' };
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        assert.deepEqual(arc.beats[0].completion, {
            at: 5,
            unlocked: ['b2'],
            arcCompleted: false,
            lastFulfilledBefore: 2,
        });
        assert.equal(chat[5].extra, undefined);
    });

    it('names a hidden message by index only', async () => {
        chat[5] = { mes: 'hidden', is_system: true };
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        assert.equal(arc.beats[0].completion.at, 5);
        assert.equal('messageId' in arc.beats[0].completion, false);
        assert.equal(chat[5].extra, undefined);
    });

    it('records nothing without a message index', async () => {
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1' }], [arc]);
        assert.equal(arc.beats[0].status, 'completed');
        assert.equal(arc.beats[0].completion, undefined);
    });
});

describe('reopenCompletionsFrom — which completions', () => {
    it('reopens a completion in a deleted message (regeneration deletes the last reply)', async () => {
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 7 }], [arc]);
        chat.length = 7;

        assert.equal(reopenCompletionsFrom(7), true);
        assert.deepEqual(statuses(arc), ['active', 'locked', 'pending', 'pending']);
        assert.equal(arc.beats[0].completion, undefined);
        assert.equal(arc.lastFulfilledAt, 2);
    });

    it('reopens a completion in the swiped message', async () => {
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 7 }], [arc]);
        // The swiped message stays in the chat, with its message id until the ledger takes it.
        assert.equal(reopenCompletionsFrom(7), true);
        assert.equal(arc.beats[0].status, 'active');
    });

    it('reopens a completion past the end of a loaded branch and keeps an earlier one', async () => {
        const [arc] = storeArcs(act());
        await completeBeats([{ arcId: 'act00001', beatId: 'm1', at: 3 }], [arc]);
        await completeBeats([{ arcId: 'act00001', beatId: 'm2', at: 6 }], [arc]);
        chatWithIds(5);

        assert.equal(reopenCompletionsFrom(5), true);
        assert.deepEqual(statuses(arc), ['completed', 'active', 'active']);
        assert.equal(arc.lastFulfilledAt, 3);
    });

    it('follows a message id when a message before it is deleted, and reopens the deleted one', async () => {
        const [arc] = storeArcs(act());
        await completeBeats([{ arcId: 'act00001', beatId: 'm1', at: 3 }], [arc]);
        await completeBeats([{ arcId: 'act00001', beatId: 'm2', at: 6 }], [arc]);
        chat.splice(3, 1);

        assert.equal(reopenCompletionsFrom(chat.length), true);
        assert.deepEqual(statuses(arc), ['active', 'completed', 'active']);
        assert.equal(arc.beats[1].completion.at, 5);
        assert.equal(arc.beats[1].completion.messageId, 'm6');
        assert.equal(arc.lastFulfilledAt, 5);
    });

    it('reopens a completion without a message id by the index rule only', async () => {
        chat[6] = { mes: 'a reply from a chat with the tracker off' };
        const [arc] = storeArcs(act());
        await completeBeats([{ arcId: 'act00001', beatId: 'm1', at: 6 }], [arc]);

        // A deletion before it does not move it: `at` stays 6.
        chat.splice(2, 1);
        assert.equal(reopenCompletionsFrom(chat.length), false);
        assert.equal(arc.beats[0].completion.at, 6);

        // A swipe of index 6 (or a deletion from 6 on) reopens it.
        assert.equal(reopenCompletionsFrom(6), true);
        assert.equal(arc.beats[0].status, 'active');
    });

    it('changes nothing when every recorded message is still there', async () => {
        const [arc] = storeArcs(act());
        await completeBeats([{ arcId: 'act00001', beatId: 'm1', at: 3 }], [arc]);
        assert.equal(reopenCompletionsFrom(8), false);
        assert.equal(arc.beats[0].status, 'completed');
        assert.equal(arc.lastFulfilledAt, 3);
    });

    it('never touches a completion without a record', () => {
        const arc = act();
        arc.beats[0].status = 'completed';
        arc.lastFulfilledAt = 7;
        storeArcs(arc);
        chat.length = 3;

        assert.equal(reopenCompletionsFrom(3), false);
        assert.equal(arc.beats[0].status, 'completed');
        assert.equal(arc.lastFulfilledAt, 7);
    });
});

describe('reopenCompletionsFrom — what reopening undoes', () => {
    it('locks again a beat the completion unlocked that is still pending', async () => {
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        assert.equal(arc.beats[1].status, 'pending');

        reopenCompletionsFrom(5);
        assert.equal(arc.beats[1].status, 'locked');
    });

    it('leaves an unlocked milestone that is no longer pending as it is', async () => {
        const arc = act();
        arc.beats[2] = { id: 'm3', intention: 'three', status: 'locked', unlockAfter: ['m1'], optional: false };
        storeArcs(arc);
        await completeBeats([{ arcId: 'act00001', beatId: 'm1', at: 5 }], [arc]);
        await promoteNextBeats([arc]);
        assert.equal(arc.beats[2].status, 'active');

        reopenCompletionsFrom(5);
        assert.deepEqual(statuses(arc), ['active', 'active', 'active']);
    });

    it('sets a later scene beat promoted after the completion back to pending', async () => {
        const arc = episode();
        arc.beats[1].unlockAfter = [];
        arc.beats[1].status = 'pending';
        storeArcs(arc);
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        await promoteNextBeats([arc]);
        assert.deepEqual(statuses(arc), ['completed', 'active', 'pending', 'pending']);

        reopenCompletionsFrom(5);
        assert.deepEqual(statuses(arc), ['active', 'pending', 'pending', 'pending']);
    });

    it('locks again an unlocked scene beat that was promoted meanwhile', async () => {
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        await promoteNextBeats([arc]);
        assert.deepEqual(statuses(arc), ['completed', 'active', 'pending', 'pending']);

        reopenCompletionsFrom(5);
        assert.deepEqual(statuses(arc), ['active', 'locked', 'pending', 'pending']);
    });

    it('reopens two completions of one episode, latest first', async () => {
        const arc = episode();
        arc.beats[1].unlockAfter = [];
        arc.beats[1].status = 'pending';
        storeArcs(arc);
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 4 }], [arc]);
        await promoteNextBeats([arc]);
        await completeBeats([{ arcId: 'epi00001', beatId: 'b2', at: 6 }], [arc]);
        await promoteNextBeats([arc]);
        assert.deepEqual(statuses(arc), ['completed', 'completed', 'active', 'pending']);
        chat.length = 4;

        reopenCompletionsFrom(4);
        assert.deepEqual(statuses(arc), ['active', 'pending', 'pending', 'pending']);
        assert.equal(arc.lastFulfilledAt, 2);
    });

    it('makes an arc the completion completed active again', async () => {
        const arc = act();
        arc.beats[0].status = 'completed';
        arc.beats[1].status = 'completed';
        storeArcs(arc);
        await completeBeats([{ arcId: 'act00001', beatId: 'm3', at: 6 }], [arc]);
        assert.equal(arc.status, 'completed');

        reopenCompletionsFrom(6);
        assert.equal(arc.status, 'active');
        assert.equal(arc.beats[2].status, 'active');
    });

    it('sets lastFulfilledAt back to the latest remaining completion', async () => {
        const [arc] = storeArcs(act());
        await completeBeats([{ arcId: 'act00001', beatId: 'm1', at: 4 }], [arc]);
        await completeBeats([{ arcId: 'act00001', beatId: 'm2', at: 6 }], [arc]);
        assert.equal(arc.lastFulfilledAt, 6);

        reopenCompletionsFrom(6);
        assert.equal(arc.lastFulfilledAt, 4);
    });

    it('sets lastFulfilledAt back to a legacy completion without a record', async () => {
        const arc = act();
        arc.beats[0].status = 'completed';
        arc.lastFulfilledAt = 5;
        storeArcs(arc);
        await completeBeats([{ arcId: 'act00001', beatId: 'm2', at: 7 }], [arc]);

        reopenCompletionsFrom(7);
        assert.equal(arc.lastFulfilledAt, 5);
        assert.equal(arc.beats[0].status, 'completed');
    });

    it('falls back to messageStart for a record without the earlier lastFulfilledAt', () => {
        const arc = act();
        arc.beats[0].status = 'completed';
        arc.beats[0].completion = { at: 6, messageId: 'm6', unlocked: [], arcCompleted: false };
        arc.lastFulfilledAt = 6;
        storeArcs(arc);

        reopenCompletionsFrom(6);
        assert.equal(arc.lastFulfilledAt, 2);
    });
});

describe('in-prompt marker path', () => {
    it('records the message that carried the COMPLETE marker', async () => {
        const [arc] = storeArcs(episode());
        await processSignalResults([{ arcId: 'epi00001', beatId: 'b1', verb: 'COMPLETE' }], [arc], 7);
        assert.equal(arc.beats[0].completion.at, 7);
        assert.equal(arc.beats[0].completion.messageId, 'm7');
    });
});

describe('manual toggle and recorded completions', () => {
    it('a completion by hand carries no record, so a rollback leaves it', () => {
        const [arc] = storeArcs(episode());
        arc.beats = completeBeat(arc.beats, 'b1');
        assert.equal(arc.beats[0].completion, undefined);

        assert.equal(reopenCompletionsFrom(0), false);
        assert.equal(arc.beats[0].status, 'completed');
    });

    it('a completion by hand drops a stale record of an earlier recognised completion', () => {
        const beats = episode().beats;
        beats[0] = { ...beats[0], status: 'pending', completion: { at: 5, messageId: 'm5', unlocked: [], arcCompleted: false, lastFulfilledBefore: 2 } };
        const completed = completeBeat(beats, 'b1');
        assert.deepEqual(completed[0], { id: 'b1', intention: 'first', status: 'completed', unlockAfter: [], optional: false });
    });

    it('a recognised completion set back by hand only loses its record on rollback', async () => {
        const [arc] = storeArcs(episode());
        await completeBeats([{ arcId: 'epi00001', beatId: 'b1', at: 5 }], [arc]);
        arc.beats[0].status = 'pending';

        assert.equal(reopenCompletionsFrom(5), true);
        assert.equal(arc.beats[0].status, 'pending');
        assert.equal(arc.beats[0].completion, undefined);
    });
});
