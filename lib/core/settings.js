/**
 * @file Settings management for Story Arc
 * @module core/settings
 */

import { extension_settings, getContext } from '/scripts/extensions.js';
import { chat, chat_metadata, saveMetadata } from '/script.js';
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

    let migrated = false;
    for (const arc of chat_metadata.story_arc.arcs || []) {
        migrated = migrateArc(arc, chat.length) || migrated;
    }
    if (migrated) {
        saveMetadata();
    }
}

/**
 * Bring an arc planned before tiers existed onto the current schema, in place.
 *
 * Arcs without a tier are all episodes: their beats are ordered scene beats,
 * and presenting them as milestones is the mismatch the tier split was made
 * to end (ADR-0001). The old focus values map foreground → normal and
 * background → paused; a paused arc's clock freezes at the migration point.
 *
 * @param {object} arc - Stored arc, mutated
 * @param {number} chatLength - chat.length at migration, becomes pausedAt
 * @returns {boolean} Whether anything changed
 */
export function migrateArc(arc, chatLength) {
    if (arc.tier) return false;

    arc.tier = 'episode';
    if (arc.focus === 'background') {
        arc.focus = 'paused';
        arc.pausedAt = chatLength;
    } else {
        arc.focus = 'normal';
        arc.pausedAt = null;
    }
    return true;
}

/**
 * The arc's tier. migrateArc gives every stored arc one; an arc that has not
 * passed through it counts as an episode by the same rule.
 * @param {object} arc
 * @returns {string}
 */
export function arcTier(arc) {
    return arc.tier || 'episode';
}

/**
 * The chat index the arc's pacing counts from. Every arc gets messageStart
 * at planning (createDefaultArc); an arc without one counts from the start of
 * the chat instead of producing NaN.
 * @param {object} arc
 * @returns {number}
 */
export function arcMessageStart(arc) {
    return arc.messageStart || 0;
}

/**
 * Get per-chat settings
 * @returns {object}
 */
export function getChatSettings() {
    // May migrate stored arcs and save: the migration runs before the first
    // read of a chat by design (architecture.md, lib/core/, "Migration").
    ensureChatState();
    return chat_metadata.story_arc.settings;
}
