/**
 * @file Build prompt injection text from active arcs
 * @module injection/builder
 */

import { calculatePhase, phaseBoundaryMessage } from './pacing.js';
import { getChatSettings } from '../core/settings.js';
import { INJECTION_HEADER } from '../core/constants.js';
import { estimateTokens } from '../context/chat-history.js';
import { buildEpisodeSection } from './sections/episode.js';
import { buildMilestoneSection } from './sections/milestone.js';
import { buildPausedSection } from './sections/paused.js';
import { buildSpotlightSection } from './sections/spotlight.js';
import { buildSignalDirective } from './sections/signal-directive.js';

/**
 * Build the complete prompt injection text from all active arcs.
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
export function buildInjection(arcs) {
    if (!arcs.length) return '';

    const settings = getChatSettings();

    const sections = [`${INJECTION_HEADER}\n`];
    const ordered = [...arcs].sort((a, b) => sectionRank(a) - sectionRank(b));
    for (const arc of ordered) {
        sections.push(buildArcSection(arc));
    }

    let body = sections.join('\n');

    const budget = settings.injectionBudget || 3000;
    if (estimateTokens(body) > budget) {
        body = trimToBudget(body, budget);
    }

    return body + '\n[END STORY ARC]';
}

/**
 * Pick the section for one arc by tier and focus. Focus decides prominence,
 * tier decides shape (ADR-0001).
 * @param {object} arc
 * @returns {string}
 */
function buildArcSection(arc) {
    const tier = arc.tier || 'episode';
    if (arc.focus === 'paused') return buildPausedSection(arc);
    if (arc.focus === 'spotlight') return buildSpotlightSection(arc);
    if (tier === 'episode') return buildEpisodeSection(arc);
    return buildMilestoneSection(arc);
}

/**
 * Section order: spotlight first so budget trimming never drops it, then
 * normal episodes, then everything else — storage order within each group.
 * @param {object} arc
 * @returns {number}
 */
function sectionRank(arc) {
    if (arc.focus === 'spotlight') return 0;
    if (arc.focus === 'normal' && (arc.tier || 'episode') === 'episode') return 1;
    return 2;
}

/**
 * Trim an over-budget injection at line boundaries. Sections are ordered so
 * the fat lists (secrets, triggers, foreshadowing) sit at the end — every
 * trailing line is a whole list item, so nothing is cut mid-sentence and the
 * guardrail sections (pacing rules, DO NOT, directives) always survive.
 * ponytail: drops from the tail only; per-section prioritization if the
 * last arc's lists ever need different survival odds than earlier arcs'.
 * @param {string} body
 * @param {number} budget - Token budget
 * @returns {string}
 */
function trimToBudget(body, budget) {
    const lines = body.split('\n');
    const total = lines.length;
    while (lines.length && estimateTokens(lines.join('\n')) > budget) {
        lines.pop();
    }
    // Don't end on a section header whose items were all dropped,
    // or on blank spacer lines.
    while (lines.length && (!lines[lines.length - 1].trim() || lines[lines.length - 1].trim().endsWith(':'))) {
        lines.pop();
    }
    console.warn(`[Story Arc] Injection over ${budget}-token budget: dropped ${total - lines.length} trailing lines`);
    return lines.join('\n');
}

/**
 * Build the in-chat injection: the phase brake plus the beat-signal directive.
 * Injected in-chat near the generation point (not with the plan at IN_PROMPT)
 * because models reliably ignore the marker instruction when it sits thousands
 * of tokens back in the system prompt.
 *
 * Everything here must be byte-identical from message to message within a
 * phase — it sits at the very end of the prompt, where a single changed byte
 * costs the entire cached prefix.
 * @param {object[]} arcs - Active arcs
 * @returns {string} Injection text, or '' when there is nothing to say
 */
export function buildSignalInjection(arcs) {
    if (!arcs.length) return '';
    const settings = getChatSettings();
    const parts = [buildPacingBlock(arcs)];
    if (settings.autoTrack) parts.push(buildSignalDirective(arcs));
    return parts.filter(Boolean).join('\n');
}

/**
 * The phase brake, phrased as a fixed boundary rather than a countdown.
 *
 * This block used to carry "<N> messages into this arc" and "for at least <M>
 * more messages" — both recomputed from chat.length, so both changed every
 * single message and destroyed the provider's prefix cache. The current count
 * now rides on the messages themselves (see injection/stamping.js), and what
 * is left here changes only when the phase does.
 *
 * One line per episode that is not paused — the same set the pre-tier code
 * braked. Narrowing this to the pacing clock alone is the focus ticket's call.
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
function buildPacingBlock(arcs) {
    const lines = [];
    for (const arc of arcs.filter(a => (a.tier || 'episode') === 'episode' && a.focus !== 'paused')) {
        const { phase } = calculatePhase(arc);
        const boundary = phaseBoundaryMessage(arc, phase);
        lines.push(boundary > 0
            ? `- "${arc.title}": do not advance to the next phase before arc message ${boundary}.`
            : `- "${arc.title}": do not advance to the next phase early.`);
    }
    if (!lines.length) return '';
    return ['ARC PACING:', ...lines, ''].join('\n');
}
