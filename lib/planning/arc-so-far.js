/**
 * @file "Arc so far" block for re-planning
 * @module planning/arc-so-far
 *
 * Fills {{ARC_SO_FAR}} in prompts/generate-arc.txt when an active arc is
 * being re-planned: premise, secrets, escalation and every fulfilled beat's
 * fulfillment text marked "already happened" (design spec §3). Stub: returns
 * '' until the re-plan ticket fills it.
 */

/**
 * @param {object|null} arc - The arc being re-planned, null when planning new
 * @returns {string} Prompt text, '' for now
 */
export function buildArcSoFar(arc) {
    return '';
}
