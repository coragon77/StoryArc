/**
 * @file Wand-menu entry and its quick-access popup
 * @module ui/wand-menu
 *
 * Adds a "Story Arc" item to SillyTavern's extensions menu (the wand next to
 * the chat bar). Clicking it opens a popup with the two actions from the
 * settings drawer — Plan Next Arc, Manage Arcs — plus the progress display for
 * the active arcs. Setup rows (enable toggle, generation profile, arc preset)
 * stay in the drawer.
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { getSettings } from '../core/settings.js';
import { getActiveArcs } from '../planning/storage.js';
import { renderProgressDisplay } from './progress.js';
import { showWizard } from './wizard.js';
import { showArcManager } from './arc-manager.js';

/**
 * Append the Story Arc entry to ST's extensions (wand) menu.
 * Safe to call once at extension load; no-ops if the entry already exists.
 */
export function registerWandMenuEntry() {
    const $menu = $('#extensionsMenu');
    if (!$menu.length) {
        console.warn('[Story Arc] Extensions menu not found — no wand entry');
        return;
    }
    if ($('#story_arc_wand_button').length) {
        return;
    }

    $menu.append(`
        <div id="story_arc_wand_button" class="list-group-item flex-container flexGap5 interactable" title="Story Arc: plan and manage arcs">
            <i class="fa-solid fa-compass"></i>
            <span>Story Arc</span>
        </div>`);

    $(document).off('click.storyArcWand', '#story_arc_wand_button');
    $(document).on('click.storyArcWand', '#story_arc_wand_button', showWandPopup);
}

/**
 * Show the wand popup. Wizard and arc manager are popups themselves, so this
 * one closes first and opens the chosen one afterwards — nested ST popups
 * stack awkwardly.
 */
async function showWandPopup() {
    const popup = new Popup(buildWandContent(), POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        allowVerticalScrolling: true,
    });

    const popupPromise = popup.show();

    // Small delay for DOM render (same as the wizard and arc manager)
    await delay(50);

    let openAfterClose = null;
    const $doc = $(document);

    // Clean up previous handlers before rebinding — same defence as the
    // wizard and arc manager (see commit 7945e3a)
    $doc.off('click.storyArcWandPopup');

    $doc.on('click.storyArcWandPopup', '#story-arc-wand-plan', () => {
        openAfterClose = showWizard;
        popup.complete(0);
    });

    $doc.on('click.storyArcWandPopup', '#story-arc-wand-manage', () => {
        openAfterClose = showArcManager;
        popup.complete(0);
    });

    $doc.on('click.storyArcWandPopup', '#story-arc-wand-close', () => {
        popup.complete(0);
    });

    await popupPromise;

    // Cleanup — leaving these bound fires them again from the next popup
    $doc.off('click.storyArcWandPopup');

    if (openAfterClose) {
        await openAfterClose();
    }
}

/**
 * Build the popup body: actions plus the active-arc progress cards.
 * @returns {string} HTML string
 */
function buildWandContent() {
    let html = `<div class="story-arc-wand" id="story-arc-wand">`;
    html += `<div class="story-arc-section-header"><i class="fa-solid fa-compass"></i> Story Arc</div>`;

    if (!getSettings().enabled) {
        html += `<div class="story-arc-empty">Story Arc is disabled. Enable it in the extensions panel.</div>`;
    } else {
        html += `
        <div class="story-arc-panel-row">
            <div id="story-arc-wand-plan" class="menu_button story-arc-btn" title="Plan a new story arc">
                <i class="fa-solid fa-compass"></i>
                <span>Plan Next Arc</span>
            </div>
            <div id="story-arc-wand-manage" class="menu_button story-arc-btn" title="View and manage arcs">
                <i class="fa-solid fa-list"></i>
                <span>Manage Arcs</span>
            </div>
        </div>`;

        const progress = renderProgressDisplay(getActiveArcs());
        html += progress || `<div class="story-arc-empty">No active arcs.</div>`;
    }

    html += `
        <div class="story-arc-wizard-footer">
            <div class="story-arc-btn" id="story-arc-wand-close">Close</div>
        </div>
    </div>`;

    return html;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
