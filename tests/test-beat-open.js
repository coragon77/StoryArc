import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBeatOpen } from '../lib/core/settings.js';

describe('isBeatOpen', () => {
    it('counts active and pending beats as open, completed and skipped ones as closed', () => {
        assert.equal(isBeatOpen({ status: 'active' }), true);
        assert.equal(isBeatOpen({ status: 'pending' }), true);
        assert.equal(isBeatOpen({ status: 'completed' }), false);
        assert.equal(isBeatOpen({ status: 'skipped' }), false);
    });
});
