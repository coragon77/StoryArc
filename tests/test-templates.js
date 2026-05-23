import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate } from '../lib/planning/templates.js';

describe('fillTemplate', () => {
    it('replaces single placeholder', () => {
        assert.equal(fillTemplate('Hello {{NAME}}', { NAME: 'World' }), 'Hello World');
    });

    it('replaces multiple placeholders', () => {
        const result = fillTemplate('{{A}} and {{B}}', { A: 'X', B: 'Y' });
        assert.equal(result, 'X and Y');
    });

    it('replaces repeated placeholders', () => {
        const result = fillTemplate('{{X}} is {{X}}', { X: 'same' });
        assert.equal(result, 'same is same');
    });

    it('leaves unmatched placeholders intact', () => {
        assert.equal(fillTemplate('Hello {{NAME}}', {}), 'Hello {{NAME}}');
    });

    it('only replaces placeholders present in variables', () => {
        assert.equal(fillTemplate('{{A}} and {{B}}', { A: 'X' }), 'X and {{B}}');
    });
});
