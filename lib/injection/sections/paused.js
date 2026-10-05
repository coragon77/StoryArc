/**
 * @file Injection section for a paused arc, any tier
 * @module injection/sections/paused
 *
 * One line: the model is told the arc exists and is not being pursued. No
 * beats, no pressures — the arc is set aside for a tangent (GLOSSARY.md,
 * "Paused").
 */

/**
 * @param {object} arc - An active, paused arc
 * @returns {string}
 */
export function buildPausedSection(arc) {
    return `=== PAUSED: "${arc.title}" ===\n${arc.premise || arc.title} — pending, not being pursued right now.\n`;
}
