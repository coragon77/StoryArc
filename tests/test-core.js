import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MODULE_NAME, defaultSettings } from '../lib/core/constants.js';

describe('core/constants', () => {
    it('exports MODULE_NAME as story_arc', () => {
        assert.equal(MODULE_NAME, 'story_arc');
    });

    it('exports defaultSettings with enabled=false', () => {
        assert.equal(defaultSettings.enabled, false);
    });
});
