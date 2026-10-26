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
    // May migrate stored arcs and save: the migration runs before the first
    // read of a chat by design (architecture.md, lib/core/, "Migration").
    ensureChatState();
    return chat_metadata.story_arc.arcs || [];
}

/**
 * Get only active arcs
 * @returns {object[]}
 */
export function getActiveArcs() {
    return getArcs().filter(arc => arc.status === 'active');
}

/**
 * The genre of the newest arc that has one: the wizard's default for a new
 * arc, so a story's genre is typed once and still set per arc (ADR-0004).
 * @param {object[]} arcs - In storage order, oldest first
 * @returns {string} '' when no arc has a genre
 */
export function latestGenre(arcs) {
    return arcs.findLast(arc => arc.genre)?.genre ?? '';
}

/**
 * Get a specific arc by ID
 * @param {string} arcId
 * @returns {object|undefined}
 */
export function getArcById(arcId) {
    return getArcs().find(arc => arc.id === arcId);
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
    const index = arcs.findIndex(arc => arc.id === arcId);
    if (index === -1) {
        console.warn(`[Story Arc] Arc not found: ${arcId}`);
        return;
    }
    const storedArc = arcs[index];
    Object.assign(storedArc, updates);
    await saveMetadata();
}

/**
 * Replace a stored arc with an edited one, keeping its place in the list.
 * Replace, not merge: a field deleted in the editor must go. In place,
 * because the stored arc is the object inside chat_metadata.
 * @param {object} storedArc - The arc as stored now (from getArcById)
 * @param {object} arc - The arc to store instead
 */
export async function replaceArc(storedArc, arc) {
    for (const key of Object.keys(storedArc)) delete storedArc[key];
    Object.assign(storedArc, arc);
    await saveMetadata();
}

/**
 * Delete an arc by ID
 * @param {string} arcId
 */
export async function deleteArc(arcId) {
    ensureChatState();
    chat_metadata.story_arc.arcs = chat_metadata.story_arc.arcs.filter(arc => arc.id !== arcId);
    await saveMetadata();
}
