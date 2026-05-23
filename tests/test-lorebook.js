import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeEntries } from '../lib/context/lorebook.js';

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
