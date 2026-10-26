import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chat, chat_metadata } from './mocks/st-mocks.js';

/*
 * saveArc and deleteArc must persist through saveMetadata, which the shared
 * mock implements as a no-op nobody can observe. This file routes '/script.js'
 * to a stub that re-exports the shared mock and replaces only saveMetadata
 * with a counter. Hooks registered later run first, so this one wins over
 * tests/loader.js; each test file runs in its own process, so no other file
 * sees it. The modules under test are imported only after the hook is set.
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
const { getArcs, saveArc, deleteArc } = await import('../lib/planning/storage.js');

function tieredArc(id) {
    return { id, title: `Arc ${id}`, tier: 'episode', focus: 'normal', status: 'active', beats: [] };
}

describe('planning/storage — saveArc, deleteArc, getArcs', () => {
    beforeEach(() => {
        delete chat_metadata.story_arc;
        chat.length = 0;
        globalThis.saveMetadataCalls = 0;
    });

    it('getArcs on a chat without Story Arc state returns an empty list', () => {
        assert.deepEqual(getArcs(), []);
    });

    it('getArcs on a namespace that has no arcs list returns an empty list', () => {
        chat_metadata.story_arc = { version: 1, settings: {} };
        assert.deepEqual(getArcs(), []);
    });

    it('saveArc appends the arc after the stored ones and saves once', async () => {
        const first = tieredArc('a');
        chat_metadata.story_arc = { version: 1, arcs: [first], settings: {} };
        const second = tieredArc('b');

        await saveArc(second);

        assert.equal(chat_metadata.story_arc.arcs.length, 2);
        assert.equal(chat_metadata.story_arc.arcs[0], first);
        assert.equal(chat_metadata.story_arc.arcs[1], second);
        assert.equal(globalThis.saveMetadataCalls, 1);
    });

    it('saveArc on a chat without Story Arc state creates it and stores the arc', async () => {
        const arc = tieredArc('a');

        await saveArc(arc);

        assert.deepEqual(chat_metadata.story_arc.arcs, [arc]);
        assert.equal(globalThis.saveMetadataCalls, 1);
    });

    it('deleteArc removes only the arc with that id, keeps the order and saves once', async () => {
        const a = tieredArc('a');
        const b = tieredArc('b');
        const c = tieredArc('c');
        chat_metadata.story_arc = { version: 1, arcs: [a, b, c], settings: {} };

        await deleteArc('b');

        assert.deepEqual(chat_metadata.story_arc.arcs.map(arc => arc.id), ['a', 'c']);
        assert.equal(globalThis.saveMetadataCalls, 1);
    });

    it('deleteArc with an unknown id leaves every arc in place', async () => {
        chat_metadata.story_arc = { version: 1, arcs: [tieredArc('a'), tieredArc('b')], settings: {} };

        await deleteArc('missing');

        assert.deepEqual(chat_metadata.story_arc.arcs.map(arc => arc.id), ['a', 'b']);
    });

    it('deleteArc on a chat without Story Arc state leaves an empty list', async () => {
        await deleteArc('a');

        assert.deepEqual(chat_metadata.story_arc.arcs, []);
    });
});
