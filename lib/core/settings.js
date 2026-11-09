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
 * switch, off by default), `updateInterval` (update the ledger every N
 * AI replies, default 1) and `characterDetails` (the character details
 * switch, off by default). After loadSettings this is the stored object, so
 * changes to it persist with the next settings save; before, the defaults.
 * @returns {{enabled: boolean, updateInterval: number, characterDetails: boolean}}
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
 * Check if character details are switched on: Story Arc, the knowledge
 * tracker and its details switch are all on. While they are off the
 * extraction is not asked for details and its details are ignored, and
 * the knowledge block and the Knowledge popup show none; the details a
 * ledger already holds stay, and still roll back with their messages.
 * @returns {boolean}
 */
export function isCharacterDetailsEnabled() {
    return isEnabled() && isKnowledgeTrackerEnabled() && getKnowledgeTrackerSettings().characterDetails === true;
}

/**
 * Where the current chat's beats are recognised as fulfilled (ADR-0008):
 * - 'off': the chat's `autoTrack` is off, nothing is recognised; a beat
 *   completes only by hand in the Arc Manager;
 * - 'extraction': the knowledge tracker is on, so the knowledge extraction
 *   recognises them after each reply and the narrator never sees a
 *   fulfillment;
 * - 'marker': the knowledge tracker is off, so the narrator recognises them
 *   through the BEAT CHECK's in-prompt ARC_SIGNAL markers.
 * The one place this decision is made.
 * @returns {'off'|'marker'|'extraction'}
 */
export function beatRecognitionPath() {
    if (!getChatSettings().autoTrack) return 'off';
    return isKnowledgeTrackerEnabled() ? 'extraction' : 'marker';
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
 * Whether a beat or milestone is still open: neither completed nor skipped.
 * A milestone is skipped when the story fulfils a later one first; it is
 * obsolete, not failed, and a re-plan keeps it like a completed one
 * (Stefan, 2026-11-09: an arc is one plot thread, its milestones run in order).
 * @param {object} beat
 * @returns {boolean}
 */
export function isBeatOpen(beat) {
    return beat.status !== 'completed' && beat.status !== 'skipped';
}

/**
 * Whether the arc has a skipped non-optional beat: the beat strip's count
 * and the Arc Manager's "every milestone done" note then say "done or
 * skipped". Optional beats are left out, as both count only the
 * non-optional ones.
 * @param {object} arc
 * @returns {boolean}
 */
export function hasSkippedBeats(arc) {
    return (arc.beats || []).some(beat => !beat.optional && beat.status === 'skipped');
}

/**
 * The milestone an act or saga presses now: the first open milestone after
 * the last completed one, in the planner's order (ADR-0010). An open
 * milestone before a completed one is passed: the story is already beyond
 * it, so it is never current and its pressure is never printed. Such a
 * milestone is left by a rollback, an edit or a hand change, and this
 * definition covers every one of them. It stays active, so recognition
 * still sees it, like every open milestone; only the current one's pressure
 * reaches the narrator. Arcs stored before the order rule have every
 * milestone active and need no migration: their first one is current.
 * @param {object} arc - An act or saga
 * @returns {object|null} The current milestone, null when none is open after the last completed one
 */
export function currentMilestone(arc) {
    const beats = arc.beats || [];
    let lastCompletedIndex = -1;
    beats.forEach((beat, index) => {
        if (beat.status === 'completed') lastCompletedIndex = index;
    });
    const notPassed = beats.slice(lastCompletedIndex + 1);
    return notPassed.find(isBeatOpen) || null;
}

/**
 * The arc's world facts (ADR-0009). Arcs planned before world facts have
 * none; re-planning one is its conversion.
 * @param {object} arc
 * @returns {string[]}
 */
export function arcWorldFacts(arc) {
    return Array.isArray(arc.worldFacts) ? arc.worldFacts : [];
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
