import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrateArc, ensureChatState } from '../lib/core/settings.js';
import { chat, chat_metadata } from './mocks/st-mocks.js';

function oldArc(overrides = {}) {
    return {
        id: 'old-arc',
        title: 'Planned before tiers',
        status: 'active',
        focus: 'foreground',
        messageStart: 10,
        estimatedLength: 40,
        beats: [{ id: 'b1', status: 'active' }],
        ...overrides,
    };
}

describe('migrateArc — arcs planned before tiers existed', () => {
    it('gives an untiered arc the episode tier', () => {
        const arc = oldArc();
        migrateArc(arc, 50);
        assert.equal(arc.tier, 'episode');
    });

    it('maps foreground to normal', () => {
        const arc = oldArc({ focus: 'foreground' });
        migrateArc(arc, 50);
        assert.equal(arc.focus, 'normal');
        assert.equal(arc.pausedAt, null);
    });

    it('maps background to paused, frozen at the chat length of the migration', () => {
        const arc = oldArc({ focus: 'background' });
        migrateArc(arc, 123);
        assert.equal(arc.focus, 'paused');
        assert.equal(arc.pausedAt, 123);
    });

    it('changes nothing else on the arc', () => {
        const arc = oldArc();
        migrateArc(arc, 50);
        assert.equal(arc.messageStart, 10);
        assert.equal(arc.estimatedLength, 40);
        assert.equal(arc.status, 'active');
        assert.deepEqual(arc.beats, [{ id: 'b1', status: 'active' }]);
        assert.equal(arc.lastFulfilledAt, undefined);
        assert.equal(arc.direction, undefined);
    });

    it('leaves an arc that already has a tier untouched', () => {
        const arc = oldArc({ tier: 'act', focus: 'spotlight', pausedAt: 7 });
        migrateArc(arc, 999);
        assert.equal(arc.tier, 'act');
        assert.equal(arc.focus, 'spotlight');
        assert.equal(arc.pausedAt, 7);
    });
});

describe('ensureChatState — runs the migration on load', () => {
    beforeEach(() => {
        delete chat_metadata.story_arc;
        chat.length = 0;
    });

    it('migrates every stored arc once, using the live chat length', () => {
        for (let i = 0; i < 30; i++) chat.push({ mes: `m${i}` });
        chat_metadata.story_arc = {
            version: 1,
            arcs: [oldArc({ id: 'a', focus: 'foreground' }), oldArc({ id: 'b', focus: 'background' })],
        };
        ensureChatState();
        const [a, b] = chat_metadata.story_arc.arcs;
        assert.equal(a.tier, 'episode');
        assert.equal(a.focus, 'normal');
        assert.equal(b.tier, 'episode');
        assert.equal(b.focus, 'paused');
        assert.equal(b.pausedAt, 30);

        // A second load must not move the pause point.
        chat.push({ mes: 'later' });
        ensureChatState();
        assert.equal(b.pausedAt, 30);
    });
});
