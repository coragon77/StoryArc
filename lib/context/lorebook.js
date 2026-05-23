/**
 * @file Lorebook / World Info adapter
 * @module context/lorebook
 *
 * Fetches world info entries from all connected lorebooks.
 * Primary: getContext().worldInfo (client-side, fast)
 * Fallback: HTTP API /api/worldinfo/list + /get (full multi-book access)
 */

import { getContext } from '/scripts/extensions.js';

/**
 * @typedef {object} LorebookEntry
 * @property {string} comment - Display name / label
 * @property {string} content - The lorebook entry text
 * @property {string[]} key - Trigger keywords
 * @property {boolean} constant - Always active (not keyword-triggered)
 * @property {boolean} disable - Entry is disabled
 * @property {number} order - Sort order
 * @property {string} [world] - Which lorebook this came from
 */

/**
 * Fetch all enabled lorebook entries for the current chat.
 * @returns {Promise<LorebookEntry[]>}
 */
export async function fetchLorebookEntries() {
    const context = getContext();
    if (context.worldInfo && Array.isArray(context.worldInfo) && context.worldInfo.length > 0) {
        return filterAndSort(context.worldInfo);
    }

    console.log('[Story Arc] worldInfo not available via context, trying HTTP API');
    return await fetchViaHttpApi();
}

/**
 * Filter out disabled entries and sort by order
 * @param {LorebookEntry[]} entries
 * @returns {LorebookEntry[]}
 */
function filterAndSort(entries) {
    return entries
        .filter(e => !e.disable)
        .sort((a, b) => (a.order || 100) - (b.order || 100));
}

/**
 * Fetch lorebooks via ST's HTTP API
 * @returns {Promise<LorebookEntry[]>}
 */
async function fetchViaHttpApi() {
    try {
        const headers = { 'Content-Type': 'application/json' };
        const listResp = await fetch('/api/worldinfo/list', {
            method: 'POST', headers, body: JSON.stringify({}),
        });
        if (!listResp.ok) {
            console.warn('[Story Arc] Failed to list lorebooks:', listResp.status);
            return [];
        }
        const books = await listResp.json();
        const allEntries = [];

        for (const book of books) {
            const name = book.name || book;
            const getResp = await fetch('/api/worldinfo/get', {
                method: 'POST', headers, body: JSON.stringify({ name }),
            });
            if (!getResp.ok) continue;
            const data = await getResp.json();
            if (!data?.entries) continue;

            for (const [uid, entry] of Object.entries(data.entries)) {
                allEntries.push({ ...entry, world: name, uid: parseInt(uid) });
            }
        }

        return filterAndSort(allEntries);
    } catch (err) {
        console.error('[Story Arc] HTTP lorebook fetch failed:', err);
        return [];
    }
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
