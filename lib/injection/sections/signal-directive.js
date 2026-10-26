/**
 * @file The in-chat beat-signal directive
 * @module injection/sections/signal-directive
 *
 * Continuation guard and confidentiality clause on every generation; the
 * BEAT CHECK with one recognition line per active beat of every arc that is
 * not paused. A paused arc's beats are not checked (GLOSSARY.md, "Paused").
 * The PLANT CHECK has one line per unplanted clue and unfired trigger of every
 * arc whose section shows them. Secrets get no line: it would have to state
 * the secret right before the reply is written.
 */

import { arcTier } from '../../core/settings.js';

/**
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
export function buildSignalDirective(arcs) {
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
 * the dispatch in builder.js: episodes in normal or spotlight focus, acts and
 * sagas in spotlight only.
 * @param {object} arc
 * @returns {boolean}
 */
function showsPlanLists(arc) {
    if (arc.focus === 'paused') return false;
    return arcTier(arc) === 'episode' || arc.focus === 'spotlight';
}
