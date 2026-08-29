/**
 * @file Arc manager popup — list, toggle, complete, abandon arcs
 * @module ui/arc-manager
 *
 * Displays all arcs for the current chat in a popup with:
 * - Active arcs at top with full controls
 * - Completed/abandoned arcs collapsed at bottom
 * - Per-arc: status badge, focus toggle, progress bar, beat list (spoiler)
 * - Beat list with manual status toggle
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { saveMetadata } from '/script.js';
import { getArcs, updateArc } from '../planning/storage.js';
import { calculatePhase } from '../injection/pacing.js';
import { ensureChatState } from '../core/settings.js';
import { updateProgress } from './progress.js';

/**
 * Show the arc manager popup.
 */
export async function showArcManager() {
    ensureChatState();

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
    $(document).off('click.storyArcManager');
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
    const focusBadge = arc.status === 'active' ? buildFocusBadge(arc) : '';

    const actionsHtml = arc.status === 'active' ? `
        <div class="story-arc-row-actions">
            <div class="story-arc-btn story-arc-focus-btn"
                 data-arc-id="${arc.id}" data-current-focus="${arc.focus}"
                 title="Toggle foreground/background">
                <i class="fa-solid fa-${arc.focus === 'foreground' ? 'eye' : 'eye-slash'}"></i>
                ${arc.focus === 'foreground' ? 'Foreground' : 'Background'}
            </div>
            <div class="story-arc-btn story-arc-complete-btn" data-arc-id="${arc.id}" title="Mark as completed">
                <i class="fa-solid fa-check"></i> Complete
            </div>
            <div class="story-arc-btn story-arc-btn-danger story-arc-abandon-btn" data-arc-id="${arc.id}" title="Abandon this arc">
                <i class="fa-solid fa-xmark"></i> Abandon
            </div>
        </div>` : '';

    const beatsHtml = buildBeatList(arc);

    return `
    <div class="story-arc-row ${isInactive ? 'inactive' : ''}" data-arc-id="${arc.id}">
        <div class="story-arc-row-header">
            <span class="story-arc-row-title">${escapeHtml(arc.title)}</span>
            ${statusBadge}
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

        return `
        <li class="story-arc-beat-item ${completedClass}">
            <div class="story-arc-beat-status ${beat.status}"
                 ${canToggle ? `data-arc-id="${arc.id}" data-beat-id="${beat.id}" data-beat-status="${beat.status}"` : ''}
                 title="${canToggle ? 'Click to toggle status' : beat.status}">
                ${statusIcon}
            </div>
            <span class="story-arc-beat-intention">${escapeHtml(beat.intention)}${optLabel}</span>
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

    // Focus toggle
    $doc.on('click.storyArcManager', '.story-arc-focus-btn', async function () {
        const arcId = $(this).data('arc-id');
        const currentFocus = $(this).data('current-focus');
        const newFocus = currentFocus === 'foreground' ? 'background' : 'foreground';

        await updateArc(arcId, { focus: newFocus });
        refreshManager();
        updateProgress();
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
}

function refreshManager() {
    const $manager = $('#story-arc-manager');
    if (!$manager.length) return;

    const newHtml = buildManagerContent();
    $manager.replaceWith(newHtml);
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
