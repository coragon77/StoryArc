import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chat, chat_metadata } from './mocks/st-mocks.js';

/*
 * ensureChatState must save exactly when it migrated an arc, through
 * saveMetadata, which the shared mock implements as a no-op nobody can
 * observe. This file routes '/script.js' to a stub that re-exports the shared
 * mock and replaces only saveMetadata with a counter. Hooks registered later
 * run first, so this one wins over tests/loader.js; each test file runs in its
 * own process, so no other file sees it. settings.js is imported only after
 * the hook is set.
 */
const MOCKS_URL = new URL('./mocks/st-mocks.js', import.meta.url).href;
const SCRIPT_STUB_URL = 'data:text/javascript,' + encodeURIComponent(
    `export * from '${MOCKS_URL}';
     export function saveMetadata() { globalThis.saveMetadataCalls += 1; }`,
);
register('data:text/javascript,' + encodeURIComponent(
    `export function resolve(specifier, context, nextResolve) {
         if (specifier === '/script.js') return { url: ${JSON.stringify(SCRIPT_STUB_URL)}, shortCircuit: true };
         return nextResolve(specifier, context);
     }`,
));
const { migrateArc, ensureChatState } = await import('../lib/core/settings.js');

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
    it('gives an untiered arc the episode tier and reports the change', () => {
        const arc = oldArc();
        assert.equal(migrateArc(arc, 50), true);
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

    it('leaves an arc that already has a tier untouched and reports no change', () => {
        const arc = oldArc({ tier: 'act', focus: 'spotlight', pausedAt: 7 });
        assert.equal(migrateArc(arc, 999), false);
        assert.equal(arc.tier, 'act');
        assert.equal(arc.focus, 'spotlight');
        assert.equal(arc.pausedAt, 7);
    });
});

describe('ensureChatState — runs the migration on load', () => {
    beforeEach(() => {
        delete chat_metadata.story_arc;
        chat.length = 0;
        globalThis.saveMetadataCalls = 0;
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

    it('saves once when a migrated arc is followed by one that already has a tier', () => {
        chat_metadata.story_arc = {
            version: 1,
            arcs: [oldArc({ id: 'a' }), oldArc({ id: 'b', tier: 'act', focus: 'normal' })],
        };
        ensureChatState();
        assert.equal(globalThis.saveMetadataCalls, 1);
    });

    it('does not save when every stored arc already has a tier', () => {
        chat_metadata.story_arc = {
            version: 1,
            arcs: [
                oldArc({ id: 'a', tier: 'episode', focus: 'normal' }),
                oldArc({ id: 'b', tier: 'saga', focus: 'paused' }),
            ],
        };
        ensureChatState();
        assert.equal(globalThis.saveMetadataCalls, 0);
    });
});

describe('ensureChatState — per-chat namespace and settings', () => {
    beforeEach(() => {
        delete chat_metadata.story_arc;
        chat.length = 0;
        globalThis.saveMetadataCalls = 0;
    });

    it('creates version 1, an empty arc list and the per-chat default settings on a fresh chat', () => {
        ensureChatState();
        assert.deepEqual(chat_metadata.story_arc, {
            version: 1,
            arcs: [],
            settings: {
                injectionBudget: 3000,
                autoTrack: true,
            },
        });
        assert.equal(globalThis.saveMetadataCalls, 0);
    });

    it('gives a stored namespace without settings the per-chat defaults', () => {
        chat_metadata.story_arc = { version: 1, arcs: [] };
        ensureChatState();
        assert.deepEqual(chat_metadata.story_arc.settings, {
            injectionBudget: 3000,
            autoTrack: true,
        });
    });

    it('fills a missing settings key with its default and keeps the stored values', () => {
        chat_metadata.story_arc = {
            version: 1,
            arcs: [],
            settings: { autoTrack: false },
        };
        ensureChatState();
        assert.deepEqual(chat_metadata.story_arc.settings, {
            injectionBudget: 3000,
            autoTrack: false,
        });
    });
});
