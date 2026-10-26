/**
 * @file Injection section for an episode in normal focus
 * @module injection/sections/episode
 *
 * The full section: premise, tone, the active beat's pressure, pacing rules,
 * anti-patterns, directives, then the long lists. Text unchanged from the
 * pre-tier foreground section — the header word stays for byte-identity.
 */

import { calculatePhase, getPacingDirective, shouldShowSecret } from '../pacing.js';

/**
 * @param {object} arc - An active episode
 * @returns {string}
 */
export function buildEpisodeSection(arc) {
    const { phase, label } = calculatePhase(arc);
    const pacing = getPacingDirective(phase);

    const lines = [];
    lines.push(`=== FOREGROUNDED: "${arc.title}" ===`);
    lines.push(`[Phase: ${label} | Pacing: Do not rush]\n`);

    if (arc.genre) {
        lines.push(`GENRE: ${arc.genre}\n`);
    }

    if (arc.premise) {
        lines.push(`PREMISE: ${arc.premise}\n`);
    }
    if (arc.tone) {
        lines.push(`TONE: ${arc.tone}\n`);
    }

    // Only the active beat is shown, and only as a pressure — a force acting
    // on the scene, never a destination. Listing pending beats turned the plan
    // into a visible task list and the model raced through it.
    const activeBeat = arc.beats.find(candidate => candidate.status === 'active');
    if (activeBeat) {
        // Arcs planned before the pressure field existed only have intentions.
        const pressureText = activeBeat.pressure || activeBeat.intention;
        lines.push('CURRENT PRESSURE:');
        lines.push(pressureText);
        lines.push('');
    } else {
        // Linger: the gap between a completed beat and the next user message.
        lines.push('CURRENT FOCUS:');
        lines.push('Develop the consequences of recent events. Let characters breathe and react. Do not introduce new major developments this scene.');
        lines.push('');
    }

    // Guardrail sections come before the long content lists: when the budget
    // trim drops trailing lines, foreshadowing items die first and the pacing
    // rules never do.
    lines.push('PACING RULES:');
    lines.push(`- You are in ${label.toUpperCase()} phase. ${pacing}`);
    lines.push('- If tempted to resolve something — add a complication instead.');
    lines.push('');

    if (arc.antiPatterns.length) {
        lines.push('DO NOT:');
        for (const antiPattern of arc.antiPatterns) {
            lines.push(`- ${antiPattern}`);
        }
        lines.push('');
    }

    if (arc.directives.length) {
        lines.push('DIRECTIVES:');
        for (const directive of arc.directives) {
            lines.push(`- ${directive}`);
        }
        lines.push('');
    }

    pushPlanLists(lines, arc, phase);

    return lines.join('\n');
}

/**
 * Append the secrets, triggers and foreshadowing blocks the arc still has
 * open: secrets visible in this phase, unfired triggers, unplanted clues. The
 * spotlit act or saga section (sections/milestone.js) prints the same blocks.
 * @param {string[]} lines - Section lines, appended to in place
 * @param {object} arc
 * @param {string} phase - The arc's current phase, for secret gating
 */
export function pushPlanLists(lines, arc, phase) {
    const visibleSecrets = arc.secrets.filter(secret =>
        !secret.disclosed && shouldShowSecret(secret.revealPhase, phase)
    );
    if (visibleSecrets.length) {
        lines.push('SECRETS (guard these carefully — do not reveal directly):');
        for (const secret of visibleSecrets) {
            lines.push(`- ${secret.content}`);
        }
        lines.push('');
    }

    const unfired = arc.triggers.filter(trigger => !trigger.fired);
    if (unfired.length) {
        lines.push('TRIGGERS (check narrative conditions each message):');
        for (const trigger of unfired) {
            lines.push(`- IF ${trigger.condition} → ${trigger.action}`);
        }
        lines.push('');
    }

    const unplanted = arc.foreshadowing.filter(foreshadowing => !foreshadowing.planted);
    if (unplanted.length) {
        lines.push('FORESHADOWING TO PLANT:');
        for (const foreshadowing of unplanted) {
            lines.push(`- ${foreshadowing.clue} (foreshadows: ${foreshadowing.target})`);
        }
        lines.push('');
    }
}
