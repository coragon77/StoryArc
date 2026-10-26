/**
 * @file Creates a barebones chat-completion preset (and matching Connection
 *       Manager profile) tuned for arc generation.
 * @module planning/arc-preset
 *
 * Why this exists: the user's roleplay presets are actively harmful for arc
 * generation (reasoning budgets that eat the whole response, RP-tuned sampling),
 * and picking the right profile out of ~150 near-identical names is a coin flip.
 * One button produces a distinctly named preset + profile pair instead.
 *
 * What a derived preset can and cannot carry: arc generation builds its own
 * messages from `prompts/*.txt` and passes them to
 * `ChatCompletionService.presetToGeneratePayload`, which only maps the preset's
 * *parameter* keys into the payload. The preset's prompt list is never used by
 * SillyTavern for these calls, so only generation parameters reach the wire on
 * their own.
 *
 * The arc directives (adult content, genre) exploit that unused prompt
 * list as storage: they are ordinary prompt entries in the derived preset, so
 * the user edits and toggles them in SillyTavern's own prompt manager instead of
 * in yet another extension panel, and `collectArcDirectives` reads the enabled
 * ones back at generation time and folds them into Story Arc's own prompt.
 */

import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { getPresetManager } from '/scripts/preset-manager.js';
import { uuidv4 } from '/scripts/utils.js';
import { getSettings } from '../core/settings.js';

/** Name used for both the derived preset and the derived profile. */
export const ARC_PRESET_NAME = 'Story Arc Generation';

/** Identifier prefix that marks a prompt entry as a Story Arc directive. */
const ARC_PROMPT_PREFIX = 'storyArc';

/**
 * Character id under which SillyTavern's chat-completion prompt manager keeps
 * its single global prompt order (`openai.js`: `promptOrder.dummyId`). Presets
 * can carry stale orders under other ids; this is the one the UI edits.
 */
const GLOBAL_PROMPT_ORDER_ID = 100001;

/**
 * The directive entries the button seeds into a fresh derived preset.
 *
 * They are plain prompt entries, so the user turns them on and off — and
 * rewrites their text — in the prompt manager. Only enabled entries reach the
 * generation prompt. Adult content starts disabled (off = fade to black);
 * genre starts enabled because its default text works unedited.
 */
export const ARC_PROMPT_ENTRIES = [
    {
        identifier: 'storyArcAdultContent',
        name: 'Story Arc: Adult Content',
        enabled: false,
        content: 'Explicit sexual content is permitted. Beats, secrets and escalation may build toward adult scenes and describe them in full, rather than fading to black.',
    },
    {
        identifier: 'storyArcGenre',
        name: 'Story Arc: Genre',
        enabled: true,
        content: 'If a GENRE block is given, it decides the genre. Without one, stay inside the genre and tonal register the story has already established; let new beats escalate within that register rather than drift into another genre. To force a specific genre for every arc instead, replace this text — e.g.: "Genre: gothic horror. Dread builds slowly, the supernatural stays ambiguous, no comic relief."',
    },
];

/**
 * The complete barebones preset, not derived from anything. Connection details
 * (API, model, secret) come from the Connection Manager profile at request
 * time, so the preset only has to carry generation parameters.
 *
 * The load-bearing values are wire-verified against nano-gpt GLM 5.2:
 *
 * - `reasoning_effort: 'max'` burns the entire token budget on reasoning, so the
 *   response arrives empty or with the JSON truncated mid-string. 'high' works.
 * - Arc plans are long structured JSON; 20000 response tokens is what the
 *   working setup uses. A 8192 budget truncates.
 * - Sampling is kept mild — arc plans are structured output, not prose.
 *
 * The neutral pins matter too: `presetToGeneratePayload` starts from the *live*
 * chat settings and only overlays the keys the preset defines, so any key left
 * out would silently fall back to whatever the roleplay session happens to be
 * set to.
 */
export const ARC_PRESET_SETTINGS = {
    reasoning_effort: 'high',
    openai_max_tokens: 20000,
    openai_max_context: 163000,
    temperature: 0.8,
    top_p: 0.95,
    stream_openai: true,
    frequency_penalty: 0,
    presence_penalty: 0,
    repetition_penalty: 1,
    top_k: 0,
    top_a: 0,
    min_p: 0,
    seed: -1,
    function_calling: false,
    enable_web_search: false,
    request_images: false,
    media_inlining: false,
    squash_system_messages: false,
};

/**
 * Build the arc-generation preset settings.
 * @param {object} [previousPreset] - Earlier arc preset whose directive entries should survive
 * @returns {object} New preset settings object
 */
export function buildArcPresetSettings(previousPreset = null) {
    const settings = structuredClone(ARC_PRESET_SETTINGS);
    // The prompt list holds only the directive entries — the preset exists for
    // Story Arc's calls, which never send a preset's prompts. SillyTavern
    // re-adds its mandatory system prompts on load
    // (PromptManager.checkForMissingPrompts), so the sparse list is safe.
    settings.prompts = [];
    settings.prompt_order = [{ character_id: GLOBAL_PROMPT_ORDER_ID, order: [] }];
    applyArcPromptEntries(settings, previousPreset);
    return settings;
}

/**
 * Add the directive entries to a derived preset, in place. The caller hands
 * in empty `prompts` and `order` lists, so every entry is appended.
 *
 * Re-deriving keeps whatever the user made of them: their edited text and their
 * on/off state are carried over from the preset being replaced, because the base
 * preset knows nothing about them and would otherwise reset a hand-written genre
 * back to the placeholder.
 *
 * @param {object} settings - Derived preset settings, already cloned
 * @param {object|null} previousPreset - Preset being replaced, if any
 */
function applyArcPromptEntries(settings, previousPreset) {
    for (const template of ARC_PROMPT_ENTRIES) {
        const carried = findPromptEntry(previousPreset, template.identifier);
        const entry = carried ?? {
            identifier: template.identifier,
            name: template.name,
            role: 'system',
            content: template.content,
            system_prompt: true,
            marker: false,
        };

        settings.prompts.push(entry);

        const carriedState = readPromptEnabled(previousPreset, template.identifier);
        const enabled = carriedState === null ? template.enabled : carriedState;
        for (const promptOrder of settings.prompt_order) {
            promptOrder.order.push({ identifier: template.identifier, enabled });
        }
    }
}

/**
 * The prompt order SillyTavern's prompt manager actually edits.
 * @param {object} preset - Preset object
 * @returns {object|null} Prompt order entry, or null when the preset has none
 */
function findGlobalPromptOrder(preset) {
    if (!Array.isArray(preset?.prompt_order) || preset.prompt_order.length === 0) {
        return null;
    }
    return preset.prompt_order.find(o => o.character_id === GLOBAL_PROMPT_ORDER_ID) ?? preset.prompt_order[0];
}

/**
 * @param {object|null} preset - Preset to search
 * @param {string} identifier - Prompt identifier
 * @returns {object|null} The prompt entry, or null
 */
function findPromptEntry(preset, identifier) {
    if (!Array.isArray(preset?.prompts)) return null;
    return preset.prompts.find(p => p.identifier === identifier) ?? null;
}

/**
 * @param {object|null} preset - Preset to search
 * @param {string} identifier - Prompt identifier
 * @returns {boolean|null} Enabled state, or null when the preset does not list it
 */
function readPromptEnabled(preset, identifier) {
    const promptOrder = findGlobalPromptOrder(preset);
    const listed = promptOrder?.order?.find(o => o.identifier === identifier);
    return listed ? listed.enabled === true : null;
}

/**
 * Read the enabled directive entries out of a preset.
 * @param {object} preset - Preset object to read
 * @returns {string[]} Directive texts, in preset order, empty entries dropped
 */
export function collectArcDirectives(preset) {
    if (!Array.isArray(preset?.prompts)) return [];

    const promptOrder = findGlobalPromptOrder(preset);
    const enabled = new Set(
        (promptOrder?.order ?? []).filter(o => o.enabled === true).map(o => o.identifier),
    );

    return preset.prompts
        .filter(p => typeof p.identifier === 'string' && p.identifier.startsWith(ARC_PROMPT_PREFIX))
        .filter(p => enabled.has(p.identifier))
        .map(p => (p.content || '').trim())
        .filter(Boolean);
}

/**
 * Read the directives from the preset that Story Arc's generation profile pins.
 *
 * Deliberately not tied to `ARC_PRESET_NAME`: whatever preset the active profile
 * uses is the one the user is editing, so directive entries work in a hand-built
 * preset too.
 *
 * Directive state lives in the *stored* preset, and SillyTavern's prompt manager
 * writes toggles to the live settings — so a toggle only counts here once the
 * user saves the preset. That is ST's own behaviour for every preset edit.
 *
 * @returns {string[]} Directive texts, empty when there is no profile, preset or enabled entry
 */
export function readActiveArcDirectives() {
    const profileId = getSettings().defaultConnectionProfile;
    if (!profileId) return [];

    const profiles = extension_settings.connectionManager?.profiles || [];
    const presetName = profiles.find(p => p.id === profileId)?.preset;
    if (!presetName) return [];

    const presetManager = getPresetManager('openai');
    if (!presetManager || !presetExists(presetManager, presetName)) return [];

    return collectArcDirectives(presetManager.getCompletionPresetByName(presetName));
}

/**
 * Build a Connection Manager profile that pins the derived preset, reusing the
 * connection details (API, URL, model, secret) of a base profile the user
 * already has working.
 * @param {object} baseProfile - Connection Manager profile to derive from
 * @param {string} id - Id for the new profile
 * @param {string} [name] - Name for the new profile
 * @returns {object} New profile object
 */
export function buildArcProfile(baseProfile, id, name = ARC_PRESET_NAME) {
    if (!baseProfile || typeof baseProfile !== 'object') {
        throw new Error('Base profile is missing or not an object');
    }
    return { ...structuredClone(baseProfile), id, name, preset: ARC_PRESET_NAME };
}

/**
 * Whether a preset of this name is already known to SillyTavern.
 *
 * Read from the in-memory preset list rather than from `getAllPresets()`, which
 * reads the option texts of ST's preset dropdown — `registerPreset` deliberately
 * does not add an option there, so the dropdown lags behind until a reload.
 *
 * @param {object} presetManager - ST preset manager for the 'openai' API
 * @param {string} name - Preset name
 * @returns {boolean}
 */
function presetExists(presetManager, name) {
    const { preset_names } = presetManager.getPresetList();
    return Array.isArray(preset_names)
        ? preset_names.includes(name)
        : preset_names[name] !== undefined;
}

/**
 * Write a preset to disk and make it resolvable by name in this session.
 *
 * `PresetManager.savePreset` normally follows the save with `updateList`, which
 * *selects* the saved preset in ST's dropdown — that would silently swap the
 * roleplay preset the user is chatting with. So the save skips that step, and
 * the in-memory list is updated here without touching the selection. Registering
 * it matters: `presetToGeneratePayload` resolves the profile's preset by name
 * and falls back to the live chat settings when the lookup misses.
 *
 * @param {object} presetManager - ST preset manager for the 'openai' API
 * @param {string} name - Preset name
 * @param {object} settings - Preset settings to store
 */
async function registerPreset(presetManager, name, settings) {
    await presetManager.savePreset(name, settings, { skipUpdate: true });

    const { presets, preset_names } = presetManager.getPresetList();
    if (preset_names[name] !== undefined) {
        presets[preset_names[name]] = settings;
        return;
    }
    presets.push(settings);
    preset_names[name] = presets.length - 1;
}

/**
 * Create (or overwrite) the arc-generation preset, and a Connection Manager
 * profile pinning it when a base profile is available.
 *
 * Writes to the user's live SillyTavern data, so both halves are guarded: the
 * caller decides whether overwriting is allowed, and an existing profile of the
 * same name is reused rather than duplicated.
 *
 * @param {string|null} baseProfileId - Connection Manager profile to derive connection details from
 * @param {(name: string) => Promise<boolean>} confirmOverwrite - Asked before replacing an existing preset
 * @returns {Promise<{ presetCreated: boolean, profileId: string|null, note: string }>}
 */
export async function createArcPreset(baseProfileId, confirmOverwrite) {
    const presetManager = getPresetManager('openai');
    if (!presetManager) {
        throw new Error('Chat completion preset manager is unavailable — is the API set to Chat Completion?');
    }

    let previousPreset = null;
    if (presetExists(presetManager, ARC_PRESET_NAME)) {
        if (!await confirmOverwrite(ARC_PRESET_NAME)) {
            return { presetCreated: false, profileId: null, note: 'Cancelled — nothing was changed.' };
        }
        previousPreset = presetManager.getCompletionPresetByName(ARC_PRESET_NAME);
    }

    await registerPreset(presetManager, ARC_PRESET_NAME, buildArcPresetSettings(previousPreset));
    console.log(`[Story Arc] Saved preset "${ARC_PRESET_NAME}"`);

    const profiles = extension_settings.connectionManager?.profiles;
    if (!Array.isArray(profiles)) {
        return { presetCreated: true, profileId: null, note: 'Connection Manager is not available — pin the preset to a profile yourself.' };
    }

    const existingProfile = profiles.find(p => p.name === ARC_PRESET_NAME);
    if (existingProfile) {
        return { presetCreated: true, profileId: existingProfile.id, note: `Profile "${ARC_PRESET_NAME}" already exists and was left untouched.` };
    }

    const baseProfile = profiles.find(p => p.id === baseProfileId);
    if (!baseProfile) {
        return { presetCreated: true, profileId: null, note: 'No generation profile selected, so no profile was created — pick one and press the button again.' };
    }

    const arcProfile = buildArcProfile(baseProfile, uuidv4());
    profiles.push(arcProfile);
    saveSettingsDebounced();
    console.log(`[Story Arc] Created connection profile "${ARC_PRESET_NAME}" from "${baseProfile.name}"`);

    return {
        presetCreated: true,
        profileId: arcProfile.id,
        note: 'Reload SillyTavern to see the new profile in Connection Manager itself.',
    };
}
