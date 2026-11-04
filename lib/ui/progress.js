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
        // An open ruling is the more specific of the two nudges, so it wins
        // over the stall line. Both buttons share the stall button's class.
        const rulingLine = renderRulingLine(arc);
        const stallLine = !rulingLine && isStalled(arc, chat.length)
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
            ${rulingLine}
            ${stallLine}
        </div>`;
    }).join('');

    return cards;
}

/**
 * The card line of an arc's open rulings (those without answeredAt): the
 * newest one quoted, "and N earlier" when there are more, and the arc's
 * re-plan button; a bare pick with the option it picked. Only the player's
 * own words, the narrator's out-of-character option and the count reach the
 * card, never plan text; nothing of it reaches the prompt. Empty without
 * an open ruling.
 * @param {object} arc
 * @returns {string} HTML string
 */
function renderRulingLine(arc) {
    const openRulings = (arc.rulings || []).filter(ruling => ruling.answeredAt === undefined);
    if (openRulings.length === 0) return '';

    // The newest is the one from the latest message; of two from one
    // message, the one stored last.
    let newestRuling = openRulings[0];
    for (const ruling of openRulings) {
        if (ruling.at >= newestRuling.at) newestRuling = ruling;
    }
    const earlierCount = openRulings.length - 1;
    const earlierNote = earlierCount > 0 ? ` and ${earlierCount} earlier` : '';
    const quotedText = escapeHtml(newestRuling.text);
    // A bare pick ("Option one") means nothing alone: the option it picked
    // follows, the narrator's out-of-character words the player has read.
    let choseNote = '';
    let tooltip = quotedText;
    if (newestRuling.chose) {
        const choseText = escapeHtml(newestRuling.chose);
        choseNote = ` <span class="story-arc-ruling-chose">picked “${choseText}”</span>`;
        tooltip = `${quotedText} — picked: ${choseText}`;
    }

    return `<div class="story-arc-ruling">
                <div class="story-arc-ruling-text" title="${tooltip}"><span class="story-arc-ruling-quote">“${quotedText}”</span>${choseNote}${earlierNote}</div>
                <div class="story-arc-stall-btn" data-arc-id="${arc.id}" title="Re-plan the rest of this arc from where the story is now">You overruled the plan — re-plan?</div>
            </div>`;
}

/**
 * Stall rule (spec §4, #33): an arc of any tier has gone more than three
 * times its expected per-beat length without a fulfillment. The per-beat
 * length is its estimated length divided by its non-optional beats (an
 * act's or saga's milestones). Never while paused, and never in background
 * focus: no fulfillment is expected of an arc kept off-screen, though its
 * clock still runs. An arc without non-optional beats or an estimated
 * length never stalls.
 *
 * The count starts at the latest of messageStart, lastFulfilledAt and
 * replannedAt. lastFulfilledAt is the chat index of the last fulfilling
 * message (set to messageStart at planning); migrated arcs may carry 0 or
 * nothing there, so the count then starts at messageStart. replannedAt is
 * the chat length when the last re-plan was applied (applyReplan), absent
 * on arcs never re-planned; a rollback cannot move it. A chat shorter than
 * the stamp counts negative, so nothing lights until it grows past it.
 * @param {object} arc
 * @param {number} chatLength - Current chat length
 * @returns {boolean}
 */
export function isStalled(arc, chatLength) {
    if (arc.focus === 'paused' || arc.focus === 'background') return false;

    const nonOptionalCount = selectNonOptionalBeats(arc.beats).length;
    if (nonOptionalCount === 0 || !arc.estimatedLength) return false;

    const lastFulfilledAt = typeof arc.lastFulfilledAt === 'number' ? arc.lastFulfilledAt : 0;
    const replannedAt = typeof arc.replannedAt === 'number' ? arc.replannedAt : 0;
    const countFrom = Math.max(lastFulfilledAt, replannedAt, arcMessageStart(arc));
    const allowance = 3 * arc.estimatedLength / nonOptionalCount;
    const messagesSinceFulfillment = chatLength - countFrom;
    return messagesSinceFulfillment > allowance;
}
