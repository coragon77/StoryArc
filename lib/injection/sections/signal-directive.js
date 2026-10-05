/**
 * @file The in-chat beat-signal directive
 * @module injection/sections/signal-directive
 *
 * Continuation guard and confidentiality clause on every generation; the
 * BEAT CHECK with one recognition line per active beat of every arc that is
 * not paused. A paused arc's beats are not checked (GLOSSARY.md, "Paused").
 */

/**
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
export function buildSignalDirective(arcs) {
    const activeBeats = [];
    for (const arc of arcs) {
        if (arc.focus === 'paused') continue;
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
