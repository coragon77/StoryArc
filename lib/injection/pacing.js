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
    const messageCount = currentMessage - (arc.messageStart || 0);
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
 * Get the pacing directive text for a phase
 * @param {string} phase
 * @returns {string}
 */
export function getPacingDirective(phase) {
    return PACING_DIRECTIVES[phase] || PACING_DIRECTIVES.development;
}

/**
 * Calculate how many messages remain before the next phase transition
 * @param {object} arc
 * @param {string} currentPhase
 * @returns {number}
 */
export function messagesUntilNextPhase(arc, currentPhase) {
    const phaseConfig = ARC_PHASES[currentPhase];
    if (!phaseConfig) return 0;
    const targetMessage = Math.floor(phaseConfig.max * arc.estimatedLength) + arc.messageStart;
    const currentMessage = chat?.length || 0;
    return Math.max(0, targetMessage - currentMessage);
}
