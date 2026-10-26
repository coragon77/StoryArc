import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { MODULE_NAME, defaultSettings, createDefaultArc, TIER_TABLE } from '../lib/core/constants.js';
import { loadSettings, getSettings, isEnabled } from '../lib/core/settings.js';
import { calculatePhase } from '../lib/injection/pacing.js';
import { chat, extension_settings } from './mocks/st-mocks.js';

describe('core/constants', () => {
    it('exports MODULE_NAME as story_arc', () => {
        assert.equal(MODULE_NAME, 'story_arc');
    });

    it('exports defaultSettings with enabled=false', () => {
        assert.equal(defaultSettings.enabled, false);
    });
});

describe('ARC_PHASES — phase and label per message ratio', () => {
    // Every beat completed puts the beat phase at resolution, so the message
    // ratio alone decides the phase. estimatedLength 100 makes the message
    // count the ratio in percent.
    function phaseAtMessage(messageCount) {
        const arc = createDefaultArc({
            messageStart: 0,
            estimatedLength: 100,
            beats: [{ id: 'b1', status: 'completed', optional: false }],
        });
        chat.length = 0;
        for (let i = 0; i < messageCount; i++) chat.push({});
        const { phase, label } = calculatePhase(arc);
        chat.length = 0;
        return { phase, label };
    }

    it('names each of the five phases with its label', () => {
        assert.deepEqual(phaseAtMessage(10), { phase: 'setup', label: 'Setup' });
        assert.deepEqual(phaseAtMessage(30), { phase: 'development', label: 'Development' });
        assert.deepEqual(phaseAtMessage(60), { phase: 'escalation', label: 'Escalation' });
        assert.deepEqual(phaseAtMessage(80), { phase: 'climax', label: 'Climax' });
        assert.deepEqual(phaseAtMessage(95), { phase: 'resolution', label: 'Resolution' });
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

    it('starts active with empty texts and empty lists', () => {
        const { id, createdAt, ...rest } = createDefaultArc();
        assert.equal(typeof id, 'string');
        assert.ok(id.length > 0);
        assert.equal(new Date(createdAt).toISOString(), createdAt);
        assert.deepEqual(rest, {
            title: '',
            status: 'active',
            tier: 'episode',
            focus: 'normal',
            messageStart: 0,
            lastFulfilledAt: 0,
            pausedAt: null,
            direction: '',
            premise: '',
            themes: [],
            tone: '',
            directives: [],
            antiPatterns: [],
            secrets: [],
            foreshadowing: [],
            beats: [],
            escalation: '',
            triggers: [],
            characters: [],
            estimatedLength: 40,
        });
    });

    it('lets overrides replace defaults and keeps the rest', () => {
        const arc = createDefaultArc({ title: 'The Heist', tier: 'act' });
        assert.equal(arc.title, 'The Heist');
        assert.equal(arc.tier, 'act');
        assert.equal(arc.status, 'active');
        assert.deepEqual(arc.beats, []);
    });

    it('carries the three tiers with their length bands', () => {
        assert.deepEqual(Object.keys(TIER_TABLE), ['episode', 'act', 'saga']);
        assert.deepEqual(TIER_TABLE.episode.lengthBand, [8, 20]);
        assert.deepEqual(TIER_TABLE.saga.lengthBand, [400, 1500]);
    });
});

describe('global settings — loadSettings, getSettings, isEnabled', () => {
    beforeEach(() => {
        delete extension_settings.story_arc;
    });

    it('loadSettings on a fresh install stores the global defaults', () => {
        loadSettings();
        assert.deepEqual(extension_settings.story_arc, {
            enabled: false,
            defaultConnectionProfile: null,
            defaultInjectionBudget: 3000,
            defaultPacingStyle: 'moderate',
        });
    });

    it('loadSettings fills missing keys without overwriting the stored ones', () => {
        extension_settings.story_arc = { enabled: true, defaultInjectionBudget: 1200 };
        loadSettings();
        assert.deepEqual(extension_settings.story_arc, {
            enabled: true,
            defaultConnectionProfile: null,
            defaultInjectionBudget: 1200,
            defaultPacingStyle: 'moderate',
        });
    });

    it('getSettings returns the stored settings object', () => {
        const stored = { enabled: true, defaultInjectionBudget: 1200 };
        extension_settings.story_arc = stored;
        assert.equal(getSettings(), stored);
    });

    it('getSettings before loadSettings returns the global defaults', () => {
        assert.deepEqual(getSettings(), {
            enabled: false,
            defaultConnectionProfile: null,
            defaultInjectionBudget: 3000,
            defaultPacingStyle: 'moderate',
        });
    });

    it('isEnabled is true only when enabled is exactly true', () => {
        extension_settings.story_arc = { enabled: true };
        assert.equal(isEnabled(), true);
        extension_settings.story_arc = { enabled: false };
        assert.equal(isEnabled(), false);
        extension_settings.story_arc = { enabled: 'yes' };
        assert.equal(isEnabled(), false);
        delete extension_settings.story_arc;
        assert.equal(isEnabled(), false);
    });
});
