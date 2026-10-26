/**
 * @file Build prompt injection text from active arcs
 * @module injection/builder
 */

import { calculatePhase, phaseBoundaryMessage } from './pacing.js';
import { selectPacingClock } from './clock.js';
import { arcTier, getChatSettings } from '../core/settings.js';
import { INJECTION_HEADER } from '../core/constants.js';
import { estimateTokens } from '../context/chat-history.js';
import { buildEpisodeSection } from './sections/episode.js';
import { buildMilestoneSection } from './sections/milestone.js';
import { buildPausedSection } from './sections/paused.js';
import { buildBackgroundSection } from './sections/background.js';
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
    const tier = arcTier(arc);
    if (arc.focus === 'paused') return buildPausedSection(arc);
    if (arc.focus === 'background') return buildBackgroundSection(arc);
    if (arc.focus === 'spotlight') return buildSpotlightSection(arc);
    if (tier === 'episode') return buildEpisodeSection(arc);
    return buildMilestoneSection(arc);
}

/**
 * Section order: spotlight first so its list items are the last the budget
 * trim drops, then normal episodes, then everything else — storage order
 * within each group.
 * @param {object} arc
 * @returns {number}
 */
function sectionRank(arc) {
    if (arc.focus === 'spotlight') return 0;
    if (arc.focus === 'normal' && arcTier(arc) === 'episode') return 1;
    return 2;
}

/** Headers of the long lists the budget trim may shorten (sections/). */
const TRIMMABLE_LIST_HEADER = /^(SECRETS \(|TRIGGERS \(|FORESHADOWING TO PLANT:)/;

/**
 * Trim an over-budget injection by dropping whole list items — secrets,
 * triggers and foreshadowing — from the last one backwards, across all
 * sections. Every other line is kept, so the guardrail sections (pacing
 * rules, DO NOT, directives) survive whatever the order of the arcs, and the
 * spotlit arc's items, ordered first, drop last. A list header goes with its
 * last item. If the body is still over budget with every item gone, it is
 * returned over budget rather than cut into its guardrails.
 * @param {string} body
 * @param {number} budget - Token budget
 * @returns {string}
 */
function trimToBudget(body, budget) {
    const lines = body.split('\n');
    const listItems = [];
    const headerOf = new Map();
    let header = null;
    lines.forEach((line, index) => {
        if (TRIMMABLE_LIST_HEADER.test(line)) {
            header = index;
        } else if (header !== null && line.startsWith('- ')) {
            listItems.push(index);
            headerOf.set(index, header);
        } else {
            header = null;
        }
    });

    const dropped = new Set();
    const assemble = () => {
        const kept = lines.filter((line, index) => !dropped.has(index));
        while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
        return kept.join('\n');
    };
    while (listItems.length && estimateTokens(assemble()) > budget) {
        const item = listItems.pop();
        dropped.add(item);
        const itemHeader = headerOf.get(item);
        if (item === itemHeader + 1) {
            // The header's last item went: drop the header and the blank
            // line that closed its list.
            dropped.add(itemHeader);
            let next = item + 1;
            while (dropped.has(next)) next++;
            if (next < lines.length && !lines[next].trim()) dropped.add(next);
        }
    }

    const trimmed = assemble();
    const overBudget = estimateTokens(trimmed) > budget ? ', still over budget without any list item' : '';
    console.warn(`[Story Arc] Injection over ${budget}-token budget: dropped ${dropped.size} lines${overBudget}`);
    return trimmed;
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
 * One line, for the pacing clock only: "arc message N" is the number the
 * stamps carry, and the stamps count one episode (stamping.js). A brake line
 * for any other episode would point at a counter the model never sees.
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
function buildPacingBlock(arcs) {
    const arc = selectPacingClock(arcs);
    if (!arc) return '';
    const { phase } = calculatePhase(arc);
    const boundary = phaseBoundaryMessage(arc, phase);
    const line = boundary > 0
        ? `- "${arc.title}": do not advance to the next phase before arc message ${boundary}.`
        : `- "${arc.title}": do not advance to the next phase early.`;
    return ['ARC PACING:', line, ''].join('\n');
}
