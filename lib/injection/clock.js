/**
 * @file Pacing clock — which episode stamps and brakes, and pausing it
 * @module injection/clock
 *
 * One episode's message count drives the per-message stamps and the phase
 * brake. Paused episodes and all acts and sagas are never the clock.
 */

import { updateArc } from '../planning/storage.js';

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
 * Pause an arc. Stub: only writes focus. The clock freeze (pausedAt) is
 * filled in by the focus ticket.
 * @param {string} arcId
 */
export async function pauseArc(arcId) {
    await updateArc(arcId, { focus: 'paused' });
}

/**
 * Resume an arc into the given focus. Stub: only writes focus. The clock
 * shift (messageStart, lastFulfilledAt) is filled in by the focus ticket.
 * @param {string} arcId
 * @param {'normal'|'spotlight'} [focus='normal']
 */
export async function resumeArc(arcId, focus = 'normal') {
    await updateArc(arcId, { focus });
}
