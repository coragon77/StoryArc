/**
 * @file Injection section for an act or saga in normal focus
 * @module injection/sections/milestone
 *
 * Will render the premise plus every unfulfilled milestone's pressure as
 * standing weather, with secrets, triggers and foreshadowing gated by phase
 * and no pacing brake (design spec §1). Stub: falls through to the paused
 * one-liner until the tiers ticket fills it.
 */

import { buildPausedSection } from './paused.js';

/**
 * @param {object} arc - An active act or saga
 * @returns {string}
 */
export function buildMilestoneSection(arc) {
    return buildPausedSection(arc);
}
