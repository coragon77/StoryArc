/**
 * @file Settings panel UI for Story Arc extension
 * @module ui/settings-panel
 *
 * Renders the extension panel in ST's right-column extensions drawer
 * and wires up its interactive elements.
 */

import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { Popup } from '/scripts/popup.js';
import { getPresetManager } from '/scripts/preset-manager.js';
import { MODULE_NAME } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { ARC_PRESET_NAME, createArcPreset } from '../planning/index.js';
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

                <!-- Generation profile -->
                <div class="story-arc-panel-row">
                    <label class="checkbox_label" for="story-arc-profile" title="Connection Manager profile used for arc generation. 'Current API' uses whatever API the chat is using.">
                        <span>Generation profile</span>
                    </label>
                    <select id="story-arc-profile" class="text_pole"></select>
                </div>

                <!-- Derive an arc-generation preset from an existing one -->
                <div class="story-arc-panel-row">
                    <label class="checkbox_label" for="story-arc-base-preset" title="Chat completion preset to derive the arc generation preset from. Pick one that works with your generation API.">
                        <span>Base preset</span>
                    </label>
                    <select id="story-arc-base-preset" class="text_pole"></select>
                    <div id="story-arc-create-preset-btn" class="menu_button story-arc-btn" title="Create a '${ARC_PRESET_NAME}' preset tuned for arc planning, plus a matching connection profile">
                        <i class="fa-solid fa-sliders"></i>
                        <span>Create arc preset</span>
                    </div>
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
 * Fill the generation-profile dropdown from Connection Manager's profile list.
 * Re-run on demand since profiles can be created/deleted at any time.
 */
function populateProfileSelect() {
    const settings = getSettings();
    const profiles = extension_settings.connectionManager?.profiles || [];
    const $select = $('#story-arc-profile');
    $select.empty().append('<option value="">Current API (no profile)</option>');
    for (const profile of [...profiles].sort((a, b) => a.name.localeCompare(b.name))) {
        $select.append($('<option></option>').val(profile.id).text(profile.name));
    }
    $select.val(settings.defaultConnectionProfile || '');
}

/**
 * Fill the base-preset dropdown from ST's chat completion presets.
 * Preselects the preset the configured generation profile already pins, so the
 * usual case is one click without picking anything.
 */
function populateBasePresetSelect() {
    const presetManager = getPresetManager('openai');
    const $select = $('#story-arc-base-preset');
    if (!presetManager) {
        $select.empty().append('<option value="">(Chat Completion API not active)</option>');
        return;
    }

    const presetNames = presetManager.getAllPresets().filter(name => name !== ARC_PRESET_NAME);
    $select.empty();
    for (const name of presetNames) {
        $select.append($('<option></option>').val(name).text(name));
    }

    const profiles = extension_settings.connectionManager?.profiles || [];
    const activeProfile = profiles.find(p => p.id === getSettings().defaultConnectionProfile);
    const preferred = activeProfile?.preset || presetManager.getSelectedPresetName();
    if (presetNames.includes(preferred)) {
        $select.val(preferred);
    }
}

/**
 * Derive the arc-generation preset (and profile) from the selected base preset,
 * then point Story Arc's generation profile at the result.
 */
async function handleCreateArcPreset() {
    const basePresetName = $('#story-arc-base-preset').val();
    if (!basePresetName) {
        toastr.warning('Pick a base preset first.');
        return;
    }

    try {
        const result = await createArcPreset(
            basePresetName,
            getSettings().defaultConnectionProfile,
            (name) => Popup.show.confirm(`A preset named "${name}" already exists. Overwrite it?`, 'Story Arc'),
        );

        if (!result.presetCreated) {
            toastr.info(result.note);
            return;
        }

        if (result.profileId) {
            const settings = getSettings();
            settings.defaultConnectionProfile = result.profileId;
            extension_settings[MODULE_NAME] = settings;
            saveSettingsDebounced();
            populateProfileSelect();
        }

        populateBasePresetSelect();
        toastr.success(`Preset "${ARC_PRESET_NAME}" ready. ${result.note}`);
    } catch (err) {
        console.error('[Story Arc] Failed to create arc preset:', err);
        toastr.error(`Failed to create arc preset: ${err.message}`);
    }
}

/**
 * Wire up event handlers for the settings panel.
 * Uses namespaced jQuery events to allow clean re-attachment.
 */
export function setupSettingsPanelEvents() {
    // Clean up previous handlers
    $(document).off('change.storyArc', '#story-arc-enabled');
    $(document).off('change.storyArc mousedown.storyArc', '#story-arc-profile');
    $(document).off('mousedown.storyArc', '#story-arc-base-preset');
    $(document).off('click.storyArc', '#story-arc-create-preset-btn');
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

    // Generation profile dropdown: refresh options on open, persist on change
    $(document).on('mousedown.storyArc', '#story-arc-profile', function () {
        populateProfileSelect();
    });
    $(document).on('change.storyArc', '#story-arc-profile', function () {
        const settings = getSettings();
        settings.defaultConnectionProfile = $(this).val() || null;
        extension_settings[MODULE_NAME] = settings;
        saveSettingsDebounced();
        console.log(`[Story Arc] Generation profile set to: ${settings.defaultConnectionProfile || '(current API)'}`);
    });

    populateProfileSelect();

    // Base preset dropdown: refresh options on open (presets can be added anytime)
    $(document).on('mousedown.storyArc', '#story-arc-base-preset', function () {
        populateBasePresetSelect();
    });
    $(document).on('click.storyArc', '#story-arc-create-preset-btn', handleCreateArcPreset);

    populateBasePresetSelect();

    // Plan Next Arc button
    $(document).on('click.storyArc', '#story-arc-plan-btn', function () {
        showWizard();
    });

    // Manage Arcs button
    $(document).on('click.storyArc', '#story-arc-manage-btn', function () {
        showArcManager();
    });
}
