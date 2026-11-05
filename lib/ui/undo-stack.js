/**
 * @file Undo stack over one stored state, for a popup session's hand edits
 * @module ui/undo-stack
 *
 * Used by the Knowledge popup (the ledger) and the Arc Manager (the arcs
 * and their queued marks).
 */

/**
 * An undo stack over one stored state: `read` returns the stored state,
 * `write` puts a snapshot back. Each entry holds the state before an edit and
 * the state the edit produced, both as JSON, and an optional label naming
 * the edit. Undo restores the newest entry only while the
 * stored state still serializes to what the edit produced; anything else
 * (an extraction writing into the stored object, a rollback, a replaced
 * object, another chat) refuses with `changedMessage` and drops the stack.
 * The serialized comparison catches an in-place write and a replacement
 * alike, which an identity check or a counter bumped at each write site
 * would not without touching every writer.
 * @param {{ read: () => object, write: (snapshot: object) => void, changedMessage: string }} store
 */
export function createUndoStack({ read, write, changedMessage }) {
    let entries = [];
    return {
        /** The stored state now, to pass to `record` after the edit */
        capture() {
            return JSON.stringify(read());
        },
        /**
         * Record an edit made since `before` was captured; an edit that changed nothing is not recorded
         * @param {string} before - From `capture`
         * @param {string} [label] - What the edit did, for an undo button
         */
        record(before, label = null) {
            const after = JSON.stringify(read());
            if (after !== before) entries.push({ before, after, label });
        },
        /** The label of the newest edit, null when there is none or it has no label */
        newestLabel() {
            return entries[entries.length - 1]?.label ?? null;
        },
        /** How many edits can be undone */
        size() {
            return entries.length;
        },
        /**
         * Restore the state before the newest edit.
         * @returns {{ error: string|null, label: string|null }} The label of the edit undone, or refused
         */
        undo() {
            const newest = entries[entries.length - 1];
            if (!newest) return { error: 'Nothing to undo.', label: null };
            if (JSON.stringify(read()) !== newest.after) {
                entries = [];
                return { error: changedMessage, label: newest.label };
            }
            entries.pop();
            write(JSON.parse(newest.before));
            return { error: null, label: newest.label };
        },
    };
}
