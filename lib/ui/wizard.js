/**
 * @file Two-step arc planning wizard
 * @module ui/wizard
 *
 * Direction: what the arc should explore (tier, genre, direction; on a
 * re-plan also title, premise and rulings), under a summary strip of the
 * harvested story context. Review: the generation log while the plan is
 * made, then the plan, its plan text behind one Reveal switch.
 *
 * The build* functions return markup only and are exported, so the tests and
 * the screenshot script can render each state without SillyTavern.
 */

import { chat } from '/script.js';
import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { extension_settings } from '/scripts/extensions.js';
import { harvestContext } from '../context/harvester.js';
import { generateArc } from '../planning/generator.js';
import { saveArc, updateArc, getArcById, getArcs, latestGenre } from '../planning/storage.js';
import { applyReplan, replanTiers } from '../planning/replan.js';
import { arcTier, ensureChatState, getSettings } from '../core/settings.js';
import { TIER_TABLE } from '../core/constants.js';
import { updateProgress } from './progress.js';

/** Current wizard state (module-scoped, one wizard at a time) */
let wizardState = null;

/**
 * Launch the arc planning wizard as a popup dialog.
 * @param {string|null} [reviseArcId=null] - Arc to re-plan (revise mode): tier,
 *   direction, genre, title and premise are pre-filled from it and the result is merged
 *   into it instead of saved as a new arc.
 */
export async function showWizard(reviseArcId = null) {
    ensureChatState();

    const reviseArc = reviseArcId ? getArcById(reviseArcId) : null;
    if (reviseArcId && !reviseArc) {
        toastr.error('Arc to re-plan not found');
        return;
    }

    const state = {
        step: 'direction',
        context: null,
        contextError: null,
        direction: reviseArc?.direction || '',
        // A new arc starts as an episode; the Direction step can change it.
        tier: reviseArc ? arcTier(reviseArc) : 'episode',
        // A new arc starts from the newest arc's genre (ADR-0004).
        genre: reviseArc ? (reviseArc.genre || '') : latestGenre(getArcs()),
        reviseArc,
        title: reviseArc?.title || '',
        premise: reviseArc?.premise || '',
        // Rulings removed on the Direction step: held here, off the stored arc until apply.
        removedRulingIds: [],
        generatedArc: null,
        cancelled: false,
        popup: null,
    };
    wizardState = state;

    const popup = new Popup(buildWizardShell(reviseArc), POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
    state.popup = popup;

    const popupPromise = popup.show();

    // Small delay to let popup render into DOM
    await delay(50);

    wireWizardEvents();
    showDirectionStep();
    await loadContext();

    await popupPromise;

    // However the popup closed (Cancel, Escape, a click outside), a generation
    // still running for this wizard is cancelled: its result is never shown or saved.
    state.cancelled = true;

    // Cleanup — leaving these bound fires them from the next popup
    $(document).off('click.storyArcWizard change.storyArcWizard');
    if (wizardState === state) wizardState = null;
}

/**
 * The static wizard frame: heading, the two-step indicator, content and
 * controls. The current step carries aria-current, so it is not told by
 * styling alone.
 * @param {object|null} reviseArc - The arc being re-planned, null for a new arc
 * @returns {string} HTML
 */
export function buildWizardShell(reviseArc) {
    const heading = reviseArc
        ? `Re-plan <span class="story-arc-wizard-heading-arc">${escapeHtml(reviseArc.title)}</span>`
        : 'Plan the next arc';
    return `
    <div class="story-arc-wizard" id="story-arc-wizard" role="region" aria-labelledby="story-arc-wizard-heading">
        <header class="story-arc-wizard-head">
            <h2 id="story-arc-wizard-heading">${heading}</h2>
            <ol class="story-arc-wizard-steps" aria-label="Steps">
                <li id="story-arc-wizard-step-direction" aria-current="step"><span class="story-arc-wizard-step-number">1</span>Direction</li>
                <li id="story-arc-wizard-step-review"><span class="story-arc-wizard-step-number">2</span>Review</li>
            </ol>
        </header>
        <div class="story-arc-wizard-content" id="story-arc-wizard-content"></div>
        <div class="story-arc-wizard-controls" id="story-arc-wizard-footer"></div>
    </div>`;
}

/**
 * Move the wizard to a step: the only place that sets wizardState.step and the
 * step indicator, so the two cannot disagree. Renderers do not touch either.
 * @param {'direction'|'review'} currentStep
 */
function setWizardStep(currentStep) {
    wizardState.step = currentStep;
    $('#story-arc-wizard-step-direction').attr('aria-current', currentStep === 'direction' ? 'step' : null);
    $('#story-arc-wizard-step-review').attr('aria-current', currentStep === 'review' ? 'step' : null);
}

// ─── Step 1: Direction ──────────────────────────────────────────────────────

/** Show the Direction step with the fields as held in wizardState. */
function showDirectionStep() {
    setWizardStep('direction');
    $('#story-arc-wizard-content').html(buildDirectionStep(wizardState));
    $('#story-arc-wizard-footer').html(buildDirectionControls(Boolean(wizardState.context)));
}

/**
 * Harvest the story context into wizardState and show it in the summary
 * strip. Only the strip and the Generate button change, so a direction typed
 * meanwhile stays. Run on open and by Retry after a failed harvest.
 */
async function loadContext() {
    const state = wizardState;
    state.context = null;
    state.contextError = null;
    $('#story-arc-wizard-context').html(buildContextStrip(state));
    $('#story-arc-wizard-generate').prop('disabled', true);

    try {
        state.context = await harvestContext();
    } catch (err) {
        console.error('[Story Arc] Context harvesting failed:', err);
        state.contextError = err.message;
    }
    // The wizard was closed or replaced while the harvest ran.
    if (state !== wizardState) return;

    $('#story-arc-wizard-context').html(buildContextStrip(state));
    $('#story-arc-wizard-generate').prop('disabled', !state.context);
}

/**
 * The Direction step: the context strip, the re-plan fields when re-planning,
 * then tier, genre and direction.
 * @param {object} state - Wizard state (context, contextError, tier, genre, direction, reviseArc, title, premise, removedRulingIds)
 * @returns {string} HTML
 */
export function buildDirectionStep(state) {
    const reviseFields = state.reviseArc ? `
            <p class="story-arc-wizard-help story-arc-wizard-lead">
                The rest of this arc is planned again from where the story is now. Fulfilled beats and
                secrets are kept. The title stays as written unless you edit it; a new premise is proposed
                for you to review next to this one before anything is stored.
            </p>
            <div class="story-arc-wizard-field">
                <label class="story-arc-wizard-label" for="story-arc-title-input">Title</label>
                <input type="text" class="text_pole" id="story-arc-title-input" value="${escapeHtml(state.title)}">
            </div>
            <div class="story-arc-wizard-field">
                <label class="story-arc-wizard-label" for="story-arc-premise-input">Premise</label>
                <textarea class="text_pole" id="story-arc-premise-input" rows="3">${escapeHtml(state.premise)}</textarea>
            </div>
            ${buildRulingsList(state)}` : '';

    return `
        <section class="story-arc-wizard-context" id="story-arc-wizard-context" aria-label="Story context">${buildContextStrip(state)}</section>
        <div class="story-arc-wizard-form">
            ${reviseFields}
            <div class="story-arc-wizard-field-row">
                <div class="story-arc-wizard-field story-arc-wizard-field-tier">
                    <label class="story-arc-wizard-label" for="story-arc-tier-select">Tier</label>
                    <select id="story-arc-tier-select" class="text_pole" aria-describedby="story-arc-tier-help">
                        ${buildTierOptions(state.tier, state.reviseArc)}
                    </select>
                    <p class="story-arc-wizard-help" id="story-arc-tier-help">
                        An episode is one playable unit with scene beats. An act or a saga plans milestones
                        that stand as pressure and complete when the story shows them.
                    </p>
                </div>
                <div class="story-arc-wizard-field story-arc-wizard-field-genre">
                    <label class="story-arc-wizard-label" for="story-arc-genre-input">Genre</label>
                    <textarea class="text_pole" id="story-arc-genre-input" rows="2" aria-describedby="story-arc-genre-help"
                        placeholder="e.g. High fantasy adventure: guild jobs, monsters and ruins, banter around the campfire. Dark moments, but never grimdark."
                    >${escapeHtml(state.genre)}</textarea>
                    <p class="story-arc-wizard-help" id="story-arc-genre-help">
                        Binding for planning and narration: the arc's pressures, secrets and tone read as this genre. Leave blank for none.
                    </p>
                </div>
            </div>
            <div class="story-arc-wizard-field">
                <label class="story-arc-wizard-label" for="story-arc-direction-input">Direction</label>
                <textarea class="text_pole" id="story-arc-direction-input" rows="6" aria-describedby="story-arc-direction-help"
                    placeholder="e.g. The party takes a job from the guild board: find out what haunts the old mill. Let it look routine at first, and let one clue point at something much bigger."
                >${escapeHtml(state.direction)}</textarea>
                <p class="story-arc-wizard-help" id="story-arc-direction-help">
                    What this arc should explore: themes, character dynamics, conflicts, a change of tone, plot
                    threads to pick up. Leave blank to let the AI decide from the story alone.
                </p>
            </div>
        </div>`;
}

/**
 * The summary strip of the harvested context: reading, failed with Retry,
 * or one line of counts with the lorebook entries behind a disclosure.
 * @param {{ context: object|null, contextError: string|null }} state
 * @returns {string} HTML
 */
export function buildContextStrip({ context, contextError }) {
    if (contextError) {
        return `
            <div class="story-arc-wizard-context-line is-error" role="alert">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <span>Could not read the story context: ${escapeHtml(contextError)}</span>
                <button type="button" class="menu_button" id="story-arc-wizard-retry-context">
                    <i class="fa-solid fa-rotate" aria-hidden="true"></i> Retry
                </button>
            </div>`;
    }
    if (!context) {
        return `
            <div class="story-arc-wizard-context-line is-loading" role="status">
                <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                <span>Reading the story: lorebook, character card, persona and recent chat…</span>
            </div>`;
    }

    const characterName = context.character?.name;
    const personaName = context.persona?.name;
    const lorebookConstants = context.lorebook?.constants?.length || 0;
    const lorebookSummaries = context.lorebook?.arcSummaries?.length || 0;
    const lorebookRecent = context.lorebook?.recent?.length || 0;
    const lorebookTotal = lorebookConstants + lorebookSummaries + lorebookRecent;
    const chatDepth = context.chatHistory?.length || 0;
    const tokenEstimate = context.estimatedTokens || 0;
    const activeArcCount = context.existingArcs?.length || 0;

    const storyOf = [
        characterName ? `<b>${escapeHtml(characterName)}</b>` : 'no character card',
        personaName ? `<b>${escapeHtml(personaName)}</b>` : 'no persona',
    ].join(' and ');

    return `
            <div class="story-arc-wizard-context-line">
                <i class="fa-solid fa-book-open" aria-hidden="true"></i>
                <ul class="story-arc-wizard-context-facts">
                    <li>Planning from ${storyOf}</li>
                    <li>${countOf(lorebookTotal, 'lorebook entry', 'lorebook entries')}</li>
                    <li>${countOf(chatDepth, 'recent message', 'recent messages')}</li>
                    <li>~${tokenEstimate.toLocaleString()} tokens</li>
                    <li>${countOf(activeArcCount, 'active arc', 'active arcs')}</li>
                </ul>
            </div>
            ${buildContextEntries(context)}`;
}

/**
 * "1 clue", "3 clues": a count with its noun.
 * @returns {string}
 */
function countOf(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The harvested lorebook entries behind a closed disclosure, by group.
 * @returns {string} HTML, empty when the lorebook gave nothing
 */
function buildContextEntries(context) {
    const groups = [
        ['Constants', context.lorebook?.constants || []],
        ['Arc summaries', context.lorebook?.arcSummaries || []],
        ['Recent', context.lorebook?.recent || []],
    ].filter(([, entries]) => entries.length > 0);
    if (groups.length === 0) return '';

    const groupsHtml = groups.map(([title, entries]) => {
        const items = entries.map(entry => {
            const name = entry.comment || '(unnamed)';
            const preview = (entry.content || '').slice(0, 160);
            return `<li><b>${escapeHtml(name)}</b> <span class="story-arc-wizard-muted">${escapeHtml(preview)}</span></li>`;
        }).join('');
        return `
                <h4>${escapeHtml(title)} <span class="story-arc-wizard-muted">${entries.length}</span></h4>
                <ul class="story-arc-wizard-entry-list">${items}</ul>`;
    }).join('');

    return `
            <details class="story-arc-wizard-entries">
                <summary><i class="fa-solid fa-chevron-right" aria-hidden="true"></i> Inspect the harvested lorebook entries</summary>
                <div class="story-arc-wizard-entries-body">${groupsHtml}</div>
            </details>`;
}

/**
 * The re-plan's read-only "Your rulings" list on the Direction step: the
 * player's quote and the option it picked, the open rulings first, then the
 * answered ones marked as given before an earlier re-plan, each with a
 * remove control. Only the player's words are shown, never plan text. Empty
 * when the arc has no ruling left.
 * @param {object} state - Wizard state (reviseArc, removedRulingIds)
 * @returns {string} HTML
 */
function buildRulingsList(state) {
    const keptRulings = rulingsNotRemoved(state);
    if (!keptRulings.length) return '';

    const openRulings = keptRulings.filter(ruling => ruling.answeredAt === undefined);
    const answeredRulings = keptRulings.filter(ruling => ruling.answeredAt !== undefined);
    const rulingItems = [...openRulings, ...answeredRulings].map(ruling => {
        const picked = ruling.chose ? ` <span class="story-arc-wizard-muted">(picked &ldquo;${escapeHtml(ruling.chose)}&rdquo;)</span>` : '';
        const answered = ruling.answeredAt !== undefined ? ' <span class="story-arc-wizard-muted">(given before an earlier re-plan)</span>' : '';
        return `
                    <li class="story-arc-ruling-item">
                        <span>&ldquo;${escapeHtml(ruling.text)}&rdquo;${picked}${answered}</span>
                        <button type="button" class="menu_button story-arc-wizard-icon-button story-arc-ruling-remove" data-ruling-id="${escapeHtml(ruling.id)}"
                            aria-label="Remove this ruling" title="Remove this ruling: it no longer steers this arc">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </li>`;
    }).join('');

    return `
            <div class="story-arc-wizard-field">
                <h3 class="story-arc-wizard-label">Your rulings</h3>
                <ul class="story-arc-rulings-list">${rulingItems}
                </ul>
                <p class="story-arc-wizard-help">
                    The re-plan follows these as binding, and the proposed premise follows them. A removed
                    ruling is taken off the arc when you apply the re-plan.
                </p>
            </div>`;
}

/**
 * The re-planned arc's rulings without those the player removed.
 * @param {object} state - Wizard state (reviseArc, removedRulingIds)
 * @returns {object[]}
 */
function rulingsNotRemoved(state) {
    const rulings = state.reviseArc?.rulings || [];
    return rulings.filter(ruling => !state.removedRulingIds.includes(ruling.id));
}

function buildTierOptions(selected, reviseArc) {
    // A re-plan may keep the tier or grow it, never shrink it (ADR-0003 amendment)
    const tiers = reviseArc ? replanTiers(reviseArc.tier) : Object.keys(TIER_TABLE);
    return tiers.map(tier => {
        const { label, lengthBand } = TIER_TABLE[tier];
        return `<option value="${tier}" ${tier === selected ? 'selected' : ''}>${label} (~${lengthBand[0]}–${lengthBand[1]} messages)</option>`;
    }).join('');
}

/**
 * The Direction step's controls: Cancel, and Generate, off until the story
 * context is in.
 * @param {boolean} contextReady
 * @returns {string} HTML
 */
export function buildDirectionControls(contextReady) {
    return `
        <button type="button" class="menu_button" id="story-arc-wizard-cancel">Cancel</button>
        <span class="story-arc-wizard-controls-end">
            <button type="button" class="menu_button story-arc-wizard-primary" id="story-arc-wizard-generate" ${contextReady ? '' : 'disabled'}>
                <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generate
            </button>
        </span>`;
}

/**
 * Read the Direction step's inputs into wizardState. No-op when the step is
 * not on screen (Regenerate / Retry from Review), so the values survive.
 */
function readDirectionStep() {
    const $direction = $('#story-arc-direction-input');
    if (!$direction.length) return;
    wizardState.direction = $direction.val() || '';
    wizardState.tier = $('#story-arc-tier-select').val() || 'episode';
    wizardState.genre = $('#story-arc-genre-input').val() || '';
    if (wizardState.reviseArc) {
        wizardState.title = $('#story-arc-title-input').val() || wizardState.reviseArc.title;
        wizardState.premise = $('#story-arc-premise-input').val() || wizardState.reviseArc.premise;
    }
}

// ─── Step 2: Review ─────────────────────────────────────────────────────────

async function runGeneration() {
    readDirectionStep();

    // Generation outlives the popup. The run keeps the state of the wizard it
    // started in and writes nothing once that wizard is cancelled, closed or
    // replaced by a re-opened one — otherwise its result lands in the new wizard.
    const runState = wizardState;
    const isAbandoned = () => runState.cancelled || runState !== wizardState;

    const log = createStepLog();
    let lastChunkPaint = 0;

    try {
        const callbacks = {
            onProgress: (phase, message) => {
                if (isAbandoned()) return;
                // A retry means the step that was running did not succeed.
                log.step(message, phase === 'retry' ? 'failed' : 'done');
                lastChunkPaint = 0;
            },
            onChunk: (chars) => {
                if (isAbandoned()) return;
                // Chunks arrive per token; repainting each one is pointless churn.
                const now = Date.now();
                if (now - lastChunkPaint < 250) return;
                lastChunkPaint = now;
                log.detail(`${formatCharCount(chars)} received`);
            },
            isCancelled: isAbandoned,
        };
        const reviseArc = reviseArcWithEdits();
        const generationOptions = { tier: runState.tier, reviseArc, genre: runState.genre };
        const result = await generateArc(runState.context, runState.direction, callbacks, generationOptions);

        if (isAbandoned()) return;

        if (result.error) {
            showGenerationFailed(log, `Generation failed: ${result.error}`);
            return;
        }

        log.finish('done');
        runState.generatedArc = result.arc;
        $('#story-arc-wizard-content').html(buildReviewStep(result.arc, runState.reviseArc));
        $('#story-arc-wizard-footer').html(buildReviewControls(runState.reviseArc));
        $('#story-arc-wizard-arc-title').trigger('focus');

    } catch (err) {
        console.error('[Story Arc] Generation error:', err);
        if (isAbandoned()) return;
        showGenerationFailed(log, `Error: ${err.message}`);
    }
}

/**
 * A failed generation keeps its log on screen (it shows which step failed)
 * with the error under it, and offers Back and Retry.
 */
function showGenerationFailed(log, message) {
    log.finish('failed');
    $('#story-arc-wizard-generation-error').html(buildGenerationError(message));
    $('#story-arc-wizard-footer').html(buildGenerationFailedControls());
}

/**
 * The failed generation's message.
 * @param {string} message
 * @returns {string} HTML
 */
export function buildGenerationError(message) {
    return `
            <p class="story-arc-wizard-error" role="alert">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <span>${escapeHtml(message)}</span>
            </p>`;
}

/** @returns {string} HTML: Cancel, Back, Retry */
export function buildGenerationFailedControls() {
    return `
        <button type="button" class="menu_button" id="story-arc-wizard-cancel">Cancel</button>
        <span class="story-arc-wizard-controls-end">
            <button type="button" class="menu_button" id="story-arc-wizard-back">
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back
            </button>
            <button type="button" class="menu_button story-arc-wizard-primary" id="story-arc-wizard-regenerate">
                <i class="fa-solid fa-rotate" aria-hidden="true"></i> Retry
            </button>
        </span>`;
}

/**
 * Show the generation log in the wizard content area and return a handle
 * for driving it. Generation takes minutes, so every step stays on screen with
 * the time it took instead of a single line that overwrites itself. Only a
 * new step is announced to screen readers (the status line); the detail
 * repaints every 250 ms and would chatter.
 *
 * @returns {{ step: (message: string, previousOutcome?: 'done'|'failed') => void,
 *             detail: (text: string) => void,
 *             finish: (outcome: 'done'|'failed') => void }}
 */
function createStepLog() {
    // Profile names differ only in a preset segment; a wrong pick otherwise stays
    // invisible until generation has burned minutes.
    $('#story-arc-wizard-content').html(buildGenerationView(activeProfileName()));
    $('#story-arc-wizard-footer').html(buildGenerationControls());

    const lines = [];
    let activeStartedAt = 0;

    function paint() {
        $('#story-arc-step-log').html(buildStepLogLines(lines));
    }

    function closeActive(outcome) {
        const activeLine = lines[lines.length - 1];
        if (!activeLine || activeLine.outcome !== 'active') return;
        const seconds = Math.round((Date.now() - activeStartedAt) / 1000);
        activeLine.outcome = outcome;
        activeLine.detail = `${seconds}s`;
    }

    return {
        step(message, previousOutcome = 'done') {
            closeActive(previousOutcome);
            activeStartedAt = Date.now();
            lines.push({ message, outcome: 'active', detail: '' });
            paint();
            $('#story-arc-wizard-status').text(message);
        },
        detail(text) {
            const activeLine = lines[lines.length - 1];
            if (!activeLine || activeLine.outcome !== 'active') return;
            activeLine.detail = text;
            paint();
        },
        finish(outcome) {
            closeActive(outcome);
            paint();
        },
    };
}

/**
 * The generation view: the profile in use, the step log, the hidden status
 * line that announces each step, and the slot for a failure message.
 * @param {string} profileName
 * @param {{ message: string, outcome: 'active'|'done'|'failed', detail: string }[]} [lines=[]]
 * @returns {string} HTML
 */
export function buildGenerationView(profileName, lines = []) {
    return `
        <section class="story-arc-wizard-generation" aria-labelledby="story-arc-wizard-generation-heading">
            <h3 id="story-arc-wizard-generation-heading">Planning the arc</h3>
            <p class="story-arc-wizard-help">
                <i class="fa-solid fa-plug" aria-hidden="true"></i> Profile: <b>${escapeHtml(profileName)}</b>.
                This takes a few minutes. Cancel drops the result; a call already sent finishes in the background.
            </p>
            <ol class="story-arc-wizard-log" id="story-arc-step-log">${buildStepLogLines(lines)}</ol>
            <p class="visually-hidden" id="story-arc-wizard-status" role="status" aria-live="polite"></p>
            <div id="story-arc-wizard-generation-error"></div>
        </section>`;
}

/**
 * The log's lines: running (spinner), done (check) or failed (cross), each
 * with its message and its elapsed time or received size.
 * @param {{ message: string, outcome: 'active'|'done'|'failed', detail: string }[]} lines
 * @returns {string} HTML
 */
export function buildStepLogLines(lines) {
    return lines.map(line => {
        let icon = 'fa-spinner fa-spin';
        let outcomeLabel = 'Running';
        if (line.outcome === 'done') {
            icon = 'fa-circle-check';
            outcomeLabel = 'Done';
        } else if (line.outcome === 'failed') {
            icon = 'fa-circle-xmark';
            outcomeLabel = 'Failed';
        }
        return `
                <li class="story-arc-wizard-log-line is-${line.outcome}">
                    <i class="fa-solid ${icon}" aria-hidden="true"></i>
                    <span class="visually-hidden">${outcomeLabel}:</span>
                    <span class="story-arc-wizard-log-message">${escapeHtml(line.message)}</span>
                    <span class="story-arc-wizard-log-detail">${escapeHtml(line.detail)}</span>
                </li>`;
    }).join('');
}

/** @returns {string} HTML: Cancel only, while the plan is made */
export function buildGenerationControls() {
    return `
        <button type="button" class="menu_button" id="story-arc-wizard-cancel" title="Stop planning and close the wizard">Cancel</button>`;
}

/**
 * Name of the Connection Manager profile arc generation will use.
 * @returns {string} Profile name, or a label for the no-profile fallback
 */
function activeProfileName() {
    const profileId = getSettings().defaultConnectionProfile;
    if (!profileId) return 'Current chat API (no profile)';

    const profiles = extension_settings.connectionManager?.profiles || [];
    const profile = profiles.find(candidate => candidate.id === profileId);
    return profile ? profile.name : `Unknown profile (${profileId})`;
}

function formatCharCount(chars) {
    return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k chars` : `${chars} chars`;
}

/**
 * The arc being re-planned with the dialog's title, premise, direction and
 * genre applied — what mergeReplan keeps verbatim — and without the
 * rulings removed on the Direction step, so a removed ruling reaches no
 * call. Null when planning new.
 * @returns {object|null}
 */
function reviseArcWithEdits() {
    if (!wizardState.reviseArc) return null;
    const reviseArc = {
        ...wizardState.reviseArc,
        title: wizardState.title,
        premise: wizardState.premise,
        direction: wizardState.direction,
        genre: wizardState.genre.trim(),
    };
    if (wizardState.reviseArc.rulings) reviseArc.rulings = rulingsNotRemoved(wizardState);
    return reviseArc;
}

/**
 * The Review step: what the plan is in plain view (title, tier, length,
 * tone, themes; on a re-plan the premise choice), and the plan text — a new
 * arc's premise, beats, secrets, clues, triggers, escalation — behind one
 * Reveal switch, off on every render.
 * @param {object} arc - The generated (on a re-plan: merged and checked) arc
 * @param {object|null} reviseArc - The arc being re-planned, null for a new arc
 * @returns {string} HTML
 */
export function buildReviewStep(arc, reviseArc) {
    const tierLabel = TIER_TABLE[arc.tier]?.label || arc.tier;
    const themes = (arc.themes || []).map(theme => escapeHtml(theme)).join(', ');
    const metaParts = [escapeHtml(tierLabel), `about ${arc.estimatedLength || '?'} messages`];
    if (arc.tone) metaParts.push(escapeHtml(arc.tone));

    // A re-plan shows its premise in plain view for the player's choice
    // (ADR-0003); a new arc's premise stays behind the switch.
    const premiseChoice = reviseArc ? buildPremiseChoice(arc) : '';
    const beatsHeading = arc.tier === 'episode' || !arc.tier ? 'Beats' : 'Milestones';

    const sections = [];
    if (!reviseArc) sections.push(`<section><h4>Premise</h4><p>${escapeHtml(arc.premise)}</p></section>`);
    if ((arc.beats || []).length) {
        const beatItems = arc.beats.map(beat => {
            const phase = beat.phase ? `<span class="story-arc-wizard-muted">${escapeHtml(beat.phase)}</span> ` : '';
            const optional = beat.optional ? ' <span class="story-arc-wizard-muted">(optional)</span>' : '';
            return `<li>${phase}${escapeHtml(beat.intention)}${optional}</li>`;
        }).join('');
        sections.push(`<section><h4>${beatsHeading}</h4><ol>${beatItems}</ol></section>`);
    }
    if ((arc.secrets || []).length) {
        const secretItems = arc.secrets.map(secret =>
            `<li>${escapeHtml(secret.content)} <span class="story-arc-wizard-muted">(revealed in ${escapeHtml(secret.revealPhase)})</span></li>`,
        ).join('');
        sections.push(`<section><h4>Secrets</h4><ul>${secretItems}</ul></section>`);
    }
    if ((arc.foreshadowing || []).length) {
        const clueItems = arc.foreshadowing.map(foreshadowing =>
            `<li><b>${escapeHtml(foreshadowing.clue)}</b> <span class="story-arc-wizard-muted">points to</span> ${escapeHtml(foreshadowing.target)}</li>`,
        ).join('');
        sections.push(`<section><h4>Clues</h4><ul>${clueItems}</ul></section>`);
    }
    if ((arc.triggers || []).length) {
        const triggerItems = arc.triggers.map(trigger =>
            `<li><span class="story-arc-wizard-muted">If</span> ${escapeHtml(trigger.condition)} <span class="story-arc-wizard-muted">then</span> ${escapeHtml(trigger.action)}</li>`,
        ).join('');
        sections.push(`<section><h4>Triggers</h4><ul>${triggerItems}</ul></section>`);
    }
    if (arc.escalation) sections.push(`<section><h4>Escalation</h4><p>${escapeHtml(arc.escalation)}</p></section>`);

    return `
        <section class="story-arc-wizard-review" aria-labelledby="story-arc-wizard-arc-title">
            <h3 class="story-arc-wizard-arc-title" id="story-arc-wizard-arc-title" tabindex="-1">${escapeHtml(arc.title)}</h3>
            <p class="story-arc-wizard-meta">${metaParts.join(' · ')}</p>
            <p class="story-arc-wizard-meta"><span class="story-arc-wizard-muted">Themes:</span> ${themes || '<span class="story-arc-wizard-muted">none</span>'}</p>
            ${premiseChoice}
            <div class="story-arc-wizard-plan" id="story-arc-wizard-plan">
                <div class="story-arc-wizard-plan-bar">
                    <label class="story-arc-wizard-switch">
                        <input type="checkbox" role="switch" id="story-arc-wizard-reveal">
                        <span class="story-arc-wizard-switch-track" aria-hidden="true"></span>
                        Reveal plan
                    </label>
                    <p class="story-arc-wizard-help story-arc-wizard-plan-hidden-note">
                        Hidden: ${listPlanParts(arc, !reviseArc)}. Revealing it may spoil the story for you as a player.
                    </p>
                </div>
                <div class="story-arc-wizard-plan-body">${sections.join('')}</div>
            </div>
        </section>`;
}

/**
 * The hidden plan text as a phrase: "the premise, 5 beats, 2 secrets,
 * 1 clue, 2 triggers and the escalation".
 * @param {object} arc
 * @param {boolean} withPremise - The premise is hidden too (a new arc)
 * @returns {string}
 */
function listPlanParts(arc, withPremise) {
    const beatWord = arc.tier === 'episode' || !arc.tier ? ['beat', 'beats'] : ['milestone', 'milestones'];
    const parts = [];
    if (withPremise) parts.push('the premise');
    if ((arc.beats || []).length) parts.push(countOf(arc.beats.length, ...beatWord));
    if ((arc.secrets || []).length) parts.push(countOf(arc.secrets.length, 'secret', 'secrets'));
    if ((arc.foreshadowing || []).length) parts.push(countOf(arc.foreshadowing.length, 'clue', 'clues'));
    if ((arc.triggers || []).length) parts.push(countOf(arc.triggers.length, 'trigger', 'triggers'));
    if (arc.escalation) parts.push('the escalation');
    if (parts.length <= 1) return parts.join('') || 'nothing';
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The re-plan's Premise block, in plain view outside the plan switch:
 * the current premise, the one Phase 2 proposed, a choice between them and
 * a text area holding the chosen text for editing. When rulings were passed
 * to the re-plan, the proposal is pre-selected: it follows them, and that is
 * the usual case. Otherwise the current premise is, so a plain re-plan does
 * not replace a premise the player wrote by hand. Every render (a fresh
 * generation, Regenerate) starts from that default.
 * @param {object} arc - The checked merged arc, carrying proposedPremise and the rulings passed
 * @returns {string} HTML
 */
function buildPremiseChoice(arc) {
    const proposedPremise = arc.proposedPremise || arc.premise;
    const proposalPreselected = (arc.rulings || []).length > 0;
    const chosenPremise = proposalPreselected ? proposedPremise : arc.premise;
    return `
            <fieldset class="story-arc-wizard-premise-choice">
                <legend class="story-arc-wizard-label">Premise</legend>
                <label class="story-arc-premise-option">
                    <input type="radio" name="story-arc-premise-choice" value="current" ${proposalPreselected ? '' : 'checked'}>
                    <span><b>Current:</b> ${escapeHtml(arc.premise)}</span>
                </label>
                <label class="story-arc-premise-option">
                    <input type="radio" name="story-arc-premise-choice" value="proposed" ${proposalPreselected ? 'checked' : ''}>
                    <span><b>Proposed:</b> ${escapeHtml(proposedPremise)}</span>
                </label>
                <label class="visually-hidden" for="story-arc-premise-choice-text">Premise to store</label>
                <textarea class="text_pole" id="story-arc-premise-choice-text" rows="3">${escapeHtml(chosenPremise)}</textarea>
                <p class="story-arc-wizard-help">The text above is stored as the premise when you apply the re-plan. Edit it freely.</p>
            </fieldset>`;
}

/**
 * The Review step's controls: Cancel, Back, Regenerate, and Activate (Apply
 * re-plan when re-planning).
 * @param {object|null} reviseArc
 * @returns {string} HTML
 */
export function buildReviewControls(reviseArc) {
    return `
        <button type="button" class="menu_button" id="story-arc-wizard-cancel">Cancel</button>
        <span class="story-arc-wizard-controls-end">
            <button type="button" class="menu_button" id="story-arc-wizard-back">
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back
            </button>
            <button type="button" class="menu_button" id="story-arc-wizard-regenerate">
                <i class="fa-solid fa-rotate" aria-hidden="true"></i> Regenerate
            </button>
            <button type="button" class="menu_button story-arc-wizard-primary" id="story-arc-wizard-activate">
                <i class="fa-solid fa-check" aria-hidden="true"></i> ${reviseArc ? 'Apply re-plan' : 'Activate'}
            </button>
        </span>`;
}

/**
 * Back from a generated plan asks first, in the controls row: going back
 * drops the plan, and a new one costs another generation.
 * @returns {string} HTML
 */
export function buildDiscardPlanControls() {
    return `
        <button type="button" class="menu_button" id="story-arc-wizard-cancel">Cancel</button>
        <span class="story-arc-wizard-controls-end" role="group" aria-labelledby="story-arc-wizard-discard-question">
            <span class="story-arc-wizard-question" id="story-arc-wizard-discard-question">Going back discards this plan.</span>
            <button type="button" class="menu_button" id="story-arc-wizard-keep-plan">Keep the plan</button>
            <button type="button" class="menu_button story-arc-wizard-danger" id="story-arc-wizard-discard-plan">
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Discard and go back
            </button>
        </span>`;
}

// ─── Event Wiring ───────────────────────────────────────────────────────────

function wireWizardEvents() {
    const $doc = $(document);

    // Use delegation scoped to the wizard
    $doc.off('click.storyArcWizard change.storyArcWizard');

    // Cancel: on every view, including while the plan is made
    $doc.on('click.storyArcWizard', '#story-arc-wizard-cancel', () => {
        if (!wizardState) return;
        wizardState.cancelled = true;
        wizardState.popup?.completeCancelled?.();
        // Try multiple close methods for compatibility
        if (typeof wizardState.popup?.complete === 'function') {
            wizardState.popup.complete(0);
        }
    });

    // A failed harvest: read the story again
    $doc.on('click.storyArcWizard', '#story-arc-wizard-retry-context', () => {
        if (!wizardState) return;
        loadContext();
    });

    // Direction → Review: generate
    $doc.on('click.storyArcWizard', '#story-arc-wizard-generate', () => {
        if (!wizardState?.context) return;
        readDirectionStep();
        setWizardStep('review');
        runGeneration();
    });

    // Review → Direction: a generated plan is only dropped after asking
    $doc.on('click.storyArcWizard', '#story-arc-wizard-back', () => {
        if (wizardState?.step !== 'review') return;
        if (wizardState.generatedArc) {
            $('#story-arc-wizard-footer').html(buildDiscardPlanControls());
            $('#story-arc-wizard-keep-plan').trigger('focus');
            return;
        }
        showDirectionStep();
    });

    $doc.on('click.storyArcWizard', '#story-arc-wizard-keep-plan', () => {
        if (!wizardState?.generatedArc) return;
        $('#story-arc-wizard-footer').html(buildReviewControls(wizardState.reviseArc));
        $('#story-arc-wizard-back').trigger('focus');
    });

    $doc.on('click.storyArcWizard', '#story-arc-wizard-discard-plan', () => {
        if (!wizardState) return;
        wizardState.generatedArc = null;
        showDirectionStep();
    });

    // Regenerate, and Retry after a failed generation
    $doc.on('click.storyArcWizard', '#story-arc-wizard-regenerate', () => {
        if (!wizardState) return;
        wizardState.generatedArc = null;
        runGeneration();
    });

    // Activate
    $doc.on('click.storyArcWizard', '#story-arc-wizard-activate', async () => {
        // The save is awaited; the popup may close meanwhile and null wizardState.
        const state = wizardState;
        if (!state?.generatedArc) return;

        try {
            if (state.reviseArc) {
                const premise = $('#story-arc-premise-choice-text').val();
                const removedRulingIds = state.removedRulingIds;
                // The rulings as stored now: one may have come or gone since Generate.
                const storedRulings = getArcById(state.reviseArc.id)?.rulings;
                const { arc, error } = applyReplan(state.generatedArc, chat.length, { premise, removedRulingIds, storedRulings });
                if (error) {
                    toastr.error(error);
                    return;
                }
                await updateArc(state.reviseArc.id, arc);
                toastr.success(`Arc "${state.generatedArc.title}" re-planned`);
            } else {
                await saveArc(state.generatedArc);
                toastr.success(`Arc "${state.generatedArc.title}" activated!`);
            }
            updateProgress();

            if (typeof state.popup?.complete === 'function') {
                state.popup.complete(1);
            }
        } catch (err) {
            console.error('[Story Arc] Failed to save arc:', err);
            toastr.error(`Failed to save arc: ${err.message}`);
        }
    });

    // Re-plan Direction step: remove a ruling. Held in the wizard until apply,
    // so cancelling changes nothing; the typed fields survive the re-render.
    $doc.on('click.storyArcWizard', '.story-arc-ruling-remove', function () {
        if (!wizardState?.reviseArc) return;
        readDirectionStep();
        wizardState.removedRulingIds.push(String($(this).data('ruling-id')));
        showDirectionStep();
    });

    // Re-plan premise choice: the text area takes the chosen premise
    $doc.on('change.storyArcWizard', 'input[name="story-arc-premise-choice"]', function () {
        const arc = wizardState?.generatedArc;
        if (!arc) return;
        const chosen = $(this).val() === 'proposed' ? (arc.proposedPremise || arc.premise) : arc.premise;
        $('#story-arc-premise-choice-text').val(chosen);
    });

    // Reveal plan: one switch for the whole plan text; nothing re-renders
    $doc.on('change.storyArcWizard', '#story-arc-wizard-reveal', function () {
        $('#story-arc-wizard-plan').toggleClass('is-revealed', $(this).prop('checked'));
    });
}
