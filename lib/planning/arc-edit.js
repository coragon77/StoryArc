/**
 * @file Hand edits to a stored arc — the Arc Manager's beat editor and arc JSON editor
 * @module planning/arc-edit
 */

import { TIER_TABLE } from '../core/constants.js';

/**
 * Check an edited beat against the rules validateArcPlan applies to new ones.
 * The intention is always required: the beat check prints it as the
 * fulfillment condition. A milestone also needs a pressure, because the
 * milestone section prints nothing else (ADR-0002).
 * @param {string} tier - The arc's tier
 * @param {{ pressure: string, intention: string }} edit - Trimmed texts
 * @returns {string|null} Error message, or null when the edit is valid
 */
export function checkBeatEdit(tier, edit) {
    if (!edit.intention) return '"Fulfilled when" cannot be empty.';

    const isMilestone = TIER_TABLE[tier || 'episode']?.beatKind === 'milestone';
    if (isMilestone && !edit.pressure) return 'A milestone needs a pressure.';

    return null;
}

/** Fields the user may not change: the pacing clock, signal matching and focus depend on them */
const KEPT_ARC_FIELDS = ['id', 'status', 'tier', 'focus', 'createdAt', 'messageStart', 'lastFulfilledAt', 'pausedAt'];

/** Fields the injection sections iterate over; a non-array breaks every generation */
const ARRAY_ARC_FIELDS = ['themes', 'directives', 'antiPatterns', 'secrets', 'foreshadowing', 'triggers', 'characters', 'beats'];

/**
 * Turn the arc JSON edited in the Arc Manager into the arc to store. The
 * bookkeeping fields always come from the stored arc, whatever the text says.
 * @param {object} storedArc - The arc as stored now
 * @param {string} text - The edited JSON
 * @returns {{ arc: object|null, error: string|null }}
 */
export function applyArcEdit(storedArc, text) {
    let edited;
    try {
        edited = JSON.parse(text);
    } catch (err) {
        return { arc: null, error: `Not valid JSON: ${err.message}` };
    }
    if (!edited || typeof edited !== 'object' || Array.isArray(edited)) {
        return { arc: null, error: 'The arc must be a JSON object.' };
    }

    if (!String(edited.title || '').trim()) return { arc: null, error: 'title cannot be empty.' };
    if (!String(edited.premise || '').trim()) return { arc: null, error: 'premise cannot be empty.' };

    for (const field of ARRAY_ARC_FIELDS) {
        if (!Array.isArray(edited[field])) return { arc: null, error: `${field} must be a list.` };
    }
    if (edited.beats.length === 0) return { arc: null, error: 'An arc needs at least one beat.' };

    if (!(Number(edited.estimatedLength) > 0)) {
        return { arc: null, error: 'estimatedLength must be a number above 0.' };
    }

    const beatIds = new Set();
    for (const beat of edited.beats) {
        if (!beat || !beat.id) return { arc: null, error: 'Every beat needs an id.' };
        if (beatIds.has(beat.id)) return { arc: null, error: `Beat id "${beat.id}" is used twice.` };
        beatIds.add(beat.id);

        if (!Array.isArray(beat.unlockAfter)) return { arc: null, error: `Beat "${beat.id}": unlockAfter must be a list.` };

        const beatError = checkBeatEdit(storedArc.tier, {
            pressure: String(beat.pressure || '').trim(),
            intention: String(beat.intention || '').trim(),
        });
        if (beatError) return { arc: null, error: `Beat "${beat.id}": ${beatError}` };
    }

    const arc = { ...edited, estimatedLength: Number(edited.estimatedLength) };
    for (const field of KEPT_ARC_FIELDS) {
        arc[field] = storedArc[field];
    }
    return { arc, error: null };
}

/**
 * Remove a beat and clean up the beats that waited for it. Its id leaves
 * every unlockAfter list; a locked beat whose remaining prerequisites are all
 * completed becomes pending. Signal processing unlocks only when a
 * prerequisite completes, so without this the beat would stay locked forever.
 * Does not mutate the input.
 * @param {object[]} beats
 * @param {string} beatId
 * @returns {object[]} The remaining beats
 */
export function removeBeat(beats, beatId) {
    const remaining = beats.filter(b => b.id !== beatId);

    return remaining.map(beat => {
        const waitedForDeleted = (beat.unlockAfter || []).includes(beatId);
        const unlockAfter = (beat.unlockAfter || []).filter(id => id !== beatId);
        const unlocked = beat.status === 'locked' && waitedForDeleted && unlockAfter.every(
            reqId => remaining.find(b => b.id === reqId)?.status === 'completed'
        );
        return { ...beat, unlockAfter, status: unlocked ? 'pending' : beat.status };
    });
}
