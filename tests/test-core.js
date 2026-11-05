import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { MODULE_NAME, defaultSettings, createDefaultArc, TIER_TABLE, KNOWLEDGE_PROMPT_KEY } from '../lib/core/constants.js';
import { loadSettings, getSettings, isEnabled, getKnowledgeTrackerSettings, isKnowledgeTrackerEnabled, isCharacterDetailsEnabled, beatRecognitionPath } from '../lib/core/settings.js';
import { calculatePhase } from '../lib/injection/pacing.js';
import { chat, chat_metadata, extension_settings } from './mocks/st-mocks.js';

describe('core/constants', () => {
    it('exports MODULE_NAME as story_arc', () => {
        assert.equal(MODULE_NAME, 'story_arc');
    });

    it('exports defaultSettings with enabled=false', () => {
        assert.equal(defaultSettings.enabled, false);
    });

    it('reserves story_arc_knowledge as the knowledge block\'s prompt key', () => {
        assert.equal(KNOWLEDGE_PROMPT_KEY, 'story_arc_knowledge');
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

describe('beatRecognitionPath — where beats are recognised', () => {
    function setSwitches({ autoTrack, tracker }) {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: tracker, updateInterval: 1 } };
        chat_metadata.story_arc = { version: 1, arcs: [], settings: { autoTrack } };
    }

    beforeEach(() => {
        delete extension_settings.story_arc;
        delete chat_metadata.story_arc;
    });

    it('is off while the chat\'s autoTrack is off, whatever the tracker says', () => {
        setSwitches({ autoTrack: false, tracker: true });
        assert.equal(beatRecognitionPath(), 'off');
        setSwitches({ autoTrack: false, tracker: false });
        assert.equal(beatRecognitionPath(), 'off');
    });

    it('is the extraction while autoTrack and the knowledge tracker are on', () => {
        setSwitches({ autoTrack: true, tracker: true });
        assert.equal(beatRecognitionPath(), 'extraction');
    });

    it('is the narrator\'s marker while autoTrack is on and the knowledge tracker off', () => {
        setSwitches({ autoTrack: true, tracker: false });
        assert.equal(beatRecognitionPath(), 'marker');
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
            knowledgeTracker: { enabled: false, updateInterval: 1, characterDetails: false },
        });
    });

    it('loadSettings fills missing keys without overwriting the stored ones', () => {
        extension_settings.story_arc = { defaultConnectionProfile: 'profile-7' };
        loadSettings();
        assert.deepEqual(extension_settings.story_arc, {
            enabled: false,
            defaultConnectionProfile: 'profile-7',
            knowledgeTracker: { enabled: false, updateInterval: 1, characterDetails: false },
        });
    });

    it('loadSettings fills a missing tracker key and keeps the stored one', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { updateInterval: 3 } };
        loadSettings();
        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: false, updateInterval: 3, characterDetails: false });

        extension_settings.story_arc = { knowledgeTracker: { enabled: true } };
        loadSettings();
        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: true, updateInterval: 1, characterDetails: false });
    });

    it('stored tracker settings survive a settings reload', () => {
        loadSettings();
        getKnowledgeTrackerSettings().enabled = true;
        getKnowledgeTrackerSettings().updateInterval = 4;
        loadSettings();
        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: true, updateInterval: 4, characterDetails: false });
    });

    it('changing one install\'s tracker settings leaves the defaults alone', () => {
        loadSettings();
        getKnowledgeTrackerSettings().enabled = true;
        delete extension_settings.story_arc;
        loadSettings();
        assert.deepEqual(extension_settings.story_arc.knowledgeTracker, { enabled: false, updateInterval: 1, characterDetails: false });
    });

    it('getKnowledgeTrackerSettings returns the stored group, or the defaults before loadSettings', () => {
        assert.deepEqual(getKnowledgeTrackerSettings(), { enabled: false, updateInterval: 1, characterDetails: false });
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 2 } };
        assert.equal(getKnowledgeTrackerSettings(), extension_settings.story_arc.knowledgeTracker);
    });

    it('isKnowledgeTrackerEnabled is true only when the tracker switch is exactly true', () => {
        assert.equal(isKnowledgeTrackerEnabled(), false);
        extension_settings.story_arc = { knowledgeTracker: { enabled: true, updateInterval: 1 } };
        assert.equal(isKnowledgeTrackerEnabled(), true);
        extension_settings.story_arc = { knowledgeTracker: { enabled: 'yes', updateInterval: 1 } };
        assert.equal(isKnowledgeTrackerEnabled(), false);
        extension_settings.story_arc = { enabled: true };
        assert.equal(isKnowledgeTrackerEnabled(), false);
    });

    it('isCharacterDetailsEnabled is true only while Story Arc, the tracker and the details switch are all on', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, updateInterval: 1, characterDetails: true } };
        assert.equal(isCharacterDetailsEnabled(), true);
        extension_settings.story_arc = { enabled: false, knowledgeTracker: { enabled: true, updateInterval: 1, characterDetails: true } };
        assert.equal(isCharacterDetailsEnabled(), false);
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: false, updateInterval: 1, characterDetails: true } };
        assert.equal(isCharacterDetailsEnabled(), false);
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, updateInterval: 1, characterDetails: 'yes' } };
        assert.equal(isCharacterDetailsEnabled(), false);
    });

    it('a settings file from before the details switch reads it as off', () => {
        extension_settings.story_arc = { enabled: true, knowledgeTracker: { enabled: true, updateInterval: 1 } };
        assert.equal(isCharacterDetailsEnabled(), false);
        loadSettings();
        assert.equal(extension_settings.story_arc.knowledgeTracker.characterDetails, false);
    });

    it('getSettings returns the stored settings object', () => {
        const stored = { enabled: true, defaultConnectionProfile: 'profile-7' };
        extension_settings.story_arc = stored;
        assert.equal(getSettings(), stored);
    });

    it('getSettings before loadSettings returns the global defaults', () => {
        assert.deepEqual(getSettings(), {
            enabled: false,
            defaultConnectionProfile: null,
            knowledgeTracker: { enabled: false, updateInterval: 1, characterDetails: false },
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
