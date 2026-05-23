/**
 * @file Settings panel UI for Story Arc extension
 * @module ui/settings-panel
 *
 * Renders the extension panel in ST's right-column extensions drawer
 * and wires up its interactive elements.
 */

import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { MODULE_NAME } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { showWizard } from './wizard.js';
import { showArcManager } from './arc-manager.js';

/**
 * Render the settings panel HTML.
 * Placed inside #extensions_settings2 by index.js.
 * @returns {string} HTML string
 */
export function renderSettingsPanel() {
    const settings = getSettings();
    const checkedAttr = settings.enabled ? 'checked' : '';

    return `
    <div id="story-arc-settings" class="story-arc-panel">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-compass"></i> Story Arc</b>
                <div class="inline-drawer-icon fa-solid interactable down fa-circle-chevron-down" tabindex="0" role="button"></div>
            </div>
            <div class="inline-drawer-content" style="display: none;">
                <!-- Enable toggle -->
                <div class="story-arc-panel-row">
                    <label class="checkbox_label">
                        <input type="checkbox" id="story-arc-enabled" ${checkedAttr} />
                        <span>Enable Story Arc</span>
                    </label>
                </div>

                <!-- Action buttons -->
                <div class="story-arc-panel-row">
                    <div id="story-arc-plan-btn" class="menu_button story-arc-btn" title="Plan a new story arc">
                        <i class="fa-solid fa-compass"></i>
                        <span>Plan Next Arc</span>
                    </div>
                    <div id="story-arc-manage-btn" class="menu_button story-arc-btn" title="View and manage arcs">
                        <i class="fa-solid fa-list"></i>
                        <span>Manage Arcs</span>
                    </div>
                </div>

                <!-- Progress display (filled dynamically) -->
                <div id="story-arc-progress-container"></div>
            </div>
        </div>
    </div>`;
}

/**
 * Wire up event handlers for the settings panel.
 * Uses namespaced jQuery events to allow clean re-attachment.
 */
export function setupSettingsPanelEvents() {
    // Clean up previous handlers
    $(document).off('change.storyArc', '#story-arc-enabled');
    $(document).off('click.storyArc', '#story-arc-plan-btn');
    $(document).off('click.storyArc', '#story-arc-manage-btn');

    // Enable toggle
    $(document).on('change.storyArc', '#story-arc-enabled', function () {
        const settings = getSettings();
        settings.enabled = $(this).prop('checked');
        extension_settings[MODULE_NAME] = settings;
        saveSettingsDebounced();
        console.log(`[Story Arc] Extension ${settings.enabled ? 'enabled' : 'disabled'}`);
    });

    // Plan Next Arc button
    $(document).on('click.storyArc', '#story-arc-plan-btn', function () {
        showWizard();
    });

    // Manage Arcs button
    $(document).on('click.storyArc', '#story-arc-manage-btn', function () {
        showArcManager();
    });
}
