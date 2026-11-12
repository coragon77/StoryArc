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
/** Call counts tests can assert on — reset them in the test that reads them. */
export const mockCalls = { saveSettingsDebounced: 0 };
export function saveSettingsDebounced() { mockCalls.saveSettingsDebounced += 1; }
/** Every setExtensionPrompt call as its argument list — clear it in the test that reads it. */
export const extensionPromptCalls = [];
/** ST's prompt registry, which setExtensionPrompt fills as ST's does. */
export const extension_prompts = {};
export function setExtensionPrompt(...args) {
    extensionPromptCalls.push(args);
    const [key, value, position, depth, scan = false, role = 0] = args;
    extension_prompts[key] = { value: String(value), position: Number(position), depth: Number(depth), scan: !!scan, role: Number(role) };
}
// Values as in ST's script.js
export const extension_prompt_types = { IN_PROMPT: 0, IN_CHAT: 1 };
export const extension_prompt_roles = { SYSTEM: 0 };
export function saveMetadata() {}
export function generateRaw() { return ''; }
export function getRequestHeaders() { return {}; }

// --- /scripts/extensions.js mocks ---
export const extension_settings = {};
/** Fields a test lays over the context getContext returns — clear it in the test that sets it. */
export const mockContextFields = {};
export function getContext() {
    return {
        name1: 'TestUser',
        characters: [],
        characterId: null,
        ...mockContextFields,
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
/**
 * Every Popup constructed, in order, and whether show() waits for complete().
 * By default show() resolves at once; a test that drives a popup's handlers
 * sets holdOpen, so the popup stays open until its complete() — and clears
 * both in its own cleanup.
 */
export const mockPopups = [];
export const mockPopupState = { holdOpen: false };
export class Popup {
    constructor(content) {
        this.content = content;
        this.completedWith = undefined;
        this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
        mockPopups.push(this);
    }
    async show() {
        if (mockPopupState.holdOpen) await this.closed;
    }
    complete(result) {
        this.completedWith = result;
        this.resolveClosed(result);
    }
}
export const POPUP_TYPE = { TEXT: 0 };

// --- /scripts/preset-manager.js mocks ---
/** In-memory preset list, shaped like ST's openai_settings / openai_setting_names. */
export const mockPresetList = { presets: [], preset_names: {} };
/** Presets written through savePreset — tests assert on this. */
export const savedPresets = {};
/** Options savePreset was called with, keyed by preset name. */
export const savedPresetOptions = {};

/** Set `available` to false to make getPresetManager return null (no Chat Completion API). */
export const mockPresetManagerState = { available: true };

export function getPresetManager() {
    if (!mockPresetManagerState.available) return null;
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

// Same bodies as ST's public/scripts/utils.js
export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

export function getStringHash(str, seed = 0) {
    if (typeof str !== 'string') {
        return 0;
    }

    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// --- /scripts/power-user.js mocks ---
export const power_user = { personas: {}, persona_descriptions: {} };

// --- /scripts/extensions/shared.js mocks ---
export const ConnectionManagerRequestService = {
    sendRequest: async () => ({ text: '' }),
};
