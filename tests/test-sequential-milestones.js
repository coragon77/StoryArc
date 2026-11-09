import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chat_metadata } from './mocks/st-mocks.js';
import { completeBeats, reopenCompletionsAt, reopenCompletionsFrom, setBeatStatusByHand } from '../lib/planning/beat-completion.js';
import { buildInjection, buildSignalInjection } from '../lib/injection/builder.js';
import { calculatePhase } from '../lib/injection/pacing.js';
import { currentMilestone } from '../lib/core/settings.js';
import { listRecognisableBeats } from '../lib/knowledge/ledger.js';
import { buildBeatStrip } from '../lib/ui/beat-strip.js';
import { buildArcDetail } from '../lib/ui/arc-manager.js';
import { isStalled } from '../lib/ui/progress.js';

// An arc is one plot thread: its milestones run in order, the narrator gets
// only the current one, recognition sees them all (ADR-0010).

const HEADER = '[STORY ARC - NARRATIVE DIRECTION]';
const STANDING_HEADER = 'STANDING PRESSURE (the force at work in this stretch of the story — let it colour scenes as a mood, a detail or a line in passing; '
    + 'it becomes an event — an arrival, an interruption, a new agenda — only when the user\'s character goes toward it or brings it up; '
    + 'do not resolve it; what the story has already established always wins over it):';

/** Replace the chat with `length` messages carrying the message ids m0, m1, … */
function chatWithIds(length) {
    chat.length = 0;
    for (let index = 0; index < length; index++) {
        chat.push({ mes: `message ${index}`, extra: { story_arc_message_id: `msg${index}` } });
    }
}

/** Put the arcs into chat_metadata as they are, beat check on; returns the stored arcs. */
function storeArcs(...arcs) {
    chat_metadata.story_arc = { version: 1, arcs, settings: { autoTrack: true } };
    return arcs;
}

/**
 * The Paragon shape, stored the way every arc before the order rule is:
 * four milestones, all active. Perks first, the freeze-out once perks are
 * withdrawn.
 */
function storedAct(overrides = {}) {
    return {
        id: 'act00001-full-id',
        title: 'The Golden Cage',
        tier: 'act',
        focus: 'normal',
        status: 'active',
        premise: 'The firm courts her with perks it can take away.',
        messageStart: 2,
        lastFulfilledAt: 2,
        estimatedLength: 80,
        secrets: [],
        foreshadowing: [],
        triggers: [],
        worldFacts: [],
        beats: [
            { id: 'perks', pressure: 'Gifts and privileges keep arriving from the firm.', intention: 'She has accepted a perk she cannot easily give back.', status: 'active', unlockAfter: [], optional: false, phase: 'setup' },
            { id: 'strings', pressure: 'Every favour now comes with a small request.', intention: 'She has done the firm a favour she would have refused before.', status: 'active', unlockAfter: [], optional: false, phase: 'development' },
            { id: 'withdrawn', pressure: 'The perks are quietly being taken back.', intention: 'She has lost a privilege she relied on.', status: 'active', unlockAfter: [], optional: false, phase: 'escalation' },
            { id: 'frozen_out', pressure: 'Colleagues stop answering her calls.', intention: 'She has been shut out of a meeting she used to lead.', status: 'active', unlockAfter: [], optional: false, phase: 'climax' },
        ],
        ...overrides,
    };
}

function statuses(arc) {
    return arc.beats.map(beat => beat.status);
}

function textOf(html) {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
    chatWithIds(12);
});

afterEach(() => {
    delete chat_metadata.story_arc;
    chat.length = 0;
});

describe('a stored all-active act', () => {
    it('presses only its first milestone in normal focus', () => {
        const [arc] = storeArcs(storedAct());
        assert.equal(buildInjection([arc]), `${HEADER}\n\n`
            + '=== ACT: "The Golden Cage" ===\n'
            + 'PREMISE: The firm courts her with perks it can take away.\n'
            + '\n'
            + `${STANDING_HEADER}\n`
            + 'Gifts and privileges keep arriving from the firm.\n'
            + '\n[END STORY ARC]');
    });

    it('presses only its first milestone in spotlight', () => {
        const [arc] = storeArcs(storedAct({ focus: 'spotlight' }));
        const text = buildInjection([arc]);
        assert.ok(text.includes('PREMISE: The firm courts her with perks it can take away.\n\n'
            + 'BRING TO A HEAD:\n'
            + 'Gifts and privileges keep arriving from the firm.\n'
            + 'Let this pressure intensify over the coming scenes, and let the world act on its own interests.\n'), text);
        assert.equal(text.includes('Every favour now comes with a small request.'), false);
        assert.equal(text.includes('The perks are quietly being taken back.'), false);
        assert.equal(text.includes('Colleagues stop answering her calls.'), false);
    });

    it('keeps every open milestone in the beat check (tracker off) and the extraction (tracker on)', () => {
        const [arc] = storeArcs(storedAct());
        const text = buildSignalInjection([arc]);
        for (const beatId of ['perks', 'strings', 'withdrawn', 'frozen_out']) {
            assert.ok(text.includes(`<!-- [ARC_SIGNAL:act00001:${beatId}:COMPLETE] -->`), beatId);
        }
        const [listed] = listRecognisableBeats([arc]);
        assert.deepEqual(listed.active.map(entry => entry.developmentId),
            ['act00001:perks', 'act00001:strings', 'act00001:withdrawn', 'act00001:frozen_out']);
    });

    it('leaves background and paused focus as they were: no pressure at all', () => {
        const [background, paused] = storeArcs(storedAct({ focus: 'background' }), storedAct({ id: 'act00002-full-id', focus: 'paused' }));
        const text = buildInjection([background, paused]);
        assert.equal(text.includes('Gifts and privileges'), false);
        assert.ok(text.includes('=== BACKGROUND: "The Golden Cage" ===\nRuns off-screen.'));
        assert.ok(text.includes('=== PAUSED: "The Golden Cage" ===\nThe firm courts her with perks it can take away. — pending, not being pursued right now.'));
    });
});

describe('completing milestones in order', () => {
    it('makes the next milestone current once the current one completes', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'perks', at: 5 }], [arc]);
        assert.deepEqual(statuses(arc), ['completed', 'active', 'active', 'active']);
        assert.equal(currentMilestone(arc).id, 'strings');
        const text = buildInjection([arc]);
        assert.ok(text.includes(`${STANDING_HEADER}\nEvery favour now comes with a small request.\n`), text);
        assert.equal(text.includes('Gifts and privileges keep arriving from the firm.'), false);
    });
});

describe('completions in one call are applied in the order of their messages', () => {
    it('applies [strings at 9, perks at 7] as perks first, so perks is completed, not skipped', async () => {
        const [arc] = storeArcs(storedAct());
        const result = await completeBeats([
            { arcId: 'act00001', beatId: 'strings', at: 9 },
            { arcId: 'act00001', beatId: 'perks', at: 7 },
        ], [arc]);
        assert.deepEqual(result.completedBeats, ['perks', 'strings']);
        assert.deepEqual(statuses(arc), ['completed', 'completed', 'active', 'active']);
        assert.deepEqual(arc.beats[1].completion.skipped, []);
        assert.equal(arc.lastFulfilledAt, 9);
    });
});

describe('a passed milestone: open, but before a completed one', () => {
    it('is never current and its pressure is never printed; the first open one after the last completed one presses', () => {
        const arc = storedAct();
        arc.beats[1].status = 'completed';
        storeArcs(arc);
        // perks is open but passed; withdrawn is current.
        assert.equal(currentMilestone(arc).id, 'withdrawn');
        const text = buildInjection([arc]);
        assert.ok(text.includes(`${STANDING_HEADER}\nThe perks are quietly being taken back.\n`), text);
        assert.equal(text.includes('Gifts and privileges keep arriving from the firm.'), false);
    });

    it('stays recognisable', () => {
        const arc = storedAct();
        arc.beats[1].status = 'completed';
        storeArcs(arc);
        assert.ok(buildSignalInjection([arc]).includes('<!-- [ARC_SIGNAL:act00001:perks:COMPLETE] -->'));
    });

    it('leaves no current milestone, and no pressure block, when nothing open follows the last completed one', () => {
        const arc = storedAct();
        arc.beats[3].status = 'completed';
        arc.status = 'active';
        storeArcs(arc);
        assert.equal(currentMilestone(arc), null);
        assert.equal(buildInjection([arc]).includes('STANDING PRESSURE'), false);
    });
});

describe('completing a later milestone skips the earlier open ones', () => {
    it('skips the first two, records them, and makes the fourth current', async () => {
        const [arc] = storeArcs(storedAct());
        const result = await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        assert.deepEqual(result, { updated: true, completedBeats: ['withdrawn'] });
        assert.deepEqual(statuses(arc), ['skipped', 'skipped', 'completed', 'active']);
        assert.deepEqual(arc.beats[2].completion, {
            at: 6,
            messageId: 'msg6',
            unlocked: [],
            skipped: ['perks', 'strings'],
            arcCompleted: false,
            lastFulfilledBefore: 2,
        });
        assert.equal(arc.status, 'active');
        assert.equal(arc.lastFulfilledAt, 6);
        assert.equal(currentMilestone(arc).id, 'frozen_out');
        assert.ok(buildInjection([arc]).includes(`${STANDING_HEADER}\nColleagues stop answering her calls.\n`));
    });

    it('takes skipped milestones out of the beat check and the extraction', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        const text = buildSignalInjection([arc]);
        assert.equal(text.includes(':perks:COMPLETE'), false);
        assert.equal(text.includes(':strings:COMPLETE'), false);
        assert.ok(text.includes('<!-- [ARC_SIGNAL:act00001:frozen_out:COMPLETE] -->'));
        assert.deepEqual(listRecognisableBeats([arc])[0].active.map(entry => entry.beatId), ['frozen_out']);
    });

    it('ignores a later claim for a milestone a completion has skipped', async () => {
        const [arc] = storeArcs(storedAct());
        const result = await completeBeats([
            { arcId: 'act00001', beatId: 'withdrawn', at: 6 },
            { arcId: 'act00001', beatId: 'perks', at: 7 },
        ], [arc]);
        assert.deepEqual(result.completedBeats, ['withdrawn']);
        assert.deepEqual(statuses(arc), ['skipped', 'skipped', 'completed', 'active']);
    });

    it('completes the arc when the last milestone completes, the earlier open ones skipped', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'frozen_out', at: 6 }], [arc]);
        assert.deepEqual(statuses(arc), ['skipped', 'skipped', 'skipped', 'completed']);
        assert.equal(arc.status, 'completed');
        assert.equal(arc.beats[3].completion.arcCompleted, true);
    });

    it('counts skipped milestones toward the phase like completed ones', async () => {
        const [arc] = storeArcs(storedAct({ messageStart: 0, estimatedLength: 10 }));
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        // 3 of 4 closed (0.75) and 12 of 10 messages: the beats hold the phase at climax.
        assert.equal(calculatePhase(arc).phase, 'climax');
        assert.equal(calculatePhase(arc).beatRatio, 0.75);
    });
});

describe('rolling back a completion that skipped', () => {
    it('reopens the completed milestone and restores the skipped ones when the message is gone', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        chat.length = 6;

        assert.equal(reopenCompletionsFrom(6), true);

        assert.deepEqual(statuses(arc), ['active', 'active', 'active', 'active']);
        assert.equal(arc.beats[2].completion, undefined);
        assert.equal(arc.lastFulfilledAt, 2);
        assert.equal(currentMilestone(arc).id, 'perks');
    });

    it('reopens and restores on an edit of the completing message', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);

        const reopened = reopenCompletionsAt(6);

        assert.deepEqual(reopened, [{ arcId: 'act00001-full-id', beatId: 'withdrawn' }]);
        assert.deepEqual(statuses(arc), ['active', 'active', 'active', 'active']);
    });

    it('restores the arc when its last milestone completion goes', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'frozen_out', at: 6 }], [arc]);
        reopenCompletionsFrom(6);
        assert.deepEqual(statuses(arc), ['active', 'active', 'active', 'active']);
        assert.equal(arc.status, 'active');
    });

    it('undoes only the later completion\'s skips when two completions roll back in turn', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'strings', at: 5 }], [arc]);
        await completeBeats([{ arcId: 'act00001', beatId: 'frozen_out', at: 8 }], [arc]);
        assert.deepEqual(statuses(arc), ['skipped', 'completed', 'skipped', 'completed']);

        reopenCompletionsFrom(8);
        assert.deepEqual(statuses(arc), ['skipped', 'completed', 'active', 'active']);
        assert.equal(arc.lastFulfilledAt, 5);

        reopenCompletionsFrom(5);
        assert.deepEqual(statuses(arc), ['active', 'active', 'active', 'active']);
    });

    it('leaves a skipped milestone the player has set by hand since as set', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        await setBeatStatusByHand('act00001-full-id', 'perks', 'completed');
        const stored = chat_metadata.story_arc.arcs[0];

        reopenCompletionsFrom(6);

        assert.deepEqual(statuses(stored), ['completed', 'active', 'active', 'active']);
    });
});

describe('skip ownership', () => {
    it('a rollback leaves a milestone skipped while a standing completion also skipped it', async () => {
        const [arc] = storeArcs(storedAct());
        // B at 20 skips A.
        chatWithIds(30);
        await completeBeats([{ arcId: 'act00001', beatId: 'strings', at: 20 }], [arc]);
        assert.deepEqual(statuses(arc), ['skipped', 'completed', 'active', 'active']);
        // The player opens A by hand, then completes D by hand: D skips A and C.
        await setBeatStatusByHand('act00001-full-id', 'perks', 'active');
        await setBeatStatusByHand('act00001-full-id', 'frozen_out', 'completed');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.deepEqual(statuses(stored), ['skipped', 'completed', 'skipped', 'completed']);
        assert.deepEqual(stored.beats[3].completion, { byHand: true, skipped: ['perks', 'withdrawn'] });

        // Message 20 goes: B reopens, A stays skipped (D owns that skip).
        chat.length = 20;
        assert.equal(reopenCompletionsFrom(20), true);
        assert.deepEqual(statuses(stored), ['skipped', 'active', 'skipped', 'completed']);
    });
});

describe('episodes are unaffected', () => {
    it('completing a scene beat skips no earlier pending or locked beat and records no skip', async () => {
        const [episode] = storeArcs({
            id: 'epi00001-full-id',
            title: 'One Night',
            tier: 'episode',
            focus: 'normal',
            status: 'active',
            messageStart: 2,
            lastFulfilledAt: 2,
            estimatedLength: 20,
            beats: [
                { id: 'b1', intention: 'first', status: 'locked', unlockAfter: ['b9'], optional: false },
                { id: 'b2', intention: 'second', status: 'pending', unlockAfter: [], optional: false },
                { id: 'b3', intention: 'third', status: 'active', unlockAfter: [], optional: false },
            ],
        });
        await completeBeats([{ arcId: 'epi00001', beatId: 'b3', at: 5 }], [episode]);
        assert.deepEqual(statuses(episode), ['locked', 'pending', 'completed']);
        assert.deepEqual(episode.beats[2].completion.skipped, []);
        assert.equal(episode.status, 'active');
    });
});

describe('by hand', () => {
    it('completing a later milestone by hand skips the earlier open ones', async () => {
        storeArcs(storedAct());
        await setBeatStatusByHand('act00001-full-id', 'withdrawn', 'completed');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.deepEqual(statuses(stored), ['skipped', 'skipped', 'completed', 'active']);
        assert.equal(stored.beats[0].completion, undefined);
        assert.deepEqual(stored.beats[2].completion, { byHand: true, skipped: ['perks', 'strings'] });
    });

    it('setting a skipped milestone open makes it open, but passed: the next one after the completed one stays current', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        await setBeatStatusByHand('act00001-full-id', 'perks', 'active');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.deepEqual(statuses(stored), ['active', 'skipped', 'completed', 'active']);
        assert.equal(currentMilestone(stored).id, 'frozen_out');
    });

    it('setting a hand-completed milestone open gives back what it skipped', async () => {
        storeArcs(storedAct());
        await setBeatStatusByHand('act00001-full-id', 'withdrawn', 'completed');
        await setBeatStatusByHand('act00001-full-id', 'withdrawn', 'active');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.deepEqual(statuses(stored), ['active', 'active', 'active', 'active']);
        assert.equal(stored.beats[2].completion, undefined);
        assert.equal(currentMilestone(stored).id, 'perks');
    });

    it('setting a recognised completion open gives back what it skipped', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        await setBeatStatusByHand('act00001-full-id', 'withdrawn', 'active');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.deepEqual(statuses(stored), ['active', 'active', 'active', 'active']);
    });

    it('a rollback never reopens a hand completion', async () => {
        storeArcs(storedAct());
        await setBeatStatusByHand('act00001-full-id', 'withdrawn', 'completed');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.equal(reopenCompletionsFrom(0), false);
        assert.deepEqual(reopenCompletionsAt(11), []);
        assert.deepEqual(statuses(stored), ['skipped', 'skipped', 'completed', 'active']);
    });
});

describe('the stall rule', () => {
    it('counts from the message whose completion skipped, as from any fulfillment', async () => {
        // 4 milestones over 80 messages: stalled after 3 × 20 = 60 messages without one.
        const [arc] = storeArcs(storedAct());
        assert.equal(isStalled(arc, 63), true);
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        assert.equal(isStalled(arc, 63), false);
        assert.equal(isStalled(arc, 66), false);
        assert.equal(isStalled(arc, 67), true);
    });
});

describe('skipped in the Arc Manager and the progress rows', () => {
    it('the beat strip draws a skipped milestone faded, says why, and counts it as done or skipped', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'withdrawn', at: 6 }], [arc]);
        const html = buildBeatStrip(arc, [], true);
        assert.ok(html.includes('class="am-cell s-skipped"'));
        assert.ok(html.includes('<i class="fa-solid fa-forward" aria-hidden="true"></i>'));
        assert.ok(html.includes('aria-label="Milestone 1 of 4 · Setup · Skipped — the story moved past it"'));
        assert.ok(html.includes('aria-label="Milestone 3 of 4 · Escalation · Done"'));
        assert.ok(textOf(html).endsWith('3 /4 done or skipped'), textOf(html));
    });

    it('the beat strip keeps "done" while nothing is skipped', () => {
        const [arc] = storeArcs(storedAct());
        assert.ok(textOf(buildBeatStrip(arc, [], false)).endsWith('0 /4 done'));
    });

    it('the detail names the current and the skipped milestones and offers Skipped in the status control', async () => {
        const [arc] = storeArcs(storedAct());
        await completeBeats([{ arcId: 'act00001', beatId: 'strings', at: 6 }], [arc]);
        const html = buildArcDetail(arc, { activeArcs: [arc], pendingMarks: [], view: { revealed: new Set() } });
        const text = textOf(html);
        assert.ok(text.includes('Milestone 1 Setup · skipped — the story moved past it Status of milestone 1 Open Skipped Done'), text);
        assert.ok(text.includes('Milestone 3 Escalation · current, its pressure reaches the narrator Status of milestone 3 Open Skipped Done'), text);
        assert.ok(text.includes('Milestones · in order, the first open one presses'), text);
        assert.match(html, /value="skipped" data-beat-status="act00001-full-id" data-beat="perks" checked/);
    });
});

describe('the current label in the Arc Manager detail', () => {
    function detailText(arc) {
        storeArcs(arc);
        return textOf(buildArcDetail(arc, { activeArcs: [arc], pendingMarks: [], view: { revealed: new Set() } }));
    }

    it('names the narrator only in normal and spotlight focus', () => {
        for (const focus of ['normal', 'spotlight']) {
            assert.ok(detailText(storedAct({ focus })).includes('Milestone 1 Setup · current, its pressure reaches the narrator Status of milestone 1'), focus);
        }
    });

    it('says only "current" in background and paused focus', () => {
        for (const focus of ['background', 'paused']) {
            const text = detailText(storedAct({ focus }));
            assert.ok(text.includes('Milestone 1 Setup · current Status of milestone 1'), focus);
            assert.equal(text.includes('reaches the narrator'), false, focus);
        }
    });

    it('marks no milestone current on a past arc', () => {
        assert.equal(detailText(storedAct({ status: 'abandoned' })).includes('current'), false);
    });
});
