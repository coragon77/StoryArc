/**
 * @file Arc manager popup — list, toggle, complete, abandon arcs
 * @module ui/arc-manager
 *
 * Displays all arcs for the current chat in a popup with:
 * - Active arcs at top with full controls
 * - Completed/abandoned arcs collapsed at bottom
 * - Per-arc: status badge, tier badge, focus control, progress bar, beat list (spoiler)
 * - Beat list with manual status toggle, and edit/delete per beat
 * - Edit arc: every field as JSON, bookkeeping fields kept as stored
 * - Re-plan per active arc, opening the wizard after this popup closes
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { getArcById, getArcs, replaceArc, updateArc } from '../planning/storage.js';
import { applyArcEdit, checkBeatEdit, completeBeat, removeBeat, togglePlanItem } from '../planning/arc-edit.js';
import { chat_metadata, saveMetadata } from '/script.js';
import { dropPendingMark, MARK_FLUSH_WINDOW } from '../injection/signals.js';
import { calculatePhase, selectNonOptionalBeats } from '../injection/pacing.js';
import { pauseArc, resumeArc, spotlightArc } from '../injection/clock.js';
import { arcTier, ensureChatState } from '../core/settings.js';
import { ARC_FOCUS, TIER_TABLE } from '../core/constants.js';
import { updateProgress } from './progress.js';
import { showWizard } from './wizard.js';

/** Arc the user asked to re-plan; the wizard opens once this popup has closed */
let replanArcId = null;

/**
 * Show the arc manager popup.
 */
export async function showArcManager() {
    ensureChatState();
    replanArcId = null;

    const html = buildManagerContent();

    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    const popupPromise = popup.show();

    // Small delay for DOM render
    await delay(50);
    wireManagerEvents(popup);

    await popupPromise;

    // Cleanup — leaving these bound double-toggles the wizard's spoilers
    $(document).off('.storyArcManager');

    // Nested ST popups stack badly, so the wizard opens only now (same
    // pattern as the wand menu).
    if (replanArcId) {
        await showWizard(replanArcId);
    }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function buildManagerContent() {
    const allArcs = getArcs();
    const active = allArcs.filter(arc => arc.status === 'active');
    const inactive = allArcs.filter(arc => arc.status !== 'active');

    let html = `<div class="story-arc-manager" id="story-arc-manager">`;
    html += `<div class="story-arc-section-header"><i class="fa-solid fa-compass"></i> Story Arcs</div>`;

    if (active.length === 0 && inactive.length === 0) {
        html += `<div class="story-arc-empty">No arcs yet. Use "Plan Next Arc" to create one.</div>`;
    }

    if (active.length > 0) {
        html += `<div class="story-arc-manager-list">`;
        for (const arc of active) {
            html += buildArcRow(arc);
        }
        html += `</div>`;
    }

    if (inactive.length > 0) {
        const inactiveRowsHtml = inactive.map(arc => buildArcRow(arc, true)).join('');
        html += `
        <div class="story-arc-collapsed-section">
            <div class="story-arc-collapsed-header" id="story-arc-inactive-toggle">
                <i class="fa-solid fa-chevron-right"></i>
                <span>Past Arcs (${inactive.length})</span>
            </div>
            <div class="story-arc-collapsed-body" id="story-arc-inactive-list">
                <div class="story-arc-manager-list">
                    ${inactiveRowsHtml}
                </div>
            </div>
        </div>`;
    }

    html += `
        <div class="story-arc-wizard-footer">
            <div class="story-arc-btn" id="story-arc-manager-close">Close</div>
        </div>
    </div>`;

    return html;
}

function buildArcRow(arc, isInactive = false) {
    const { phase, label } = calculatePhase(arc);
    const nonOptional = selectNonOptionalBeats(arc.beats);
    const completed = nonOptional.filter(beat => beat.status === 'completed').length;
    const total = nonOptional.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const statusBadge = buildStatusBadge(arc.status);
    const tierBadge = buildTierBadge(arc);
    const focusBadge = arc.status === 'active' ? buildFocusBadge(arc) : '';
    // An episode's ordered scene beats have no off-screen form (ADR-0001 amendment)
    const focusOptions = arcTier(arc) === 'episode'
        ? ARC_FOCUS.filter(focus => focus !== 'background')
        : ARC_FOCUS;

    let actionsHtml = '';
    if (arc.status === 'active') {
        const focusOptionsHtml = focusOptions.map(focus => `<option value="${focus}" ${focus === arc.focus ? 'selected' : ''}>${focus}</option>`).join('');
        const arcJson = JSON.stringify(arc, null, 2);
        actionsHtml = `
        <div class="story-arc-row-actions">
            <select class="text_pole story-arc-focus-select" data-arc-id="${arc.id}"
                    title="Focus: paused sets the arc aside, background keeps it off-screen until the story goes to it, spotlight pushes it to the front">
                ${focusOptionsHtml}
            </select>
            <div class="story-arc-btn story-arc-replan-btn" data-arc-id="${arc.id}" title="Re-plan the rest of this arc from where the story is now">
                <i class="fa-solid fa-route"></i> Re-plan
            </div>
            <div class="story-arc-btn story-arc-complete-btn" data-arc-id="${arc.id}" title="Mark as completed">
                <i class="fa-solid fa-check"></i> Complete
            </div>
            <div class="story-arc-btn story-arc-arc-edit-btn" title="Edit every field of this arc as JSON">
                <i class="fa-solid fa-pen-to-square"></i> Edit arc
            </div>
            <div class="story-arc-btn story-arc-btn-danger story-arc-abandon-btn" data-arc-id="${arc.id}" title="Abandon this arc">
                <i class="fa-solid fa-xmark"></i> Abandon
            </div>
        </div>
        <div class="story-arc-arc-editor" data-arc-id="${arc.id}">
            <small>id, status, tier, focus and the message counters are kept as stored, whatever you write here.</small>
            <textarea class="story-arc-textarea story-arc-arc-json-input" rows="20" spellcheck="false">${escapeHtml(arcJson)}</textarea>
            <div class="story-arc-beat-editor-actions">
                <div class="story-arc-btn story-arc-arc-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save</div>
                <div class="story-arc-btn story-arc-arc-cancel-btn">Cancel</div>
            </div>
        </div>`;
    }

    const pendingMarks = chat_metadata.story_arc?.pendingMarks || [];
    const beatsHtml = buildBeatList(arc) + buildPlanItemLists(arc, pendingMarks);

    return `
    <div class="story-arc-row ${isInactive ? 'inactive' : ''}" data-arc-id="${arc.id}">
        <div class="story-arc-row-header">
            <span class="story-arc-row-title">${escapeHtml(arc.title)}</span>
            ${statusBadge}
            ${tierBadge}
            ${focusBadge}
        </div>
        <div class="story-arc-row-meta">
            <span class="story-arc-row-phase">Phase: ${escapeHtml(label)}</span>
            <div class="story-arc-row-progress">
                <div class="story-arc-progress-bar" style="flex: 1;">
                    <div class="story-arc-progress-fill phase-${phase}" style="width: ${pct}%"></div>
                </div>
                <span class="story-arc-row-progress-text">${completed}/${total}</span>
            </div>
        </div>
        ${buildReportsWaitingLine(arc, pendingMarks)}
        ${actionsHtml}
        ${beatsHtml}
    </div>`;
}

function buildStatusBadge(status) {
    const labels = { active: 'Active', completed: 'Completed', abandoned: 'Abandoned' };
    return `<span class="story-arc-badge story-arc-badge-${status}">${labels[status] || status}</span>`;
}

function buildTierBadge(arc) {
    const tier = arcTier(arc);
    return `<span class="story-arc-badge story-arc-badge-tier">${TIER_TABLE[tier]?.label || tier}</span>`;
}

function buildFocusBadge(arc) {
    return `<span class="story-arc-badge story-arc-badge-${arc.focus}">${arc.focus}</span>`;
}

function buildBeatList(arc) {
    if (!arc.beats || arc.beats.length === 0) return '';

    const beatItems = arc.beats.map(beat => {
        const statusIcon = getBeatStatusIcon(beat.status);
        const completedClass = beat.status === 'completed' ? 'beat-completed' : '';
        const optLabel = beat.optional ? ' <span class="story-arc-beat-optional-label">(optional)</span>' : '';

        const canToggle = arc.status === 'active';

        const editHtml = canToggle ? `
            <div class="story-arc-beat-edit-btn" title="Edit beat"><i class="fa-solid fa-pen"></i></div>
            <div class="story-arc-beat-editor" data-arc-id="${arc.id}" data-beat-id="${beat.id}">
                <label>Pressure <small>(the only part the narrating AI sees)</small></label>
                <textarea class="story-arc-textarea story-arc-beat-pressure-input" rows="2">${escapeHtml(beat.pressure)}</textarea>
                <label>Fulfilled when</label>
                <textarea class="story-arc-textarea story-arc-beat-intention-input" rows="2">${escapeHtml(beat.intention)}</textarea>
                <div class="story-arc-beat-editor-actions">
                    <div class="story-arc-btn story-arc-beat-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save</div>
                    <div class="story-arc-btn story-arc-beat-cancel-btn">Cancel</div>
                    <div class="story-arc-btn story-arc-btn-danger story-arc-beat-delete-btn"><i class="fa-solid fa-trash"></i> Delete</div>
                </div>
            </div>` : '';

        return `
        <li class="story-arc-beat-item ${completedClass}">
            <div class="story-arc-beat-status ${beat.status}"
                 ${canToggle ? `data-arc-id="${arc.id}" data-beat-id="${beat.id}" data-beat-status="${beat.status}"` : ''}
                 title="${canToggle ? 'Click to toggle status' : beat.status}">
                ${statusIcon}
            </div>
            <span class="story-arc-beat-intention">${escapeHtml(beat.intention)}${optLabel}</span>
            ${editHtml}
        </li>`;
    }).join('');

    const id = `story-arc-beats-${arc.id.slice(0, 8)}`;
    const label = `Beats (${arc.beats.length})`;
    const bodyHtml = `<ul class="story-arc-beat-list">${beatItems}</ul>`;

    return buildSpoilerGroup(id, label, 'Spoiler — these are the planned narrative beats.', bodyHtml);
}

function getBeatStatusIcon(status) {
    switch (status) {
        case 'completed': return '<i class="fa-solid fa-check"></i>';
        case 'active': return '<i class="fa-solid fa-play"></i>';
        case 'pending': return '<i class="fa-regular fa-circle"></i>';
        case 'locked': return '<i class="fa-solid fa-lock"></i>';
        default: return '<i class="fa-regular fa-circle"></i>';
    }
}

/**
 * A collapsed spoiler group: toggle with label, warning line, then the body.
 * wizard.js buildSpoilerSection writes the same markup for the review step,
 * on purpose in its own file: there the title is escaped text, the id is
 * derived from it and the warning is fixed; here the caller passes the id and
 * both texts as HTML. Both depend on the .story-arc-spoiler-* rules in
 * css/spoiler.css.
 * @param {string} id - Id of the content element the toggle opens
 * @param {string} label - Toggle text, inserted as HTML
 * @param {string} warningText - Warning line, inserted as HTML
 * @param {string} bodyHtml
 * @returns {string}
 */
function buildSpoilerGroup(id, label, warningText, bodyHtml) {
    return `
    <div class="story-arc-spoiler-group">
        <div class="story-arc-spoiler-toggle" data-spoiler-target="${id}">
            <i class="fa-solid fa-chevron-right"></i>
            <span class="story-arc-spoiler-label">${label}</span>
            <i class="fa-solid fa-eye-slash story-arc-spoiler-icon"></i>
        </div>
        <div class="story-arc-spoiler-content" id="${id}">
            <div class="story-arc-spoiler-warning">
                <i class="fa-solid fa-triangle-exclamation"></i>
                ${warningText}
            </div>
            ${bodyHtml}
        </div>
    </div>`;
}

/** Plan lists with a done flag the Arc Manager can toggle: list → flag, drawer label, done word */
const PLAN_ITEM_LISTS = {
    secrets: { flag: 'disclosed', label: 'Secrets', doneWord: 'revealed', text: secret => `${secret.content} (reveal: ${secret.revealPhase})` },
    foreshadowing: { flag: 'planted', label: 'Clues', doneWord: 'planted', text: foreshadowing => foreshadowing.clue },
    triggers: { flag: 'fired', label: 'Triggers', doneWord: 'happened', text: trigger => `IF ${trigger.condition} → ${trigger.action}` },
};

/**
 * Secrets, clues and triggers in a drawer each, so the player can open one
 * without seeing the others. Each item is open, waiting or done. Waiting
 * means the model reported it in a reply and the mark sits in the queue
 * until the prompt changes anyway (ADR-0005); without that state the drawer
 * showed such an item as open while a queued mark would still close it later
 * (Paragon chat, 2026-10-31). Waiting and open items come first, done ones
 * after under their own heading.
 * @param {object} arc
 * @param {object[]} pendingMarks - The chat's queued marks, all arcs
 * @returns {string}
 */
export function buildPlanItemLists(arc, pendingMarks) {
    const canToggle = arc.status === 'active';
    const arcMarks = pendingMarks.filter(mark => mark.arcId === arc.id);

    return Object.entries(PLAN_ITEM_LISTS).map(([list, config]) => {
        const items = arc[list] || [];
        if (!items.length) return '';

        const queuedAt = new Map(arcMarks.filter(mark => mark.list === list).map(mark => [mark.id, mark.at]));
        const stateOf = item => {
            if (item[config.flag]) return 'done';
            if (queuedAt.has(item.id)) return 'queued';
            return 'open';
        };
        const waitingItems = items.filter(item => stateOf(item) === 'queued');
        const openItems = items.filter(item => stateOf(item) === 'open');
        const doneItems = items.filter(item => stateOf(item) === 'done');

        const rowOf = item => buildPlanItemRow(arc, list, config, item, stateOf(item), queuedAt.get(item.id), canToggle);
        const liveRows = [...waitingItems, ...openItems].map(rowOf).join('');
        const doneRows = doneItems.map(rowOf).join('');
        const body = (liveRows ? `<ul class="story-arc-beat-list">${liveRows}</ul>` : '')
            + (doneRows ? `<small class="story-arc-plan-done-heading">${config.doneWord} (${doneItems.length})</small><ul class="story-arc-beat-list">${doneRows}</ul>` : '');

        const waitingChip = waitingItems.length
            ? `<span class="story-arc-plan-chip queued"><i class="fa-solid fa-hourglass-half"></i> ${waitingItems.length} waiting</span>`
            : '';
        const doneChip = `<span class="story-arc-plan-chip done">${doneItems.length} ${config.doneWord}</span>`;
        const label = `${config.label} (${items.length}) ${waitingChip}${doneChip}`;
        const id = `story-arc-plan-${list}-${arc.id.slice(0, 8)}`;
        return buildSpoilerGroup(id, label, 'Spoiler — done items leave the prompt. Each toggle costs one prompt-cache miss.', body);
    }).join('');
}

/**
 * One secret, clue or trigger with its status box. A waiting item shows an
 * hourglass; clicking it drops the report and leaves the item open. Clicking
 * an open item marks it done, a done one sets it back to open.
 * @returns {string}
 */
function buildPlanItemRow(arc, list, config, item, state, reportedAt, canToggle) {
    const icons = {
        done: '<i class="fa-solid fa-check"></i>',
        queued: '<i class="fa-solid fa-hourglass-half"></i>',
        open: '<i class="fa-regular fa-circle"></i>',
    };
    const statusClasses = { done: 'completed', queued: 'queued', open: 'pending' };
    let title = state;
    if (canToggle && state === 'queued') {
        title = `Reported as ${config.doneWord} in message #${reportedAt}. Applied when the next milestone completes, or after ${MARK_FLUSH_WINDOW} messages. Click to drop the report.`;
    } else if (canToggle && state === 'done') {
        title = 'Click to set back to open';
    } else if (canToggle) {
        title = `Click to mark ${config.doneWord}`;
    }
    const toggleAttributes = canToggle
        ? `data-arc-id="${arc.id}" data-list="${list}" data-item-id="${escapeHtml(item.id)}" data-queued="${state === 'queued'}"`
        : '';
    const waitingNote = state === 'queued'
        ? `<div class="story-arc-plan-waiting-note"><i class="fa-solid fa-hourglass-half"></i> Reported in message #${reportedAt}, waiting to be applied</div>`
        : '';
    return `
    <li class="story-arc-beat-item ${state === 'done' ? 'beat-completed' : ''}">
        <div class="story-arc-beat-status ${statusClasses[state]} ${canToggle ? 'story-arc-plan-item-toggle' : ''}"
             ${toggleAttributes} title="${escapeHtml(title)}">
            ${icons[state]}
        </div>
        <span class="story-arc-beat-intention">${escapeHtml(config.text(item))}${waitingNote}</span>
    </li>`;
}

/**
 * The arc card line counting the arc's waiting reports, '' when there are
 * none or the arc is not active. Counts the marks the drawers show as
 * waiting: a mark whose item a re-plan removed, or whose item is already
 * done, has no hourglass and is not counted.
 * @param {object} arc
 * @param {object[]} pendingMarks - The chat's queued marks, all arcs
 * @returns {string}
 */
export function buildReportsWaitingLine(arc, pendingMarks) {
    if (arc.status !== 'active') return '';
    const waiting = pendingMarks.filter(mark => {
        if (mark.arcId !== arc.id) return false;
        const item = (arc[mark.list] || []).find(candidate => candidate.id === mark.id);
        return item && !item[mark.flag];
    }).length;
    if (!waiting) return '';
    const noun = waiting === 1 ? 'report' : 'reports';
    return `<div class="story-arc-reports-waiting"><i class="fa-solid fa-hourglass-half"></i> ${waiting} ${noun} waiting — applied with the next milestone or after ${MARK_FLUSH_WINDOW} messages</div>`;
}

// ─── Event Wiring ───────────────────────────────────────────────────────────

function wireManagerEvents(popup) {
    const $doc = $(document);
    $doc.off('click.storyArcManager');

    // Focus: paused / background / normal / spotlight
    $doc.on('change.storyArcManager', '.story-arc-focus-select', async function () {
        const arcId = $(this).data('arc-id');
        const focus = $(this).val();

        if (focus === 'paused') {
            await pauseArc(arcId);
        } else if (focus === 'spotlight') {
            // Only one arc in the spotlight: the previous one goes back to normal
            await spotlightArc(arcId);
        } else {
            await resumeArc(arcId, focus);
        }
        refreshViews();
    });

    // Re-plan: close this popup, then open the wizard for the arc
    $doc.on('click.storyArcManager', '.story-arc-replan-btn', function () {
        replanArcId = $(this).data('arc-id');
        if (typeof popup?.complete === 'function') {
            popup.complete(0);
        }
    });

    // Complete arc
    $doc.on('click.storyArcManager', '.story-arc-complete-btn', async function () {
        const arcId = $(this).data('arc-id');
        await updateArc(arcId, { status: 'completed' });
        toastr.success('Arc marked as completed.');
        refreshViews();
    });

    // Abandon arc
    $doc.on('click.storyArcManager', '.story-arc-abandon-btn', async function () {
        const arcId = $(this).data('arc-id');
        await updateArc(arcId, { status: 'abandoned' });
        toastr.info('Arc abandoned.');
        refreshViews();
    });

    // Arc edit: open / close the JSON editor
    $doc.on('click.storyArcManager', '.story-arc-arc-edit-btn, .story-arc-arc-cancel-btn', function () {
        $(this).closest('.story-arc-row').toggleClass('editing-arc');
    });

    // Arc edit: save the edited JSON
    $doc.on('click.storyArcManager', '.story-arc-arc-save-btn', async function () {
        const $editor = $(this).closest('.story-arc-arc-editor');
        const arcId = $editor.data('arc-id');

        const storedArc = getArcById(arcId);
        if (!storedArc) return;

        const editedJson = String($editor.find('.story-arc-arc-json-input').val());
        const { arc, error } = applyArcEdit(storedArc, editedJson);
        if (error) {
            toastr.warning(error);
            return;
        }

        await replaceArc(storedArc, arc);
        toastr.success('Arc saved.');
        refreshViews();
    });

    // Spoiler toggles
    $doc.on('click.storyArcManager', '.story-arc-spoiler-toggle', function () {
        const $toggle = $(this);
        const targetId = $toggle.data('spoiler-target');
        if (targetId) {
            $toggle.toggleClass('open');
            $(`#${targetId}`).toggleClass('open');
        }
    });

    // Beat status toggle (manual override)
    $doc.on('click.storyArcManager', '.story-arc-beat-status[data-arc-id]', async function () {
        const arcId = $(this).data('arc-id');
        const beatId = $(this).data('beat-id');
        const currentStatus = $(this).data('beat-status');

        if (currentStatus === 'locked') return;

        const arc = getArcById(arcId);
        if (!arc) return;

        const beat = arc.beats.find(candidate => candidate.id === beatId);
        if (!beat) return;

        // Cycle: pending → active → completed → pending. Completing unlocks
        // the beats that waited for this one; setting a completed beat back
        // does not lock them again.
        const cycle = { pending: 'active', active: 'completed', completed: 'pending' };
        const nextStatus = cycle[currentStatus] || 'pending';
        const beats = nextStatus === 'completed'
            ? completeBeat(arc.beats, beatId)
            : arc.beats.map(otherBeat => otherBeat.id === beatId ? { ...otherBeat, status: nextStatus } : otherBeat);

        await updateArc(arcId, { beats });
        refreshViews();
    });

    // Beat edit: open / close the inline editor
    $doc.on('click.storyArcManager', '.story-arc-beat-edit-btn, .story-arc-beat-cancel-btn', function () {
        const $item = $(this).closest('.story-arc-beat-item');
        $item.toggleClass('editing');
        $item.find('.story-arc-beat-delete-btn').removeClass('armed').html('<i class="fa-solid fa-trash"></i> Delete');
    });

    // Beat edit: save pressure and intention
    $doc.on('click.storyArcManager', '.story-arc-beat-save-btn', async function () {
        const $editor = $(this).closest('.story-arc-beat-editor');
        const arcId = $editor.data('arc-id');
        const beatId = $editor.data('beat-id');

        const arc = getArcById(arcId);
        const beat = arc?.beats.find(candidate => candidate.id === beatId);
        if (!beat) return;

        const edit = {
            pressure: String($editor.find('.story-arc-beat-pressure-input').val()).trim(),
            intention: String($editor.find('.story-arc-beat-intention-input').val()).trim(),
        };
        const error = checkBeatEdit(arc.tier, edit);
        if (error) {
            toastr.warning(error);
            return;
        }

        beat.pressure = edit.pressure;
        beat.intention = edit.intention;
        await updateArc(arcId, { beats: arc.beats });
        refreshViews();
    });

    // Beat delete: the first click arms the button, the second deletes
    $doc.on('click.storyArcManager', '.story-arc-beat-delete-btn', async function () {
        const $button = $(this);
        if (!$button.hasClass('armed')) {
            $button.addClass('armed').html('<i class="fa-solid fa-trash"></i> Really delete?');
            return;
        }

        const $editor = $button.closest('.story-arc-beat-editor');
        const arcId = $editor.data('arc-id');
        const beatId = $editor.data('beat-id');

        const arc = getArcById(arcId);
        if (!arc) return;

        // An arc without beats has nothing to drive it and can never complete.
        if (arc.beats.length === 1) {
            toastr.warning('An arc needs at least one beat. Abandon the arc instead.');
            return;
        }

        const beats = removeBeat(arc.beats, beatId);

        // Same rule as signal processing: no open non-optional beat left
        // means the arc is done.
        const remaining = selectNonOptionalBeats(beats).filter(nonOptionalBeat => nonOptionalBeat.status !== 'completed');
        const status = remaining.length === 0 ? 'completed' : arc.status;

        await updateArc(arcId, { beats, status });
        if (status === 'completed') {
            toastr.info('No open beats left. Arc marked as completed.');
        }
        refreshViews();
    });

    // Secret / clue / trigger done toggle (manual override)
    $doc.on('click.storyArcManager', '.story-arc-plan-item-toggle', async function () {
        const arcId = $(this).data('arc-id');
        const list = $(this).data('list');
        const itemId = String($(this).data('item-id'));
        const arc = getArcById(arcId);
        const item = arc?.[list]?.find(candidate => candidate.id === itemId);
        if (!item) return;

        // A waiting item: the click only drops the model's report, and the
        // item stays open. The next click on the open item marks it done.
        if ($(this).data('queued') === true) {
            dropPendingMark(arcId, list, itemId);
            await saveMetadata();
            refreshManager();
            return;
        }

        // A queued model mark for this item would undo the hand toggle on
        // flush. Dropped first so updateArc's save covers it.
        dropPendingMark(arcId, list, itemId);
        const toggledItems = togglePlanItem(arc[list], itemId, PLAN_ITEM_LISTS[list].flag);
        await updateArc(arcId, { [list]: toggledItems });
        // The progress card counts beats only, so a plan item leaves it unchanged.
        refreshManager();
    });

    // Inactive section toggle
    $doc.on('click.storyArcManager', '#story-arc-inactive-toggle', function () {
        $(this).toggleClass('open');
        $('#story-arc-inactive-list').toggleClass('open');
    });

    // Close
    $doc.on('click.storyArcManager', '#story-arc-manager-close', () => {
        if (typeof popup?.complete === 'function') {
            popup.complete(0);
        }
    });
}

/** Rebuild both views that show arc state: this popup and the progress card. */
function refreshViews() {
    refreshManager();
    updateProgress();
}

function refreshManager() {
    const $manager = $('#story-arc-manager');
    if (!$manager.length) return;

    // Keep open beat lists open; a rebuild would collapse them after every edit.
    const openSpoilerIds = $manager.find('.story-arc-spoiler-content.open').map((index, element) => element.id).get();

    const newHtml = buildManagerContent();
    $manager.replaceWith(newHtml);

    for (const id of openSpoilerIds) {
        $(`#${id}`).addClass('open');
        $(`.story-arc-spoiler-toggle[data-spoiler-target="${id}"]`).addClass('open');
    }
}
