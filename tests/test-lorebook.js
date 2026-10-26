import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeEntries, fetchLorebookEntries, filterAndSort } from '../lib/context/harvester.js';
import { mockSortedEntries } from './mocks/st-mocks.js';

describe('categorizeEntries', () => {
    it('categorizes constant entries', () => {
        const entries = [
            { comment: 'Facts', content: 'x', constant: true },
            { comment: 'Party', content: 'y', constant: true },
        ];
        const { constants, arcSummaries, recent } = categorizeEntries(entries);
        assert.equal(constants.length, 2);
        assert.equal(arcSummaries.length, 0);
        assert.equal(recent.length, 0);
    });

    it('categorizes arc summary entries', () => {
        const entries = [
            { comment: '[ARC 001] - First Arc', content: 'x', constant: false },
            { comment: '[ARC 002] - Second Arc', content: 'y', constant: false },
        ];
        const { constants, arcSummaries, recent } = categorizeEntries(entries);
        assert.equal(arcSummaries.length, 2);
        assert.equal(constants.length, 0);
    });

    it('categorizes recent memories as default', () => {
        const entries = [
            { comment: '051 - Something Happened', content: 'x', constant: false },
        ];
        const { recent } = categorizeEntries(entries);
        assert.equal(recent.length, 1);
    });

    it('handles mixed entries', () => {
        const entries = [
            { comment: 'Facts', content: 'a', constant: true },
            { comment: '[ARC 001] - Start', content: 'b', constant: false },
            { comment: '051 - Event', content: 'c', constant: false },
        ];
        const { constants, arcSummaries, recent } = categorizeEntries(entries);
        assert.equal(constants.length, 1);
        assert.equal(arcSummaries.length, 1);
        assert.equal(recent.length, 1);
    });
});

describe('fetchLorebookEntries', () => {
    it('uses ST getSortedEntries, drops disabled entries and sorts by order', async () => {
        mockSortedEntries.length = 0;
        mockSortedEntries.push(
            { uid: 1, world: 'chat-book', comment: 'Late', content: 'a', order: 200 },
            { uid: 2, world: 'chat-book', comment: 'Off', content: 'b', order: 50, disable: true },
            { uid: 3, world: 'global', comment: 'Early', content: 'c', order: 10 },
        );
        const entries = await fetchLorebookEntries();
        assert.deepEqual(entries.map(e => e.comment), ['Early', 'Late']);
        assert.equal(entries[0].world, 'global');
    });

    it('returns an empty list when ST cannot deliver the entries', async () => {
        // The mock spreads mockSortedEntries; an iterator that throws makes
        // getSortedEntries itself reject, as a failed fetch would.
        mockSortedEntries[Symbol.iterator] = () => { throw new Error('world info unavailable'); };
        const originalError = console.error;
        console.error = () => {};
        try {
            assert.deepEqual(await fetchLorebookEntries(), []);
        } finally {
            console.error = originalError;
            delete mockSortedEntries[Symbol.iterator];
        }
    });
});

describe('filterAndSort', () => {
    it('sorts an entry without an order as order 100', () => {
        const entries = [
            { comment: 'Late', order: 150 },
            { comment: 'Unordered' },
            { comment: 'Early', order: 50 },
            { comment: 'Last', order: 300 },
            { comment: 'First', order: 5 },
        ];
        assert.deepEqual(filterAndSort(entries).map(e => e.comment), ['First', 'Early', 'Unordered', 'Late', 'Last']);
    });
});

describe('categorizeEntries — which bucket each entry lands in', () => {
    it('sorts each entry into exactly one bucket, constants first', () => {
        const constantArc = { comment: '[ARC 004] - Pinned', constant: true };
        const lowerCaseArc = { comment: '[arc 002] - Lower case', constant: false };
        const archive = { comment: '[ARCHIVE] Old notes', constant: false };
        const noComment = { content: 'untitled', constant: false };
        const { constants, arcSummaries, recent } = categorizeEntries([constantArc, lowerCaseArc, archive, noComment]);
        assert.deepEqual(constants, [constantArc]);
        assert.deepEqual(arcSummaries, [lowerCaseArc]);
        assert.deepEqual(recent, [archive, noComment]);
    });
});
