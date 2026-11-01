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
import { MODULE_NAME } from '../core/constants.js';
import {
    getSettings,
    getKnowledgeTrackerSettings,
    isKnowledgeTrackerEnabled,
    getKnowledgeLedger,
} from '../core/settings.js';
import { ARC_PRESET_NAME, createArcPreset } from '../planning/arc-preset.js';
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
    const knowledgeTracker = getKnowledgeTrackerSettings();
    const knowledgeCheckedAttr = knowledgeTracker.enabled ? 'checked' : '';

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

                <!-- Create the arc-generation preset -->
                <div class="story-arc-panel-row">
                    <div id="story-arc-create-preset-btn" class="menu_button story-arc-btn" title="Create a barebones '${ARC_PRESET_NAME}' preset tuned for arc planning, plus a connection profile cloned from the selected generation profile">
                        <i class="fa-solid fa-sliders"></i>
                        <span>Create arc preset</span>
                    </div>
                </div>

                <!-- Knowledge tracker (ADR-0007): switch, update interval, status line -->
                <div class="story-arc-panel-row">
                    <label class="checkbox_label" title="Track which character knows which fact, so the AI does not let a character know what they never learned. Each update is one extra LLM call through the generation profile.">
                        <input type="checkbox" id="story-arc-knowledge-enabled" ${knowledgeCheckedAttr} />
                        <span>Track who knows what</span>
                    </label>
                </div>
                <div class="story-arc-panel-row">
                    <label class="checkbox_label" for="story-arc-knowledge-interval" title="Update the knowledge ledger after every N AI replies. 1 is after every reply.">
                        <span>Update every N replies</span>
                    </label>
                    <input type="number" id="story-arc-knowledge-interval" class="text_pole" min="1" step="1" value="${knowledgeTracker.updateInterval}" />
                </div>
                <div class="story-arc-panel-row">
                    <small id="story-arc-knowledge-status"></small>
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
 * Every binding here uses the `storyArcSettings` namespace, which nothing else
 * binds under, so one namespace-wide `off` removes them all and a second call
 * never stacks handlers (a stacked stall button would open two wizards).
 */
export function setupSettingsPanelEvents() {
    $(document).off('.storyArcSettings');

    // Enable toggle
    $(document).on('change.storyArcSettings', '#story-arc-enabled', function () {
        const settings = getSettings();
        settings.enabled = $(this).prop('checked');
        extension_settings[MODULE_NAME] = settings;
        saveSettingsDebounced();
        const enabledState = settings.enabled ? 'enabled' : 'disabled';
        console.log(`[Story Arc] Extension ${enabledState}`);
    });

    // Generation profile dropdown: refresh options on open, persist on change
    $(document).on('mousedown.storyArcSettings', '#story-arc-profile', function () {
        populateProfileSelect();
    });
    $(document).on('change.storyArcSettings', '#story-arc-profile', function () {
        const settings = getSettings();
        settings.defaultConnectionProfile = $(this).val() || null;
        extension_settings[MODULE_NAME] = settings;
        saveSettingsDebounced();
        const profileLabel = settings.defaultConnectionProfile || '(current API)';
        console.log(`[Story Arc] Generation profile set to: ${profileLabel}`);
    });

    populateProfileSelect();

    // Knowledge tracker switch and update interval (ADR-0007). The settings
    // group is the stored object, so changing it and saving persists it.
    $(document).on('change.storyArcSettings', '#story-arc-knowledge-enabled', function () {
        const knowledgeTracker = getKnowledgeTrackerSettings();
        knowledgeTracker.enabled = $(this).prop('checked');
        saveSettingsDebounced();
        updateKnowledgeStatus();
        const trackerState = knowledgeTracker.enabled ? 'on' : 'off';
        console.log(`[Story Arc] Knowledge tracker ${trackerState}`);
    });
    $(document).on('change.storyArcSettings', '#story-arc-knowledge-interval', function () {
        const knowledgeTracker = getKnowledgeTrackerSettings();
        const enteredInterval = Number($(this).val());
        // An empty field, a fraction or anything below 1 is not an interval:
        // keep the stored one and show it again.
        if (!Number.isInteger(enteredInterval) || enteredInterval < 1) {
            $(this).val(knowledgeTracker.updateInterval);
            return;
        }
        knowledgeTracker.updateInterval = enteredInterval;
        saveSettingsDebounced();
        console.log(`[Story Arc] Knowledge ledger updates every ${enteredInterval} replies`);
    });
    updateKnowledgeStatus();

    $(document).on('click.storyArcSettings', '#story-arc-create-preset-btn', handleCreateArcPreset);

    // Plan Next Arc button
    $(document).on('click.storyArcSettings', '#story-arc-plan-btn', function () {
        showWizard();
    });

    // Manage Arcs button
    $(document).on('click.storyArcSettings', '#story-arc-manage-btn', function () {
        showArcManager();
    });

    // Stall nudge in the progress widget: re-plan that arc
    $(document).on('click.storyArcSettings', '.story-arc-stall-btn', function () {
        const arcId = $(this).data('arc-id');
        showWizard(arcId);
    });
}

/**
 * Show in the status line at which message the current chat's knowledge
 * ledger was last updated, or that the tracker is off or the ledger empty.
 * Called on setup, when the switch changes and on CHAT_CHANGED; whoever
 * updates the ledger calls it too. No-op while the panel is absent.
 */
export function updateKnowledgeStatus() {
    const $status = $('#story-arc-knowledge-status');
    if (!$status.length) return;

    if (!isKnowledgeTrackerEnabled()) {
        $status.text('Knowledge tracker is off.');
        return;
    }
    const lastUpdatedAt = getKnowledgeLedger().lastUpdatedAt;
    if (lastUpdatedAt === null) {
        $status.text('Ledger is empty: not updated yet.');
        return;
    }
    $status.text(`Ledger last updated at message #${lastUpdatedAt}.`);
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
    const sortedProfiles = [...profiles].sort((firstProfile, secondProfile) => firstProfile.name.localeCompare(secondProfile.name));
    for (const profile of sortedProfiles) {
        const $option = $('<option></option>').val(profile.id).text(profile.name);
        $select.append($option);
    }
    const selectedProfileId = settings.defaultConnectionProfile || '';
    $select.val(selectedProfileId);
}

/**
 * Create the barebones arc-generation preset (and a profile pinning it, cloned
 * from the selected generation profile), then point Story Arc at the result.
 */
async function handleCreateArcPreset() {
    try {
        const baseProfileId = getSettings().defaultConnectionProfile;
        const result = await createArcPreset(
            baseProfileId,
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

        toastr.success(`Preset "${ARC_PRESET_NAME}" ready. ${result.note}`);
    } catch (err) {
        console.error('[Story Arc] Failed to create arc preset:', err);
        toastr.error(`Failed to create arc preset: ${err.message}`);
    }
}
