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
} from '../core/settings.js';
import { ARC_PRESET_NAME, createArcPreset } from '../planning/arc-preset.js';
import { showWizard } from './wizard.js';
import { showArcManager } from './arc-manager.js';
import { showKnowledgePopup } from './knowledge-popup.js';
import { updateKnowledgeStatus } from './knowledge-status.js';
import { updateProgress } from './progress.js';
import { ignoreStall } from '../injection/clock.js';

/**
 * Render the settings panel HTML: the actions first (Plan a new arc,
 * Manage, Knowledge), the active arcs' progress, then the settings in three
 * groups: arcs, knowledge tracker, connection. What only works with the
 * knowledge tracker is disabled by applyTrackerDisabled at setup.
 * Placed inside #extensions_settings2 by index.js.
 * @returns {string} HTML string
 */
export function renderSettingsPanel() {
    const settings = getSettings();
    const checkedAttr = settings.enabled ? ' checked' : '';
    const knowledgeTracker = getKnowledgeTrackerSettings();
    const knowledgeCheckedAttr = knowledgeTracker.enabled ? ' checked' : '';
    const detailsCheckedAttr = knowledgeTracker.characterDetails ? ' checked' : '';

    return `
    <div id="story-arc-settings" class="story-arc-drawer">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-compass"></i> Story Arc</b>
                <div class="inline-drawer-icon fa-solid interactable down fa-circle-chevron-down" tabindex="0" role="button"></div>
            </div>
            <div class="inline-drawer-content" style="display: none;">
                <div class="story-arc-drawer-actions">
                    <button type="button" id="story-arc-plan-btn" class="menu_button story-arc-drawer-primary" title="Plan the next arc from where the story is now">
                        <i class="fa-solid fa-compass" aria-hidden="true"></i> Plan a new arc
                    </button>
                    <button type="button" id="story-arc-manage-btn" class="menu_button" title="Steer the arcs: focus, beats, re-plan, end">
                        <i class="fa-solid fa-list" aria-hidden="true"></i> Manage
                    </button>
                    <button type="button" id="story-arc-knowledge-btn" class="menu_button" title="Who knows what">
                        <i class="fa-solid fa-user-secret" aria-hidden="true"></i> Knowledge
                    </button>
                </div>
                <small id="story-arc-knowledge-btn-hint" class="story-arc-drawer-help">Knowledge needs the tracker: turn on "Track who knows what" below.</small>

                <!-- Progress display (filled dynamically) -->
                <div id="story-arc-progress-container"></div>

                <section class="story-arc-drawer-group" aria-labelledby="story-arc-drawer-arcs-heading">
                    <h4 id="story-arc-drawer-arcs-heading">Arcs</h4>
                    <label class="checkbox_label" title="Guide the AI with the active arcs and track their beats">
                        <input type="checkbox" id="story-arc-enabled"${checkedAttr} />
                        <span>Enable Story Arc</span>
                    </label>
                </section>

                <!-- Knowledge tracker (ADR-0007): switch, character details switch, update interval, status line -->
                <section class="story-arc-drawer-group" aria-labelledby="story-arc-drawer-knowledge-heading">
                    <h4 id="story-arc-drawer-knowledge-heading">Knowledge tracker</h4>
                    <label class="checkbox_label" title="Track which character knows which fact, so the AI does not let a character know what they never learned. Each update is one extra LLM call through the generation profile.">
                        <input type="checkbox" id="story-arc-knowledge-enabled"${knowledgeCheckedAttr} />
                        <span>Track who knows what</span>
                    </label>
                    <label class="checkbox_label" title="Also track each character's gender, age, role, relation and alive or dead, as the story states them, and show them to the AI. Works only while the knowledge tracker is on.">
                        <input type="checkbox" id="story-arc-knowledge-details"${detailsCheckedAttr} />
                        <span>Character details</span>
                    </label>
                    <div class="story-arc-drawer-field">
                        <label for="story-arc-knowledge-interval" title="Update the knowledge ledger after every N AI replies. 1 is after every reply.">Update every N replies</label>
                        <input type="number" id="story-arc-knowledge-interval" class="text_pole" min="1" step="1" value="${knowledgeTracker.updateInterval}" />
                    </div>
                    <small id="story-arc-knowledge-status" class="story-arc-drawer-status"></small>
                </section>

                <section class="story-arc-drawer-group" aria-labelledby="story-arc-drawer-connection-heading">
                    <h4 id="story-arc-drawer-connection-heading">Connection</h4>
                    <div class="story-arc-drawer-field">
                        <label for="story-arc-profile">Generation profile</label>
                        <select id="story-arc-profile" class="text_pole" aria-describedby="story-arc-profile-help"></select>
                    </div>
                    <small class="story-arc-drawer-help" id="story-arc-profile-help">The Connection Manager profile for arc planning and the knowledge tracker. Current API uses whatever the chat uses.</small>
                    <div>
                        <button type="button" id="story-arc-create-preset-btn" class="menu_button" title="Create a barebones '${ARC_PRESET_NAME}' preset tuned for arc planning, plus a connection profile cloned from the selected generation profile">
                            <i class="fa-solid fa-sliders" aria-hidden="true"></i> Create arc preset
                        </button>
                    </div>
                </section>
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

    // Knowledge tracker switch, character details switch and update interval (ADR-0007). The settings
    // group is the stored object, so changing it and saving persists it.
    $(document).on('change.storyArcSettings', '#story-arc-knowledge-enabled', function () {
        const knowledgeTracker = getKnowledgeTrackerSettings();
        knowledgeTracker.enabled = $(this).prop('checked');
        saveSettingsDebounced();
        applyTrackerDisabled(knowledgeTracker.enabled);
        updateKnowledgeStatus();
        const trackerState = knowledgeTracker.enabled ? 'on' : 'off';
        console.log(`[Story Arc] Knowledge tracker ${trackerState}`);
    });
    $(document).on('change.storyArcSettings', '#story-arc-knowledge-details', function () {
        const knowledgeTracker = getKnowledgeTrackerSettings();
        knowledgeTracker.characterDetails = $(this).prop('checked');
        saveSettingsDebounced();
        const detailsState = knowledgeTracker.characterDetails ? 'on' : 'off';
        console.log(`[Story Arc] Character details ${detailsState}`);
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
    applyTrackerDisabled(getKnowledgeTrackerSettings().enabled);
    updateKnowledgeStatus();
    // The status line's button while names are to check.
    $(document).on('click.storyArcSettings', '.story-arc-knowledge-names-btn', function () {
        showKnowledgePopup();
    });

    $(document).on('click.storyArcSettings', '#story-arc-create-preset-btn', handleCreateArcPreset);

    // The actions row: Plan, Manage, Knowledge
    $(document).on('click.storyArcSettings', '#story-arc-plan-btn', function () {
        showWizard();
    });
    $(document).on('click.storyArcSettings', '#story-arc-manage-btn', function () {
        showArcManager();
    });
    $(document).on('click.storyArcSettings', '#story-arc-knowledge-btn', function () {
        showKnowledgePopup();
    });

    // Ignore a stall warning in the drawer's progress rows
    $(document).on('click.storyArcSettings', '#story-arc-settings .story-arc-ignore-stall-btn', async function () {
        await ignoreStall($(this).data('arc-id'));
        updateProgress();
    });

    // Stall nudge in the drawer's progress widget: re-plan that arc. Only the
    // drawer's: the wand popup has its own handler, which closes the popup first.
    $(document).on('click.storyArcSettings', '#story-arc-settings .story-arc-stall-btn', function () {
        const arcId = $(this).data('arc-id');
        showWizard(arcId);
    });
}

/**
 * What only works with the knowledge tracker follows its switch: character
 * details, the interval and the Knowledge button are disabled while it is
 * off, and the button's hint shows as text (a disabled button shows no
 * tooltip). Used at setup and when the switch changes.
 * @param {boolean} trackerEnabled
 */
function applyTrackerDisabled(trackerEnabled) {
    $('#story-arc-knowledge-details').prop('disabled', !trackerEnabled);
    $('#story-arc-knowledge-interval').prop('disabled', !trackerEnabled);
    $('#story-arc-knowledge-btn').prop('disabled', !trackerEnabled);
    $('#story-arc-knowledge-btn-hint').prop('hidden', trackerEnabled);
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
