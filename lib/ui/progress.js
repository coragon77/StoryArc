/**
 * @file Progress display for the settings panel
 * @module ui/progress
 *
 * Shows compact progress bars and phase labels for each active arc
 * in the settings panel's #story-arc-progress-container.
 */

import { chat } from '/script.js';
import { escapeHtml } from '/scripts/utils.js';
import { getActiveArcs } from '../planning/storage.js';
import { calculatePhase, messagesUntilNextPhase, selectNonOptionalBeats } from '../injection/pacing.js';
import { arcMessageStart, arcTier } from '../core/settings.js';

/**
 * Re-render the progress display in the settings panel.
 * Safe to call at any time — no-ops if container is absent.
 */
export function updateProgress() {
    const $container = $('#story-arc-progress-container');
    if (!$container.length) return;

    try {
        const arcs = getActiveArcs();
        const progressHtml = renderProgressDisplay(arcs);
        $container.html(progressHtml);
    } catch (err) {
        console.warn('[Story Arc] Failed to update progress display:', err);
        $container.html('');
    }
}

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
        const nonOptional = selectNonOptionalBeats(arc.beats);
        const completed = nonOptional.filter(beat => beat.status === 'completed').length;
        const total = nonOptional.length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        const beatNoun = arcTier(arc) === 'episode' ? 'beats' : 'milestones';

        // The phase is the minimum of beat progress and message progress, so a
        // full beat bar can still sit in an early phase. Show the message gap
        // only while it is the thing holding the phase back — 0 means the beats
        // are the limit, and resolution has no phase after it.
        const remaining = phase === 'resolution' ? 0 : messagesUntilNextPhase(arc, phase);
        const pacingLine = remaining > 0
            ? `<div class="story-arc-progress-pacing">~${remaining} msgs to next phase</div>`
            : '';

        // Player-facing only; nothing about a stall reaches the prompt. The
        // click handler lives in settings-panel.js with the other drawer buttons.
        const stallLine = isStalled(arc, chat.length)
            ? `<div class="story-arc-stall-btn" data-arc-id="${arc.id}" title="Re-plan the rest of this arc from where the story is now">May have drifted — re-plan?</div>`
            : '';

        return `
        <div class="story-arc-progress-card">
            <div class="story-arc-progress-header">
                <span class="story-arc-progress-focus ${arc.focus}" title="${arc.focus}"></span>
                <span class="story-arc-progress-title" title="${escapeHtml(arc.title)}">${escapeHtml(arc.title)}</span>
                <span class="story-arc-progress-phase phase-${phase}">${label}</span>
            </div>
            <div class="story-arc-progress-bar">
                <div class="story-arc-progress-fill phase-${phase}" style="width: ${pct}%"></div>
            </div>
            <div class="story-arc-progress-count">${completed}/${total} ${beatNoun}</div>
            ${pacingLine}
            ${stallLine}
        </div>`;
    }).join('');

    return cards;
}

/**
 * Stall rule (spec §4): an episode has gone more than three times its expected
 * per-beat length without a fulfillment. Never while paused, never for acts
 * and sagas — milestones cannot diverge.
 *
 * lastFulfilledAt is the chat index of the last fulfilling message (set to
 * messageStart at planning). Migrated arcs may carry 0 or nothing there; the
 * count then starts at messageStart so an old episode is not nudged at once.
 * @param {object} arc
 * @param {number} chatLength - Current chat length
 * @returns {boolean}
 */
export function isStalled(arc, chatLength) {
    if (arcTier(arc) !== 'episode') return false;
    if (arc.focus === 'paused') return false;

    const nonOptionalCount = selectNonOptionalBeats(arc.beats).length;
    if (nonOptionalCount === 0 || !arc.estimatedLength) return false;

    const lastFulfilledAt = typeof arc.lastFulfilledAt === 'number' ? arc.lastFulfilledAt : 0;
    const countFrom = Math.max(lastFulfilledAt, arcMessageStart(arc));
    const allowance = 3 * arc.estimatedLength / nonOptionalCount;
    const messagesSinceFulfillment = chatLength - countFrom;
    return messagesSinceFulfillment > allowance;
}
