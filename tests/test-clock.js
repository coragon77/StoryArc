import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { selectPacingClock, pauseArc, resumeArc } from '../lib/injection/clock.js';
import { chat_metadata } from './mocks/st-mocks.js';

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

    it('returns undefined when no episode can be the clock', () => {
        assert.equal(selectPacingClock([arc('paused', 'episode', 'paused'), arc('act', 'act', 'normal')]), undefined);
        assert.equal(selectPacingClock([]), undefined);
    });
});

describe('pauseArc / resumeArc — stubs that only write focus', () => {
    beforeEach(() => {
        chat_metadata.story_arc = {
            version: 1,
            arcs: [{ ...arc('a', 'episode', 'normal'), messageStart: 12, pausedAt: null, lastFulfilledAt: 12 }],
            settings: {},
        };
    });

    it('pauseArc writes focus paused and nothing else', async () => {
        await pauseArc('a');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.equal(stored.focus, 'paused');
        assert.equal(stored.messageStart, 12);
        assert.equal(stored.pausedAt, null);
        assert.equal(stored.lastFulfilledAt, 12);
    });

    it('resumeArc writes the requested focus and nothing else', async () => {
        chat_metadata.story_arc.arcs[0].focus = 'paused';
        await resumeArc('a', 'spotlight');
        const stored = chat_metadata.story_arc.arcs[0];
        assert.equal(stored.focus, 'spotlight');
        assert.equal(stored.messageStart, 12);
        assert.equal(stored.lastFulfilledAt, 12);
    });

    it('resumeArc defaults to normal', async () => {
        chat_metadata.story_arc.arcs[0].focus = 'paused';
        await resumeArc('a');
        assert.equal(chat_metadata.story_arc.arcs[0].focus, 'normal');
    });
});
