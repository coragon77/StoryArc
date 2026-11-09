import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chat, chat_metadata } from './mocks/st-mocks.js';
import {
    buildArcAlert, buildArcDetail, buildFocusControl, buildLastBeatCell, buildManagerContent, buildPlanList,
    buildSummary, describeWhatNarratorGets, endArcUndoSession, newestArcEditLabel, runArcEdit, sortActiveArcs,
    startArcUndoSession, undoArcEdit,
} from '../lib/ui/arc-manager.js';
import { buildBeatStrip } from '../lib/ui/beat-strip.js';
import { pauseArc } from '../lib/injection/clock.js';
import { updateArc } from '../lib/planning/storage.js';

/** The visible text of rendered HTML: tags dropped, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The <li> of the plan item with this id. */
function itemOf(html, itemId) {
    return html.split('<li>').find(chunk => chunk.includes(`data-item="${itemId}"`)) || '';
}

function makeAct(overrides = {}) {
    return {
        id: 'act-1',
        title: 'The Long Winter',
        premise: 'The guild starves the city.',
        status: 'active',
        tier: 'act',
        focus: 'normal',
        createdAt: '2026-10-01T00:00:00.000Z',
        messageStart: 2000,
        lastFulfilledAt: 2000,
        estimatedLength: 90,
        beats: [
            { id: 'm1', phase: 'setup', status: 'completed', pressure: 'Hunger grows.', intention: 'A riot broke out.' },
            { id: 'm2', phase: 'development', status: 'active', pressure: 'The guild hoards.', intention: 'The granary was found.' },
            { id: 'm3', phase: 'climax', status: 'active', pressure: 'The city turns.', intention: 'The guild fell.' },
        ],
        secrets: [
            { id: 'guild_theft', content: 'The guild emptied the granary.', revealPhase: 'escalation', disclosed: false },
            { id: 'quartermaster_sales', content: 'The quartermaster sells to the Syndicate.', revealPhase: 'development', disclosed: true },
        ],
        foreshadowing: [
            { id: 'covered_lamps', clue: 'Carts leave at night with covered lamps.', planted: false },
        ],
        triggers: [
            { id: 'debt_paid', condition: 'she pays the debt', action: 'the debt doubles', fired: true },
            { id: 'voss_accused', condition: 'the player accuses Voss', action: 'Voss answers with cold anger', fired: false },
            { id: 'sacks_counted', condition: 'anyone counts the sacks', action: 'the clerk goes pale', fired: false },
        ],
        ...overrides,
    };
}

function makeEpisode(overrides = {}) {
    return {
        id: 'ep-1',
        title: 'The Night Market',
        premise: 'A deal at the market.',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        createdAt: '2026-10-20T00:00:00.000Z',
        messageStart: 2080,
        lastFulfilledAt: 2085,
        estimatedLength: 12,
        beats: [
            { id: 'b1', phase: 'setup', status: 'completed', pressure: 'A stranger waits.', intention: 'They met.' },
            { id: 'b2', phase: 'development', status: 'active', pressure: 'The price rises.', intention: 'A price was named.' },
            { id: 'b3', phase: 'climax', status: 'locked', pressure: 'Guards close in.', intention: 'Guards arrived.', unlockAfter: ['b2'] },
        ],
        secrets: [],
        foreshadowing: [],
        triggers: [],
        ...overrides,
    };
}

const marks = [
    { arcId: 'act-1', list: 'triggers', flag: 'fired', id: 'sacks_counted', at: 2090 },
    { arcId: 'act-1', list: 'triggers', flag: 'fired', id: 'debt_paid', at: 2091 },
    { arcId: 'other-arc', list: 'triggers', flag: 'fired', id: 'voss_accused', at: 2092 },
];

const view = () => ({ activeOrder: ['act-1'], expanded: new Set(), revealed: new Set(), trackerOn: true });

beforeEach(() => {
    chat.length = 2101;
});

afterEach(() => {
    chat.length = 0;
    delete chat_metadata.story_arc;
});

describe('buildPlanList', () => {
    it('lists the waiting item first, then the open one, then the done one', () => {
        const text = textOf(buildPlanList(makeAct(), 'triggers', marks, false));
        const waiting = text.indexOf('IF anyone counts the sacks');
        const open = text.indexOf('IF the player accuses Voss');
        const done = text.indexOf('IF she pays the debt');
        assert.ok(waiting >= 0 && waiting < open && open < done, text);
    });

    it('counts done and waiting items in its heading; a mark on a done item waits for nothing', () => {
        const text = textOf(buildPlanList(makeAct(), 'triggers', marks, false));
        assert.ok(text.startsWith('Triggers · 1 of 3 happened · 1 waiting'), text);
    });

    it('names when a waiting item was reported and offers Drop report on it only', () => {
        const html = buildPlanList(makeAct(), 'triggers', marks, false);
        assert.ok(textOf(itemOf(html, 'sacks_counted')).includes('Reported as happened at #2,090, waiting to be applied Drop report'));
        assert.equal(itemOf(html, 'voss_accused').includes('drop-report'), false);
    });

    it('ignores a queued mark of another arc', () => {
        const html = buildPlanList(makeAct(), 'triggers', marks, false);
        assert.equal(itemOf(html, 'voss_accused').includes('Reported'), false);
    });

    it('shows a past arc read-only: disabled boxes, no reports', () => {
        const html = buildPlanList(makeAct({ status: 'completed' }), 'triggers', marks, true);
        assert.equal((html.match(/ disabled>/g) || []).length, 3);
        assert.equal(html.includes('Reported'), false);
    });

    it('says when the plan has none', () => {
        assert.ok(textOf(buildPlanList(makeEpisode(), 'secrets', [], false)).includes('Secrets · 0 of 0 revealed None in this plan.'));
    });
});

describe('buildBeatStrip', () => {
    it('one cell per beat, its status in its label, the non-optional done count and the waiting reports', () => {
        const html = buildBeatStrip(makeAct(), marks, true);
        assert.ok(html.includes('aria-label="Milestone 1 of 3 · Setup · Done"'));
        assert.ok(html.includes('aria-label="Milestone 2 of 3 · Development · Open"'));
        assert.ok(textOf(html).endsWith('1 /3 done 1 report waiting'), textOf(html));
    });

    it('a scene beat is pending, active or locked, each a shape of its own', () => {
        const html = buildBeatStrip(makeEpisode(), [], true);
        assert.ok(html.includes('class="am-cell s-completed"'));
        assert.ok(html.includes('class="am-cell s-active"'));
        assert.ok(html.includes('class="am-cell s-locked"'));
        assert.ok(html.includes('aria-label="Scene beat 3 of 3 · Climax · Locked"'));
    });

    it('a past arc\'s strip is read-only and shows no reports', () => {
        const html = buildBeatStrip(makeAct({ status: 'abandoned' }), marks, false);
        assert.equal(html.includes('data-act="cell"'), false);
        assert.equal(html.includes('waiting'), false);
    });
});

describe('buildFocusControl', () => {
    it('offers an episode no background focus: the option is disabled', () => {
        const html = buildFocusControl(makeEpisode());
        assert.match(html, /value="background" data-focus="ep-1"\s+disabled/);
        assert.ok(html.includes('(not for episodes)'));
    });

    it('checks the arc\'s focus', () => {
        assert.match(buildFocusControl(makeAct({ focus: 'spotlight' })), /value="spotlight" data-focus="act-1" checked/);
    });
});

describe('buildArcAlert — the warning line', () => {
    it('quotes the newest open ruling, counts the earlier ones and offers Re-plan only', () => {
        const arc = makeAct({
            rulings: [
                { id: 'r1', text: 'Voss is innocent.', at: 2050 },
                { id: 'r2', text: 'The guild has no granary.', at: 2095 },
                { id: 'r3', text: 'Answered long ago.', at: 2010, answeredAt: 2020 },
            ],
        });
        const html = buildArcAlert(arc);
        assert.equal(textOf(html), 'You overruled the plan — re-plan? The guild has no granary. at #2,095, and 1 earlier. Every re-plan follows your rulings as binding. Re-plan');
        assert.ok(html.includes('data-act="replan" data-id="act-1"'));
    });

    it('with every required beat done, notes that the arc is still in the prompt and offers Complete it and Re-plan', () => {
        const arc = makeAct({ beats: [{ id: 'm1', status: 'completed' }, { id: 'm2', status: 'active', optional: true }] });
        assert.equal(textOf(buildArcAlert(arc)), 'Every milestone is done, and the arc is still active, so the narrator keeps getting it. Complete it Re-plan');
    });

    it('a stall: how long no beat landed, how often one is due, and Re-plan, Spotlight it, Ignore', () => {
        // 3 required milestones over ~90 messages: one due every 30; stalled after 90 since 2000.
        const html = buildArcAlert(makeAct());
        assert.equal(textOf(html), 'No milestone in 100 messages — about one is due every 30. Re-plan Spotlight it Ignore');
    });

    it('a spotlit stalled arc gets no Spotlight it, and the sentence says what the spotlight does', () => {
        const text = textOf(buildArcAlert(makeAct({ focus: 'spotlight' })));
        assert.equal(text, 'No milestone in 100 messages — about one is due every 30. It is in the spotlight, so the narrator brings its current milestone to a head. Re-plan Ignore');
    });

    it('an ignored stall shows no warning, but the last-beat cell says it is hidden and offers Show', () => {
        const arc = makeAct({ stallIgnoredFrom: 2000 });
        assert.equal(buildArcAlert(arc), '');
        assert.ok(textOf(buildLastBeatCell(arc)).endsWith('Stall warning hidden until the next milestone · Show'));
    });

    it('an arc that needs nothing has no warning line', () => {
        assert.equal(buildArcAlert(makeAct({ lastFulfilledAt: 2090 })), '');
    });
});

describe('buildArcAlert — the notice of an episode planned before world facts', () => {
    const NOTICE = 'Its directives, rules and tone are no longer sent to the narrator. Re-plan it to give it world facts instead.';

    it('an episode with directives, rules or tone and no world facts gets the notice, with no button', () => {
        const oldEpisodes = [
            makeEpisode({ lastFulfilledAt: 2099, directives: ['Keep it intimate.'], antiPatterns: [], tone: '' }),
            makeEpisode({ lastFulfilledAt: 2099, directives: [], antiPatterns: ['No sudden villains.'], tone: '' }),
            makeEpisode({ lastFulfilledAt: 2099, directives: [], antiPatterns: [], tone: 'Slow dread.' }),
        ];
        for (const episode of oldEpisodes) {
            const html = buildArcAlert(episode);
            assert.equal(textOf(html), NOTICE);
            assert.equal(html.includes('<button'), false);
        }
    });

    it('comes after the warning line of a stalled episode', () => {
        const episode = makeEpisode({ directives: ['Keep it intimate.'] });
        const text = textOf(buildArcAlert(episode));
        assert.ok(text.startsWith('No scene beat in '), text);
        assert.ok(text.endsWith(`Ignore ${NOTICE}`), text);
    });

    it('an act with directives, rules and tone gets no notice', () => {
        const act = makeAct({ lastFulfilledAt: 2090, directives: ['Keep it grim.'], antiPatterns: ['No sudden villains.'], tone: 'Slow dread.' });
        assert.equal(buildArcAlert(act), '');
    });

    it('an episode with world facts gets no notice, whatever else it carries', () => {
        const episode = makeEpisode({
            lastFulfilledAt: 2099, directives: ['Keep it intimate.'], antiPatterns: ['No sudden villains.'], tone: 'Slow dread.',
            worldFacts: ['The market closes at dawn.'],
        });
        assert.equal(buildArcAlert(episode), '');
    });

    it('a fresh or re-planned episode with an empty world-facts list and a tone gets no notice', () => {
        const episode = makeEpisode({ lastFulfilledAt: 2099, worldFacts: [], directives: [], antiPatterns: [], tone: 'Slow dread.' });
        assert.equal(buildArcAlert(episode), '');
    });

    it('an episode with nothing in those fields gets no notice', () => {
        assert.equal(buildArcAlert(makeEpisode({ lastFulfilledAt: 2099, directives: [], antiPatterns: [], tone: '' })), '');
        assert.equal(buildArcAlert(makeEpisode({ lastFulfilledAt: 2099 })), '');
    });
});

describe('buildLastBeatCell', () => {
    it('where the last beat landed and how long ago', () => {
        assert.equal(textOf(buildLastBeatCell(makeEpisode())), '#2,085 15 messages ago');
    });

    it('none yet while no beat is done, with where the arc started', () => {
        const arc = makeEpisode({ lastFulfilledAt: 2080, beats: [{ id: 'b1', status: 'active' }] });
        assert.equal(textOf(buildLastBeatCell(arc)), 'None yet arc started at #2,080');
    });

    it('a paused arc: where it was paused, and that its clock stands still', () => {
        const arc = makeEpisode({ focus: 'paused', pausedAt: 2090 });
        assert.equal(textOf(buildLastBeatCell(arc)), 'Paused at #2,090 clock stands still last scene beat #2,085');
    });

    it('a reactivated arc says where it was reactivated', () => {
        const arc = makeEpisode({ messageStart: 2095, reactivatedAt: 2095 });
        assert.equal(textOf(buildLastBeatCell(arc)), '#2,085 15 messages ago reactivated at #2,095');
    });
});

describe('buildSummary', () => {
    it('counts the arcs, names the spotlit one, says when the last beat landed and how many need the player (both stalled)', () => {
        const arcs = [makeAct({ focus: 'spotlight' }), makeEpisode(), makeEpisode({ id: 'ep-2', focus: 'paused', lastFulfilledAt: 2050 })];
        assert.equal(textOf(buildSummary(arcs)), '3 active arcs · The Long Winter in the spotlight · 1 paused · last beat 15 messages ago · 2 need you · chat at #2,100');
    });

    it('no active arc', () => {
        assert.equal(buildSummary([]), 'No active arc · chat at #2,100');
    });
});

describe('describeWhatNarratorGets', () => {
    it('a normal act: its premise and its current milestone\'s pressure as mood', () => {
        assert.equal(textOf(describeWhatNarratorGets(makeAct(), [])), 'its premise and the current milestone\'s pressure , as mood. No secrets, triggers or clues.');
    });

    it('a spotlit act: its current milestone\'s pressure to bring to a head plus its open plan items, no named target', () => {
        assert.equal(textOf(describeWhatNarratorGets(makeAct({ focus: 'spotlight' }), [])),
            'its premise and the current milestone\'s pressure to bring to a head , plus 1 secret as its phase allows, 2 triggers and 1 clue to plant. No milestone is named as a target.');
    });

    it('a background act: its title only', () => {
        assert.ok(textOf(describeWhatNarratorGets(makeAct({ focus: 'background' }), [])).startsWith('its title only , with orders to keep it off-screen'));
    });

    it('the episode that is the pacing clock says so', () => {
        const episode = makeEpisode();
        assert.equal(textOf(describeWhatNarratorGets(episode, [episode])),
            'its premise and the current scene beat\'s pressure , with pacing rules. It is the pacing clock, so the phase brake counts its messages.');
    });

    it('an episode with world facts counts every one', () => {
        const episode = makeEpisode({ worldFacts: ['The market closes at dawn.', 'The guards take bribes.'] });
        assert.equal(textOf(describeWhatNarratorGets(episode, [])),
            'its premise, 2 world facts and the current scene beat\'s pressure , with pacing rules.');
    });

    it('an act with four world facts counts all four, normal and spotlit', () => {
        const worldFacts = ['First fact.', 'Second fact.', 'Third fact.', 'Fourth fact.'];
        assert.equal(textOf(describeWhatNarratorGets(makeAct({ worldFacts }), [])),
            'its premise, 4 world facts and the current milestone\'s pressure , as mood. No secrets, triggers or clues.');
        assert.equal(textOf(describeWhatNarratorGets(makeAct({ worldFacts, focus: 'spotlight' }), [])),
            'its premise, 4 world facts and the current milestone\'s pressure to bring to a head , plus 1 secret as its phase allows, 2 triggers and 1 clue to plant. No milestone is named as a target.');
    });
});

describe('buildManagerContent — the pacing clock in the narrator line', () => {
    it('names the first normal episode in storage order, not the first row of the table', () => {
        const older = makeEpisode({ id: 'ep-old', title: 'Older', createdAt: '2026-10-01T00:00:00.000Z' });
        const newer = makeEpisode({ id: 'ep-new', title: 'Newer', createdAt: '2026-10-25T00:00:00.000Z' });
        const arcs = [older, newer];
        const tableView = { activeOrder: ['ep-new', 'ep-old'], expanded: new Set(['ep-old', 'ep-new']), revealed: new Set(), trackerOn: true };
        const html = buildManagerContent(arcs, [], tableView);
        const getsOf = id => textOf(html.split(`data-gets="${id}">`)[1].split('</p>')[0]);
        assert.ok(getsOf('ep-old').endsWith('It is the pacing clock, so the phase brake counts its messages.'), getsOf('ep-old'));
        assert.equal(getsOf('ep-new').includes('pacing clock'), false);
    });
});

describe('buildArcDetail — the plan behind the Reveal switch', () => {
    it('marks every piece of plan text plan-only, and starts hidden', () => {
        const html = buildArcDetail(makeAct(), { activeArcs: [], pendingMarks: [], view: view() });
        assert.ok(html.startsWith('<div class="am-detail " data-detail="act-1">'));
        assert.match(html, /<dl class="am-beat-text am-plan-only">\s*<div><dt>Pressure<\/dt><dd data-f="pressure">Hunger grows\.<\/dd>/);
        assert.match(html, /<div class="am-plan-only am-form">\s*<label for="am-pp-act-1">Premise<\/label>/);
        assert.ok(html.includes('<section class="am-sec am-sec-wide am-plan-only" aria-labelledby="am-sh-act-1">'));
        assert.ok(textOf(html).includes('Reveal plan hidden Spoilers. The premise, every pressure and fulfillment, 2 secrets, 1 clue and 3 triggers stay hidden until you switch this on.'));
    });

    it('escapes a stored phase and status it does not know', () => {
        const arc = makeAct({ status: 'completed', beats: [{ id: 'm1', phase: '<img src=x>', status: '<b>odd</b>', pressure: 'p', intention: 'i' }] });
        const html = buildArcDetail(arc, { activeArcs: [], pendingMarks: [], view: view() });
        assert.equal(html.includes('<img src=x>'), false);
        assert.equal(html.includes('<b>odd</b>'), false);
        assert.ok(html.includes('&lt;img src=x&gt;'));
        assert.ok(html.includes('&lt;b&gt;odd&lt;/b&gt;'));
    });

    it('a revealed arc starts shown', () => {
        const revealedView = { ...view(), revealed: new Set(['act-1']) };
        assert.ok(buildArcDetail(makeAct(), { activeArcs: [], pendingMarks: [], view: revealedView }).startsWith('<div class="am-detail is-revealed"'));
    });
});

describe('buildManagerContent', () => {
    it('without an active arc: the empty state, which offers the past arcs', () => {
        const html = buildManagerContent([makeAct({ status: 'abandoned' })], [], { ...view(), activeOrder: [] });
        const text = textOf(html);
        assert.ok(text.includes('No arc is steering the story'), text);
        assert.ok(text.includes('Or bring one back: 1 past arc below can be reactivated. Show past arcs'), text);
        assert.ok(text.includes('Past arcs (1 · 0 completed, 1 abandoned)'), text);
    });

    it('names the beats with the tier word of the arcs the table lists, beat when tiers mix', () => {
        const actsOnly = textOf(buildManagerContent([makeAct()], [], view()));
        assert.ok(actsOnly.includes('Phase Milestones Last milestone landed'), actsOnly);
        const mixed = textOf(buildManagerContent([makeAct(), makeEpisode()], [], { ...view(), activeOrder: ['act-1', 'ep-1'] }));
        assert.ok(mixed.includes('Phase Beats Last beat landed'), mixed);
    });

    it('the Knowledge button only while the tracker is on', () => {
        assert.ok(buildManagerContent([makeAct()], [], view()).includes('data-act="knowledge"'));
        assert.equal(buildManagerContent([makeAct()], [], { ...view(), trackerOn: false }).includes('data-act="knowledge"'), false);
    });
});

describe('sortActiveArcs', () => {
    it('spotlight, normal, background, paused; within a focus episode, act, saga; then the newest first', () => {
        const arcs = [
            makeAct({ id: 'paused-act', focus: 'paused' }),
            makeAct({ id: 'old-act' }),
            makeEpisode({ id: 'ep' }),
            makeAct({ id: 'new-act', createdAt: '2026-10-30T00:00:00.000Z' }),
            makeAct({ id: 'saga', tier: 'saga' }),
            makeAct({ id: 'lit', tier: 'saga', focus: 'spotlight' }),
            makeAct({ id: 'off', focus: 'background' }),
        ];
        assert.deepEqual(sortActiveArcs(arcs).map(arc => arc.id), ['lit', 'ep', 'new-act', 'old-act', 'saga', 'off', 'paused-act']);
    });
});

describe('Arc Manager undo', () => {
    let previousJquery;

    beforeEach(() => {
        // No progress card on the page: updateProgress finds nothing to redraw.
        previousJquery = globalThis.$;
        globalThis.$ = () => ({ length: 0 });
        chat.length = 2101;
        chat_metadata.story_arc = { version: 1, arcs: [makeAct(), makeEpisode()], pendingMarks: [marks[0]], settings: {} };
        startArcUndoSession();
    });

    afterEach(() => {
        endArcUndoSession();
        globalThis.$ = previousJquery;
    });

    const stored = id => chat_metadata.story_arc.arcs.find(arc => arc.id === id);

    it('undoes a focus change: the arc is back in normal focus with no freeze point', async () => {
        await runArcEdit('Paused: The Long Winter', () => pauseArc('act-1'));
        assert.equal(stored('act-1').pausedAt, 2101);
        assert.equal(newestArcEditLabel(), 'Paused: The Long Winter');

        assert.deepEqual(await undoArcEdit(), { error: null, label: 'Paused: The Long Winter' });
        assert.deepEqual(stored('act-1'), makeAct());
        assert.equal(newestArcEditLabel(), null);
    });

    it('undoes an abandon, then the focus change before it, newest first', async () => {
        await runArcEdit('Paused: The Night Market', () => pauseArc('ep-1'));
        await runArcEdit('Abandoned The Night Market', () => updateArc('ep-1', { status: 'abandoned' }));

        assert.equal((await undoArcEdit()).label, 'Abandoned The Night Market');
        assert.equal(stored('ep-1').status, 'active');
        assert.equal(stored('ep-1').focus, 'paused');
        assert.equal((await undoArcEdit()).label, 'Paused: The Night Market');
        assert.deepEqual(stored('ep-1'), makeEpisode());
    });

    it('brings a dropped report back with the undo', async () => {
        await runArcEdit('Dropped the report', async () => { chat_metadata.story_arc.pendingMarks = []; });
        await undoArcEdit();
        assert.deepEqual(chat_metadata.story_arc.pendingMarks, [marks[0]]);
    });

    it('refuses when the extraction changed the arc since, changes nothing and drops the stack', async () => {
        await runArcEdit('Paused: The Long Winter', () => pauseArc('ep-1'));
        await runArcEdit('Abandoned The Long Winter', () => updateArc('act-1', { status: 'abandoned' }));
        // A reply came in and its extraction completed a milestone of the act
        stored('act-1').beats[1].status = 'completed';

        const { error, label } = await undoArcEdit();
        assert.equal(label, 'Abandoned The Long Winter');
        assert.equal(error, 'the arcs changed since (an update ran after a reply, a swipe or a deleted message). Nothing was changed; edit it by hand instead.');
        assert.equal(stored('act-1').status, 'abandoned');
        assert.equal(stored('act-1').beats[1].status, 'completed');
        assert.deepEqual(await undoArcEdit(), { error: 'Nothing to undo.', label: null });
        assert.equal(stored('ep-1').focus, 'paused');
    });

    it('records nothing while no Arc Manager is open', async () => {
        endArcUndoSession();
        await runArcEdit('Paused', () => pauseArc('act-1'));
        assert.equal(newestArcEditLabel(), null);
        assert.equal(stored('act-1').focus, 'paused');
    });
});
