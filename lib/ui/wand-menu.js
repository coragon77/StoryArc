/**
 * @file Wand-menu entry and its quick-access popup
 * @module ui/wand-menu
 *
 * Adds a "Story Arc" item to SillyTavern's extensions menu (the wand next to
 * the chat bar). Clicking it opens a popup with the two actions from the
 * settings drawer — Plan, Manage — plus Knowledge while the knowledge
 * tracker is on, and the progress display for the active arcs.
 * Setup rows (enable toggle, generation profile, arc preset)
 * stay in the drawer.
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay } from '/scripts/utils.js';
import { getSettings, isKnowledgeTrackerEnabled } from '../core/settings.js';
import { getActiveArcs } from '../planning/storage.js';
import { renderProgressDisplay } from './progress.js';
import { showWizard } from './wizard.js';
import { showArcManager } from './arc-manager.js';
import { showKnowledgePopup } from './knowledge-popup.js';

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
 * stack awkwardly. When that one closes the wand popup comes back, so the user
 * can run several actions without reopening the menu; rebuilding it also picks
 * up whatever the wizard or manager just changed.
 */
async function showWandPopup() {
    let openAfterClose = null;

    do {
        const wandContent = buildWandContent();
        const popup = new Popup(wandContent, POPUP_TYPE.TEXT, '', {
            okButton: false,
            cancelButton: false,
            allowVerticalScrolling: true,
        });

        const popupPromise = popup.show();

        // Small delay for DOM render (same as the wizard and arc manager)
        await delay(50);

        openAfterClose = null;
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

        $doc.on('click.storyArcWandPopup', '#story-arc-wand-knowledge', () => {
            openAfterClose = showKnowledgePopup;
            popup.complete(0);
        });

        // The progress cards' stall and ruling nudges: re-plan that arc, after
        // this popup has closed (the drawer's handler would stack the wizard on it).
        $doc.on('click.storyArcWandPopup', '#story-arc-wand .story-arc-stall-btn', function () {
            const arcId = $(this).data('arc-id');
            openAfterClose = () => showWizard(arcId);
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
    } while (openAfterClose);
}

/**
 * Build the popup body: heading, the actions, the active arcs' progress cards
 * and Close.
 * @returns {string} HTML string
 */
export function buildWandContent() {
    let html = `<div class="story-arc-wand" id="story-arc-wand">`;
    html += `<h2 class="story-arc-wand-heading">Story Arc</h2>`;

    if (!getSettings().enabled) {
        html += `<p class="story-arc-wand-note">Story Arc is off. Turn it on in the Story Arc section of the extensions panel.</p>`;
    } else {
        html += `
        <div class="story-arc-drawer-actions">
            <button type="button" id="story-arc-wand-plan" class="menu_button story-arc-drawer-primary" title="Plan the next arc from where the story is now">
                <i class="fa-solid fa-compass" aria-hidden="true"></i> Plan
            </button>
            <button type="button" id="story-arc-wand-manage" class="menu_button" title="Steer the arcs: focus, beats, re-plan, end">
                <i class="fa-solid fa-list" aria-hidden="true"></i> Manage
            </button>
            ${buildKnowledgeButton()}
        </div>`;

        const activeArcs = getActiveArcs();
        const progress = renderProgressDisplay(activeArcs);
        html += progress || `<p class="story-arc-wand-note">No active arcs. Plan one to guide the story.</p>`;
    }

    html += `
        <div class="story-arc-wand-controls">
            <button type="button" class="menu_button" id="story-arc-wand-close">Close</button>
        </div>
    </div>`;

    return html;
}

/**
 * The Knowledge action, only while the knowledge tracker is on: off, Story
 * Arc behaves as before.
 * @returns {string} HTML string, empty while the tracker is off
 */
function buildKnowledgeButton() {
    if (!isKnowledgeTrackerEnabled()) return '';

    return `
            <button type="button" id="story-arc-wand-knowledge" class="menu_button" title="Who knows what">
                <i class="fa-solid fa-user-secret" aria-hidden="true"></i> Knowledge
            </button>`;
}
