/**
 * @file Re-plan merge — keep the situation, replace the road
 * @module planning/replan
 *
 * Merges a freshly generated plan into an existing active arc per ADR-0003:
 * identity, secrets, fulfilled beats, planted foreshadowing and fired
 * triggers are kept; everything else comes from the generated plan, with
 * colliding ids suffixed. Stub: returns the generated plan unchanged until
 * the re-plan ticket fills it. Nothing calls it yet.
 */

/**
 * @param {object} existing - The stored arc being re-planned
 * @param {object} generated - The validated arc from a fresh generation
 * @returns {object} The merged arc
 */
export function mergeReplan(existing, generated) {
    return generated;
}
