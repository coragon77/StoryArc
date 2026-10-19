/**
 * @file Arc CRUD operations on chat_metadata
 * @module planning/storage
 */

import { chat_metadata, saveMetadata } from '/script.js';
import { ensureChatState } from '../core/settings.js';

/**
 * Get all arcs for the current chat
 * @returns {object[]}
 */
export function getArcs() {
    ensureChatState();
    return chat_metadata.story_arc.arcs || [];
}

/**
 * Get only active arcs
 * @returns {object[]}
 */
export function getActiveArcs() {
    return getArcs().filter(a => a.status === 'active');
}

/**
 * The genre of the newest arc that has one: the wizard's default for a new
 * arc, so a story's genre is typed once and still set per arc (ADR-0004).
 * @param {object[]} arcs - In storage order, oldest first
 * @returns {string} '' when no arc has a genre
 */
export function latestGenre(arcs) {
    for (let i = arcs.length - 1; i >= 0; i--) {
        if (arcs[i].genre) return arcs[i].genre;
    }
    return '';
}

/**
 * Get a specific arc by ID
 * @param {string} arcId
 * @returns {object|undefined}
 */
export function getArcById(arcId) {
    return getArcs().find(a => a.id === arcId);
}

/**
 * Save a new arc to chat_metadata
 * @param {object} arc
 */
export async function saveArc(arc) {
    ensureChatState();
    chat_metadata.story_arc.arcs.push(arc);
    await saveMetadata();
    console.log(`[Story Arc] Saved arc: ${arc.title}`);
}

/**
 * Update an existing arc in place
 * @param {string} arcId
 * @param {object} updates - Partial arc fields to merge
 */
export async function updateArc(arcId, updates) {
    const arcs = getArcs();
    const index = arcs.findIndex(a => a.id === arcId);
    if (index === -1) {
        console.warn(`[Story Arc] Arc not found: ${arcId}`);
        return;
    }
    Object.assign(arcs[index], updates);
    await saveMetadata();
}

/**
 * Delete an arc by ID
 * @param {string} arcId
 */
export async function deleteArc(arcId) {
    ensureChatState();
    chat_metadata.story_arc.arcs = chat_metadata.story_arc.arcs.filter(a => a.id !== arcId);
    await saveMetadata();
}
