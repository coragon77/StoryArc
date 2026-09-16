/**
 * @file Injection section for an act or saga in normal focus
 * @module injection/sections/milestone
 *
 * Premise plus every unfulfilled milestone's pressure as standing weather,
 * then secrets, triggers and foreshadowing under the same phase gating as the
 * episode section. No current beat, no pacing rules, no brake: milestones are
 * unordered and complete by recognition, so there is nothing to pace toward
 * (design spec §1, ADR-0001). The phase feeds secret gating only and is not
 * printed, which also keeps the section byte-identical between messages.
 *
 * The spotlight section is this section with the pressures block swapped
 * (sections/spotlight.js); everything after the pressures is shared so
 * spotlighting never hides what the normal section showed.
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
 * @returns {string}
 */
export function buildMilestoneSection(arc, pressures = STANDING_PRESSURES) {
    const { phase } = calculatePhase(arc);
    const label = (TIER_TABLE[arc.tier] || TIER_TABLE.act).label.toUpperCase();

    const lines = [];
    lines.push(`=== ${label}: "${arc.title}" ===`);
    if (arc.premise) {
        lines.push(`PREMISE: ${arc.premise}`);
    }
    lines.push('');

    // Every unfulfilled milestone, pressure only — forces at work in the
    // world, not destinations. Arcs planned before the pressure field existed
    // only have intentions.
    const unfulfilled = arc.beats.filter(b => b.status !== 'completed');
    if (unfulfilled.length) {
        lines.push(pressures.header);
        for (const milestone of unfulfilled) {
            lines.push(`- ${milestone.pressure || milestone.intention}`);
        }
        if (pressures.trailer) lines.push(pressures.trailer);
        lines.push('');
    }

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
