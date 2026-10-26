/**
 * @file Injection section for an act or saga in normal focus
 * @module injection/sections/milestone
 *
 * Premise plus every unfulfilled milestone's pressure as standing weather.
 * Nothing else in normal focus: secrets, triggers and foreshadowing ask for a
 * hint or a check every message, and a background saga carrying them pulled
 * the whole story into its intrigue (test chat, 2026-10-19). No current
 * beat, no pacing rules, no brake: milestones are unordered and complete by
 * recognition, so there is nothing to pace toward (design spec §1, ADR-0001).
 *
 * The spotlight section is this section with the pressures block swapped and
 * the lists added (sections/spotlight.js), under the same phase gating as the
 * episode section. The phase feeds secret gating only and is not printed,
 * which keeps the section byte-identical between messages.
 */

import { TIER_TABLE } from '../../core/constants.js';
import { calculatePhase, shouldShowSecret } from '../pacing.js';

/** Pressures block in normal focus: weather that colours scenes. */
const STANDING_PRESSURES = {
    header: 'STANDING PRESSURES (forces at work across this stretch of the story — let them colour scenes, do not resolve them):',
    trailer: '',
};

/**
 * @param {object} arc - An active act or saga
 * @param {{header: string, trailer: string}} [pressures] - Header line above the
 *   pressure list and an optional sentence after it; defaults to standing weather
 * @param {{withLists?: boolean}} [options] - withLists adds secrets, triggers
 *   and foreshadowing (spotlight only)
 * @returns {string}
 */
export function buildMilestoneSection(arc, pressures = STANDING_PRESSURES, { withLists = false } = {}) {
    const label = (TIER_TABLE[arc.tier] || TIER_TABLE.act).label.toUpperCase();

    const lines = [];
    lines.push(`=== ${label}: "${arc.title}" ===`);
    if (arc.genre) {
        lines.push(`GENRE: ${arc.genre}`);
    }
    if (arc.premise) {
        lines.push(`PREMISE: ${arc.premise}`);
    }
    lines.push('');

    // Every unfulfilled milestone, pressure only — forces at work in the
    // world, not destinations. Never the intention: that is the fulfillment,
    // and under BRING TO A HEAD it would name a target (ADR-0002, #13).
    // Validation rejects pressure-less milestones; one that slipped through
    // is skipped rather than substituted.
    const standing = arc.beats.filter(b => b.status !== 'completed' && b.pressure);
    if (standing.length) {
        lines.push(pressures.header);
        for (const milestone of standing) {
            lines.push(`- ${milestone.pressure}`);
        }
        if (pressures.trailer) lines.push(pressures.trailer);
        lines.push('');
    }

    if (!withLists) return lines.join('\n');

    const { phase } = calculatePhase(arc);
    const visibleSecrets = arc.secrets.filter(s =>
        !s.disclosed && shouldShowSecret(s.revealPhase, phase)
    );
    if (visibleSecrets.length) {
        lines.push('SECRETS (guard these carefully — do not reveal directly):');
        for (const secret of visibleSecrets) {
            lines.push(`- ${secret.content}`);
        }
        lines.push('');
    }

    const unfired = arc.triggers.filter(t => !t.fired);
    if (unfired.length) {
        lines.push('TRIGGERS (check narrative conditions each message):');
        for (const trigger of unfired) {
            lines.push(`- IF ${trigger.condition} → ${trigger.action}`);
        }
        lines.push('');
    }

    const unplanted = arc.foreshadowing.filter(f => !f.planted);
    if (unplanted.length) {
        lines.push('FORESHADOWING TO PLANT:');
        for (const fs of unplanted) {
            lines.push(`- ${fs.clue} (foreshadows: ${fs.target})`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
