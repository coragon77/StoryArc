/**
 * @file Injection section for an act or saga in background focus
 * @module injection/sections/background
 *
 * Title and one sentence. The arc goes on off-screen: no premise, no
 * pressures, because a normal saga's standing pressures coloured every scene
 * with its thread (Paragon chat, 2026-10-25). Its beats stay in the beat
 * check, so a milestone still completes when the user plays the thread
 * (GLOSSARY.md, "Background"). Episodes have no background focus (ADR-0001
 * amendment).
 */

/**
 * @param {object} arc - An active act or saga in background focus
 * @returns {string}
 */
export function buildBackgroundSection(arc) {
    return `=== BACKGROUND: "${arc.title}" ===\nRuns off-screen. Leave it out of scenes — no hints, sounds or clues — unless the user's character goes to it or brings it up.\n`;
}
