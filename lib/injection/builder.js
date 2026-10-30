/**
 * @file Build prompt injection text from active arcs
 * @module injection/builder
 */

import { calculatePhase, getPacingDirective, phaseBoundaryMessage, shouldShowSecret } from './pacing.js';
import { selectPacingClock } from './clock.js';
import { arcTier, getChatSettings } from '../core/settings.js';
import { INJECTION_HEADER, TIER_TABLE } from '../core/constants.js';
import { estimateTokens } from '../context/chat-history.js';

/**
 * Build the complete prompt injection text from all active arcs.
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
export function buildInjection(arcs) {
    if (!arcs.length) return '';

    const settings = getChatSettings();

    const sections = [`${INJECTION_HEADER}\n`];
    const ordered = [...arcs].sort((firstArc, secondArc) => sectionRank(firstArc) - sectionRank(secondArc));
    for (const arc of ordered) {
        const section = buildArcSection(arc);
        sections.push(section);
    }

    let body = sections.join('\n');

    const budget = settings.injectionBudget || 3000;
    const bodyTokens = estimateTokens(body);
    if (bodyTokens > budget) {
        body = trimToBudget(body, budget);
    }

    return body + '\n[END STORY ARC]';
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
 * Injection section for a paused arc, any tier
 *
 * One line: the model is told the arc exists and is not being pursued. No
 * beats, no pressures — the arc is set aside for a tangent (GLOSSARY.md,
 * "Paused").
 *
 * @param {object} arc - An active, paused arc
 * @returns {string}
 */
function buildPausedSection(arc) {
    const summary = arc.premise || arc.title;
    return `=== PAUSED: "${arc.title}" ===\n${summary} — pending, not being pursued right now.\n`;
}

/**
 * Injection section for an act or saga in background focus
 *
 * Title and one sentence. The arc goes on off-screen: no premise, no
 * pressures, because a normal saga's standing pressures coloured every scene
 * with its thread (test chat, 2026-10-25). Its beats stay in the beat
 * check, so a milestone still completes when the user plays the thread
 * (GLOSSARY.md, "Background"). Episodes have no background focus (ADR-0001
 * amendment).
 *
 * @param {object} arc - An active act or saga in background focus
 * @returns {string}
 */
function buildBackgroundSection(arc) {
    return `=== BACKGROUND: "${arc.title}" ===\nRuns off-screen. Leave it out of scenes — no hints, sounds or clues — unless the user's character goes to it or brings it up.\n`;
}

/** Pressures block in spotlight: the world moves, no destination named. */
const ESCALATING_PRESSURES = {
    header: 'BRING TO A HEAD:',
    trailer: 'Let these pressures intensify over the coming scenes, and let the world act on its own interests.',
};

/**
 * Injection section for a spotlit arc
 *
 * An episode in spotlight is the full episode section (it differs only by
 * being the pacing clock). An act or saga in spotlight is the milestone
 * section with its unfulfilled pressures moved under BRING TO A HEAD, one
 * sentence asking them to intensify, and its secrets, triggers and
 * foreshadowing, which normal focus leaves out. No milestone is ever named as a target:
 * a named goal gets resolved in two messages (ADR-0002). If live play finds
 * this too soft, the next step is a tempo phrase, not a target.
 *
 * @param {object} arc - An active, spotlit arc
 * @returns {string}
 */
function buildSpotlightSection(arc) {
    if (arcTier(arc) === 'episode') return buildEpisodeSection(arc);
    return buildMilestoneSection(arc, ESCALATING_PRESSURES, { withLists: true });
}

/**
 * Injection section for an episode in normal focus
 *
 * The full section: premise, tone, the active beat's pressure, pacing rules,
 * anti-patterns, directives, then the long lists. Text unchanged from the
 * pre-tier foreground section — the header word stays for byte-identity.
 *
 * @param {object} arc - An active episode
 * @returns {string}
 */
function buildEpisodeSection(arc) {
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
 * spotlit act or saga section (buildMilestoneSection) prints the same blocks.
 * @param {string[]} lines - Section lines, appended to in place
 * @param {object} arc
 * @param {string} phase - The arc's current phase, for secret gating
 */
function pushPlanLists(lines, arc, phase) {
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
        // A generated trigger action once restated a secret it should only
        // react to, and the model narrated it as a confession (Paragon chat,
        // 2026-10-30) — the header says which rule wins.
        lines.push('TRIGGERS (check narrative conditions each message — a trigger changes how characters act, it never discloses a SECRET):');
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

/** Pressures block in normal focus: weather that colours scenes. */
const STANDING_PRESSURES = {
    header: 'STANDING PRESSURES (forces at work across this stretch of the story — let them colour scenes, do not resolve them):',
    trailer: '',
};

/**
 * Injection section for an act or saga in normal focus
 *
 * Premise plus every unfulfilled milestone's pressure as standing weather.
 * Nothing else in normal focus: secrets, triggers and foreshadowing ask for a
 * hint or a check every message, and a background saga carrying them pulled
 * the whole story into its intrigue (test chat, 2026-10-19). No current
 * beat, no pacing rules, no brake: milestones are unordered and complete by
 * recognition, so there is nothing to pace toward (design spec §1, ADR-0001).
 *
 * The spotlight section is this section with the pressures block swapped and
 * the lists added (buildSpotlightSection), under the same phase gating as the
 * episode section. The phase feeds secret gating only and is not printed,
 * which keeps the section byte-identical between messages.
 *
 * @param {object} arc - An active act or saga
 * @param {{header: string, trailer: string}} [pressures] - Header line above the
 *   pressure list and an optional sentence after it; defaults to standing weather
 * @param {{withLists?: boolean}} [options] - withLists adds secrets, triggers
 *   and foreshadowing (spotlight only)
 * @returns {string}
 */
function buildMilestoneSection(arc, pressures = STANDING_PRESSURES, { withLists = false } = {}) {
    // No fallback: buildArcSection and buildSpotlightSection send only acts and sagas here
    // (arcTier), so a tier missing from TIER_TABLE is a stored-data bug and
    // throws instead of printing a wrong label.
    const label = TIER_TABLE[arc.tier].label.toUpperCase();

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
    const standing = arc.beats.filter(milestone => milestone.status !== 'completed' && milestone.pressure);
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
    pushPlanLists(lines, arc, phase);

    return lines.join('\n');
}

/** Headers of the long lists the budget trim may shorten (the section builders above). */
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
        while (kept.length) {
            const lastLine = kept[kept.length - 1].trim();
            if (lastLine) break;
            kept.pop();
        }
        return kept.join('\n');
    };
    while (listItems.length) {
        const assembledTokens = estimateTokens(assemble());
        if (assembledTokens <= budget) break;
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
    const trimmedTokens = estimateTokens(trimmed);
    const overBudget = trimmedTokens > budget ? ', still over budget without any list item' : '';
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
    const pacingBlock = buildPacingBlock(arcs);
    const parts = [pacingBlock];
    if (settings.autoTrack) {
        const signalDirective = buildSignalDirective(arcs);
        parts.push(signalDirective);
    }
    const nonEmptyParts = parts.filter(Boolean);
    return nonEmptyParts.join('\n');
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

/**
 * The in-chat beat-signal directive
 *
 * Continuation guard and confidentiality clause on every generation; the
 * BEAT CHECK with one recognition line per active beat of every arc that is
 * not paused. A paused arc's beats are not checked (GLOSSARY.md, "Paused").
 * The PLANT CHECK has one line per unplanted clue and unfired trigger of every
 * arc whose section shows them. Secrets get no line: it would have to state
 * the secret right before the reply is written.
 *
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
function buildSignalDirective(arcs) {
    const activeBeats = [];
    const markLines = [];
    for (const arc of arcs) {
        if (arc.focus === 'paused') continue;
        const arcId = arc.id.slice(0, 8);
        const activeArcBeats = arc.beats.filter(beat => beat.status === 'active');
        for (const beat of activeArcBeats) {
            activeBeats.push({ arcId, beatId: beat.id, intention: beat.intention });
        }
        if (!showsPlanLists(arc)) continue;
        const unplanted = (arc.foreshadowing || []).filter(foreshadowing => !foreshadowing.planted);
        for (const foreshadowing of unplanted) {
            markLines.push(`If the story has already planted this clue — "${foreshadowing.clue}" — output exactly: <!-- [ARC_SIGNAL:${arcId}:${foreshadowing.id}:PLANTED] -->`);
        }
        const unfired = (arc.triggers || []).filter(trigger => !trigger.fired);
        for (const trigger of unfired) {
            markLines.push(`If the story has already shown this happen — "${trigger.action}" — output exactly: <!-- [ARC_SIGNAL:${arcId}:${trigger.id}:FIRED] -->`);
        }
    }

    // The continuation guard and the confidentiality clause apply to every
    // generation, including linger turns where no beat is being checked.
    const lines = [
        'CONTINUATION: Continue the story from the end of the most recent',
        'message. Never restart the scene or re-narrate earlier turns, even if',
        'the last message was not written by the user.',
        '',
        'The arc plan is invisible scaffolding. Never quote or reference its',
        'beat ids, beat intentions, phase names, secrets, or upcoming beats',
        'anywhere in your output — not in prose, and not in any journal,',
        'summary, suggestion, or state-tracking block another prompt asks you',
        'to write; there, describe only events that already happened on screen.',
        '',
    ];

    if (activeBeats.length || markLines.length) {
        lines.push('The markers below are the single exception to that rule.', '');
    }

    if (activeBeats.length) {
        // Phrased as recognition of what already happened, never as an
        // instruction to bring it about — a condition the model reads as a
        // goal is a condition it writes toward.
        lines.push(
            'BEAT CHECK:',
            'Below are conditions describing developments this story may reach.',
            'They are not instructions — do not steer the scene toward them.',
            'Write the reply the story calls for, then check: has the story,',
            'including the reply you just wrote, already brought this about? If',
            'so, output that condition\'s marker on its own line as the VERY',
            'FIRST line of your reply, before any story text. The marker is a',
            'literal string that is machine-read and stripped from the displayed',
            'message; it never disrupts the story. Do not mention it in prose.',
            'When in doubt, omit the marker.',
            '',
        );
        for (const { arcId, beatId, intention } of activeBeats) {
            lines.push(`If the story has already brought this about — "${intention}" — output exactly: <!-- [ARC_SIGNAL:${arcId}:${beatId}:COMPLETE] -->`);
        }
        lines.push('');
    }

    if (markLines.length) {
        // Clues are meant to be planted, so recognising one adds no goal the
        // plan above did not already set. Without the mark, a planted clue
        // stays in the plan and gets planted again in every message.
        lines.push(
            'PLANT CHECK:',
            'After writing the reply, check each clue and event below: has the',
            'story, including the reply you just wrote, already planted this clue',
            'or shown this happen? If so, output its marker on its own line at the',
            'very start of your reply, together with any other marker. Several',
            'may apply at once. When in doubt, omit the marker.',
            '',
            ...markLines,
            '',
        );
    }

    return lines.join('\n');
}

/**
 * Whether the arc's section prints its secrets, triggers and foreshadowing —
 * the dispatch in buildArcSection: episodes in normal or spotlight focus, acts and
 * sagas in spotlight only.
 * @param {object} arc
 * @returns {boolean}
 */
function showsPlanLists(arc) {
    if (arc.focus === 'paused') return false;
    return arcTier(arc) === 'episode' || arc.focus === 'spotlight';
}
