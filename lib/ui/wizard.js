/**
 * @file 3-step arc planning wizard
 * @module ui/wizard
 *
 * Step 1: Context Review — show harvested context summary
 * Step 2: Creative Direction — user describes what the arc should explore
 * Step 3: Review & Activate — show generated plan with spoiler toggles
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { chat } from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { harvestContext } from '../context/index.js';
import { generateArc, saveArc, updateArc, getArcById } from '../planning/index.js';
import { ensureChatState, getSettings } from '../core/settings.js';
import { TIER_TABLE } from '../core/constants.js';
import { updateProgress } from './progress.js';

/** Current wizard state (module-scoped, one wizard at a time) */
let wizardState = null;

/**
 * Launch the arc planning wizard as a popup dialog.
 * @param {string|null} [reviseArcId=null] - Arc to re-plan (revise mode): tier,
 *   direction, title and premise are pre-filled from it and the result is merged
 *   into it instead of saved as a new arc.
 */
export async function showWizard(reviseArcId = null) {
    ensureChatState();

    const reviseArc = reviseArcId ? getArcById(reviseArcId) : null;
    if (reviseArcId && !reviseArc) {
        toastr.error('Arc to re-plan not found');
        return;
    }

    wizardState = {
        step: 1,
        context: null,
        direction: reviseArc?.direction || '',
        tier: reviseArc?.tier || 'episode',
        reviseArc,
        title: reviseArc?.title || '',
        premise: reviseArc?.premise || '',
        generatedArc: null,
        cancelled: false,
        popup: null,
    };

    const html = buildWizardShell();
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    wizardState.popup = popup;

    // Wire events after popup renders
    const popupPromise = popup.show();

    // Small delay to let popup render into DOM
    await delay(50);

    wireWizardEvents();
    await loadStep1();

    await popupPromise;

    // Cleanup — leaving these bound double-toggles the arc manager's spoilers
    $(document).off('click.storyArcWizard');
    wizardState = null;
}

// ─── Step Rendering ─────────────────────────────────────────────────────────

/**
 * Build the static wizard shell with step indicators and content area.
 */
function buildWizardShell() {
    return `
    <div class="story-arc-wizard" id="story-arc-wizard">
        <div class="story-arc-wizard-steps">
            <div class="story-arc-wizard-step active" data-step="1">
                <div class="story-arc-wizard-step-dot">1</div>
                <span class="story-arc-wizard-step-label">Context</span>
            </div>
            <div class="story-arc-wizard-step-connector"></div>
            <div class="story-arc-wizard-step" data-step="2">
                <div class="story-arc-wizard-step-dot">2</div>
                <span class="story-arc-wizard-step-label">Direction</span>
            </div>
            <div class="story-arc-wizard-step-connector"></div>
            <div class="story-arc-wizard-step" data-step="3">
                <div class="story-arc-wizard-step-dot">3</div>
                <span class="story-arc-wizard-step-label">Review</span>
            </div>
        </div>
        <div class="story-arc-wizard-content" id="story-arc-wizard-content">
            <!-- Filled dynamically per step -->
        </div>
        <div class="story-arc-wizard-footer" id="story-arc-wizard-footer">
            <!-- Filled dynamically per step -->
        </div>
    </div>`;
}

/**
 * Show a loading state in the wizard content area.
 */
function showLoading(message) {
    $('#story-arc-wizard-content').html(`
        <div class="story-arc-wizard-loading">
            <i class="fa-solid fa-compass story-arc-spinner"></i>
            <div class="story-arc-wizard-loading-text">${escapeHtml(message)}</div>
        </div>
    `);
    $('#story-arc-wizard-footer').html('');
}

/**
 * Show an append-only step log in the wizard content area and return a handle
 * for driving it. Generation takes minutes, so every step stays on screen with
 * the time it took instead of a single line that overwrites itself.
 *
 * @returns {{ step: (message: string, previousOutcome?: 'done'|'failed') => void,
 *             detail: (text: string) => void }}
 */
function createStepLog() {
    // Profile names differ only in a preset segment; a wrong pick otherwise stays
    // invisible until generation has burned minutes.
    $('#story-arc-wizard-content').html(`
        <div class="story-arc-step-log-profile">
            <i class="fa-solid fa-plug"></i>
            <span>Profile: <strong>${escapeHtml(activeProfileName())}</strong></span>
        </div>
        <div class="story-arc-step-log" id="story-arc-step-log"></div>
    `);
    $('#story-arc-wizard-footer').html('');

    let $active = null;
    let activeStartedAt = 0;

    function closeActive(outcome) {
        if (!$active) return;
        const seconds = Math.round((Date.now() - activeStartedAt) / 1000);
        const icon = outcome === 'failed' ? 'fa-circle-xmark' : 'fa-circle-check';
        $active.removeClass('active').addClass(outcome);
        $active.find('.story-arc-step-log-icon').html(`<i class="fa-solid ${icon}"></i>`);
        $active.find('.story-arc-step-log-detail').text(`${seconds}s`);
        $active = null;
    }

    return {
        step(message, previousOutcome = 'done') {
            closeActive(previousOutcome);
            activeStartedAt = Date.now();
            $active = $(`
                <div class="story-arc-step-log-line active">
                    <span class="story-arc-step-log-icon"><i class="fa-solid fa-compass story-arc-spinner"></i></span>
                    <span class="story-arc-step-log-message"></span>
                    <span class="story-arc-step-log-detail"></span>
                </div>
            `);
            $active.find('.story-arc-step-log-message').text(message);
            $('#story-arc-step-log').append($active);
        },
        detail(text) {
            if ($active) $active.find('.story-arc-step-log-detail').text(text);
        },
    };
}

/**
 * Name of the Connection Manager profile arc generation will use.
 * @returns {string} Profile name, or a label for the no-profile fallback
 */
function activeProfileName() {
    const profileId = getSettings().defaultConnectionProfile;
    if (!profileId) return 'Current chat API (no profile)';

    const profiles = extension_settings.connectionManager?.profiles || [];
    const profile = profiles.find(p => p.id === profileId);
    return profile ? profile.name : `Unknown profile (${profileId})`;
}

/**
 * Update step indicator highlighting.
 */
function updateStepIndicators(currentStep) {
    $('.story-arc-wizard-step').each(function () {
        const step = parseInt($(this).data('step'));
        $(this).toggleClass('active', step === currentStep);
        $(this).toggleClass('completed', step < currentStep);
    });
}

// ─── Step 1: Context Review ─────────────────────────────────────────────────

async function loadStep1() {
    updateStepIndicators(1);
    showLoading('Harvesting story context...');

    try {
        const context = await harvestContext();
        wizardState.context = context;
        renderStep1(context);
    } catch (err) {
        console.error('[Story Arc] Context harvesting failed:', err);
        $('#story-arc-wizard-content').html(`
            <div class="story-arc-empty">
                <i class="fa-solid fa-triangle-exclamation"></i>
                Failed to harvest context: ${escapeHtml(err.message)}
            </div>
        `);
        $('#story-arc-wizard-footer').html(`
            <div class="story-arc-btn" id="story-arc-wizard-cancel">Cancel</div>
        `);
    }
}

function renderStep1(context) {
    const charName = context.character?.name || '(no character)';
    const personaName = context.persona?.name || '(no persona)';
    const lorebookConstants = context.lorebook?.constants?.length || 0;
    const lorebookSummaries = context.lorebook?.arcSummaries?.length || 0;
    const lorebookRecent = context.lorebook?.recent?.length || 0;
    const lorebookTotal = lorebookConstants + lorebookSummaries + lorebookRecent;
    const chatDepth = context.chatHistory?.length || 0;
    const tokenEst = context.estimatedTokens || 0;
    const existingArcs = context.existingArcs?.length || 0;

    const entriesHtml = buildContextEntries(context);

    $('#story-arc-wizard-content').html(`
        <div class="story-arc-section-header">
            <i class="fa-solid fa-magnifying-glass"></i> Harvested Context
        </div>
        <div class="story-arc-context-summary">
            <div class="story-arc-context-item">
                <i class="fa-solid fa-user"></i>
                <span class="story-arc-context-label">Character</span>
                <span class="story-arc-context-value">${escapeHtml(charName)}</span>
            </div>
            <div class="story-arc-context-item">
                <i class="fa-solid fa-masks-theater"></i>
                <span class="story-arc-context-label">Persona</span>
                <span class="story-arc-context-value">${escapeHtml(personaName)}</span>
            </div>
            <div class="story-arc-context-item">
                <i class="fa-solid fa-book"></i>
                <span class="story-arc-context-label">Lorebook</span>
                <span class="story-arc-context-value">${lorebookTotal} entries</span>
            </div>
            <div class="story-arc-context-item">
                <i class="fa-solid fa-comments"></i>
                <span class="story-arc-context-label">Chat depth</span>
                <span class="story-arc-context-value">${chatDepth} messages</span>
            </div>
            <div class="story-arc-context-item">
                <i class="fa-solid fa-coins"></i>
                <span class="story-arc-context-label">Est. tokens</span>
                <span class="story-arc-context-value">~${tokenEst.toLocaleString()}</span>
            </div>
            <div class="story-arc-context-item">
                <i class="fa-solid fa-compass"></i>
                <span class="story-arc-context-label">Active arcs</span>
                <span class="story-arc-context-value">${existingArcs}</span>
            </div>
        </div>
        ${entriesHtml}
    `);

    $('#story-arc-wizard-footer').html(`
        <div class="story-arc-btn" id="story-arc-wizard-cancel">Cancel</div>
        <div class="story-arc-btn story-arc-btn-primary" id="story-arc-wizard-next">
            Next <i class="fa-solid fa-arrow-right"></i>
        </div>
    `);
}

function buildContextEntries(context) {
    const sections = [];

    if (context.lorebook?.constants?.length) {
        sections.push(buildEntrySection('Lorebook (Constants)', context.lorebook.constants));
    }
    if (context.lorebook?.arcSummaries?.length) {
        sections.push(buildEntrySection('Lorebook (Arc Summaries)', context.lorebook.arcSummaries));
    }
    if (context.lorebook?.recent?.length) {
        sections.push(buildEntrySection('Lorebook (Recent)', context.lorebook.recent));
    }

    if (sections.length === 0) return '';

    return `
        <div class="story-arc-context-detail">
            <div class="story-arc-spoiler-toggle" id="story-arc-context-expand">
                <i class="fa-solid fa-chevron-right"></i>
                <span class="story-arc-spoiler-label">Inspect harvested entries</span>
            </div>
            <div class="story-arc-spoiler-content" id="story-arc-context-entries">
                ${sections.join('')}
            </div>
        </div>
    `;
}

function buildEntrySection(title, entries) {
    const items = entries.map(e => {
        const name = e.comment || '(unnamed)';
        const preview = (e.content || '').slice(0, 120);
        return `
            <div class="story-arc-context-entry">
                <div class="story-arc-context-entry-name">${escapeHtml(name)}</div>
                <div class="story-arc-context-entry-preview">${escapeHtml(preview)}...</div>
            </div>`;
    }).join('');

    return `
        <div class="story-arc-section-header" style="margin-top: 8px;">${escapeHtml(title)}</div>
        <div class="story-arc-context-entries">${items}</div>
    `;
}

// ─── Step 2: Creative Direction ─────────────────────────────────────────────

function renderStep2() {
    updateStepIndicators(2);

    const reviseFields = wizardState.reviseArc ? `
            <div class="story-arc-direction-hint">
                Re-planning <strong>${escapeHtml(wizardState.reviseArc.title)}</strong>: the rest of the arc is
                regenerated from where the story is now. Fulfilled beats and secrets are kept. Title and
                premise stay as written unless you edit them.
            </div>
            <label class="story-arc-tier-row" for="story-arc-title-input">
                <span class="story-arc-tier-label">Title</span>
                <input type="text" class="text_pole" id="story-arc-title-input" value="${escapeHtml(wizardState.title)}">
            </label>
            <label class="story-arc-tier-row" for="story-arc-premise-input">
                <span class="story-arc-tier-label">Premise</span>
                <textarea class="story-arc-textarea" id="story-arc-premise-input" rows="3">${escapeHtml(wizardState.premise)}</textarea>
            </label>` : '';

    $('#story-arc-wizard-content').html(`
        <div class="story-arc-section-header">
            <i class="fa-solid fa-pen-fancy"></i> ${wizardState.reviseArc ? 'Re-plan' : 'Creative Direction'}
        </div>
        <div class="story-arc-direction-section">
            ${reviseFields}
            <label class="story-arc-tier-row" for="story-arc-tier-select">
                <span class="story-arc-tier-label">Tier</span>
                <select id="story-arc-tier-select" class="text_pole story-arc-tier-select">
                    ${buildTierOptions(wizardState.tier)}
                </select>
                <span class="story-arc-direction-hint story-arc-tier-hint">
                    Episode: one playable unit, ~8–20 messages. Act and saga are being built —
                    for now they inject as a one-line premise.
                </span>
            </label>
            <div class="story-arc-direction-hint">
                Describe what you want this arc to explore. You can mention themes, character
                dynamics, conflicts, tonal shifts, or specific plot threads to pick up.
                Leave blank to let the AI decide based on story context alone.
            </div>
            <textarea
                class="story-arc-textarea"
                id="story-arc-direction-input"
                placeholder="e.g. I want to explore the tension between trust and betrayal in the alliance with the Northern Kingdom. Introduce a spy subplot that tests the main characters' loyalties."
                rows="6"
            >${escapeHtml(wizardState.direction)}</textarea>
        </div>
    `);

    $('#story-arc-wizard-footer').html(`
        <div class="story-arc-btn" id="story-arc-wizard-back">
            <i class="fa-solid fa-arrow-left"></i> Back
        </div>
        <div class="story-arc-btn story-arc-btn-primary" id="story-arc-wizard-generate">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Generate
        </div>
    `);
}

function buildTierOptions(selected) {
    return Object.entries(TIER_TABLE).map(([tier, { label, lengthBand }]) =>
        `<option value="${tier}" ${tier === selected ? 'selected' : ''}>${label} (~${lengthBand[0]}–${lengthBand[1]} messages)</option>`
    ).join('');
}

/**
 * Read the Direction step's inputs into wizardState. No-op when the step is
 * not on screen (Regenerate / Retry from step 3), so the values survive.
 */
function readDirectionStep() {
    const $direction = $('#story-arc-direction-input');
    if (!$direction.length) return;
    wizardState.direction = $direction.val() || '';
    wizardState.tier = $('#story-arc-tier-select').val() || 'episode';
    if (wizardState.reviseArc) {
        wizardState.title = $('#story-arc-title-input').val() || wizardState.reviseArc.title;
        wizardState.premise = $('#story-arc-premise-input').val() || wizardState.reviseArc.premise;
    }
}

// ─── Step 3: Review & Activate ──────────────────────────────────────────────

async function runGeneration() {
    updateStepIndicators(3);
    readDirectionStep();

    const log = createStepLog();
    let lastChunkPaint = 0;

    try {
        const result = await generateArc(wizardState.context, wizardState.direction, {
            onProgress: (phase, message) => {
                // A retry means the step that was running did not succeed.
                log.step(message, phase === 'retry' ? 'failed' : 'done');
                lastChunkPaint = 0;
            },
            onChunk: (chars) => {
                // Chunks arrive per token; repainting each one is pointless churn.
                const now = Date.now();
                if (now - lastChunkPaint < 250) return;
                lastChunkPaint = now;
                log.detail(`${formatCharCount(chars)} received`);
            },
            isCancelled: () => wizardState?.cancelled === true,
        }, { tier: wizardState.tier, reviseArc: reviseArcWithEdits() });

        if (wizardState?.cancelled) return;

        if (result.error) {
            $('#story-arc-wizard-content').html(`
                <div class="story-arc-empty">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Generation failed: ${escapeHtml(result.error)}
                </div>
            `);
            $('#story-arc-wizard-footer').html(`
                <div class="story-arc-btn" id="story-arc-wizard-back">
                    <i class="fa-solid fa-arrow-left"></i> Back
                </div>
                <div class="story-arc-btn story-arc-btn-primary" id="story-arc-wizard-regenerate">
                    <i class="fa-solid fa-rotate"></i> Retry
                </div>
            `);
            return;
        }

        wizardState.generatedArc = result.arc;
        renderStep3(result.arc);

    } catch (err) {
        console.error('[Story Arc] Generation error:', err);
        $('#story-arc-wizard-content').html(`
            <div class="story-arc-empty">
                <i class="fa-solid fa-triangle-exclamation"></i>
                Error: ${escapeHtml(err.message)}
            </div>
        `);
        $('#story-arc-wizard-footer').html(`
            <div class="story-arc-btn" id="story-arc-wizard-back">
                <i class="fa-solid fa-arrow-left"></i> Back
            </div>
        `);
    }
}

/**
 * The arc being re-planned with the dialog's title, premise and direction
 * applied — what mergeReplan keeps verbatim. Null when planning new.
 * @returns {object|null}
 */
function reviseArcWithEdits() {
    if (!wizardState.reviseArc) return null;
    return {
        ...wizardState.reviseArc,
        title: wizardState.title,
        premise: wizardState.premise,
        direction: wizardState.direction,
    };
}

function renderStep3(arc) {
    const themeTags = (arc.themes || []).map(t => `<span class="story-arc-tag">${escapeHtml(t)}</span>`).join('');

    const beatsHtml = (arc.beats || []).map((b, i) => {
        const phaseTag = b.phase ? `<span class="story-arc-tag">${escapeHtml(b.phase)}</span>` : '';
        const optTag = b.optional ? ' <span class="story-arc-beat-optional-label">(optional)</span>' : '';
        return `<li>${phaseTag} ${escapeHtml(b.intention)}${optTag}</li>`;
    }).join('');

    const secretsHtml = (arc.secrets || []).map(s =>
        `<li>${escapeHtml(s.content)} <span class="story-arc-muted">(reveal: ${s.revealPhase})</span></li>`
    ).join('');

    const foreshadowHtml = (arc.foreshadowing || []).map(f =>
        `<li><strong>${escapeHtml(f.clue)}</strong> &rarr; ${escapeHtml(f.target)}</li>`
    ).join('');

    const triggersHtml = (arc.triggers || []).map(t =>
        `<li>IF ${escapeHtml(t.condition)} &rarr; ${escapeHtml(t.action)}</li>`
    ).join('');

    $('#story-arc-wizard-content').html(`
        <div class="story-arc-review-section">
            <!-- Always visible -->
            <div class="story-arc-review-field">
                <div class="story-arc-review-field-label">Title</div>
                <div class="story-arc-review-field-value">${escapeHtml(arc.title)}</div>
            </div>
            <div class="story-arc-review-field">
                <div class="story-arc-review-field-label">Themes</div>
                <div class="story-arc-review-field-value story-arc-review-tags">${themeTags || '<span class="story-arc-muted">None</span>'}</div>
            </div>
            <div class="story-arc-review-field">
                <div class="story-arc-review-field-label">Tone</div>
                <div class="story-arc-review-field-value">${escapeHtml(arc.tone) || '<span class="story-arc-muted">Not specified</span>'}</div>
            </div>
            <div class="story-arc-review-field">
                <div class="story-arc-review-field-label">Tier</div>
                <div class="story-arc-review-field-value">${escapeHtml(TIER_TABLE[arc.tier]?.label || arc.tier)}</div>
            </div>
            <div class="story-arc-review-field">
                <div class="story-arc-review-field-label">Estimated Length</div>
                <div class="story-arc-review-field-value">~${arc.estimatedLength || '?'} messages</div>
            </div>

            <!-- Behind spoiler toggles -->
            ${buildSpoilerSection('Premise', `<p>${escapeHtml(arc.premise)}</p>`)}
            ${secretsHtml ? buildSpoilerSection('Secrets', `<ul>${secretsHtml}</ul>`) : ''}
            ${beatsHtml ? buildSpoilerSection('Beats', `<ol>${beatsHtml}</ol>`) : ''}
            ${foreshadowHtml ? buildSpoilerSection('Foreshadowing', `<ul>${foreshadowHtml}</ul>`) : ''}
            ${triggersHtml ? buildSpoilerSection('Triggers', `<ul>${triggersHtml}</ul>`) : ''}
            ${arc.escalation ? buildSpoilerSection('Escalation', `<p>${escapeHtml(arc.escalation)}</p>`) : ''}
        </div>
    `);

    $('#story-arc-wizard-footer').html(`
        <div class="story-arc-btn" id="story-arc-wizard-back">
            <i class="fa-solid fa-arrow-left"></i> Back
        </div>
        <div class="story-arc-btn" id="story-arc-wizard-regenerate">
            <i class="fa-solid fa-rotate"></i> Regenerate
        </div>
        <div class="story-arc-btn story-arc-btn-primary" id="story-arc-wizard-activate">
            <i class="fa-solid fa-check"></i> ${wizardState.reviseArc ? 'Apply re-plan' : 'Activate'}
        </div>
    `);
}

function buildSpoilerSection(title, contentHtml) {
    const id = `story-arc-spoiler-${title.toLowerCase().replace(/\s+/g, '-')}`;
    return `
        <div class="story-arc-spoiler-group">
            <div class="story-arc-spoiler-toggle" data-spoiler-target="${id}">
                <i class="fa-solid fa-chevron-right"></i>
                <span class="story-arc-spoiler-label">${escapeHtml(title)}</span>
                <i class="fa-solid fa-eye-slash story-arc-spoiler-icon"></i>
            </div>
            <div class="story-arc-spoiler-content" id="${id}">
                <div class="story-arc-spoiler-warning">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Spoiler — viewing this may affect your experience as a player.
                </div>
                ${contentHtml}
            </div>
        </div>
    `;
}

// ─── Event Wiring ───────────────────────────────────────────────────────────

function wireWizardEvents() {
    const $doc = $(document);

    // Use delegation scoped to the wizard
    $doc.off('click.storyArcWizard');

    // Cancel
    $doc.on('click.storyArcWizard', '#story-arc-wizard-cancel', () => {
        if (wizardState) {
            wizardState.cancelled = true;
            wizardState.popup?.completeCancelled?.();
            // Try multiple close methods for compatibility
            if (typeof wizardState.popup?.complete === 'function') {
                wizardState.popup.complete(0);
            }
        }
    });

    // Step 1 → Step 2
    $doc.on('click.storyArcWizard', '#story-arc-wizard-next', () => {
        wizardState.step = 2;
        renderStep2();
    });

    // Step 2 → Step 1
    $doc.on('click.storyArcWizard', '#story-arc-wizard-back', () => {
        if (wizardState.step === 2) {
            readDirectionStep();
            wizardState.step = 1;
            renderStep1(wizardState.context);
        } else if (wizardState.step === 3) {
            wizardState.step = 2;
            renderStep2();
        }
    });

    // Step 2 → generate → Step 3
    $doc.on('click.storyArcWizard', '#story-arc-wizard-generate', () => {
        wizardState.step = 3;
        runGeneration();
    });

    // Regenerate
    $doc.on('click.storyArcWizard', '#story-arc-wizard-regenerate', () => {
        wizardState.generatedArc = null;
        runGeneration();
    });

    // Activate
    $doc.on('click.storyArcWizard', '#story-arc-wizard-activate', async () => {
        if (!wizardState?.generatedArc) return;

        try {
            if (wizardState.reviseArc) {
                await updateArc(wizardState.reviseArc.id, wizardState.generatedArc);
                toastr.success(`Arc "${wizardState.generatedArc.title}" re-planned`);
            } else {
                await saveArc(wizardState.generatedArc);
                toastr.success(`Arc "${wizardState.generatedArc.title}" activated!`);
            }
            updateProgress();

            if (typeof wizardState.popup?.complete === 'function') {
                wizardState.popup.complete(1);
            }
        } catch (err) {
            console.error('[Story Arc] Failed to save arc:', err);
            toastr.error(`Failed to save arc: ${err.message}`);
        }
    });

    // Spoiler toggles (global, works for both wizard and context expand)
    $doc.on('click.storyArcWizard', '.story-arc-spoiler-toggle', function () {
        const $toggle = $(this);
        const targetId = $toggle.data('spoiler-target');

        if (targetId) {
            const $content = $(`#${targetId}`);
            $toggle.toggleClass('open');
            $content.toggleClass('open');
        } else {
            // Direct sibling toggle (context entries expand)
            const $next = $toggle.next('.story-arc-spoiler-content');
            $toggle.toggleClass('open');
            $next.toggleClass('open');
        }
    });
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatCharCount(chars) {
    return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k chars` : `${chars} chars`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
