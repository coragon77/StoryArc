/**
 * @file Settings management for Story Arc
 * @module core/settings
 */

import { extension_settings, getContext } from '/scripts/extensions.js';
import { chat_metadata, saveMetadata } from '/script.js';
import { MODULE_NAME, defaultSettings, defaultPerChatSettings } from './constants.js';

/**
 * Load global extension settings, merging defaults for missing keys
 */
export function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = value;
        }
    }
}

/**
 * Get current global extension settings
 * @returns {object}
 */
export function getSettings() {
    return extension_settings[MODULE_NAME] || { ...defaultSettings };
}

/**
 * Check if the extension is enabled
 * @returns {boolean}
 */
export function isEnabled() {
    return getSettings().enabled === true;
}

/**
 * Initialize per-chat story_arc namespace in chat_metadata if missing.
 * Call this on CHAT_CHANGED and before any arc operations.
 */
export function ensureChatState() {
    if (!chat_metadata.story_arc) {
        chat_metadata.story_arc = {
            version: 1,
            arcs: [],
            settings: { ...defaultPerChatSettings },
        };
    }
    if (!chat_metadata.story_arc.settings) {
        chat_metadata.story_arc.settings = { ...defaultPerChatSettings };
    }
    for (const [key, value] of Object.entries(defaultPerChatSettings)) {
        if (chat_metadata.story_arc.settings[key] === undefined) {
            chat_metadata.story_arc.settings[key] = value;
        }
    }
}

/**
 * Get per-chat settings
 * @returns {object}
 */
export function getChatSettings() {
    ensureChatState();
    return chat_metadata.story_arc.settings;
}
