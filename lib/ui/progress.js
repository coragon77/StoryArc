/**
 * @file Progress display for the settings drawer and the wand popup
 * @module ui/progress
 *
 * One row per active arc in the Arc Manager's grammar: title, tier, phase
 * and a focus other than normal in text; the beat strip as squares by shape
 * (buildBeatStrip from beat-strip.js, read-only); the message gap to the next
 * phase while it holds the phase back; and the stall or overrule warning as
 * a sentence with its fixes, Re-plan and (for a stall) Ignore. Also holds
 * the stall rule (isStalled, isStallNudgeShown); its count start and the
 * ignore live in injection/clock.js.
 */

import { chat } from '/script.js';
import { escapeHtml } from '/scripts/utils.js';
import { getActiveArcs } from '../planning/storage.js';
import { calculatePhase, messagesUntilNextPhase, selectNonOptionalBeats } from '../injection/pacing.js';
import { arcTier } from '../core/settings.js';
import { TIER_TABLE } from '../core/constants.js';
import { stallCountStart } from '../injection/clock.js';
import { buildBeatStrip } from './beat-strip.js';

/**
 * Re-render the progress display in the settings drawer.
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
        // A broken stored arc: say so where the rows would be, details to the console
        console.error('[Story Arc] Failed to update progress display:', err);
        $container.html('<p class="story-arc-progress-error" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> '
            + 'The arcs could not be shown. Open the Arc Manager to check them; the browser console has the details.</p>');
    }
}

/** A focus other than normal, as the row names it */
const FOCUS_WORDS = { paused: 'paused', background: 'in the background', spotlight: 'in the spotlight' };

/**
 * Render the progress rows for a list of arcs.
 * @param {object[]} arcs - Active arcs
 * @returns {string} HTML string, empty for no arcs
 */
export function renderProgressDisplay(arcs) {
    if (!arcs || arcs.length === 0) {
        return '';
    }

    const rows = arcs.map(arc => {
        const { phase, label } = calculatePhase(arc);
        const tierLabel = TIER_TABLE[arcTier(arc)].label;
        const focusWord = FOCUS_WORDS[arc.focus] ? ` · ${FOCUS_WORDS[arc.focus]}` : '';
        const title = escapeHtml(arc.title);

        // The phase is the minimum of beat progress and message progress, so a
        // full beat strip can still sit in an early phase. Show the message gap
        // only while it is the thing holding the phase back — 0 means the beats
        // are the limit, and resolution has no phase after it.
        const remaining = phase === 'resolution' ? 0 : messagesUntilNextPhase(arc, phase);
        const pacingLine = remaining > 0
            ? `<span class="am-cell-sub">~${remaining} ${remaining === 1 ? 'message' : 'messages'} to the next phase</span>`
            : '';

        // Player-facing only; nothing about a stall reaches the prompt. The
        // Re-plan and Ignore buttons' click handlers live with the drawer
        // (settings-panel.js) and the wand popup (wand-menu.js). An open ruling is the more specific
        // of the two warnings, so it wins over the stall.
        const warning = renderRulingWarning(arc) || renderStallWarning(arc);

        return `
        <li class="story-arc-progress-arc">
            <div class="story-arc-progress-head">
                <span class="story-arc-progress-title" title="${title}">${title}</span>
                <span class="story-arc-progress-meta">${tierLabel} · ${label}${focusWord}</span>
            </div>
            ${buildBeatStrip(arc, [], false)}
            ${pacingLine}
            ${warning}
        </li>`;
    }).join('');

    return `<ul class="am story-arc-progress" aria-label="Active arcs">${rows}
    </ul>`;
}

/**
 * The warning of an arc's open rulings (those without answeredAt): the
 * newest one quoted, the option a bare pick picked, "and N earlier" when
 * there are more, and Re-plan. Only the player's own words, the narrator's
 * out-of-character option and the count reach the row, never plan text;
 * nothing of it reaches the prompt. Empty without an open ruling.
 * @param {object} arc
 * @returns {string} HTML string
 */
function renderRulingWarning(arc) {
    const openRulings = (arc.rulings || []).filter(ruling => ruling.answeredAt === undefined);
    if (openRulings.length === 0) return '';

    // The newest is the one from the latest message; of two from one
    // message, the one stored last.
    let newestRuling = openRulings[0];
    for (const ruling of openRulings) {
        if (ruling.at >= newestRuling.at) newestRuling = ruling;
    }
    const earlierCount = openRulings.length - 1;
    const earlierNote = earlierCount > 0 ? `, and ${earlierCount} earlier` : '';
    // A bare pick ("Option one") means nothing alone: the option it picked
    // follows, the narrator's out-of-character words the player has read.
    const choseNote = newestRuling.chose ? `, picking <q>${escapeHtml(newestRuling.chose)}</q>` : '';

    return buildWarning(arc, 'fa-gavel',
        `You overruled the plan: <q>${escapeHtml(newestRuling.text)}</q>${choseNote}${earlierNote}.`,
        'Re-plan the rest of this arc; the re-plan follows your rulings as binding', false);
}

/**
 * The stall warning while the player sees it (isStallNudgeShown): how long
 * no beat landed against how often one is due, Re-plan and Ignore. An arc
 * without a usable length or non-optional beat gets no "due every" part.
 * @param {object} arc
 * @returns {string} HTML string, empty while the arc is not stalled or the stall is ignored
 */
function renderStallWarning(arc) {
    if (!isStallNudgeShown(arc, chat.length)) return '';

    const beatWord = arcTier(arc) === 'episode' ? 'scene beat' : 'milestone';
    const nonOptionalCount = selectNonOptionalBeats(arc.beats).length;
    const messagesSince = Math.max(0, chat.length - 1 - stallCountStart(arc));
    const perBeat = nonOptionalCount > 0 ? Math.round(arc.estimatedLength / nonOptionalCount) : 0;
    const rhythm = Number.isFinite(perBeat) && perBeat > 0 ? ` — about one is due every ${perBeat}` : '';
    return buildWarning(arc, 'fa-triangle-exclamation',
        `No ${beatWord} in ${messagesSince} messages${rhythm}.`,
        'Re-plan the rest of this arc from where the story is now', true);
}

/**
 * A warning in the Arc Manager's form: icon, one sentence, the fixes.
 * @param {object} arc
 * @param {string} icon - Font Awesome icon class
 * @param {string} sentenceHtml - The sentence, escaped
 * @param {string} fixTitle - The Re-plan button's tooltip
 * @param {boolean} canIgnore - A stall can be ignored until the next beat; a ruling cannot
 * @returns {string} HTML string
 */
function buildWarning(arc, icon, sentenceHtml, fixTitle, canIgnore) {
    const beatWord = arcTier(arc) === 'episode' ? 'scene beat' : 'milestone';
    const ignoreButton = canIgnore
        ? `<button type="button" class="menu_button story-arc-ignore-stall-btn" data-arc-id="${escapeHtml(arc.id)}" title="Hide this warning until the next ${beatWord} lands or the arc is re-planned">Ignore</button>`
        : '';
    return `<div class="am-alert" role="group" aria-label="Warning for ${escapeHtml(arc.title)}">
                <i class="fa-solid ${icon}" aria-hidden="true"></i>
                <p>${sentenceHtml}</p>
                <div class="am-alert-actions">
                    <button type="button" class="menu_button story-arc-stall-btn" data-arc-id="${escapeHtml(arc.id)}" title="${fixTitle}"><i class="fa-solid fa-route" aria-hidden="true"></i> Re-plan</button>
                    ${ignoreButton}
                </div>
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
 * The count starts at stallCountStart: the latest of messageStart,
 * lastFulfilledAt, replannedAt, reactivatedAt and spotlitAt (the chat length
 * when the arc last went into the spotlight, spotlightArc). lastFulfilledAt is the chat index of the last fulfilling
 * message (set to messageStart at planning); migrated arcs may carry 0 or
 * nothing there, so the count then starts at messageStart. replannedAt is
 * the chat length when the last re-plan was applied (applyReplan), absent
 * on arcs never re-planned; a rollback cannot move it. reactivatedAt is
 * the chat length when a past arc was reactivated (reactivateArc in
 * injection/clock.js), absent on arcs never reactivated. A chat shorter than
 * the stamp counts negative, so nothing lights until it grows past it.
 * @param {object} arc
 * @param {number} chatLength - Current chat length
 * @returns {boolean}
 */
export function isStalled(arc, chatLength) {
    if (arc.focus === 'paused' || arc.focus === 'background') return false;

    const nonOptionalCount = selectNonOptionalBeats(arc.beats).length;
    if (nonOptionalCount === 0 || !arc.estimatedLength) return false;

    const allowance = 3 * arc.estimatedLength / nonOptionalCount;
    const messagesSinceFulfillment = chatLength - stallCountStart(arc);
    return messagesSinceFulfillment > allowance;
}

/**
 * Whether the player sees the arc's stall nudge: the arc is stalled and the
 * player has not ignored this stall (ignoreStall). An ignored stall is the
 * one counted from the start stored at the ignore; the next beat landing, a
 * re-plan or a reactivation moves the count's start, so a stall after it
 * shows again.
 * @param {object} arc
 * @param {number} chatLength - Current chat length
 * @returns {boolean}
 */
export function isStallNudgeShown(arc, chatLength) {
    if (!isStalled(arc, chatLength)) return false;
    return arc.stallIgnoredFrom !== stallCountStart(arc);
}
