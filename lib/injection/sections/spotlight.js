/**
 * @file Injection section for a spotlit arc
 * @module injection/sections/spotlight
 *
 * An episode in spotlight is the full episode section (it differs only by
 * being the pacing clock). An act or saga in spotlight is the milestone
 * section with its unfulfilled pressures moved under BRING TO A HEAD, one
 * sentence asking them to intensify, and its secrets, triggers and
 * foreshadowing, which normal focus leaves out. No milestone is ever named as a target:
 * a named goal gets resolved in two messages (ADR-0002). If live play finds
 * this too soft, the next step is a tempo phrase, not a target.
 */

import { buildEpisodeSection } from './episode.js';
import { buildMilestoneSection } from './milestone.js';
import { arcTier } from '../../core/settings.js';

/** Pressures block in spotlight: the world moves, no destination named. */
const ESCALATING_PRESSURES = {
    header: 'BRING TO A HEAD:',
    trailer: 'Let these pressures intensify over the coming scenes, and let the world act on its own interests.',
};

/**
 * @param {object} arc - An active, spotlit arc
 * @returns {string}
 */
export function buildSpotlightSection(arc) {
    if (arcTier(arc) === 'episode') return buildEpisodeSection(arc);
    return buildMilestoneSection(arc, ESCALATING_PRESSURES, { withLists: true });
}
