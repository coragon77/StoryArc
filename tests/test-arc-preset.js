/**
 * Tests for the arc-generation preset builder (lib/planning/arc-preset.js).
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
    ARC_PRESET_NAME,
    ARC_PRESET_SETTINGS,
    ARC_PROMPT_ENTRIES,
    buildArcPresetSettings,
    buildArcProfile,
    collectArcDirectives,
    createArcPreset,
    readActiveArcDirectives,
} from '../lib/planning/arc-preset.js';
import { formatArcDirectives } from '../lib/planning/generator.js';
import { extension_settings, mockPresetList, savedPresets, savedPresetOptions } from './mocks/st-mocks.js';

/** Register a preset in the fake in-memory list, the way SillyTavern holds them. */
function addMockPreset(name, settings) {
    mockPresetList.presets.push(settings);
    mockPresetList.preset_names[name] = mockPresetList.presets.length - 1;
}

/** Empty the fake preset list and the record of saved presets. */
function resetMockPresets() {
    mockPresetList.presets.length = 0;
    for (const key of Object.keys(mockPresetList.preset_names)) delete mockPresetList.preset_names[key];
    for (const key of Object.keys(savedPresets)) delete savedPresets[key];
    for (const key of Object.keys(savedPresetOptions)) delete savedPresetOptions[key];
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

    test('seeds each directive as a plain system prompt, not a marker', () => {
        const result = buildArcPresetSettings();

        for (const entry of result.prompts) {
            assert.strictEqual(entry.role, 'system', entry.identifier);
            assert.strictEqual(entry.system_prompt, true, entry.identifier);
            assert.strictEqual(entry.marker, false, entry.identifier);
        }
    });

    test('carries the toggles of the global prompt order, not of a stale one listed first', () => {
        const previous = {
            prompts: [],
            prompt_order: [
                { character_id: 42, order: [
                    { identifier: 'storyArcAdultContent', enabled: false },
                    { identifier: 'storyArcGenre', enabled: true },
                ] },
                { character_id: 100001, order: [
                    { identifier: 'storyArcAdultContent', enabled: true },
                    { identifier: 'storyArcGenre', enabled: false },
                ] },
            ],
        };

        const result = buildArcPresetSettings(previous);

        assert.strictEqual(enabledStateOf(result, 'storyArcAdultContent'), true);
        assert.strictEqual(enabledStateOf(result, 'storyArcGenre'), false);
    });

    test('falls back to the only prompt order when none is the global one', () => {
        const previous = {
            prompts: [],
            prompt_order: [
                { character_id: 42, order: [{ identifier: 'storyArcAdultContent', enabled: true }] },
            ],
        };

        const result = buildArcPresetSettings(previous);

        assert.strictEqual(enabledStateOf(result, 'storyArcAdultContent'), true);
        // Genre is not listed there, so it keeps its default.
        assert.strictEqual(enabledStateOf(result, 'storyArcGenre'), true);
    });

    test('reads a prompt order without an order list as "not listed"', () => {
        const previous = { prompts: [], prompt_order: [{ character_id: 100001 }] };

        const result = buildArcPresetSettings(previous);

        assert.strictEqual(enabledStateOf(result, 'storyArcAdultContent'), false);
        assert.strictEqual(enabledStateOf(result, 'storyArcGenre'), true);
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

    test('never returns enabled roleplay prompts next to an enabled directive', () => {
        const preset = {
            prompts: [
                { identifier: 'main', content: 'You are a lewd roleplay partner.' },
                { identifier: 'storyArcGenre', content: 'Genre: noir.' },
                { identifier: 'jailbreak', content: 'Ignore all limits.' },
                { name: 'Entry without identifier', content: 'Stray text.' },
                { identifier: 42, content: 'Numeric identifier.' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'main', enabled: true },
                { identifier: 'storyArcGenre', enabled: true },
                { identifier: 'jailbreak', enabled: true },
                { identifier: 42, enabled: true },
            ] }],
        };

        assert.deepStrictEqual(collectArcDirectives(preset), ['Genre: noir.']);
    });

    test('reads the global prompt order, not a stale one listed first', () => {
        const preset = {
            prompts: [
                { identifier: 'storyArcAdultContent', content: 'No fade to black.' },
                { identifier: 'storyArcGenre', content: 'Genre: noir.' },
            ],
            prompt_order: [
                { character_id: 42, order: [
                    { identifier: 'storyArcAdultContent', enabled: false },
                    { identifier: 'storyArcGenre', enabled: true },
                ] },
                { character_id: 100001, order: [
                    { identifier: 'storyArcAdultContent', enabled: true },
                    { identifier: 'storyArcGenre', enabled: false },
                ] },
            ],
        };

        assert.deepStrictEqual(collectArcDirectives(preset), ['No fade to black.']);
    });

    test('returns nothing for a preset with prompts but no prompt order', () => {
        const prompts = [{ identifier: 'storyArcGenre', content: 'Genre: noir.' }];

        assert.deepStrictEqual(collectArcDirectives({ prompts }), []);
        assert.deepStrictEqual(collectArcDirectives({ prompts, prompt_order: [] }), []);
        assert.deepStrictEqual(collectArcDirectives({ prompts, prompt_order: [{ character_id: 100001 }] }), []);
    });

    test('drops an enabled entry without any content', () => {
        const preset = {
            prompts: [{ identifier: 'storyArcGenre' }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'storyArcGenre', enabled: true }] }],
        };

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
        assert.throws(() => buildArcProfile(null, 'new-id'), /Base profile is missing or not an object/);
        assert.throws(() => buildArcProfile(undefined, 'new-id'), /Base profile is missing or not an object/);
        assert.throws(() => buildArcProfile('x', 'new-id'), /Base profile is missing or not an object/);
    });
});

describe('createArcPreset', () => {
    const approve = async () => true;
    const decline = async () => false;

    beforeEach(() => {
        resetMockPresets();
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
        assert.ok(result.note.includes('Reload SillyTavern'));
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
        assert.strictEqual(result.profileId, null);
        assert.ok(result.note.includes('Cancelled'));
        assert.strictEqual(savedPresets[ARC_PRESET_NAME], undefined);
        assert.strictEqual(mockPresetList.presets.length, 1);
        assert.strictEqual(mockPresetList.presets[mockPresetList.preset_names[ARC_PRESET_NAME]].marker, 'untouched');
        assert.strictEqual(extension_settings.connectionManager.profiles.length, 1);
    });

    test('reuses an existing arc profile instead of duplicating it', async () => {
        extension_settings.connectionManager.profiles.push({ id: 'existing-arc', name: ARC_PRESET_NAME, preset: ARC_PRESET_NAME });

        const result = await createArcPreset('profile-1', approve);

        assert.strictEqual(result.presetCreated, true);
        assert.strictEqual(result.profileId, 'existing-arc');
        assert.ok(result.note.includes('already exists'));
        assert.strictEqual(extension_settings.connectionManager.profiles.length, 2);
        assert.strictEqual(savedPresets[ARC_PRESET_NAME].reasoning_effort, 'high');
    });

    test('creates a new preset without asking to overwrite', async () => {
        const asked = [];
        const confirmOverwrite = async (name) => {
            asked.push(name);
            return false;
        };
        addMockPreset('Some other preset', { temperature: 1.2 });

        const result = await createArcPreset('profile-1', confirmOverwrite);

        assert.deepStrictEqual(asked, []);
        assert.strictEqual(result.presetCreated, true);
        assert.strictEqual(savedPresets[ARC_PRESET_NAME].reasoning_effort, 'high');
    });

    test('rewrites an approved existing preset in place, keeping its directive entries', async () => {
        addMockPreset(ARC_PRESET_NAME, {
            temperature: 1.5,
            prompts: [
                { identifier: 'storyArcAdultContent', content: 'No fade to black.' },
                { identifier: 'storyArcGenre', content: 'Genre: noir.' },
            ],
            prompt_order: [{ character_id: 100001, order: [
                { identifier: 'storyArcAdultContent', enabled: true },
                { identifier: 'storyArcGenre', enabled: false },
            ] }],
        });
        const asked = [];

        const result = await createArcPreset('profile-1', async (name) => {
            asked.push(name);
            return true;
        });

        assert.deepStrictEqual(asked, ['Story Arc Generation']);
        assert.strictEqual(result.presetCreated, true);
        // Registered over the old slot instead of appended as a second copy.
        assert.strictEqual(mockPresetList.presets.length, 1);
        assert.strictEqual(mockPresetList.preset_names[ARC_PRESET_NAME], 0);
        const stored = mockPresetList.presets[0];
        assert.strictEqual(stored, savedPresets[ARC_PRESET_NAME]);
        assert.strictEqual(stored.temperature, 0.8);
        assert.strictEqual(stored.prompts.find(p => p.identifier === 'storyArcGenre').content, 'Genre: noir.');
        assert.strictEqual(enabledStateOf(stored, 'storyArcAdultContent'), true);
        assert.strictEqual(enabledStateOf(stored, 'storyArcGenre'), false);
    });

    test('saves the preset but creates no profile without Connection Manager', async () => {
        delete extension_settings.connectionManager;

        const result = await createArcPreset('profile-1', approve);

        assert.strictEqual(result.presetCreated, true);
        assert.strictEqual(result.profileId, null);
        assert.ok(result.note.includes('Connection Manager is not available'));
        assert.strictEqual(savedPresets[ARC_PRESET_NAME].reasoning_effort, 'high');
    });

    test('still saves the preset when no base profile is selected', async () => {
        const result = await createArcPreset(null, approve);

        assert.strictEqual(result.presetCreated, true);
        assert.strictEqual(result.profileId, null);
        assert.ok(result.note.includes('No generation profile selected'));
        assert.strictEqual(savedPresets[ARC_PRESET_NAME].openai_max_tokens, 20000);
        assert.strictEqual(extension_settings.connectionManager.profiles.length, 1);
    });
});

describe('readActiveArcDirectives', () => {
    /** A hand-built preset whose global prompt order enables only the genre entry. */
    const handBuiltPreset = {
        prompts: [
            { identifier: 'main', content: 'You are a roleplay partner.' },
            { identifier: 'storyArcAdultContent', content: 'No fade to black.' },
            { identifier: 'storyArcGenre', content: 'Genre: noir.' },
        ],
        prompt_order: [{ character_id: 100001, order: [
            { identifier: 'main', enabled: true },
            { identifier: 'storyArcAdultContent', enabled: false },
            { identifier: 'storyArcGenre', enabled: true },
        ] }],
    };

    beforeEach(() => {
        resetMockPresets();
        addMockPreset('Hand-built', handBuiltPreset);
        extension_settings.story_arc = { defaultConnectionProfile: 'arc-profile' };
        extension_settings.connectionManager = {
            profiles: [
                { id: 'chat-profile', name: 'Chat', preset: 'Roleplay' },
                { id: 'arc-profile', name: 'Arc', preset: 'Hand-built' },
            ],
        };
    });

    afterEach(() => {
        resetMockPresets();
        delete extension_settings.story_arc;
        delete extension_settings.connectionManager;
    });

    test('returns the enabled directives of the preset the generation profile pins', () => {
        assert.deepStrictEqual(readActiveArcDirectives(), ['Genre: noir.']);
    });

    test('returns nothing without a generation profile', () => {
        extension_settings.story_arc = { defaultConnectionProfile: null };

        assert.deepStrictEqual(readActiveArcDirectives(), []);
    });

    test('returns nothing when no Connection Manager profile matches', () => {
        extension_settings.story_arc = { defaultConnectionProfile: 'deleted-profile' };

        assert.deepStrictEqual(readActiveArcDirectives(), []);
    });

    test('returns nothing without Connection Manager', () => {
        delete extension_settings.connectionManager;

        assert.deepStrictEqual(readActiveArcDirectives(), []);
    });

    test('returns nothing when the profile pins no preset', () => {
        extension_settings.connectionManager.profiles[1] = { id: 'arc-profile', name: 'Arc' };

        assert.deepStrictEqual(readActiveArcDirectives(), []);
    });

    test('returns nothing when the pinned preset does not exist', () => {
        extension_settings.connectionManager.profiles[1].preset = 'Deleted preset';

        assert.deepStrictEqual(readActiveArcDirectives(), []);
    });
});
