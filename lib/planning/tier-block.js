/**
 * @file Tier block for the generate-arc template
 * @module planning/tier-block
 *
 * Fills {{TIER_BLOCK}} in prompts/generate-arc.txt with the chosen tier's
 * beat count, beat wording and length band (design spec §1). One template,
 * three blocks — the numbers come from TIER_TABLE so prompt and validator
 * cannot drift apart.
 */

import { TIER_TABLE } from '../core/constants.js';

/**
 * @param {'episode'|'act'|'saga'} tier - Unknown values fall back to episode
 * @returns {string} Prompt text ending in a newline
 */
export function buildTierBlock(tier) {
    const row = TIER_TABLE[tier] || TIER_TABLE.episode;
    const [minBeats, maxBeats] = row.beatCount;
    const [minLength, maxLength] = row.lengthBand;
    const lines = [`== TIER: ${row.label.toUpperCase()} ==`];

    if (row.beatKind === 'scene beat') {
        lines.push(
            `This arc is an EPISODE: one playable, resolvable unit of the story, such as a single mission or a single night — roughly ${minLength}-${maxLength} messages of play.`,
            `- Write ${minBeats}-${maxBeats} ordered SCENE BEATS. One is active at a time; the rest stay hidden from the narrating AI until reached.`,
            '- unlockAfter is allowed and welcome for real narrative prerequisites.',
            `- Set estimatedLength between ${minLength} and ${maxLength}.`,
        );
    } else {
        const scale = tier === 'saga'
            ? 'the overarching storyline of this whole roleplay, such as bringing down the big bad'
            : 'one leg of the larger story that colours the episodes played inside it without being pursued directly';
        lines.push(
            `This arc is ${tier === 'saga' ? 'a SAGA' : 'an ACT'}: ${scale} — roughly ${minLength}-${maxLength} messages of play.`,
            `- Write ${minBeats}-${maxBeats} unordered MILESTONES instead of scene beats. All of them stand at once from the first message on; any may be fulfilled in any order, in any scene.`,
            '- A milestone\'s pressure is a standing force in the world that can persist for dozens of scenes without resolving.',
            '- A milestone\'s intention (fulfillment) names a STATE the story has reached, never a specific scene, place or encounter. "The party knows the guild has been lying about the harvest", not "Voss is confronted at the granary."',
            '- Leave unlockAfter empty ([]) on every milestone. Milestones have no prerequisites.',
            '- revealPhase on a secret means which stretch of the whole arc it belongs to (its opening, its middle, its final quarter), not a scene.',
            `- Set estimatedLength between ${minLength} and ${maxLength}.`,
        );
    }

    // The generator passes the chosen tier to validation directly; the echo
    // in the JSON is the fallback for a build that does not.
    lines.push(`- Include "tier": "${row.label.toLowerCase()}" as a top-level field of the JSON.`);

    return lines.join('\n') + '\n';
}
