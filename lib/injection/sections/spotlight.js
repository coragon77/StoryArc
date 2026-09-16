/**
 * @file Injection section for a spotlit arc
 * @module injection/sections/spotlight
 *
 * An episode in spotlight is the full episode section (it differs only by
 * being the pacing clock). An act or saga in spotlight will move its
 * milestone pressures into the main block under BRING TO A HEAD, never
 * naming a target (ADR-0002). Stub: acts and sagas fall through to the
 * paused one-liner until the focus ticket fills it.
 */

import { buildEpisodeSection } from './episode.js';
import { buildPausedSection } from './paused.js';

/**
 * @param {object} arc - An active, spotlit arc
 * @returns {string}
 */
export function buildSpotlightSection(arc) {
    if ((arc.tier || 'episode') === 'episode') return buildEpisodeSection(arc);
    return buildPausedSection(arc);
}
