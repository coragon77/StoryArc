/**
 * @file "Arc so far" block for re-planning
 * @module planning/arc-so-far
 *
 * Fills {{ARC_SO_FAR}} in prompts/generate-arc.txt when an active arc is
 * being re-planned: premise, secrets, escalation and every fulfilled beat's
 * fulfillment text marked "already happened" (design spec §3).
 */

/**
 * @param {object|null} arc - The arc being re-planned, null when planning new
 * @returns {string} Prompt block, '' when planning new so that path stays byte-identical
 */
export function buildArcSoFar(arc) {
    if (!arc) return '';

    const secrets = arc.secrets.length
        ? arc.secrets.map(secret => `- ${secret.content}`).join('\n')
        : '(none)';
    const fulfilled = arc.beats.filter(beat => beat.status === 'completed');
    const happened = fulfilled.length
        ? fulfilled.map(beat => `- ${beat.intention}`).join('\n')
        : '(nothing yet — the arc is being re-planned from its start)';

    return `== ARC SO FAR ==
You are RE-PLANNING an arc that is already running, not inventing a new one. The story has moved on from what its remaining beats assumed; plan the rest of it from where the story is now. Everything below is established and stays true. Keep the premise as given. Do not restate the secrets listed here: your "secrets" output may only ADD new ones. Do not repeat anything marked as already happened; your beats are what comes NEXT.

Premise: ${arc.premise}

Secrets already established (do not restate, only add):
${secrets}

Escalation so far: ${arc.escalation || '(none recorded)'}

Already happened (fulfilled beats — do not plan these again):
${happened}

`;
}
