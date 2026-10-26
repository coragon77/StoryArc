/**
 * @file Context harvesting orchestrator
 * @module context/harvester
 *
 * Gathers all story context for arc planning:
 * character, persona, lorebooks, chat history, existing arcs, user input.
 */

import { getCharacterData, getPersonaData } from './character.js';
import { fetchLorebookEntries, categorizeEntries } from './lorebook.js';
import { getRecentChat, estimateTokens } from './chat-history.js';
import { getActiveArcs } from '../planning/storage.js';

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
    const chatHistory = getRecentChat(chatDepth);

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
