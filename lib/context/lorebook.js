/**
 * @file Lorebook / World Info adapter
 * @module context/lorebook
 *
 * Fetches the world info entries ST itself would scan for the current chat:
 * chat lorebook, persona lore, character lore and global books, via ST's
 * getSortedEntries(). getContext() exposes no worldInfo, and the HTTP
 * /api/worldinfo endpoints need a CSRF token and return every book on
 * the server rather than the ones bound to this chat.
 */

import { getSortedEntries } from '/scripts/world-info.js';

/**
 * @typedef {object} LorebookEntry
 * @property {number} uid - Entry id, unique within its book
 * @property {string} comment - Display name / label
 * @property {string} content - The lorebook entry text
 * @property {string[]} key - Trigger keywords
 * @property {boolean} constant - Always active (not keyword-triggered)
 * @property {boolean} disable - Entry is disabled
 * @property {number} order - Sort order
 * @property {string} world - Which lorebook this came from
 */

/**
 * Fetch all enabled lorebook entries for the current chat.
 * @returns {Promise<LorebookEntry[]>}
 */
export async function fetchLorebookEntries() {
    try {
        return filterAndSort(await getSortedEntries());
    } catch (err) {
        console.error('[Story Arc] Lorebook fetch failed:', err);
        return [];
    }
}

/**
 * Filter out disabled entries and sort by order
 * @param {LorebookEntry[]} entries
 * @returns {LorebookEntry[]}
 */
export function filterAndSort(entries) {
    return entries
        .filter(e => !e.disable)
        .sort((a, b) => (a.order || 100) - (b.order || 100));
}

/**
 * Categorize lorebook entries into constants, arc summaries, and recent memories.
 * @param {LorebookEntry[]} entries - Filtered, sorted entries
 * @returns {{ constants: LorebookEntry[], arcSummaries: LorebookEntry[], recent: LorebookEntry[] }}
 */
export function categorizeEntries(entries) {
    const constants = [];
    const arcSummaries = [];
    const recent = [];

    for (const entry of entries) {
        if (entry.constant) {
            constants.push(entry);
        } else if (/\[ARC\s/i.test(entry.comment || '')) {
            arcSummaries.push(entry);
        } else {
            recent.push(entry);
        }
    }

    return { constants, arcSummaries, recent };
}
