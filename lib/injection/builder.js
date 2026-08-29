/**
 * @file Build prompt injection text from active arcs
 * @module injection/builder
 */

import { calculatePhase, getPacingDirective, messagesUntilNextPhase } from './pacing.js';
import { getChatSettings } from '../core/settings.js';
import { estimateTokens } from '../context/chat-history.js';

/**
 * Build the complete prompt injection text from all active arcs.
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
export function buildInjection(arcs) {
    if (!arcs.length) return '';

    const foreground = arcs.filter(a => a.focus === 'foreground');
    const background = arcs.filter(a => a.focus === 'background');
    const settings = getChatSettings();

    const sections = ['[STORY ARC - NARRATIVE DIRECTION]\n'];

    for (const arc of foreground) {
        sections.push(buildForegroundSection(arc));
    }

    for (const arc of background) {
        sections.push(buildBackgroundSection(arc));
    }

    let body = sections.join('\n');

    const budget = settings.injectionBudget || 3000;
    if (estimateTokens(body) > budget) {
        // ponytail: naive tail-slice can cut mid-sentence; smarter per-section
        // trimming only if this proves disruptive in practice
        const chars = budget * 4;
        console.warn(`[Story Arc] Injection body trimmed from ${body.length} to ${chars} chars`);
        body = body.slice(0, chars);
    }

    return body + '\n[END STORY ARC]';
}

/**
 * Build the beat-signal directive as a separate injection. Injected in-chat
 * near the generation point (not with the plan at IN_PROMPT) — models
 * reliably ignore the marker instruction when it sits thousands of tokens
 * back in the system prompt.
 * @param {object[]} arcs - Active arcs
 * @returns {string} Directive text, or '' when tracking is off / no active beats
 */
export function buildSignalInjection(arcs) {
    if (!arcs.length) return '';
    const settings = getChatSettings();
    if (!settings.autoTrack) return '';
    return buildSignalDirective(arcs);
}

function buildForegroundSection(arc) {
    const { phase, label, messageCount } = calculatePhase(arc);
    const pacing = getPacingDirective(phase);
    const remaining = messagesUntilNextPhase(arc, phase);

    const lines = [];
    lines.push(`=== FOREGROUNDED: "${arc.title}" ===`);
    lines.push(`[Phase: ${label} | Messages into arc: ${messageCount} | Pacing: Do not rush]\n`);

    if (arc.premise) {
        lines.push(`PREMISE: ${arc.premise}\n`);
    }
    if (arc.tone) {
        lines.push(`TONE: ${arc.tone}\n`);
    }

    // Only the active beat is shown, and only as a pressure — a force acting
    // on the scene, never a destination. Listing pending beats turned the plan
    // into a visible task list and the model raced through it.
    const activeBeat = arc.beats.find(b => b.status === 'active');
    if (activeBeat) {
        // Arcs planned before the pressure field existed only have intentions.
        lines.push('CURRENT PRESSURE:');
        lines.push(activeBeat.pressure || activeBeat.intention);
        lines.push('');
    } else {
        // Linger: the gap between a completed beat and the next user message.
        lines.push('CURRENT FOCUS:');
        lines.push('Develop the consequences of recent events. Let characters breathe and react. Do not introduce new major developments this scene.');
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

    const unplanted = arc.foreshadowing.filter(f => !f.planted);
    if (unplanted.length) {
        lines.push('FORESHADOWING TO PLANT:');
        for (const fs of unplanted) {
            lines.push(`- ${fs.clue} (foreshadows: ${fs.target})`);
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

    lines.push('PACING RULES:');
    lines.push(`- You are in ${label.toUpperCase()} phase. ${pacing}`);
    if (remaining > 0) {
        lines.push(`- Do not advance to the next phase for at least ${remaining} more messages.`);
    }
    lines.push('- If tempted to resolve something — add a complication instead.');
    lines.push('');

    if (arc.antiPatterns.length) {
        lines.push('DO NOT:');
        for (const ap of arc.antiPatterns) {
            lines.push(`- ${ap}`);
        }
        lines.push('');
    }

    if (arc.directives.length) {
        lines.push('DIRECTIVES:');
        for (const d of arc.directives) {
            lines.push(`- ${d}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function buildBackgroundSection(arc) {
    return `=== BACKGROUNDED: "${arc.title}" ===\n${arc.premise || arc.title}. Keep this present as distant tension. Do not advance plot beats for this arc.\n`;
}

function buildSignalDirective(arcs) {
    const activeBeats = [];
    for (const arc of arcs) {
        for (const beat of arc.beats.filter(b => b.status === 'active')) {
            activeBeats.push({ arcId: arc.id.slice(0, 8), beatId: beat.id, intention: beat.intention });
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

    if (activeBeats.length) {
        // Phrased as recognition of what already happened, never as an
        // instruction to bring it about — a condition the model reads as a
        // goal is a condition it writes toward.
        lines.push(
            'The completion marker below is the single exception to that rule.',
            '',
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

    return lines.join('\n');
}

function shouldShowSecret(revealPhase, currentPhase) {
    if (revealPhase === 'any') return true;
    const phaseOrder = ['setup', 'development', 'escalation', 'climax', 'resolution'];
    return phaseOrder.indexOf(currentPhase) >= phaseOrder.indexOf(revealPhase);
}
