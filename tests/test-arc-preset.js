/**
 * Tests for the arc-generation preset builder (lib/planning/arc-preset.js).
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
    ARC_PRESET_NAME,
    ARC_PRESET_SETTINGS,
    ARC_PROMPT_ENTRIES,
    buildArcPresetSettings,
    buildArcProfile,
    collectArcDirectives,
    createArcPreset,
} from '../lib/planning/arc-preset.js';
import { formatArcDirectives } from '../lib/planning/generator.js';
import { extension_settings, mockPresetList, savedPresets, savedPresetOptions } from './mocks/st-mocks.js';

/** Register a preset in the fake in-memory list, the way SillyTavern holds them. */
function addMockPreset(name, settings) {
    mockPresetList.presets.push(settings);
    mockPresetList.preset_names[name] = mockPresetList.presets.length - 1;
}

/** The enabled state a directive carries in a preset's global prompt order. */
function enabledStateOf(preset, identifier) {
    const order = preset.prompt_order.find(o => o.character_id === 100001);
    return order.order.find(o => o.identifier === identifier)?.enabled;
}

describe('buildArcPresetSettings', () => {
    test('pins the parameters that break arc generation when left to the live settings', () => {
        const result = buildArcPresetSettings();

        assert.strictEqual(result.reasoning_effort, 'high');
        assert.strictEqual(result.openai_max_tokens, 20000);
        assert.strictEqual(result.temperature, 0.8);
        assert.strictEqual(result.top_p, 0.95);
        assert.strictEqual(result.stream_openai, true);
    });

    test('pins neutral values so live RP settings cannot leak in', () => {
        const result = buildArcPresetSettings();

        assert.strictEqual(result.top_k, 0);
        assert.strictEqual(result.repetition_penalty, 1);
        assert.strictEqual(result.function_calling, false);
        assert.strictEqual(result.request_images, false);
    });

    test('carries no connection keys — those come from the profile', () => {
        const result = buildArcPresetSettings();

        assert.strictEqual(result.chat_completion_source, undefined);
        assert.strictEqual(result.nanogpt_model, undefined);
    });

    test('does not share nested state with the settings template', () => {
        const result = buildArcPresetSettings();

        result.prompts[0].content = 'changed';

        assert.notStrictEqual(ARC_PROMPT_ENTRIES[0].content, 'changed');
        assert.strictEqual(ARC_PRESET_SETTINGS.prompts, undefined);
    });
});

describe('directive entries in the preset', () => {
    test('seeds the directive entries with their default states', () => {
        const result = buildArcPresetSettings();

        const identifiers = result.prompts.map(p => p.identifier);
        assert.ok(identifiers.includes('storyArcAdultContent'));
        assert.ok(identifiers.includes('storyArcGenre'));

        // Adult content is opt-in; the genre default text is safe to send unedited.
        assert.strictEqual(enabledStateOf(result, 'storyArcAdultContent'), false);
        assert.strictEqual(enabledStateOf(result, 'storyArcGenre'), true);
    });

    test('contains nothing but the directive entries', () => {
        const result = buildArcPresetSettings();

        assert.strictEqual(result.prompts.length, ARC_PROMPT_ENTRIES.length);
        assert.strictEqual(result.prompt_order.length, 1);
        assert.strictEqual(result.prompt_order[0].character_id, 100001);
        assert.strictEqual(result.prompt_order[0].order.length, ARC_PROMPT_ENTRIES.length);
    });

    test('carries edited text and toggles across a re-create', () => {
        const previous = buildArcPresetSettings();
        previous.prompts.find(p => p.identifier === 'storyArcGenre').content = 'Genre: hard-boiled noir.';
        previous.prompt_order[0].order.find(o => o.identifier === 'storyArcAdultContent').enabled = true;
        previous.prompt_order[0].order.find(o => o.identifier === 'storyArcGenre').enabled = false;

        const result = buildArcPresetSettings(previous);

        assert.strictEqual(result.prompts.find(p => p.identifier === 'storyArcGenre').content, 'Genre: hard-boiled noir.');
        assert.strictEqual(enabledStateOf(result, 'storyArcAdultContent'), true);
        assert.strictEqual(enabledStateOf(result, 'storyArcGenre'), false);
    });

    test('does not duplicate entries when re-created twice', () => {
        const once = buildArcPresetSettings();
        const twice = buildArcPresetSettings(once);

        const genreEntries = twice.prompts.filter(p => p.identifier === 'storyArcGenre');
        const genreOrder = twice.prompt_order[0].order.filter(o => o.identifier === 'storyArcGenre');
        assert.strictEqual(genreEntries.length, 1);
        assert.strictEqual(genreOrder.length, 1);
    });
});

describe('collectArcDirectives', () => {
    test('returns only the enabled directives', () => {
        const preset = buildArcPresetSettings();

        const result = collectArcDirectives(preset);

        const genre = ARC_PROMPT_ENTRIES.find(e => e.identifier === 'storyArcGenre').content;
        assert.deepStrictEqual(result, [genre]);
    });

    test('picks up an entry the user enabled and rewrote', () => {
        const preset = buildArcPresetSettings();
        preset.prompts.find(p => p.identifier === 'storyArcAdultContent').content = 'No fade to black.';
        preset.prompt_order[0].order.find(o => o.identifier === 'storyArcAdultContent').enabled = true;
        preset.prompt_order[0].order.find(o => o.identifier === 'storyArcGenre').enabled = false;

        const result = collectArcDirectives(preset);

        assert.deepStrictEqual(result, ['No fade to black.']);
    });

    test('ignores roleplay prompts in a hand-built preset', () => {
        const preset = buildArcPresetSettings();
        preset.prompts.push({ identifier: 'main', content: 'You are a lewd roleplay partner.' });
        preset.prompt_order[0].order.push({ identifier: 'main', enabled: true });
        preset.prompt_order[0].order.find(o => o.identifier === 'storyArcGenre').enabled = false;

        assert.deepStrictEqual(collectArcDirectives(preset), []);
    });

    test('drops an enabled entry the user emptied', () => {
        const preset = buildArcPresetSettings();
        preset.prompts.find(p => p.identifier === 'storyArcGenre').content = '   ';

        assert.deepStrictEqual(collectArcDirectives(preset), []);
    });

    test('returns nothing for a preset without prompts', () => {
        assert.deepStrictEqual(collectArcDirectives({ temperature: 0.8 }), []);
        assert.deepStrictEqual(collectArcDirectives(null), []);
    });
});

describe('formatArcDirectives', () => {
    test('renders enabled directives as a bulleted section', () => {
        const result = formatArcDirectives(['No fade to black.', 'Genre: noir.']);

        assert.ok(result.includes('== STANDING CONSTRAINTS =='));
        assert.ok(result.includes('- No fade to black.'));
        assert.ok(result.includes('- Genre: noir.'));
    });

    test('renders nothing at all when no directive is enabled', () => {
        assert.strictEqual(formatArcDirectives([]), '');
    });
});

describe('buildArcProfile', () => {
    test('pins the arc preset while keeping the connection details', () => {
        const base = { id: 'old-id', name: 'GLM 5.2 - Celia', api: 'nanogpt', model: 'zai-org/glm-5.2', preset: 'Celia', exclude: [] };

        const result = buildArcProfile(base, 'new-id');

        assert.strictEqual(result.id, 'new-id');
        assert.strictEqual(result.name, ARC_PRESET_NAME);
        assert.strictEqual(result.preset, ARC_PRESET_NAME);
        assert.strictEqual(result.api, 'nanogpt');
        assert.strictEqual(result.model, 'zai-org/glm-5.2');
    });

    test('rejects a missing base profile', () => {
        assert.throws(() => buildArcProfile(null, 'new-id'), /Base profile/);
    });
});

describe('createArcPreset', () => {
    const approve = async () => true;
    const decline = async () => false;

    beforeEach(() => {
        mockPresetList.presets.length = 0;
        for (const key of Object.keys(mockPresetList.preset_names)) delete mockPresetList.preset_names[key];
        for (const key of Object.keys(savedPresets)) delete savedPresets[key];
        for (const key of Object.keys(savedPresetOptions)) delete savedPresetOptions[key];
        extension_settings.connectionManager = {
            profiles: [{ id: 'profile-1', name: 'GLM 5.2 - O\'Block', api: 'nanogpt', preset: 'Writer\'s O\'Block' }],
        };
    });

    test('saves the preset and creates a profile pinning it', async () => {
        const result = await createArcPreset('profile-1', approve);

        assert.strictEqual(result.presetCreated, true);
        assert.strictEqual(savedPresets[ARC_PRESET_NAME].reasoning_effort, 'high');

        const created = extension_settings.connectionManager.profiles.find(p => p.name === ARC_PRESET_NAME);
        assert.strictEqual(created.preset, ARC_PRESET_NAME);
        assert.strictEqual(created.api, 'nanogpt');
        assert.strictEqual(result.profileId, created.id);
        assert.notStrictEqual(created.id, 'profile-1');
    });

    test('never switches the preset the user is chatting with', async () => {
        await createArcPreset('profile-1', approve);

        // savePreset without skipUpdate selects the saved preset in ST's dropdown,
        // swapping the live roleplay preset out from under the user.
        assert.strictEqual(savedPresetOptions[ARC_PRESET_NAME].skipUpdate, true);
    });

    test('registers the preset so it resolves by name right away', async () => {
        await createArcPreset('profile-1', approve);

        const index = mockPresetList.preset_names[ARC_PRESET_NAME];
        assert.notStrictEqual(index, undefined);
        assert.strictEqual(mockPresetList.presets[index].reasoning_effort, 'high');
    });

    test('leaves everything alone when the overwrite is declined', async () => {
        addMockPreset(ARC_PRESET_NAME, { marker: 'untouched' });

        const result = await createArcPreset('profile-1', decline);

        assert.strictEqual(result.presetCreated, false);
        assert.strictEqual(savedPresets[ARC_PRESET_NAME], undefined);
        assert.strictEqual(mockPresetList.presets[mockPresetList.preset_names[ARC_PRESET_NAME]].marker, 'untouched');
        assert.strictEqual(extension_settings.connectionManager.profiles.length, 1);
    });

    test('reuses an existing arc profile instead of duplicating it', async () => {
        extension_settings.connectionManager.profiles.push({ id: 'existing-arc', name: ARC_PRESET_NAME, preset: ARC_PRESET_NAME });

        const result = await createArcPreset('profile-1', approve);

        assert.strictEqual(result.profileId, 'existing-arc');
        assert.strictEqual(extension_settings.connectionManager.profiles.length, 2);
    });

    test('still saves the preset when no base profile is selected', async () => {
        const result = await createArcPreset(null, approve);

        assert.strictEqual(result.presetCreated, true);
        assert.strictEqual(result.profileId, null);
        assert.strictEqual(savedPresets[ARC_PRESET_NAME].openai_max_tokens, 20000);
        assert.strictEqual(extension_settings.connectionManager.profiles.length, 1);
    });
});
