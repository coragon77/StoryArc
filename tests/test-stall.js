import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ignoreStall, isStalled, isStallNudgeShown, renderProgressDisplay } from '../lib/ui/progress.js';
import { processSignalResults } from '../lib/injection/signals.js';
import { pauseArc, reactivateArc, resumeArc, spotlightArc } from '../lib/injection/clock.js';
import { completeBeats } from '../lib/planning/beat-completion.js';
import { applyReplan } from '../lib/planning/replan.js';
import { getArcById, replaceArc } from '../lib/planning/storage.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

// Episode of estimatedLength 20 with six non-optional beats: a stall is more
// than 3 × 20 / 6 = 10 messages since the last fulfillment.
function episode(overrides = {}) {
    const beats = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, status: 'active', optional: false }));
    return { id: 'ep', tier: 'episode', focus: 'normal', status: 'active', messageStart: 100, lastFulfilledAt: 100, estimatedLength: 20, beats, ...overrides };
}

describe('isStalled — threshold', () => {
    // lastFulfilledAt is the chat index of the fulfilling message, so after N
    // further messages chat.length is lastFulfilledAt + N + 1.
    const table = [
        { name: 'nine messages after the fulfillment: not stalled', chatLength: 110, expected: false },
        { name: 'ten messages after the fulfillment: stalled', chatLength: 111, expected: true },
        { name: 'right after the fulfillment: not stalled', chatLength: 101, expected: false },
    ];
    for (const row of table) {
        it(row.name, () => {
            assert.equal(isStalled(episode(), row.chatLength), row.expected);
        });
    }

    it('optional beats do not raise the per-beat allowance', () => {
        const beats = [...episode().beats, { id: 'opt', status: 'pending', optional: true }];
        assert.equal(isStalled(episode({ beats }), 111), true);
    });

    it('a fulfillment resets the count', () => {
        assert.equal(isStalled(episode({ lastFulfilledAt: 110 }), 120), false);
    });
});

describe('isStalled — never for paused or background arcs', () => {
    it('paused episode', () => {
        assert.equal(isStalled(episode({ focus: 'paused', pausedAt: 105 }), 200), false);
    });
    it('background episode', () => {
        assert.equal(isStalled(episode({ focus: 'background' }), 200), false);
    });
});

// The Street act of the Paragon chat: estimatedLength 90 with four
// non-optional milestones, so a stall is more than 3 × 90 / 4 = 67.5 messages
// since the latest of its start, last fulfillment and last re-plan.
function act(overrides = {}) {
    const beats = Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, status: 'active', optional: false }));
    return { id: 'act', tier: 'act', focus: 'normal', status: 'active', messageStart: 2118, lastFulfilledAt: 2225, estimatedLength: 90, beats, ...overrides };
}

// A saga of 1000 messages with three milestones: a stall is more than
// 3 × 1000 / 3 = 1000 messages.
function saga(overrides = {}) {
    const beats = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, status: 'active', optional: false }));
    return { id: 'saga', tier: 'saga', focus: 'normal', status: 'active', messageStart: 200, lastFulfilledAt: 500, estimatedLength: 1000, beats, ...overrides };
}

describe('isStalled — acts and sagas', () => {
    const table = [
        { name: 'act, 67 messages after its last fulfillment: not stalled', arc: act(), chatLength: 2292, expected: false },
        { name: 'act, 68 messages after its last fulfillment: stalled', arc: act(), chatLength: 2293, expected: true },
        { name: 'act never fulfilled, 67 messages after its start: not stalled', arc: act({ lastFulfilledAt: undefined }), chatLength: 2185, expected: false },
        { name: 'act never fulfilled, 68 messages after its start: stalled', arc: act({ lastFulfilledAt: undefined }), chatLength: 2186, expected: true },
        { name: 'spotlight act past its allowance: stalled', arc: act({ focus: 'spotlight' }), chatLength: 2293, expected: true },
        { name: 'paused act past its allowance: not stalled', arc: act({ focus: 'paused', pausedAt: 2230 }), chatLength: 2400, expected: false },
        { name: 'background act past its allowance: not stalled', arc: act({ focus: 'background' }), chatLength: 2400, expected: false },
        // Re-planned at 2280: 68 messages after the fulfillment, 13 after the re-plan.
        { name: 'act re-planned after its last fulfillment: counted from the re-plan', arc: act({ replannedAt: 2280 }), chatLength: 2293, expected: false },
        { name: 'act re-planned at 2280, 67 messages on: not stalled', arc: act({ replannedAt: 2280 }), chatLength: 2347, expected: false },
        { name: 'act re-planned at 2280, 68 messages on: stalled', arc: act({ replannedAt: 2280 }), chatLength: 2348, expected: true },
        { name: 'a re-plan before the last fulfillment: counted from the fulfillment', arc: act({ replannedAt: 2200 }), chatLength: 2293, expected: true },
        { name: 'act whose re-plan stamp is later than the chat length: not stalled', arc: act({ replannedAt: 2400 }), chatLength: 2300, expected: false },
        { name: 'act with only optional milestones: never stalled', arc: act({ beats: [{ id: 'o1', status: 'active', optional: true }] }), chatLength: 5000, expected: false },
        { name: 'act without an estimated length: never stalled', arc: act({ estimatedLength: undefined }), chatLength: 5000, expected: false },
        { name: 'saga 1000 messages after its last fulfillment: not stalled', arc: saga(), chatLength: 1500, expected: false },
        { name: 'saga past its allowance: stalled', arc: saga(), chatLength: 1501, expected: true },
        { name: 'paused saga past its allowance: not stalled', arc: saga({ focus: 'paused', pausedAt: 600 }), chatLength: 3000, expected: false },
        { name: 'background saga past its allowance: not stalled', arc: saga({ focus: 'background' }), chatLength: 3000, expected: false },
    ];
    for (const row of table) {
        it(row.name, () => {
            assert.equal(isStalled(row.arc, row.chatLength), row.expected);
        });
    }
});

describe('isStalled — migrated arcs without a usable lastFulfilledAt', () => {
    it('missing lastFulfilledAt counts from messageStart', () => {
        assert.equal(isStalled(episode({ lastFulfilledAt: undefined }), 110), false);
        assert.equal(isStalled(episode({ lastFulfilledAt: undefined }), 111), true);
    });
    it('lastFulfilledAt 0 (pre-tier default) counts from messageStart', () => {
        assert.equal(isStalled(episode({ lastFulfilledAt: 0 }), 110), false);
    });
    it('pre-tier arc without a tier is an episode', () => {
        assert.equal(isStalled(episode({ tier: undefined }), 111), true);
    });
});

describe('lastFulfilledAt — set on fulfillment, shifted on resume', () => {
    beforeEach(() => {
        chat.length = 0;
        chat_metadata.story_arc = { arcs: [] };
    });

    it('a fulfillment stamps the index of the fulfilling message', async () => {
        const arc = episode({ id: 'arc12345-full-id', lastFulfilledAt: 100 });
        chat_metadata.story_arc.arcs = [arc];
        await processSignalResults([{ arcId: 'arc12345', beatId: 'b0' }], [arc], 110);
        assert.equal(arc.lastFulfilledAt, 110);
        assert.equal(chat_metadata.story_arc.arcs[0].lastFulfilledAt, 110);
        assert.equal(isStalled(arc, 111), false);
    });

    it('a 15-message pause does not count', async () => {
        chat_metadata.story_arc.arcs = [episode()];
        chat.length = 105;
        await pauseArc('ep');
        chat.length = 120;
        await resumeArc('ep');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.equal(stored.lastFulfilledAt, 115);
        assert.equal(isStalled(stored, 120), false);
        assert.equal(isStalled(stored, 126), true);
    });

    it('a 15-message pause after a re-plan moves the re-plan stamp by 15', async () => {
        chat_metadata.story_arc.arcs = [act({ replannedAt: 2280 })];
        chat.length = 2290;
        await pauseArc('act');
        chat.length = 2305;
        await resumeArc('act');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.equal(stored.replannedAt, 2295);
        assert.equal(stored.messageStart, 2133);
        assert.equal(stored.lastFulfilledAt, 2240);
        // 67 messages after the shifted stamp: not stalled; 68: stalled.
        assert.equal(isStalled(stored, 2362), false);
        assert.equal(isStalled(stored, 2363), true);
    });

    it('a re-plan during the pause stamps the resume point: only the pause after the stamp counts', async () => {
        chat_metadata.story_arc.arcs = [act()];
        chat.length = 2290;
        await pauseArc('act');
        // Re-planned while paused, at chat length 2300.
        chat_metadata.story_arc.arcs[0].replannedAt = 2300;
        chat.length = 2305;
        await resumeArc('act');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.equal(stored.replannedAt, 2305);
        // The whole 15-message pause still shifts messageStart.
        assert.equal(stored.messageStart, 2133);
    });

    it('resuming an arc never re-planned writes no re-plan stamp', async () => {
        chat_metadata.story_arc.arcs = [act()];
        chat.length = 2290;
        await pauseArc('act');
        chat.length = 2305;
        await resumeArc('act');
        assert.equal('replannedAt' in chat_metadata.story_arc.arcs[0], false);
    });
});

describe('renderProgressDisplay — stall nudge', () => {
    it('shows the re-plan nudge for a stalled episode only', () => {
        chat.length = 111;
        const html = renderProgressDisplay([episode({ id: 'stalled' }), episode({ id: 'fresh', lastFulfilledAt: 105 })]);
        assert.match(html, /class="story-arc-stall-btn" data-arc-id="stalled"[^>]*>[^<]*May have drifted — re-plan\?/);
        assert.doesNotMatch(html, /data-arc-id="fresh"/);
    });

    it('shows the re-plan nudge for a stalled act, not for a fresh one', () => {
        chat.length = 2293;
        const html = renderProgressDisplay([act({ id: 'stalled-act' }), act({ id: 'fresh-act', replannedAt: 2290 })]);
        assert.match(html, /class="story-arc-stall-btn" data-arc-id="stalled-act"[^>]*>May have drifted — re-plan\?<\/div>/);
        assert.doesNotMatch(html, /data-arc-id="fresh-act"/);
    });

    it('shows only the ruling line on a stalled act with an open ruling', () => {
        chat.length = 2293;
        const html = renderProgressDisplay([act({ title: 'Streets', rulings: [{ id: 'r1', text: 'Aegis is not her defender.', at: 2250 }] })]);
        assert.equal(html.includes('May have drifted'), false);
        assert.match(html, /data-arc-id="act"[^>]*>You overruled the plan — re-plan\?</);
    });
});

describe('isStalled — counted from a reactivation', () => {
    // Reactivated at 2280: 68 messages after the fulfillment, 13 after the reactivation.
    const table = [
        { name: 'act reactivated after its last fulfillment: counted from the reactivation', arc: act({ reactivatedAt: 2280 }), chatLength: 2293, expected: false },
        { name: 'act reactivated at 2280, 67 messages on: not stalled', arc: act({ reactivatedAt: 2280 }), chatLength: 2347, expected: false },
        { name: 'act reactivated at 2280, 68 messages on: stalled', arc: act({ reactivatedAt: 2280 }), chatLength: 2348, expected: true },
    ];
    for (const row of table) {
        it(row.name, () => {
            assert.equal(isStalled(row.arc, row.chatLength), row.expected);
        });
    }

    it('reactivateArc restarts the count of an arc that ended long ago', async () => {
        chat_metadata.story_arc = { arcs: [act({ status: 'abandoned' })] };
        chat.length = 2400;
        await reactivateArc('act');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.equal(isStalled(stored, 2400), false);
        assert.equal(isStalled(stored, 2467), false);
        assert.equal(isStalled(stored, 2468), true);
    });
});

describe('ignoreStall — the stall nudge hidden until the next beat or re-plan', () => {
    beforeEach(() => {
        chat.length = 111;
        chat_metadata.story_arc = { arcs: [episode()] };
    });

    function stored() {
        return chat_metadata.story_arc.arcs[0];
    }

    it('stores where the ignored stall was counted from', async () => {
        await ignoreStall('ep');
        assert.equal(stored().stallIgnoredFrom, 100);
    });

    it('hides the nudge of the stalled arc; the arc is still stalled', async () => {
        assert.equal(isStallNudgeShown(stored(), 111), true);
        await ignoreStall('ep');
        assert.equal(isStalled(stored(), 111), true);
        assert.equal(isStallNudgeShown(stored(), 111), false);
        assert.equal(isStallNudgeShown(stored(), 400), false);
        assert.equal(renderProgressDisplay([stored()]).includes('May have drifted'), false);
    });

    it('shows the nudge again once the next beat lands and the arc stalls again', async () => {
        await ignoreStall('ep');
        chat.length = 116;
        await completeBeats([{ arcId: 'ep', beatId: 'b0', at: 115 }], chat_metadata.story_arc.arcs);
        assert.equal(isStallNudgeShown(stored(), 125), false);
        assert.equal(isStallNudgeShown(stored(), 126), true);
        chat.length = 126;
        assert.match(renderProgressDisplay([stored()]), /data-arc-id="ep"[^>]*>May have drifted — re-plan\?/);
    });

    it('shows the nudge again once the arc is re-planned and stalls again', async () => {
        await ignoreStall('ep');
        stored().title = 'The Debt';
        const { arc: replanned, error } = applyReplan(structuredClone(stored()), 130, { premise: 'A debt comes due.' });
        assert.equal(error, null);
        await replaceArc(getArcById('ep'), replanned);
        assert.equal(isStallNudgeShown(stored(), 140), false);
        assert.equal(isStallNudgeShown(stored(), 141), true);
    });

    it('shows the nudge again once the arc is reactivated and stalls again', async () => {
        await ignoreStall('ep');
        stored().status = 'completed';
        chat.length = 150;
        await reactivateArc('ep');
        assert.equal(isStallNudgeShown(stored(), 160), false);
        assert.equal(isStallNudgeShown(stored(), 161), true);
    });
});

describe('spotlightArc — the stall count restarts, the warning goes', () => {
    beforeEach(() => {
        chat.length = 111;
        chat_metadata.story_arc = { arcs: [episode()] };
    });

    function stored() {
        return chat_metadata.story_arc.arcs[0];
    }

    it('clears the stall warning of the arc it spotlights', async () => {
        assert.equal(isStallNudgeShown(stored(), 111), true);
        await spotlightArc('ep');
        assert.equal(isStalled(stored(), 111), false);
        assert.equal(isStallNudgeShown(stored(), 111), false);
    });

    it('unlike Ignore, the warning comes back once the spotlit arc stalls again', async () => {
        await spotlightArc('ep');
        assert.equal(isStallNudgeShown(stored(), 121), false);
        assert.equal(isStallNudgeShown(stored(), 122), true);
    });
});
