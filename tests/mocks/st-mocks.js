/**
 * Mock SillyTavern globals for testing pure logic functions.
 * Only exports what our source files actually import.
 */

// --- /script.js mocks ---
export const chat = [];
export const chat_metadata = {};
export const characters = [];
export const this_chid = null;
export const eventSource = { on: () => {}, emit: () => {} };
export const event_types = {};
export function saveSettingsDebounced() {}
export function setExtensionPrompt() {}
export const extension_prompt_types = { IN_PROMPT: 0 };
export const extension_prompt_roles = { SYSTEM: 0 };
export function saveMetadata() {}
export function generateRaw() { return ''; }
export function getRequestHeaders() { return {}; }

// --- /scripts/extensions.js mocks ---
export const extension_settings = {};
export function getContext() {
    return {
        name1: 'TestUser',
        persona: 'A test persona',
        characters: [],
        characterId: null,
    };
}

// --- /scripts/world-info.js mocks ---
/** Entries getSortedEntries resolves with — tests set this. */
export const mockSortedEntries = [];
export async function getSortedEntries() { return [...mockSortedEntries]; }

// --- /scripts/group-chats.js mocks ---
export const groups = [];
export const selected_group = null;

// --- /scripts/popup.js mocks ---
export class Popup {
    constructor() {}
    async show() {}
}
export const POPUP_TYPE = { TEXT: 0 };

// --- /scripts/preset-manager.js mocks ---
/** In-memory preset list, shaped like ST's openai_settings / openai_setting_names. */
export const mockPresetList = { presets: [], preset_names: {} };
/** Presets written through savePreset — tests assert on this. */
export const savedPresets = {};
/** Options savePreset was called with, keyed by preset name. */
export const savedPresetOptions = {};

export function getPresetManager() {
    return {
        getAllPresets: () => Object.keys(mockPresetList.preset_names),
        getSelectedPresetName: () => Object.keys(mockPresetList.preset_names)[0] || '',
        getCompletionPresetByName: (name) => {
            const index = mockPresetList.preset_names[name];
            return index === undefined ? undefined : mockPresetList.presets[index];
        },
        getPresetList: () => mockPresetList,
        savePreset: async (name, settings, options = {}) => {
            savedPresets[name] = settings;
            savedPresetOptions[name] = options;
        },
    };
}

// --- /scripts/utils.js mocks ---
let uuidCounter = 0;
export function uuidv4() {
    uuidCounter += 1;
    return `mock-uuid-${uuidCounter}`;
}

// --- /scripts/power-user.js mocks ---
export const power_user = { personas: {}, persona_descriptions: {} };

// --- /scripts/extensions/shared.js mocks ---
export const ConnectionManagerRequestService = {
    sendRequest: async () => ({ text: '' }),
};
