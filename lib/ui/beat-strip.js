/**
 * @file The beat strip: one square per beat, its shape telling the status
 * @module ui/beat-strip
 *
 * A file of its own because two files really call it: the Arc Manager's
 * table (arc-manager.js) and the progress rows in the drawer and the wand
 * popup (progress.js). The tier words and number formatting it needs come
 * along, and the Arc Manager imports them from here.
 */

import { escapeHtml } from '/scripts/utils.js';
import { MARK_FLUSH_WINDOW } from '../injection/signals.js';
import { selectNonOptionalBeats } from '../injection/pacing.js';
import { arcTier, isBeatOpen } from '../core/settings.js';
import { ARC_PHASES } from '../core/constants.js';

/**
 * The beat strip: one square per beat, grouped by phase, its shape telling
 * the status (filled with a check = done, faded with a forward arrow =
 * skipped, solid outline = open or active, dashed = pending, dashed with a
 * lock = locked), the done count, and the arc's waiting reports. A skipped
 * milestone counts with the done ones, and the count then says so
 * ("3/5 done or skipped"). Interactive cells open the beat in the detail; a
 * past arc's strip is read-only.
 * @param {object} arc
 * @param {object[]} pendingMarks
 * @param {boolean} isInteractive
 * @returns {string} HTML string
 */
export function buildBeatStrip(arc, pendingMarks, isInteractive) {
    const words = beatWords(arc);
    const beats = arc.beats || [];
    const phaseGroups = [];
    beats.forEach((beat, index) => {
        const lastGroup = phaseGroups[phaseGroups.length - 1];
        if (lastGroup && lastGroup.phase === beat.phase) {
            lastGroup.items.push({ beat, index });
        } else {
            phaseGroups.push({ phase: beat.phase, items: [{ beat, index }] });
        }
    });

    let isFirstCell = true;
    const cells = phaseGroups.map(group => `<span class="am-strip-group">${group.items.map(({ beat, index }) => {
        const label = beatLabel(arc, beat, index);
        const tabIndex = isFirstCell ? 0 : -1;
        isFirstCell = false;
        const shape = beatShape(arc, beat.status);
        if (isInteractive) {
            return `<button type="button" class="am-cell ${shape.className}" data-act="cell" data-id="${arc.id}" data-beat="${escapeHtml(beat.id)}" tabindex="${tabIndex}" aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(label)}">${shape.inner}</button>`;
        }
        return `<span class="am-shape ${shape.className}" role="img" aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(label)}" tabindex="${tabIndex}">${shape.inner}</span>`;
    }).join('')}</span>`).join('');

    const nonOptionalBeats = selectNonOptionalBeats(beats);
    const closedCount = nonOptionalBeats.filter(beat => !isBeatOpen(beat)).length;
    const hasSkipped = nonOptionalBeats.some(beat => beat.status === 'skipped');
    const countWord = hasSkipped ? 'done or skipped' : 'done';
    const waitingCount = isInteractive ? waitingMarksOf(arc, pendingMarks).length : 0;
    const reports = waitingCount
        ? `<span class="am-reports" title="The narrator reported ${waitingCount === 1 ? 'a secret, clue or trigger' : 'secrets, clues or triggers'} as done. Applied with the next ${words.beat} or after ${MARK_FLUSH_WINDOW} messages, so the prompt changes once. Reveal the plan to see or drop ${waitingCount === 1 ? 'it' : 'them'}.">
            <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>${plural(waitingCount, 'report')} waiting</span>`
        : '';
    return `<div class="am-strip"><span class="am-strip-cells" role="group" aria-label="${words.Beats} of ${escapeHtml(arc.title)}">${cells}</span>
        <span class="am-count"><b>${closedCount}</b>/${nonOptionalBeats.length} ${countWord}</span>${reports}</div>`;
}

function beatLabel(arc, beat, index) {
    const phaseLabel = ARC_PHASES[beat.phase]?.label || beat.phase || 'no phase';
    const optional = beat.optional ? ' · optional' : '';
    const skippedNote = beat.status === 'skipped' ? ` — ${SKIPPED_NOTE}` : '';
    return `${beatWords(arc).Beat} ${index + 1} of ${arc.beats.length} · ${phaseLabel}${optional} · ${beatStatusWord(arc, beat.status)}${skippedNote}`;
}

/** Why a milestone is skipped, after its status word (strip tooltip, Arc Manager detail) */
export const SKIPPED_NOTE = 'the story moved past it';

/** The square of a beat status: its class and the icon inside */
function beatShape(arc, status) {
    if (status === 'completed') return { className: 's-completed', inner: '<i class="fa-solid fa-check" aria-hidden="true"></i>' };
    if (status === 'skipped') return { className: 's-skipped', inner: '<i class="fa-solid fa-forward" aria-hidden="true"></i>' };
    if (status === 'locked') return { className: 's-locked', inner: '<i class="fa-solid fa-lock" aria-hidden="true"></i>' };
    if (status === 'active' && arcTier(arc) === 'episode') return { className: 's-active', inner: '<i class="fa-solid fa-play" aria-hidden="true"></i>' };
    if (status === 'active') return { className: 's-open', inner: '' };
    return { className: 's-pending', inner: '' };
}

/** The words for an arc's beats by tier */
export function beatWords(arc) {
    if (arcTier(arc) === 'episode') {
        return { Beat: 'Scene beat', beat: 'scene beat', beats: 'scene beats', Beats: 'Scene beats', note: 'in order, one active at a time' };
    }
    return { Beat: 'Milestone', beat: 'milestone', beats: 'milestones', Beats: 'Milestones', note: 'in order, the first open one presses' };
}

/** A beat status as the popup names it: a milestone is open, skipped or done, a scene beat pending, active or done */
export function beatStatusWord(arc, status) {
    if (status === 'completed') return 'Done';
    if (status === 'skipped') return 'Skipped';
    if (status === 'locked') return 'Locked';
    if (status === 'pending') return 'Pending';
    if (status === 'active') return arcTier(arc) === 'episode' ? 'Active' : 'Open';
    return status;
}

/**
 * The queued marks of an arc that still wait: their item exists and is not
 * done yet. A mark whose item a re-plan removed, or that is already done,
 * waits for nothing.
 * @param {object} arc
 * @param {object[]} pendingMarks - The chat's queued marks, all arcs
 * @returns {object[]}
 */
export function waitingMarksOf(arc, pendingMarks) {
    return pendingMarks.filter(mark => {
        if (mark.arcId !== arc.id) return false;
        const item = (arc[mark.list] || []).find(candidate => candidate.id === mark.id);
        return item && !item[mark.flag];
    });
}

export function formatNumber(number) {
    return Number(number).toLocaleString('en');
}

export function plural(count, one, many = `${one}s`) {
    return `${formatNumber(count)} ${count === 1 ? one : many}`;
}
