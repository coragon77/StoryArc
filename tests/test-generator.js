import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableError } from '../lib/planning/generator.js';

describe('isRetryableError', () => {
    it('retries bad gateway responses', () => {
        assert.equal(isRetryableError('Got response status 502: Bad Gateway'), true);
    });

    it('retries timeouts', () => {
        assert.equal(isRetryableError('request failed ETIMEDOUT'), true);
    });

    it('retries empty responses (reasoning-only output)', () => {
        assert.equal(isRetryableError('Empty response from API '), true);
    });

    it('does not retry auth failures', () => {
        assert.equal(isRetryableError('Got response status 401: Unauthorized'), false);
    });

    it('does not retry unknown model errors', () => {
        assert.equal(isRetryableError('Got response status 400: model not found'), false);
    });

    it('does not retry an empty detail string', () => {
        assert.equal(isRetryableError(''), false);
    });
});
