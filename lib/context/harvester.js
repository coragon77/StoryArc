/**
 * @file Context harvesting orchestrator
 * @module context/harvester
 *
 * Gathers all story context for arc planning:
 * character, persona, lorebooks, chat history, existing arcs, user input.
 */

import { chat_metadata } from '/script.js';
import { getCharacterData, getPersonaData } from './character.js';
import { fetchLorebookEntries, categorizeEntries } from './lorebook.js';
import { getRecentChat, estimateTokens } from './chat-history.js';
import { ensureChatState } from '../core/settings.js';

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
    const [lorebookEntries] = await Promise.all([
        fetchLorebookEntries(),
    ]);

    const character = getCharacterData();
    const persona = getPersonaData();
    const filteredEntries = excludeEntryIds.size > 0
        ? lorebookEntries.filter(e => !excludeEntryIds.has(String(e.uid)))
        : lorebookEntries;
    const lorebook = categorizeEntries(filteredEntries);
    const chatHistory = getRecentChat(chatDepth);

    ensureChatState();
    const existingArcs = (chat_metadata.story_arc?.arcs || [])
        .filter(a => a.status === 'active');

    const parts = [
        character ? `${character.description}\n${character.personality}\n${character.scenario}` : '',
        persona.description,
        ...lorebook.constants.map(e => e.content),
        ...lorebook.arcSummaries.map(e => e.content),
        ...lorebook.recent.map(e => e.content),
        ...chatHistory.map(m => m.content),
    ];
    const totalText = parts.join('\n');

    return {
        character,
        persona,
        lorebook,
        chatHistory,
        existingArcs,
        estimatedTokens: estimateTokens(totalText),
    };
}
