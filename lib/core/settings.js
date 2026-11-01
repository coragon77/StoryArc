/**
 * @file Settings management for Story Arc
 * @module core/settings
 */

import { extension_settings, getContext } from '/scripts/extensions.js';
import { chat, chat_metadata, saveMetadata } from '/script.js';
import {
    MODULE_NAME,
    defaultSettings,
    defaultKnowledgeTrackerSettings,
    defaultPerChatSettings,
    createEmptyKnowledgeLedger,
} from './constants.js';

/**
 * Load global extension settings, merging defaults for missing keys
 */
export function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    const settings = extension_settings[MODULE_NAME];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (settings[key] === undefined) {
            settings[key] = value;
        }
    }

    // The tracker group is filled key by key, as its own copy: a settings
    // file from before a tracker key existed gets that key's default.
    settings.knowledgeTracker = { ...defaultKnowledgeTrackerSettings, ...settings.knowledgeTracker };
}

/**
 * Get current global extension settings
 * @returns {object}
 */
export function getSettings() {
    return extension_settings[MODULE_NAME] || {
        ...defaultSettings,
        knowledgeTracker: { ...defaultKnowledgeTrackerSettings },
    };
}

/**
 * The knowledge tracker's global settings group
 * (extension_settings.story_arc.knowledgeTracker): `enabled` (the on/off
 * switch, off by default) and `updateInterval` (update the ledger every N
 * AI replies, default 1). After loadSettings this is the stored object, so
 * changes to it persist with the next settings save; before, the defaults.
 * @returns {{enabled: boolean, updateInterval: number}}
 */
export function getKnowledgeTrackerSettings() {
    return getSettings().knowledgeTracker || { ...defaultKnowledgeTrackerSettings };
}

/**
 * Check if the knowledge tracker is switched on. While it is off Story Arc
 * runs no extraction call, injects no knowledge block and prints no holders.
 * @returns {boolean}
 */
export function isKnowledgeTrackerEnabled() {
    return getKnowledgeTrackerSettings().enabled === true;
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

    // Not saved on its own: an empty ledger is stored with the next save.
    if (!chat_metadata.story_arc.knowledge) {
        chat_metadata.story_arc.knowledge = createEmptyKnowledgeLedger();
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
 * The names of the characters who hold a secret (ADR-0007). A secret may
 * carry an optional `holders: [name]` list, written by the planner; a secret
 * without one, as every arc planned before the knowledge tracker, has no
 * holders.
 * @param {object} secret - A secret from arc.secrets
 * @returns {string[]}
 */
export function secretHolders(secret) {
    return Array.isArray(secret.holders) ? secret.holders : [];
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

/**
 * The current chat's knowledge ledger (chat_metadata.story_arc.knowledge),
 * the stored object itself: changes to it are stored with the next
 * saveMetadata. Every chat has one after ensureChatState; its shape is
 * documented at createEmptyKnowledgeLedger in constants.js.
 * @returns {object}
 */
export function getKnowledgeLedger() {
    ensureChatState();
    return chat_metadata.story_arc.knowledge;
}
