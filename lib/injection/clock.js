/**
 * @file Pacing clock — which episode stamps and brakes, pausing it, and
 * reactivating a past arc
 * @module injection/clock
 *
 * One episode's message count drives the per-message stamps and the phase
 * brake. Paused episodes and all acts and sagas (background included) are
 * never the clock.
 */

import { chat } from '/script.js';
import { getArcById, getActiveArcs, updateArc } from '../planning/storage.js';
import { arcMessageStart, arcTier } from '../core/settings.js';

/**
 * Pick the pacing clock: the spotlit episode if there is one, otherwise the
 * first normal episode in storage order.
 * @param {object[]} arcs - Active arcs
 * @returns {object|undefined} The clock arc, or undefined when nothing qualifies
 */
export function selectPacingClock(arcs) {
    const episodes = arcs.filter(arc => arcTier(arc) === 'episode');
    const spotlitEpisode = episodes.find(episode => episode.focus === 'spotlight');
    if (spotlitEpisode) return spotlitEpisode;
    const firstNormalEpisode = episodes.find(episode => episode.focus === 'normal');
    return firstNormalEpisode;
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
 * while it stood still are added to messageStart, lastFulfilledAt,
 * replannedAt, reactivatedAt and spotlitAt, so the stamps, the phase and the stall
 * count continue where they stopped; the two stamps get only the messages
 * after them, so a re-plan applied during the pause counts from the resume. An arc that was never
 * paused, or was already resumed, only gets its focus written — the arc
 * manager routes every background/normal/spotlight change through here.
 * @param {string} arcId
 * @param {'background'|'normal'|'spotlight'} [focus='normal']
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
        messageStart: arcMessageStart(arc) + pausedSpan,
    };
    // Arcs migrated from the pre-tier `background` value have no
    // lastFulfilledAt yet (set at planning since #8); leave it absent rather
    // than inventing a value.
    if (typeof arc.lastFulfilledAt === 'number') {
        updates.lastFulfilledAt = arc.lastFulfilledAt + pausedSpan;
    }
    // The re-plan stamp (applyReplan) is absent on arcs never re-planned.
    // Only the part of the pause after the stamp shifts it: a re-plan during
    // the pause becomes the resume point.
    if (typeof arc.replannedAt === 'number') {
        const pausedSinceStamp = chat.length - Math.max(arc.pausedAt, arc.replannedAt);
        updates.replannedAt = arc.replannedAt + pausedSinceStamp;
    }
    // The reactivation stamp (reactivateArc) follows the same rule; absent
    // on arcs never reactivated.
    if (typeof arc.reactivatedAt === 'number') {
        const pausedSinceStamp = chat.length - Math.max(arc.pausedAt, arc.reactivatedAt);
        updates.reactivatedAt = arc.reactivatedAt + pausedSinceStamp;
    }
    // The spotlight stamp (spotlightArc) too; absent on arcs never spotlit.
    if (typeof arc.spotlitAt === 'number') {
        const pausedSinceStamp = chat.length - Math.max(arc.pausedAt, arc.spotlitAt);
        updates.spotlitAt = arc.spotlitAt + pausedSinceStamp;
    }
    await updateArc(arcId, updates);
}

/**
 * Spotlight an arc. Only one arc stands in the spotlight: every other
 * spotlit arc goes back to normal. The arc itself resumes like any other
 * focus change, so a paused arc's clock shifts.
 *
 * An arc that was not spotlit already gets spotlitAt, the chat length,
 * where its stall count restarts (isStalled), as after a re-plan: the
 * narrator is now told to bring its pressures to a head, so the stall
 * counted before that push is answered. A stall after it shows again,
 * unlike an ignored one. Spotlighting an arc already in the spotlight
 * keeps its stamp.
 * @param {string} arcId
 */
export async function spotlightArc(arcId) {
    const otherSpotlit = getActiveArcs().filter(arc => arc.focus === 'spotlight' && arc.id !== arcId);
    for (const arc of otherSpotlit) {
        await resumeArc(arc.id, 'normal');
    }
    const wasSpotlit = getArcById(arcId)?.focus === 'spotlight';
    await resumeArc(arcId, 'spotlight');
    if (!wasSpotlit && getArcById(arcId)) {
        await updateArc(arcId, { spotlitAt: chat.length });
    }
}

/**
 * Reactivate a past arc (completed or abandoned): it is active again, in
 * normal focus. Normal, whatever focus it ended in, so it never takes the
 * spotlight from the arc that holds it now; tier and pacing clock follow
 * as for any focus change, and an arc that ended while paused resumes
 * through resumeArc, so its clock shifts by the paused span.
 *
 * reactivatedAt stamps the chat length, where the stall count (isStalled)
 * restarts, as after a re-plan: the messages the arc sat out ended do not
 * count as a stall. A field of its own, like replannedAt, so
 * lastFulfilledAt keeps its one meaning. messageStart moves to the chat
 * length too, so the phase count (calculatePhase), the phase brake and the
 * stamps start over: the messages since the arc first began would
 * otherwise put it straight into resolution. The beats are not touched: a
 * completed arc comes back with its beats completed, for the player to
 * re-plan or set back by hand. An arc that is active already is left as
 * it is.
 * @param {string} arcId
 */
export async function reactivateArc(arcId) {
    const arc = getArcById(arcId);
    if (!arc) {
        console.warn(`[Story Arc] Arc not found: ${arcId}`);
        return;
    }
    if (arc.status === 'active') return;

    await resumeArc(arcId, 'normal');
    await updateArc(arcId, { status: 'active', reactivatedAt: chat.length, messageStart: chat.length });
    console.log(`[Story Arc] Arc reactivated: "${arc.title}"`);
}
