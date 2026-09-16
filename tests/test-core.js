import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MODULE_NAME, defaultSettings, createDefaultArc, TIER_TABLE } from '../lib/core/constants.js';

describe('core/constants', () => {
    it('exports MODULE_NAME as story_arc', () => {
        assert.equal(MODULE_NAME, 'story_arc');
    });

    it('exports defaultSettings with enabled=false', () => {
        assert.equal(defaultSettings.enabled, false);
    });
});

describe('createDefaultArc', () => {
    it('defaults to a normal episode with the new fields and no subArcs', () => {
        const arc = createDefaultArc();
        assert.equal(arc.tier, 'episode');
        assert.equal(arc.focus, 'normal');
        assert.equal(arc.direction, '');
        assert.equal(arc.pausedAt, null);
        assert.equal(arc.lastFulfilledAt, 0);
        assert.equal('subArcs' in arc, false);
    });

    it('carries the three tiers with their length bands', () => {
        assert.deepEqual(Object.keys(TIER_TABLE), ['episode', 'act', 'saga']);
        assert.deepEqual(TIER_TABLE.episode.lengthBand, [8, 20]);
        assert.deepEqual(TIER_TABLE.saga.lengthBand, [400, 1500]);
    });
});
