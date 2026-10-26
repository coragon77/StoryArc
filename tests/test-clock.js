import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { selectPacingClock, pauseArc, resumeArc, spotlightArc } from '../lib/injection/clock.js';
import { buildStamp } from '../lib/injection/stamping.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

function arc(id, tier, focus) {
    return { id, title: id, status: 'active', tier, focus, messageStart: 0, estimatedLength: 40, beats: [] };
}

describe('selectPacingClock', () => {
    it('picks the first normal episode in storage order', () => {
        const clock = selectPacingClock([arc('one', 'episode', 'normal'), arc('two', 'episode', 'normal')]);
        assert.equal(clock.id, 'one');
    });

    it('never picks a paused episode', () => {
        const clock = selectPacingClock([arc('paused', 'episode', 'paused'), arc('live', 'episode', 'normal')]);
        assert.equal(clock.id, 'live');
    });

    it('never picks an act or a saga', () => {
        const clock = selectPacingClock([arc('act', 'act', 'normal'), arc('saga', 'saga', 'spotlight'), arc('ep', 'episode', 'normal')]);
        assert.equal(clock.id, 'ep');
    });

    it('prefers the spotlit episode over an earlier normal one', () => {
        const clock = selectPacingClock([arc('first', 'episode', 'normal'), arc('lit', 'episode', 'spotlight')]);
        assert.equal(clock.id, 'lit');
    });

    it('treats an arc without a tier (planned before tiers) as an episode', () => {
        const untiered = arc('old', undefined, 'normal');
        delete untiered.tier;
        assert.equal(selectPacingClock([arc('act', 'act', 'normal'), untiered]).id, 'old');
    });

    it('returns undefined when no episode can be the clock', () => {
        assert.equal(selectPacingClock([arc('paused', 'episode', 'paused'), arc('act', 'act', 'normal')]), undefined);
        assert.equal(selectPacingClock([]), undefined);
    });
});

describe('pauseArc / resumeArc — clock freeze', () => {
    beforeEach(() => {
        chat.length = 0;
        chat_metadata.story_arc = {
            version: 1,
            arcs: [{ ...arc('a', 'episode', 'normal'), messageStart: 88, pausedAt: null, lastFulfilledAt: 92 }],
            settings: {},
        };
    });

    function stored() {
        return chat_metadata.story_arc.arcs[0];
    }

    it('pauseArc records the chat length and writes focus paused', async () => {
        chat.length = 100;
        await pauseArc('a');
        assert.equal(stored().focus, 'paused');
        assert.equal(stored().pausedAt, 100);
        assert.equal(stored().messageStart, 88);
        assert.equal(stored().lastFulfilledAt, 92);
    });

    it('pausing an already paused arc keeps the original freeze point', async () => {
        chat.length = 100;
        await pauseArc('a');
        chat.length = 130;
        await pauseArc('a');
        assert.equal(stored().pausedAt, 100);
    });

    it('resumeArc shifts messageStart and lastFulfilledAt by the paused span and clears pausedAt', async () => {
        chat.length = 100;
        await pauseArc('a');
        chat.length = 115;
        await resumeArc('a', 'spotlight');
        assert.equal(stored().focus, 'spotlight');
        assert.equal(stored().pausedAt, null);
        assert.equal(stored().messageStart, 103);
        assert.equal(stored().lastFulfilledAt, 107);
    });

    it('the stamp number continues where it stopped (message 12 before and after)', async () => {
        chat.length = 100;
        assert.equal(buildStamp(stored(), 99), '[Arc: message 12 of ~40]');
        await pauseArc('a');
        chat.length = 115;
        await resumeArc('a');
        assert.equal(buildStamp(stored(), 114), '[Arc: message 12 of ~40]');
    });

    it('resumeArc defaults to normal', async () => {
        chat.length = 100;
        await pauseArc('a');
        await resumeArc('a');
        assert.equal(stored().focus, 'normal');
    });

    it('resuming a never-paused arc writes the focus but leaves the clock alone', async () => {
        chat.length = 150;
        await resumeArc('a', 'spotlight');
        assert.equal(stored().focus, 'spotlight');
        assert.equal(stored().pausedAt, null);
        assert.equal(stored().messageStart, 88);
        assert.equal(stored().lastFulfilledAt, 92);
    });

    it('resuming twice in a row shifts the clock once', async () => {
        chat.length = 100;
        await pauseArc('a');
        chat.length = 115;
        await resumeArc('a');
        chat.length = 140;
        await resumeArc('a', 'spotlight');
        assert.equal(stored().focus, 'spotlight');
        assert.equal(stored().messageStart, 103);
        assert.equal(stored().lastFulfilledAt, 107);
    });

    it('resumes a migrated background arc, which has pausedAt but no lastFulfilledAt', async () => {
        chat_metadata.story_arc.arcs = [{ ...arc('old', 'episode', 'paused'), messageStart: 10, pausedAt: 50 }];
        chat.length = 70;
        await resumeArc('old');
        assert.equal(stored().focus, 'normal');
        assert.equal(stored().pausedAt, null);
        assert.equal(stored().messageStart, 30);
        assert.equal(stored().lastFulfilledAt, undefined);
    });

    it('pauseArc on an unknown arc changes nothing and does not throw', async () => {
        chat.length = 100;
        await pauseArc('nope');
        assert.equal(stored().focus, 'normal');
        assert.equal(stored().pausedAt, null);
        assert.equal(chat_metadata.story_arc.arcs.length, 1);
    });

    it('resumeArc on an unknown arc changes nothing', async () => {
        chat.length = 100;
        await resumeArc('nope');
        assert.equal(stored().messageStart, 88);
        assert.equal(stored().focus, 'normal');
    });
});

describe('spotlightArc — one arc in the spotlight', () => {
    beforeEach(() => {
        chat.length = 0;
        chat_metadata.story_arc = {
            version: 1,
            arcs: [
                { ...arc('lit', 'saga', 'spotlight'), pausedAt: null },
                { ...arc('quiet', 'act', 'normal'), pausedAt: null },
                { ...arc('done', 'saga', 'spotlight'), status: 'completed', pausedAt: null },
                { ...arc('off', 'saga', 'background'), pausedAt: null },
            ],
            settings: {},
        };
    });

    function focusOf(id) {
        return chat_metadata.story_arc.arcs.find(a => a.id === id).focus;
    }

    it('spotlights the arc and sends the previous spotlit arc back to normal', async () => {
        await spotlightArc('quiet');
        assert.equal(focusOf('quiet'), 'spotlight');
        assert.equal(focusOf('lit'), 'normal');
    });

    it('leaves arcs that are not active, and other focus values, alone', async () => {
        await spotlightArc('quiet');
        assert.equal(focusOf('done'), 'spotlight');
        assert.equal(focusOf('off'), 'background');
    });

    it('moves only the previously spotlit arc: a paused arc keeps its focus and its freeze point', async () => {
        chat_metadata.story_arc.arcs.push({ ...arc('resting', 'episode', 'paused'), pausedAt: 60, messageStart: 20 });
        chat.length = 130;
        await spotlightArc('quiet');
        const resting = chat_metadata.story_arc.arcs.find(a => a.id === 'resting');
        assert.equal(resting.focus, 'paused');
        assert.equal(resting.pausedAt, 60);
        assert.equal(resting.messageStart, 20);
        assert.equal(focusOf('off'), 'background');
        assert.equal(focusOf('lit'), 'normal');
    });

    it('keeps the arc spotlit when it already was', async () => {
        await spotlightArc('lit');
        assert.equal(focusOf('lit'), 'spotlight');
    });

    it('shifts the clock of a paused arc it spotlights', async () => {
        const quiet = chat_metadata.story_arc.arcs.find(a => a.id === 'quiet');
        Object.assign(quiet, { focus: 'paused', pausedAt: 100, messageStart: 40 });
        chat.length = 130;
        await spotlightArc('quiet');
        assert.equal(focusOf('quiet'), 'spotlight');
        assert.equal(quiet.pausedAt, null);
        assert.equal(quiet.messageStart, 70);
        assert.equal(focusOf('lit'), 'normal');
    });
});
