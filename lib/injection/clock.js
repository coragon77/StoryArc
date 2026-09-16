/**
 * @file Pacing clock — which episode stamps and brakes, and pausing it
 * @module injection/clock
 *
 * One episode's message count drives the per-message stamps and the phase
 * brake. Paused episodes and all acts and sagas are never the clock.
 */

import { chat } from '/script.js';
import { getArcById, updateArc } from '../planning/storage.js';

/**
 * Pick the pacing clock: the spotlit episode if there is one, otherwise the
 * first normal episode in storage order.
 * @param {object[]} arcs - Active arcs
 * @returns {object|undefined} The clock arc, or undefined when nothing qualifies
 */
export function selectPacingClock(arcs) {
    const episodes = arcs.filter(a => (a.tier || 'episode') === 'episode');
    return episodes.find(a => a.focus === 'spotlight') || episodes.find(a => a.focus === 'normal');
}

/**
 * Pause an arc: set focus to paused and freeze its clock at the current chat
 * length. Pausing an already paused arc keeps the original freeze point, so
 * the span it sat out is not shortened.
 * @param {string} arcId
 */
export async function pauseArc(arcId) {
    const arc = getArcById(arcId);
    if (!arc) {
        console.warn(`[Story Arc] Arc not found: ${arcId}`);
        return;
    }
    const pausedAt = arc.pausedAt ?? chat.length;
    await updateArc(arcId, { focus: 'paused', pausedAt });
}

/**
 * Resume an arc into the given focus. If it was paused, the messages written
 * while it stood still are added to messageStart and lastFulfilledAt, so the
 * stamps and the phase continue where they stopped. An arc that was never
 * paused, or was already resumed, only gets its focus written — the arc
 * manager routes every normal/spotlight change through here.
 * @param {string} arcId
 * @param {'normal'|'spotlight'} [focus='normal']
 */
export async function resumeArc(arcId, focus = 'normal') {
    const arc = getArcById(arcId);
    if (!arc) {
        console.warn(`[Story Arc] Arc not found: ${arcId}`);
        return;
    }
    if (arc.pausedAt == null) {
        await updateArc(arcId, { focus });
        return;
    }

    const pausedSpan = chat.length - arc.pausedAt;
    const updates = {
        focus,
        pausedAt: null,
        messageStart: (arc.messageStart || 0) + pausedSpan,
    };
    // Migrated background arcs have no lastFulfilledAt yet (set at planning
    // since #8); leave it absent rather than inventing a value.
    if (typeof arc.lastFulfilledAt === 'number') {
        updates.lastFulfilledAt = arc.lastFulfilledAt + pausedSpan;
    }
    await updateArc(arcId, updates);
}
