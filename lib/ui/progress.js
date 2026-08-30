/**
 * @file Progress display for the settings panel
 * @module ui/progress
 *
 * Shows compact progress bars and phase labels for each active arc
 * in the settings panel's #story-arc-progress-container.
 */

import { getActiveArcs } from '../planning/storage.js';
import { calculatePhase, messagesUntilNextPhase } from '../injection/pacing.js';

/**
 * Render progress display HTML for a list of arcs.
 * @param {object[]} arcs - Active arcs
 * @returns {string} HTML string
 */
export function renderProgressDisplay(arcs) {
    if (!arcs || arcs.length === 0) {
        return '';
    }

    const cards = arcs.map(arc => {
        const { phase, label } = calculatePhase(arc);
        const nonOptional = arc.beats.filter(b => !b.optional);
        const completed = nonOptional.filter(b => b.status === 'completed').length;
        const total = nonOptional.length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

        // The phase is the minimum of beat progress and message progress, so a
        // full beat bar can still sit in an early phase. Show the message gap
        // only while it is the thing holding the phase back — 0 means the beats
        // are the limit, and resolution has no phase after it.
        const remaining = phase === 'resolution' ? 0 : messagesUntilNextPhase(arc, phase);
        const pacingLine = remaining > 0
            ? `<div class="story-arc-progress-pacing">~${remaining} msgs to next phase</div>`
            : '';

        return `
        <div class="story-arc-progress-card">
            <div class="story-arc-progress-header">
                <span class="story-arc-progress-focus ${arc.focus}" title="${arc.focus}"></span>
                <span class="story-arc-progress-title" title="${escapeAttr(arc.title)}">${escapeHtml(arc.title)}</span>
                <span class="story-arc-progress-phase phase-${phase}">${label}</span>
            </div>
            <div class="story-arc-progress-bar">
                <div class="story-arc-progress-fill phase-${phase}" style="width: ${pct}%"></div>
            </div>
            <div class="story-arc-progress-count">${completed}/${total} beats</div>
            ${pacingLine}
        </div>`;
    }).join('');

    return cards;
}

/**
 * Re-render the progress display in the settings panel.
 * Safe to call at any time — no-ops if container is absent.
 */
export function updateProgress() {
    const $container = $('#story-arc-progress-container');
    if (!$container.length) return;

    try {
        const arcs = getActiveArcs();
        $container.html(renderProgressDisplay(arcs));
    } catch (err) {
        console.warn('[Story Arc] Failed to update progress display:', err);
        $container.html('');
    }
}

/**
 * Escape HTML for safe insertion.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Escape for use in HTML attributes.
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
}
