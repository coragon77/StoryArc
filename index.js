/**
 * Story Arc Extension for SillyTavern
 * Plans new story arcs for existing long-running stories using lorebook,
 * chat history, and summaries as context.
 */
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    chat,
    chat_metadata,
    saveMetadata,
    generateRaw,
} from '/script.js';

import {
    extension_settings,
    getContext,
} from '/scripts/extensions.js';

import { groups, selected_group } from '/scripts/group-chats.js';
import { Popup, POPUP_TYPE } from '/scripts/popup.js';

import { MODULE_NAME, defaultSettings } from './lib/core/constants.js';

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Load extension settings, merging defaults for missing keys
 */
function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    Object.entries(defaultSettings).forEach(([key, value]) => {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = value;
        }
    });
}

/**
 * Get current extension settings
 * @returns {object}
 */
export function getSettings() {
    return extension_settings[MODULE_NAME] || defaultSettings;
}

// ─── Extension Entry Point ───────────────────────────────────────────────────

jQuery(async () => {
    loadSettings();

    // TODO: Load settings UI panel HTML
    // TODO: Wire up event listeners
    // TODO: Register SillyTavern events

    console.log('[Story Arc] Extension loaded');
});
