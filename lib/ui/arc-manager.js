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
import { saveMetadata } from '/script.js';
import { getArcs, updateArc } from '../planning/storage.js';
import { applyArcEdit, checkBeatEdit, removeBeat, togglePlanItem } from '../planning/arc-edit.js';
import { dropPendingMark } from '../injection/signals.js';
import { calculatePhase } from '../injection/pacing.js';
import { pauseArc, resumeArc } from '../injection/clock.js';
import { ensureChatState } from '../core/settings.js';
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
    const active = allArcs.filter(a => a.status === 'active');
    const inactive = allArcs.filter(a => a.status !== 'active');

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
        html += `
        <div class="story-arc-collapsed-section">
            <div class="story-arc-collapsed-header" id="story-arc-inactive-toggle">
                <i class="fa-solid fa-chevron-right"></i>
                <span>Past Arcs (${inactive.length})</span>
            </div>
            <div class="story-arc-collapsed-body" id="story-arc-inactive-list">
                <div class="story-arc-manager-list">
                    ${inactive.map(a => buildArcRow(a, true)).join('')}
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
    const nonOptional = arc.beats.filter(b => !b.optional);
    const completed = nonOptional.filter(b => b.status === 'completed').length;
    const total = nonOptional.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const statusBadge = buildStatusBadge(arc.status);
    const tierBadge = buildTierBadge(arc);
    const focusBadge = arc.status === 'active' ? buildFocusBadge(arc) : '';

    const actionsHtml = arc.status === 'active' ? `
        <div class="story-arc-row-actions">
            <select class="text_pole story-arc-focus-select" data-arc-id="${arc.id}"
                    title="Focus: paused sets the arc aside, spotlight pushes it to the front">
                ${ARC_FOCUS.map(f => `<option value="${f}" ${f === arc.focus ? 'selected' : ''}>${f}</option>`).join('')}
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
            <textarea class="story-arc-textarea story-arc-arc-json-input" rows="20" spellcheck="false">${escapeHtml(JSON.stringify(arc, null, 2))}</textarea>
            <div class="story-arc-beat-editor-actions">
                <div class="story-arc-btn story-arc-arc-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save</div>
                <div class="story-arc-btn story-arc-arc-cancel-btn">Cancel</div>
            </div>
        </div>` : '';

    const beatsHtml = buildBeatList(arc) + buildPlanItemList(arc);

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
        ${actionsHtml}
        ${beatsHtml}
    </div>`;
}

function buildStatusBadge(status) {
    const labels = { active: 'Active', completed: 'Completed', abandoned: 'Abandoned' };
    return `<span class="story-arc-badge story-arc-badge-${status}">${labels[status] || status}</span>`;
}

function buildTierBadge(arc) {
    const tier = arc.tier || 'episode';
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

    return `
    <div class="story-arc-spoiler-group">
        <div class="story-arc-spoiler-toggle" data-spoiler-target="${id}">
            <i class="fa-solid fa-chevron-right"></i>
            <span class="story-arc-spoiler-label">Beats (${arc.beats.length})</span>
            <i class="fa-solid fa-eye-slash story-arc-spoiler-icon"></i>
        </div>
        <div class="story-arc-spoiler-content" id="${id}">
            <div class="story-arc-spoiler-warning">
                <i class="fa-solid fa-triangle-exclamation"></i>
                Spoiler — these are the planned narrative beats.
            </div>
            <ul class="story-arc-beat-list">${beatItems}</ul>
        </div>
    </div>`;
}

/** Plan lists with a done flag the Arc Manager can toggle: list → flag, label */
const PLAN_ITEM_LISTS = {
    secrets: { flag: 'disclosed', heading: 'Secrets (done = revealed)', text: s => `${s.content} (reveal: ${s.revealPhase})` },
    foreshadowing: { flag: 'planted', heading: 'Foreshadowing (done = planted)', text: f => f.clue },
    triggers: { flag: 'fired', heading: 'Triggers (done = happened)', text: t => `IF ${t.condition} → ${t.action}` },
};

/**
 * Secrets, foreshadowing and triggers, each with a done toggle. The model
 * marks clues and triggers itself; secrets only ever get marked here.
 * @param {object} arc
 * @returns {string}
 */
function buildPlanItemList(arc) {
    const canToggle = arc.status === 'active';
    let count = 0;
    const groups = Object.entries(PLAN_ITEM_LISTS).map(([list, { flag, heading, text }]) => {
        const items = arc[list] || [];
        if (!items.length) return '';
        count += items.length;
        const rows = items.map(item => {
            const status = item[flag] ? 'completed' : 'pending';
            return `
            <li class="story-arc-beat-item ${item[flag] ? 'beat-completed' : ''}">
                <div class="story-arc-beat-status ${status} ${canToggle ? 'story-arc-plan-item-toggle' : ''}"
                     ${canToggle ? `data-arc-id="${arc.id}" data-list="${list}" data-item-id="${escapeHtml(item.id)}"` : ''}
                     title="${canToggle ? 'Click to toggle done' : status}">
                    ${getBeatStatusIcon(status)}
                </div>
                <span class="story-arc-beat-intention">${escapeHtml(text(item))}</span>
            </li>`;
        }).join('');
        return `<small>${heading}</small><ul class="story-arc-beat-list">${rows}</ul>`;
    }).join('');
    if (!count) return '';

    const id = `story-arc-plan-${arc.id.slice(0, 8)}`;
    return `
    <div class="story-arc-spoiler-group">
        <div class="story-arc-spoiler-toggle" data-spoiler-target="${id}">
            <i class="fa-solid fa-chevron-right"></i>
            <span class="story-arc-spoiler-label">Secrets, clues and triggers (${count})</span>
            <i class="fa-solid fa-eye-slash story-arc-spoiler-icon"></i>
        </div>
        <div class="story-arc-spoiler-content" id="${id}">
            <div class="story-arc-spoiler-warning">
                <i class="fa-solid fa-triangle-exclamation"></i>
                Spoiler — done items leave the prompt. Each toggle costs one prompt-cache miss.
            </div>
            ${groups}
        </div>
    </div>`;
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

// ─── Event Wiring ───────────────────────────────────────────────────────────

function wireManagerEvents(popup) {
    const $doc = $(document);
    $doc.off('click.storyArcManager');

    // Close
    $doc.on('click.storyArcManager', '#story-arc-manager-close', () => {
        if (typeof popup?.complete === 'function') {
            popup.complete(0);
        }
    });

    // Inactive section toggle
    $doc.on('click.storyArcManager', '#story-arc-inactive-toggle', function () {
        $(this).toggleClass('open');
        $('#story-arc-inactive-list').toggleClass('open');
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

    // Focus: paused / normal / spotlight
    $doc.on('change.storyArcManager', '.story-arc-focus-select', async function () {
        const arcId = $(this).data('arc-id');
        const focus = $(this).val();

        if (focus === 'paused') {
            await pauseArc(arcId);
        } else {
            await resumeArc(arcId, focus);
        }
        refreshManager();
        updateProgress();
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
        refreshManager();
        updateProgress();
    });

    // Abandon arc
    $doc.on('click.storyArcManager', '.story-arc-abandon-btn', async function () {
        const arcId = $(this).data('arc-id');
        await updateArc(arcId, { status: 'abandoned' });
        toastr.info('Arc abandoned.');
        refreshManager();
        updateProgress();
    });

    // Secret / clue / trigger done toggle (manual override)
    $doc.on('click.storyArcManager', '.story-arc-plan-item-toggle', async function () {
        const arcId = $(this).data('arc-id');
        const list = $(this).data('list');
        const itemId = String($(this).data('item-id'));
        const arc = getArcs().find(a => a.id === arcId);
        const item = arc?.[list]?.find(i => i.id === itemId);
        if (!item) return;

        // A queued model mark for this item would undo the hand toggle on
        // flush. Dropped first so updateArc's save covers it.
        dropPendingMark(arcId, list, itemId);
        await updateArc(arcId, { [list]: togglePlanItem(arc[list], itemId, PLAN_ITEM_LISTS[list].flag) });
        refreshManager();
    });

    // Beat status toggle (manual override)
    $doc.on('click.storyArcManager', '.story-arc-beat-status[data-arc-id]', async function () {
        const arcId = $(this).data('arc-id');
        const beatId = $(this).data('beat-id');
        const currentStatus = $(this).data('beat-status');

        if (currentStatus === 'locked') return;

        const allArcs = getArcs();
        const arc = allArcs.find(a => a.id === arcId);
        if (!arc) return;

        const beat = arc.beats.find(b => b.id === beatId);
        if (!beat) return;

        // Cycle: pending → active → completed → pending
        const cycle = { pending: 'active', active: 'completed', completed: 'pending' };
        beat.status = cycle[currentStatus] || 'pending';

        await updateArc(arcId, { beats: arc.beats });
        refreshManager();
        updateProgress();
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

        const arc = getArcs().find(a => a.id === arcId);
        const beat = arc?.beats.find(b => b.id === beatId);
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
        refreshManager();
        updateProgress();
    });

    // Arc edit: open / close the JSON editor
    $doc.on('click.storyArcManager', '.story-arc-arc-edit-btn, .story-arc-arc-cancel-btn', function () {
        $(this).closest('.story-arc-row').toggleClass('editing-arc');
    });

    // Arc edit: save the edited JSON
    $doc.on('click.storyArcManager', '.story-arc-arc-save-btn', async function () {
        const $editor = $(this).closest('.story-arc-arc-editor');
        const arcId = $editor.data('arc-id');

        const storedArc = getArcs().find(a => a.id === arcId);
        if (!storedArc) return;

        const { arc, error } = applyArcEdit(storedArc, String($editor.find('.story-arc-arc-json-input').val()));
        if (error) {
            toastr.warning(error);
            return;
        }

        // Replace, not merge: a field deleted in the editor must go. In place,
        // because storedArc is the object inside chat_metadata.
        for (const key of Object.keys(storedArc)) delete storedArc[key];
        Object.assign(storedArc, arc);
        await saveMetadata();
        toastr.success('Arc saved.');
        refreshManager();
        updateProgress();
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

        const arc = getArcs().find(a => a.id === arcId);
        if (!arc) return;

        // An arc without beats has nothing to drive it and can never complete.
        if (arc.beats.length === 1) {
            toastr.warning('An arc needs at least one beat. Abandon the arc instead.');
            return;
        }

        const beats = removeBeat(arc.beats, beatId);

        // Same rule as signal processing: no open non-optional beat left
        // means the arc is done.
        const remaining = beats.filter(b => !b.optional && b.status !== 'completed');
        const status = remaining.length === 0 ? 'completed' : arc.status;

        await updateArc(arcId, { beats, status });
        if (status === 'completed') {
            toastr.info('No open beats left. Arc marked as completed.');
        }
        refreshManager();
        updateProgress();
    });
}

function refreshManager() {
    const $manager = $('#story-arc-manager');
    if (!$manager.length) return;

    // Keep open beat lists open; a rebuild would collapse them after every edit.
    const openSpoilerIds = $manager.find('.story-arc-spoiler-content.open').map((_, el) => el.id).get();

    const newHtml = buildManagerContent();
    $manager.replaceWith(newHtml);

    for (const id of openSpoilerIds) {
        $(`#${id}`).addClass('open');
        $(`.story-arc-spoiler-toggle[data-spoiler-target="${id}"]`).addClass('open');
    }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
