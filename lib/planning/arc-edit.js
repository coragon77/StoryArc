/**
 * @file Hand edits to a stored arc — the Arc Manager's beat editor and arc JSON editor
 * @module planning/arc-edit
 */

import { TIER_TABLE } from '../core/constants.js';

/**
 * Check an edited beat against the beat rules validateArcPlan applies to new
 * ones. The intention is always required: the beat check prints it as the
 * fulfillment condition. A milestone also needs a pressure, because the
 * milestone section prints nothing else (ADR-0002). An unknown tier counts as
 * an episode, as in validateArcPlan.
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
 *
 * Shares the content rules of validateArcPlan (planning/validation.js):
 * non-blank title and premise, at least one beat, unique beat ids, and
 * checkBeatEdit per beat. It differs on purpose where the model boundary
 * repairs and the user boundary refuses, because a user who typed a value
 * should see it refused rather than silently rewritten:
 * - a missing beat id, a non-list unlockAfter and a non-list list field are
 *   errors here; validateArcPlan fills ids positionally and wraps values
 *   into lists.
 * - estimatedLength only has to be above 0 here; validateArcPlan clamps the
 *   model's guess into the tier's length band. A hand-set length outside
 *   the band is the user's call.
 * - Beat status and the milestone shape (all active, no unlockAfter) are
 *   not checked here; validateArcPlan sets them for new arcs. A milestone
 *   edited to pending is activated again by promoteNextBeats on the next
 *   user message, and a locked one unlocks through its prerequisites like a
 *   scene beat.
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

    const titleOrPremiseError = checkTitleAndPremise(edited.title, edited.premise);
    if (titleOrPremiseError) return { arc: null, error: titleOrPremiseError };

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

        const pressure = String(beat.pressure || '').trim();
        const intention = String(beat.intention || '').trim();
        const beatError = checkBeatEdit(storedArc.tier, { pressure, intention });
        if (beatError) return { arc: null, error: `Beat "${beat.id}": ${beatError}` };
    }

    const estimatedLength = Number(edited.estimatedLength);
    const arc = { ...edited, estimatedLength };
    for (const field of KEPT_ARC_FIELDS) {
        arc[field] = storedArc[field];
    }
    return { arc, error: null };
}

/**
 * The non-blank rule for title and premise, shared by the JSON editor,
 * the title and premise editor and applying a re-plan (planning/replan.js),
 * so they cannot drift apart. Every section that prints an arc needs its
 * title, and the paused, episode and milestone sections print its premise.
 * @param {*} title - As typed or parsed, not yet trimmed
 * @param {*} premise - As typed or parsed, not yet trimmed
 * @returns {string|null} Error message, or null when both are non-blank
 */
export function checkTitleAndPremise(title, premise) {
    if (!String(title || '').trim()) return 'title cannot be empty.';
    if (!String(premise || '').trim()) return 'premise cannot be empty.';
    return null;
}

/**
 * Turn the Arc Manager's title and premise editor into the updates to store:
 * both texts trimmed, and nothing else. No other field of the arc is read
 * or returned, so its beats, clocks, focus and tier stay as stored when the
 * caller passes the updates to updateArc. Does not mutate the input.
 * @param {object} storedArc - The arc as stored now
 * @param {{ title: string, premise: string }} edit - The texts as typed
 * @returns {{ updates: { title: string, premise: string }|null, error: string|null }}
 */
export function applyTitleAndPremiseEdit(storedArc, edit) {
    const error = checkTitleAndPremise(edit.title, edit.premise);
    if (error) return { updates: null, error };

    const title = String(edit.title).trim();
    const premise = String(edit.premise).trim();
    return { updates: { title, premise }, error: null };
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
    const remaining = beats.filter(beat => beat.id !== beatId);

    const cleanedBeats = remaining.map(beat => {
        const prerequisites = beat.unlockAfter || [];
        const waitedForDeleted = prerequisites.includes(beatId);
        const unlockAfter = prerequisites.filter(id => id !== beatId);
        const unlocked = beat.status === 'locked' && waitedForDeleted && prerequisitesCompleted(unlockAfter, remaining);
        const status = unlocked ? 'pending' : beat.status;
        return { ...beat, unlockAfter, status };
    });
    return cleanedBeats;
}

/**
 * Whether every prerequisite id names a completed beat. An id that names no
 * beat counts as open, so the beat stays locked.
 * @param {string[]} prerequisiteIds
 * @param {object[]} beats
 * @returns {boolean}
 */
function prerequisitesCompleted(prerequisiteIds, beats) {
    return prerequisiteIds.every(
        prerequisiteId => beats.find(beat => beat.id === prerequisiteId)?.status === 'completed'
    );
}

/**
 * Complete a beat and unlock the beats that waited for it: a locked beat
 * that lists it in unlockAfter becomes pending once every one of its
 * prerequisites is completed. The Arc Manager's status toggle calls it for
 * a completion by hand, completeBeats (planning/beat-completion.js) for a
 * recognised one. The completed beat carries no completion record: a
 * completion by hand is not reopened by a rollback, and completeBeats adds
 * the record of a recognised one. Does not mutate the input.
 * @param {object[]} beats
 * @param {string} beatId
 * @returns {object[]}
 */
export function completeBeat(beats, beatId) {
    const updatedBeats = beats.map(beat => {
        if (beat.id !== beatId) return beat;
        const { completion, ...beatWithoutRecord } = beat;
        return { ...beatWithoutRecord, status: 'completed' };
    });

    const unlockedBeats = updatedBeats.map(beat => {
        const waitedForCompleted = (beat.unlockAfter || []).includes(beatId);
        const unlocked = beat.status === 'locked' && waitedForCompleted && prerequisitesCompleted(beat.unlockAfter, updatedBeats);
        return unlocked ? { ...beat, status: 'pending' } : beat;
    });
    return unlockedBeats;
}

/**
 * Flip the done flag of one secret, clue or trigger — the Arc Manager's
 * manual override. Does not mutate the input.
 * @param {object[]} items - The arc's secrets, foreshadowing or triggers
 * @param {string} itemId
 * @param {'disclosed'|'planted'|'fired'} flag
 * @returns {object[]}
 */
export function togglePlanItem(items, itemId, flag) {
    return items.map(item => item.id === itemId ? { ...item, [flag]: !item[flag] } : item);
}
