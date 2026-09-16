/**
 * @file Injection section for a paused arc, any tier
 * @module injection/sections/paused
 *
 * One line: the premise as distant tension. Text unchanged from the pre-tier
 * background section — the header word stays for byte-identity.
 */

/**
 * @param {object} arc - An active, paused arc
 * @returns {string}
 */
export function buildPausedSection(arc) {
    return `=== BACKGROUNDED: "${arc.title}" ===\n${arc.premise || arc.title}. Keep this present as distant tension. Do not advance plot beats for this arc.\n`;
}
