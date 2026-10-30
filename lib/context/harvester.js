/**
 * @file Context harvesting orchestrator
 * @module context/harvester
 *
 * Gathers all story context for arc planning:
 * character, persona, lorebooks, chat history, existing arcs, user input.
 */

import { characters, this_chid } from '/script.js';
import { getContext } from '/scripts/extensions.js';
import { getSortedEntries } from '/scripts/world-info.js';
import { getRecentChat, estimateTokens } from './chat-history.js';
import { getActiveArcs, getArcs } from '../planning/storage.js';
import { arcInternalIds } from '../injection/signals.js';
import { INJECTION_HEADER } from '../core/constants.js';

/**
 * @typedef {object} HarvestedContext
 * @property {object|null} character - Character card data
 * @property {object} persona - User persona data
 * @property {{ constants: object[], arcSummaries: object[], recent: object[] }} lorebook
 * @property {object[]} chatHistory - Recent messages
 * @property {object[]} existingArcs - Currently active arc plans
 * @property {number} estimatedTokens - Rough token estimate of all context
 */

/**
 * Harvest all available context for arc planning.
 * @param {number} [chatDepth=50] - How many recent messages to include
 * @param {Set<string>} [excludeEntryIds] - Lorebook entry UIDs to exclude
 * @returns {Promise<HarvestedContext>}
 */
export async function harvestContext(chatDepth = 50, excludeEntryIds = new Set()) {
    const lorebookEntries = await fetchLorebookEntries();

    const filteredEntries = excludeEntryIds.size > 0
        ? lorebookEntries.filter(entry => !excludeEntryIds.has(String(entry.uid)))
        : lorebookEntries;
    const lorebook = categorizeEntries(filteredEntries);
    const character = getCharacterData();
    const persona = getPersonaData();
    const chatHistory = selectStoryMessages(getRecentChat(chatDepth), getArcs());

    const existingArcs = getActiveArcs();

    const characterText = character ? `${character.description}\n${character.personality}\n${character.scenario}` : '';
    const parts = [
        characterText,
        persona.description,
        ...lorebook.constants.map(entry => entry.content),
        ...lorebook.arcSummaries.map(entry => entry.content),
        ...lorebook.recent.map(entry => entry.content),
        ...chatHistory.map(message => message.content),
    ];
    const totalText = parts.join('\n');
    const estimatedTokens = estimateTokens(totalText);

    return {
        character,
        persona,
        lorebook,
        chatHistory,
        existingArcs,
        estimatedTokens,
    };
}

/**
 * Drop the messages that carry plan internals instead of story: any message
 * naming an id of a stored arc (of any status), quoting the injection header
 * or holding a signal marker. A narrator's OOC analysis that printed a secret
 * beside its id was read by the planner as story fact, and the secret came
 * back as a milestone pressure (Paragon chat, 2026-10-30). Other OOC messages
 * stay: the user's own direction belongs in the planner's input.
 * @param {{ role: string, name: string, content: string }[]} messages
 * @param {object[]} arcs - Every stored arc of the chat
 * @returns {{ role: string, name: string, content: string }[]}
 */
function selectStoryMessages(messages, arcs) {
    const planMarkers = [...arcInternalIds(arcs), INJECTION_HEADER, 'ARC_SIGNAL'];
    return messages.filter(message => !planMarkers.some(marker => message.content.includes(marker)));
}

/*
 * Lorebook / World Info adapter.
 *
 * Fetches the world info entries ST itself would scan for the current chat:
 * chat lorebook, persona lore, character lore and global books, via ST's
 * getSortedEntries(). getContext() exposes no worldInfo, and the HTTP
 * /api/worldinfo endpoints need a CSRF token and return every book on
 * the server rather than the ones bound to this chat.
 */

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
        const sortedEntries = await getSortedEntries();
        return filterAndSort(sortedEntries);
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
        .filter(entry => !entry.disable)
        .sort((firstEntry, secondEntry) => (firstEntry.order || 100) - (secondEntry.order || 100));
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

/**
 * Get current character card data
 * @returns {{ name: string, description: string, personality: string, scenario: string } | null}
 */
function getCharacterData() {
    if (this_chid === undefined || this_chid === null) {
        console.warn('[Story Arc] No character selected');
        return null;
    }
    const char = characters[this_chid];
    if (!char) return null;

    return {
        name: char.name || '',
        description: char.description || '',
        personality: char.personality || '',
        scenario: char.scenario || '',
    };
}

/**
 * Get user persona name and description
 * @returns {{ name: string, description: string }}
 */
function getPersonaData() {
    const context = getContext();
    return {
        name: context.name1 || 'User',
        description: context.persona || '',
    };
}
