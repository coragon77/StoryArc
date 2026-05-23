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

    if (settings.autoTrack) {
        sections.push(buildSignalDirective(arcs));
    }

    sections.push('[END STORY ARC]');

    let injection = sections.join('\n');

    const budget = settings.injectionBudget || 3000;
    if (estimateTokens(injection) > budget) {
        injection = trimInjection(injection, budget, foreground, background);
    }

    return injection;
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

    const visibleBeats = arc.beats.filter(b => b.status === 'active' || b.status === 'pending');
    if (visibleBeats.length) {
        lines.push('CURRENT BEATS:');
        for (const beat of visibleBeats) {
            const marker = beat.status === 'active' ? '(NOW)' : '(upcoming)';
            lines.push(`- ${marker} ${beat.intention}`);
        }
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
            activeBeats.push({ arcId: arc.id.slice(0, 8), beatId: beat.id });
        }
    }

    if (!activeBeats.length) return '';

    const lines = [
        'BEAT COMPLETION SIGNALS:',
        'When a narrative beat has been meaningfully fulfilled, append this signal',
        'at the very end of your message, after all story content:',
        '',
    ];
    for (const { arcId, beatId } of activeBeats) {
        lines.push(`  [ARC_SIGNAL:${arcId}:${beatId}:COMPLETE]`);
    }
    lines.push('');
    lines.push('Only signal when the beat\'s INTENTION has been met. If uncertain, do not signal.');
    lines.push('');

    return lines.join('\n');
}

function shouldShowSecret(revealPhase, currentPhase) {
    if (revealPhase === 'any') return true;
    const phaseOrder = ['setup', 'development', 'escalation', 'climax', 'resolution'];
    return phaseOrder.indexOf(currentPhase) >= phaseOrder.indexOf(revealPhase);
}

function trimInjection(injection, budget, foreground, background) {
    const chars = budget * 4;
    if (injection.length > chars) {
        console.warn(`[Story Arc] Injection trimmed from ${injection.length} to ${chars} chars`);
        return injection.slice(0, chars) + '\n[END STORY ARC]';
    }
    return injection;
}
