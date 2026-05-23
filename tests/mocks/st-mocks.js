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

// --- /scripts/extensions.js mocks ---
export const extension_settings = {};
export function getContext() {
    return {
        name1: 'TestUser',
        persona: 'A test persona',
        characters: [],
        characterId: null,
        worldInfo: [],
    };
}

// --- /scripts/group-chats.js mocks ---
export const groups = [];
export const selected_group = null;

// --- /scripts/popup.js mocks ---
export class Popup {
    constructor() {}
    async show() {}
}
export const POPUP_TYPE = { TEXT: 0 };

// --- /scripts/power-user.js mocks ---
export const power_user = { personas: {}, persona_descriptions: {} };

// --- /scripts/extensions/shared.js mocks ---
export const ConnectionManagerRequestService = {
    sendRequest: async () => ({ text: '' }),
};
