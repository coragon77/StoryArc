/**
 * @file Phase calculation and pacing directives
 * @module injection/pacing
 */

import { chat } from '/script.js';
import { ARC_PHASES, PHASE_ORDER, PACING_DIRECTIVES } from '../core/constants.js';

/**
 * Calculate the current phase for an arc based on beat completion + message count.
 * Both conditions must be met to advance (takes the minimum).
 * @param {object} arc
 * @returns {{ phase: string, label: string, messageCount: number, beatRatio: number, messageRatio: number }}
 */
export function calculatePhase(arc) {
    const nonOptionalBeats = arc.beats.filter(b => !b.optional);
    const completedBeats = nonOptionalBeats.filter(b => b.status === 'completed');
    const beatRatio = nonOptionalBeats.length > 0
        ? completedBeats.length / nonOptionalBeats.length
        : 0;

    const currentMessage = chat?.length || 0;
    // A chat shorter than messageStart (messages deleted after planning) counts
    // as the arc's start; a negative count would match no phase range and fall
    // through to resolution, lifting the message brake.
    const messageCount = Math.max(0, currentMessage - (arc.messageStart || 0));
    const messageRatio = arc.estimatedLength > 0
        ? messageCount / arc.estimatedLength
        : 0;

    const phaseFromBeats = ratioToPhase(beatRatio);
    const phaseFromMessages = ratioToPhase(messageRatio);

    const beatIndex = PHASE_ORDER.indexOf(phaseFromBeats);
    const msgIndex = PHASE_ORDER.indexOf(phaseFromMessages);
    const phase = PHASE_ORDER[Math.min(beatIndex, msgIndex)];

    return {
        phase,
        label: ARC_PHASES[phase].label,
        messageCount,
        beatRatio,
        messageRatio,
    };
}

/**
 * Convert a ratio (0-1) to a phase name
 * @param {number} ratio
 * @returns {string}
 */
function ratioToPhase(ratio) {
    for (const name of PHASE_ORDER) {
        const { min, max } = ARC_PHASES[name];
        if (ratio >= min && ratio < max) return name;
    }
    return 'resolution';
}

/**
 * Secret gating: a secret is shown once the arc's phase has reached its
 * revealPhase. Shared by every section that lists secrets.
 * @param {string} revealPhase - 'any' or a phase name
 * @param {string} currentPhase
 * @returns {boolean}
 */
export function shouldShowSecret(revealPhase, currentPhase) {
    if (revealPhase === 'any') return true;
    return PHASE_ORDER.indexOf(currentPhase) >= PHASE_ORDER.indexOf(revealPhase);
}

/**
 * Get the pacing directive text for a phase
 * @param {string} phase
 * @returns {string}
 */
export function getPacingDirective(phase) {
    return PACING_DIRECTIVES[phase] || PACING_DIRECTIVES.development;
}

/**
 * The arc-relative message number at which the current phase gives way to the
 * next one. Depends only on the phase and the arc's fixed metadata, never on
 * the current chat length — that is what makes it safe to put in the prompt.
 * Returns 0 when the boundary cannot be computed — arcs planned before
 * estimatedLength existed have no message-based pacing at all.
 * @param {object} arc
 * @param {string} currentPhase
 * @returns {number}
 */
export function phaseBoundaryMessage(arc, currentPhase) {
    const phaseConfig = ARC_PHASES[currentPhase];
    if (!phaseConfig || !(arc.estimatedLength > 0)) return 0;
    return Math.floor(phaseConfig.max * arc.estimatedLength);
}

/**
 * Calculate how many messages remain before the next phase transition.
 * Returns 0 when the boundary cannot be computed — arcs planned before
 * estimatedLength existed have no message-based pacing at all.
 * @param {object} arc
 * @param {string} currentPhase
 * @returns {number}
 */
export function messagesUntilNextPhase(arc, currentPhase) {
    // Guard on the inputs, not on the boundary: a legitimately computed
    // boundary of 0 (tiny estimatedLength) is not the same as "cannot compute".
    if (!ARC_PHASES[currentPhase] || !(arc.estimatedLength > 0)) return 0;
    const targetMessage = phaseBoundaryMessage(arc, currentPhase) + (arc.messageStart || 0);
    const currentMessage = chat?.length || 0;
    return Math.max(0, targetMessage - currentMessage);
}
