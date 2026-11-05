import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUndoStack } from '../lib/ui/undo-stack.js';

const CHANGED = 'Changed since; undo is no longer possible.';

/** A stored state the stack reads, and a write that puts a snapshot back */
function makeStore(initial) {
    const store = { state: initial };
    const stack = createUndoStack({
        read: () => store.state,
        write: snapshot => { store.state = snapshot; },
        changedMessage: CHANGED,
    });
    return { store, stack };
}

describe('createUndoStack', () => {
    it('restores the state before the newest edit, newest first', () => {
        const { store, stack } = makeStore({ focus: 'normal' });

        let before = stack.capture();
        store.state = { focus: 'paused' };
        stack.record(before, 'Paused: The Long Winter');
        before = stack.capture();
        store.state = { focus: 'spotlight' };
        stack.record(before, 'Spotlight: The Long Winter');

        assert.deepEqual(stack.undo(), { error: null, label: 'Spotlight: The Long Winter' });
        assert.deepEqual(store.state, { focus: 'paused' });
        assert.deepEqual(stack.undo(), { error: null, label: 'Paused: The Long Winter' });
        assert.deepEqual(store.state, { focus: 'normal' });
    });

    it('names the newest label and counts the entries', () => {
        const { store, stack } = makeStore({ n: 1 });
        assert.equal(stack.newestLabel(), null);
        assert.equal(stack.size(), 0);

        const before = stack.capture();
        store.state = { n: 2 };
        stack.record(before, 'Edited n');

        assert.equal(stack.newestLabel(), 'Edited n');
        assert.equal(stack.size(), 1);
    });

    it('records no edit that changed nothing', () => {
        const { stack } = makeStore({ n: 1 });
        stack.record(stack.capture(), 'Nothing');

        assert.equal(stack.size(), 0);
        assert.deepEqual(stack.undo(), { error: 'Nothing to undo.', label: null });
    });

    it('refuses when the stored state changed since the edit, and drops the stack', () => {
        const { store, stack } = makeStore({ n: 1 });
        let before = stack.capture();
        store.state = { n: 2 };
        stack.record(before, 'First');
        before = stack.capture();
        store.state = { n: 3 };
        stack.record(before, 'Second');
        store.state = { n: 3, extracted: true };

        assert.deepEqual(stack.undo(), { error: CHANGED, label: 'Second' });
        assert.deepEqual(store.state, { n: 3, extracted: true });
        assert.equal(stack.size(), 0);
    });

    it('keeps working without labels, as the Knowledge popup records', () => {
        const { store, stack } = makeStore({ n: 1 });
        const before = stack.capture();
        store.state = { n: 2 };
        stack.record(before);

        assert.deepEqual(stack.undo(), { error: null, label: null });
        assert.deepEqual(store.state, { n: 1 });
    });
});
