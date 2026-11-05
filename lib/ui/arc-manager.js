/**
 * @file Arc Manager popup — a table of the chat's arcs, one row per arc
 * @module ui/arc-manager
 *
 * Active arcs in a table: title, tier, focus as a segmented control, phase,
 * the beat strip (shape per status), the last beat landed and a ⋯ menu
 * (re-plan, edit title and premise, edit beats, edit as JSON, complete,
 * abandon). A warning line under an arc names what is wrong in one sentence
 * with its fixes beside it: an open ruling (Re-plan), every beat done
 * (Complete it), a stall (Re-plan, Spotlight it, Ignore). Expanding a row
 * shows what the narrator gets from the arc, its beats with their status,
 * the title and premise editor, and behind one Reveal switch per arc the
 * plan text: premise, pressures and fulfillments, secrets, clues and
 * triggers, the JSON editor. Past arcs sit collapsed below, each with
 * Reactivate. Every change is saved at once and can be undone while the
 * popup is open (createUndoStack). Re-plan, Plan a new arc and Knowledge
 * close the popup first and open the wizard or the Knowledge popup after it
 * (ST popups do not nest).
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { chat, chat_metadata, saveMetadata } from '/script.js';
import { getArcById, getArcs, replaceArc, updateArc } from '../planning/storage.js';
import { applyArcEdit, applyTitleAndPremiseEdit, checkBeatEdit, removeBeat, togglePlanItem } from '../planning/arc-edit.js';
import { setBeatStatusByHand } from '../planning/beat-completion.js';
import { dropPendingMark, MARK_FLUSH_WINDOW } from '../injection/signals.js';
import { calculatePhase, selectNonOptionalBeats } from '../injection/pacing.js';
import { pauseArc, reactivateArc, resumeArc, selectPacingClock, spotlightArc } from '../injection/clock.js';
import { arcMessageStart, arcTier, ensureChatState, isKnowledgeTrackerEnabled } from '../core/settings.js';
import { ARC_PHASES, TIER_TABLE } from '../core/constants.js';
import { ignoreStall, isStalled, isStallNudgeShown, showIgnoredStall, stallCountStart, updateProgress } from './progress.js';
import { showWizard } from './wizard.js';
import { showKnowledgePopup } from './knowledge-popup.js';
import { createUndoStack } from './undo-stack.js';

/**
 * The open popup session: the popup, the order of the active rows (sorted
 * once at the open, so a focus change never moves a row), which arcs are
 * expanded and which show their plan. Null while no Arc Manager is open.
 * @type {{ popup: object, activeOrder: string[], expanded: Set<string>, revealed: Set<string> }|null}
 */
let session = null;

/** What opens after the popup closed: { kind: 'replan', arcId } | { kind: 'plan-new' } | { kind: 'knowledge' } */
let handoffAfterClose = null;

/**
 * Show the Arc Manager popup.
 */
export async function showArcManager() {
    ensureChatState();
    handoffAfterClose = null;

    const arcs = getArcs();
    session = {
        popup: null,
        activeOrder: sortActiveArcs(arcs.filter(arc => arc.status === 'active')).map(arc => arc.id),
        expanded: new Set(),
        revealed: new Set(),
    };
    startArcUndoSession();

    const html = buildManagerContent(arcs, pendingMarksOfChat(), viewOfSession());
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
    session.popup = popup;

    const popupPromise = popup.show();

    // Small delay for DOM render
    await delay(50);
    wireManagerEvents(popup);

    await popupPromise;

    // Cleanup — leaving these bound would fire them from the next popup
    $(document).off('.storyArcManager');
    $(window).off('.storyArcManager');
    endArcUndoSession();
    session = null;

    // Nested ST popups stack badly, so the wizard or the Knowledge popup opens only now
    const handoff = handoffAfterClose;
    handoffAfterClose = null;
    if (handoff?.kind === 'replan') {
        await showWizard(handoff.arcId);
    } else if (handoff?.kind === 'plan-new') {
        await showWizard();
    } else if (handoff?.kind === 'knowledge') {
        await showKnowledgePopup();
    }
}

/**
 * Active arcs in the order the table shows them: spotlight, normal,
 * background, paused; within a focus episode, act, saga (the closest to the
 * scene first); then the newest first.
 * @param {object[]} activeArcs
 * @returns {object[]}
 */
export function sortActiveArcs(activeArcs) {
    const focusRank = { spotlight: 0, normal: 1, background: 2, paused: 3 };
    const tierRank = { episode: 0, act: 1, saga: 2 };
    return [...activeArcs].sort((first, second) => {
        const byFocus = (focusRank[first.focus] ?? 9) - (focusRank[second.focus] ?? 9);
        if (byFocus) return byFocus;
        const byTier = tierRank[arcTier(first)] - tierRank[arcTier(second)];
        if (byTier) return byTier;
        return (Date.parse(second.createdAt) || 0) - (Date.parse(first.createdAt) || 0);
    });
}

/** The view state the builders need from the open session */
function viewOfSession() {
    return {
        activeOrder: session.activeOrder,
        expanded: session.expanded,
        revealed: session.revealed,
        trackerOn: isKnowledgeTrackerEnabled(),
    };
}

/** The chat's queued marks, all arcs */
function pendingMarksOfChat() {
    return chat_metadata.story_arc?.pendingMarks || [];
}

// ─── Undo ───────────────────────────────────────────────────────────────────

/**
 * The undo stack of the open Arc Manager; null while none is open, so an
 * arc edit saved from elsewhere records nothing.
 * @type {ReturnType<typeof createUndoStack>|null}
 */
let arcUndo = null;

/** Message of an undo refused because the arcs changed since the edit */
const ARCS_CHANGED_MESSAGE = 'the arcs changed since (an update ran after a reply, a swipe or a deleted message). Nothing was changed; edit it by hand instead.';

/**
 * Start an empty undo stack for a new Arc Manager session. Its state is the
 * chat's arcs together with the queued marks, since dropping a report or
 * toggling a plan item also drops a mark.
 */
export function startArcUndoSession() {
    arcUndo = createUndoStack({
        read: readArcState,
        write: restoreArcState,
        changedMessage: ARCS_CHANGED_MESSAGE,
    });
}

/** End the session; its undo stack is dropped. */
export function endArcUndoSession() {
    arcUndo = null;
}

/**
 * Run one arc edit and record it for undo under `label`.
 * @param {string} label - What the edit did, as the undo button names it
 * @param {() => Promise<void>} edit - Saves the change
 */
export async function runArcEdit(label, edit) {
    const before = arcUndo?.capture();
    await edit();
    arcUndo?.record(before, label);
}

/**
 * Undo the newest arc edit of the session. Refused, and the stack dropped,
 * when the stored arcs or marks changed since the edit.
 * @returns {Promise<{ error: string|null, label: string|null }>}
 */
export async function undoArcEdit() {
    if (!arcUndo) return { error: 'Nothing to undo.', label: null };
    const result = arcUndo.undo();
    if (result.error) return result;
    await saveMetadata();
    updateProgress();
    return result;
}

/** The label of the newest edit the session can undo, null when there is none */
export function newestArcEditLabel() {
    return arcUndo?.newestLabel() ?? null;
}

function readArcState() {
    const state = chat_metadata.story_arc;
    return { arcs: state?.arcs || [], pendingMarks: state?.pendingMarks || [] };
}

/**
 * Put a snapshot back: the arcs array is kept and refilled, so anything
 * holding it sees the restored arcs.
 * @param {{ arcs: object[], pendingMarks: object[] }} snapshot
 */
function restoreArcState(snapshot) {
    ensureChatState();
    const storedArcs = chat_metadata.story_arc.arcs;
    storedArcs.splice(0, storedArcs.length, ...snapshot.arcs);
    chat_metadata.story_arc.pendingMarks = snapshot.pendingMarks;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/** Focus values in the order of the segmented control */
const FOCUS_OPTIONS = [
    { value: 'paused', label: 'Paused', icon: 'fa-pause', hint: 'Paused: set aside for a tangent. Its beats are not checked and its clock stands still.' },
    { value: 'background', label: 'Background', icon: 'fa-eye-slash', hint: 'Background: goes on off-screen. The narrator gets only the title; milestones are still recognised.' },
    { value: 'normal', label: 'Normal', icon: 'fa-circle-dot', hint: 'Normal: in the prompt as planned.' },
    { value: 'spotlight', label: 'Spotlight', icon: 'fa-star', hint: 'Spotlight: pushed to the front. Only one arc at a time; the previous one goes back to normal.' },
];

/** Plan lists with a done flag the Arc Manager can toggle */
const PLAN_ITEM_LISTS = {
    secrets: { flag: 'disclosed', label: 'Secrets', one: 'Secret', doneWord: 'revealed', text: secret => secret.content },
    foreshadowing: { flag: 'planted', label: 'Clues', one: 'Clue', doneWord: 'planted', text: foreshadowing => foreshadowing.clue },
    triggers: { flag: 'fired', label: 'Triggers', one: 'Trigger', doneWord: 'happened', text: trigger => `IF ${trigger.condition} → ${trigger.action}` },
};

/** The words for an arc's beats by tier */
function beatWords(arc) {
    if (arcTier(arc) === 'episode') {
        return { Beat: 'Scene beat', beat: 'scene beat', beats: 'scene beats', Beats: 'Scene beats', note: 'in order, one active at a time' };
    }
    return { Beat: 'Milestone', beat: 'milestone', beats: 'milestones', Beats: 'Milestones', note: 'any order, all open ones stand at once' };
}

/** A beat status as the popup names it: a milestone is open or done, a scene beat pending, active or done */
function beatStatusWord(arc, status) {
    if (status === 'completed') return 'Done';
    if (status === 'locked') return 'Locked';
    if (status === 'pending') return 'Pending';
    if (status === 'active') return arcTier(arc) === 'episode' ? 'Active' : 'Open';
    return status;
}

/** The index of the latest message: what "#2,941" in the popup refers to */
function latestMessageIndex() {
    return Math.max(0, chat.length - 1);
}

function formatNumber(number) {
    return Number(number).toLocaleString('en');
}

function plural(count, one, many = `${one}s`) {
    return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/** "246 messages ago" from a message index */
function messagesAgo(messageIndex) {
    const count = latestMessageIndex() - messageIndex;
    if (count <= 0) return 'at the latest message';
    return `${plural(count, 'message')} ago`;
}

/** Whether a beat of the arc has landed: one is done and the arc carries its message */
function hasLandedBeat(arc) {
    return typeof arc.lastFulfilledAt === 'number' && (arc.beats || []).some(beat => beat.status === 'completed');
}

function openRulingsOf(arc) {
    return (arc.rulings || []).filter(ruling => ruling.answeredAt === undefined);
}

function areAllRequiredBeatsDone(arc) {
    const nonOptionalBeats = selectNonOptionalBeats(arc.beats || []);
    return nonOptionalBeats.length > 0 && nonOptionalBeats.every(beat => beat.status === 'completed');
}

/**
 * The queued marks of an arc that still wait: their item exists and is not
 * done yet. A mark whose item a re-plan removed, or that is already done,
 * waits for nothing.
 * @param {object} arc
 * @param {object[]} pendingMarks - The chat's queued marks, all arcs
 * @returns {object[]}
 */
export function waitingMarksOf(arc, pendingMarks) {
    return pendingMarks.filter(mark => {
        if (mark.arcId !== arc.id) return false;
        const item = (arc[mark.list] || []).find(candidate => candidate.id === mark.id);
        return item && !item[mark.flag];
    });
}

/**
 * The whole popup: head with the summary line and the two hand-off buttons,
 * the table of active arcs (or the empty state), the past arcs collapsed,
 * the status strip and the footer with undo and Close.
 * @param {object[]} arcs - Every arc of the chat
 * @param {object[]} pendingMarks - The chat's queued marks
 * @param {{ activeOrder: string[], expanded: Set<string>, revealed: Set<string>, trackerOn: boolean }} view
 * @returns {string} HTML string
 */
export function buildManagerContent(arcs, pendingMarks, view) {
    const activeArcs = view.activeOrder.map(id => arcs.find(arc => arc.id === id)).filter(arc => arc?.status === 'active');
    const pastArcs = arcs.filter(arc => arc.status !== 'active');
    const knowledgeButton = view.trackerOn
        ? `<button type="button" class="menu_button" data-act="knowledge" title="Who knows what: opens the Knowledge popup">
                <i class="fa-solid fa-user-secret" aria-hidden="true"></i> Knowledge</button>`
        : '';

    return `<div class="am" id="story-arc-manager" role="region" aria-labelledby="am-title">
        <header class="am-head">
            <div class="am-head-text">
                <h2 id="am-title" tabindex="-1">Story arcs</h2>
                <p class="am-summary" id="am-summary">${buildSummary(activeArcs)}</p>
            </div>
            <div class="am-head-actions">
                ${knowledgeButton}
                <button type="button" class="menu_button am-primary" data-act="plan-new" id="am-plan-new" title="Plan the next arc from where the story is now" ${activeArcs.length ? '' : 'hidden'}>
                    <i class="fa-solid fa-compass" aria-hidden="true"></i> Plan a new arc</button>
            </div>
        </header>
        <div class="am-table-wrap" id="am-active">${buildActiveTable(activeArcs, arcs, pendingMarks, view)}</div>
        <details class="am-past" id="am-past">
            <summary><i class="fa-solid fa-chevron-right" aria-hidden="true"></i> Past arcs <span class="muted" id="am-past-count">${buildPastCount(pastArcs)}</span></summary>
            <div class="am-table-wrap" id="am-past-wrap">${buildPastTable(pastArcs, view)}</div>
        </details>
        <div class="am-live" id="am-live" aria-live="polite"></div>
        <div class="am-controls">
            <span class="am-undo-slot" id="am-undo-slot"></span>
            <button type="button" class="menu_button" data-act="close">Close</button>
            <span class="am-undo-slot"></span>
        </div>
    </div>`;
}

/**
 * The head's one line: how many arcs are active, which one is spotlit, how
 * many are in the background or paused, when the last beat landed, how many
 * need the player, and where the chat is.
 * @param {object[]} activeArcs
 * @returns {string} HTML string
 */
export function buildSummary(activeArcs) {
    const chatAt = `chat at #${formatNumber(latestMessageIndex())}`;
    if (!activeArcs.length) return `No active arc · ${chatAt}`;

    const parts = [`<b>${activeArcs.length}</b> active ${activeArcs.length === 1 ? 'arc' : 'arcs'}`];
    const spotlitArc = activeArcs.find(arc => arc.focus === 'spotlight');
    parts.push(spotlitArc ? `<b>${escapeHtml(spotlitArc.title)}</b> in the spotlight` : 'none in the spotlight');
    const backgroundCount = activeArcs.filter(arc => arc.focus === 'background').length;
    const pausedCount = activeArcs.filter(arc => arc.focus === 'paused').length;
    if (backgroundCount) parts.push(`${backgroundCount} in the background`);
    if (pausedCount) parts.push(`${pausedCount} paused`);
    const landedAt = activeArcs.filter(hasLandedBeat).map(arc => arc.lastFulfilledAt);
    parts.push(landedAt.length ? `last beat ${messagesAgo(Math.max(...landedAt))}` : 'no beat landed yet');
    const needYouCount = activeArcs.filter(arc => buildArcAlert(arc)).length;
    if (needYouCount) parts.push(`<b>${needYouCount} ${needYouCount === 1 ? 'needs' : 'need'} you</b>`);
    parts.push(chatAt);
    return parts.join(' · ');
}

function buildPastCount(pastArcs) {
    const completedCount = pastArcs.filter(arc => arc.status === 'completed').length;
    return `(${pastArcs.length} · ${completedCount} completed, ${pastArcs.length - completedCount} abandoned)`;
}

/**
 * The table of active arcs, or the empty state when none is active.
 * @returns {string} HTML string
 */
function buildActiveTable(activeArcs, arcs, pendingMarks, view) {
    if (!activeArcs.length) {
        const pastCount = arcs.filter(arc => arc.status !== 'active').length;
        const bringBack = pastCount
            ? `<p class="am-hint">Or bring one back: ${plural(pastCount, 'past arc')} below can be reactivated. <button type="button" class="am-link-btn" data-act="open-past">Show past arcs</button></p>`
            : '';
        return `<div class="am-empty">
            <h3>No arc is steering the story</h3>
            <p>Nothing from Story Arc reaches the narrator; it continues from the chat alone. Plan the next arc from where the story is now, at message #${formatNumber(latestMessageIndex())}.</p>
            <button type="button" class="menu_button am-primary" data-act="plan-new"><i class="fa-solid fa-compass" aria-hidden="true"></i> Plan a new arc</button>
            ${bringBack}
        </div>`;
    }
    const context = { activeArcs, pendingMarks, view };
    return `<table class="am-table" aria-label="Active arcs">
        <thead><tr>
            <th scope="col">Arc</th><th scope="col" class="c-tier">Tier</th><th scope="col" class="c-focus">Focus</th>
            <th scope="col" class="c-phase">Phase</th><th scope="col">Beats</th><th scope="col" class="c-last">Last beat landed</th>
            <th scope="col" class="c-menu"><span class="sr">Actions</span></th>
        </tr></thead>
        ${activeArcs.map(arc => buildActiveArc(arc, context)).join('')}
    </table>`;
}

/**
 * One active arc: its row, the warning line under it (hidden when there is
 * none) and the detail row, filled when expanded.
 * @param {object} arc
 * @param {{ activeArcs: object[], pendingMarks: object[], view: object }} context
 * @returns {string} HTML string
 */
export function buildActiveArc(arc, context) {
    const alert = buildArcAlert(arc);
    const isExpanded = context.view.expanded.has(arc.id);
    return `<tbody class="am-arc ${isExpanded ? 'is-open' : ''}" id="am-arc-${arc.id}" data-id="${arc.id}">
    <tr class="am-row">
        <td class="c-arc">${buildExpandButton(arc, isExpanded)}</td>
        <td class="c-tier">${TIER_TABLE[arcTier(arc)].label}</td>
        <td class="c-focus">${buildFocusControl(arc)}</td>
        <td class="c-phase">${buildPhaseCell(arc)}</td>
        <td class="c-beats">${buildBeatStrip(arc, context.pendingMarks, true)}</td>
        <td class="c-last">${buildLastBeatCell(arc)}</td>
        <td class="c-menu"><button type="button" class="menu_button am-icon-btn" data-act="menu" data-id="${arc.id}"
            aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${escapeHtml(arc.title)}" title="Re-plan, edit, complete, abandon">
            <i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button></td>
    </tr>
    <tr class="am-alert-row" ${alert ? '' : 'hidden'}><td colspan="7">${alert}</td></tr>
    <tr class="am-detail-row" id="am-detail-${arc.id}" ${isExpanded ? '' : 'hidden'}><td colspan="7">${isExpanded ? buildArcDetail(arc, context) : ''}</td></tr>
    </tbody>`;
}

function buildExpandButton(arc, isExpanded, subline = '') {
    return `<button type="button" class="am-expand" data-act="expand" data-id="${arc.id}" aria-expanded="${isExpanded}" aria-controls="am-detail-${arc.id}">
        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i><span class="am-title">${escapeHtml(arc.title)}</span></button>${subline}`;
}

/**
 * The focus as a segmented control of radio buttons. An episode has no
 * background focus (ADR-0001 amendment): that option is there, disabled and
 * struck through, with the reason in its tooltip.
 * @param {object} arc
 * @returns {string} HTML string
 */
export function buildFocusControl(arc) {
    const isEpisode = arcTier(arc) === 'episode';
    const options = FOCUS_OPTIONS.map(option => {
        const isUnavailable = option.value === 'background' && isEpisode;
        let hint = option.hint;
        if (isUnavailable) hint = 'Episodes have no background focus: a scene beat has no off-screen form.';
        if (option.value === 'spotlight' && isEpisode) hint = 'Spotlight: makes this episode the pacing clock. Only one arc at a time.';
        const unavailableNote = isUnavailable ? '<span class="sr"> (not for episodes)</span>' : '';
        return `<label class="am-seg-opt" title="${escapeHtml(hint)}">
            <input type="radio" name="am-focus-${arc.id}" value="${option.value}" data-focus="${arc.id}" ${arc.focus === option.value ? 'checked' : ''} ${isUnavailable ? 'disabled' : ''}>
            <i class="fa-solid ${option.icon}" aria-hidden="true"></i><span class="am-seg-lbl">${option.label}${unavailableNote}</span></label>`;
    }).join('');
    return `<fieldset class="am-seg am-seg-focus"><legend class="sr">Focus of ${escapeHtml(arc.title)}</legend>${options}</fieldset>`;
}

function buildPhaseCell(arc) {
    const { label, messageCount } = calculatePhase(arc);
    const length = arc.estimatedLength > 0 ? `&nbsp;of&nbsp;~${formatNumber(arc.estimatedLength)}` : '';
    return `${label}<span class="am-cell-sub">${formatNumber(messageCount)}${length} messages</span>`;
}

/**
 * The beat strip: one square per beat, grouped by phase, its shape telling
 * the status (filled with a check = done, solid outline = open or active,
 * dashed = pending, dashed with a lock = locked), the done count, and the
 * arc's waiting reports. Interactive cells open the beat in the detail; a
 * past arc's strip is read-only.
 * @param {object} arc
 * @param {object[]} pendingMarks
 * @param {boolean} isInteractive
 * @returns {string} HTML string
 */
export function buildBeatStrip(arc, pendingMarks, isInteractive) {
    const words = beatWords(arc);
    const beats = arc.beats || [];
    const phaseGroups = [];
    beats.forEach((beat, index) => {
        const lastGroup = phaseGroups[phaseGroups.length - 1];
        if (lastGroup && lastGroup.phase === beat.phase) {
            lastGroup.items.push({ beat, index });
        } else {
            phaseGroups.push({ phase: beat.phase, items: [{ beat, index }] });
        }
    });

    let isFirstCell = true;
    const cells = phaseGroups.map(group => `<span class="am-strip-group">${group.items.map(({ beat, index }) => {
        const label = beatLabel(arc, beat, index);
        const tabIndex = isFirstCell ? 0 : -1;
        isFirstCell = false;
        const shape = beatShape(arc, beat.status);
        if (isInteractive) {
            return `<button type="button" class="am-cell ${shape.className}" data-act="cell" data-id="${arc.id}" data-beat="${escapeHtml(beat.id)}" tabindex="${tabIndex}" aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(label)}">${shape.inner}</button>`;
        }
        return `<span class="am-shape ${shape.className}" role="img" aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(label)}" tabindex="${tabIndex}">${shape.inner}</span>`;
    }).join('')}</span>`).join('');

    const nonOptionalBeats = selectNonOptionalBeats(beats);
    const doneCount = nonOptionalBeats.filter(beat => beat.status === 'completed').length;
    const waitingCount = isInteractive ? waitingMarksOf(arc, pendingMarks).length : 0;
    const reports = waitingCount
        ? `<span class="am-reports" title="The narrator reported ${waitingCount === 1 ? 'a secret, clue or trigger' : 'secrets, clues or triggers'} as done. Applied with the next ${words.beat} or after ${MARK_FLUSH_WINDOW} messages, so the prompt changes once. Reveal the plan to see or drop ${waitingCount === 1 ? 'it' : 'them'}.">
            <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>${plural(waitingCount, 'report')} waiting</span>`
        : '';
    return `<div class="am-strip"><span class="am-strip-cells" role="group" aria-label="${words.Beats} of ${escapeHtml(arc.title)}">${cells}</span>
        <span class="am-count"><b>${doneCount}</b>/${nonOptionalBeats.length} done</span>${reports}</div>`;
}

function beatLabel(arc, beat, index) {
    const phaseLabel = ARC_PHASES[beat.phase]?.label || beat.phase || 'no phase';
    const optional = beat.optional ? ' · optional' : '';
    return `${beatWords(arc).Beat} ${index + 1} of ${arc.beats.length} · ${phaseLabel}${optional} · ${beatStatusWord(arc, beat.status)}`;
}

/** The square of a beat status: its class and the icon inside */
function beatShape(arc, status) {
    if (status === 'completed') return { className: 's-completed', inner: '<i class="fa-solid fa-check" aria-hidden="true"></i>' };
    if (status === 'locked') return { className: 's-locked', inner: '<i class="fa-solid fa-lock" aria-hidden="true"></i>' };
    if (status === 'active' && arcTier(arc) === 'episode') return { className: 's-active', inner: '<i class="fa-solid fa-play" aria-hidden="true"></i>' };
    if (status === 'active') return { className: 's-open', inner: '' };
    return { className: 's-pending', inner: '' };
}

/**
 * The last-beat cell: where the last beat landed, or that none has; a
 * paused arc's freeze point; the reactivation; and, while a stall is
 * ignored, that its warning is hidden, with a Show button.
 * @param {object} arc
 * @returns {string} HTML string
 */
export function buildLastBeatCell(arc) {
    let html;
    if (arc.focus === 'paused') {
        const lastBeat = hasLandedBeat(arc) ? ` · last beat #${formatNumber(arc.lastFulfilledAt)}` : '';
        html = `Paused at #${formatNumber(arc.pausedAt ?? latestMessageIndex())}<span class="am-cell-sub">clock stands still${lastBeat}</span>`;
    } else if (hasLandedBeat(arc)) {
        html = `#${formatNumber(arc.lastFulfilledAt)}<span class="am-cell-sub">${messagesAgo(arc.lastFulfilledAt)}</span>`;
    } else {
        html = `None yet<span class="am-cell-sub">arc started at #${formatNumber(arcMessageStart(arc))}</span>`;
    }
    if (typeof arc.reactivatedAt === 'number' && arc.reactivatedAt > (arc.lastFulfilledAt || 0)) {
        html += `<span class="am-cell-sub">reactivated at #${formatNumber(arc.reactivatedAt)}</span>`;
    }
    const isIgnoredStall = isStalled(arc, chat.length) && !isStallNudgeShown(arc, chat.length);
    if (isIgnoredStall && !openRulingsOf(arc).length) {
        html += `<span class="am-cell-sub">Stall warning hidden until the next ${beatWords(arc).beat} ·
            <button type="button" class="am-link-btn" data-act="unignore" data-id="${arc.id}">Show</button></span>`;
    }
    return html;
}

/**
 * The warning line under an active arc: one sentence and its fixes, '' when
 * nothing needs the player. An open ruling wins over the rest (as on the
 * progress card), then every beat done, then a stall the player has not
 * ignored.
 * @param {object} arc
 * @returns {string} HTML string
 */
export function buildArcAlert(arc) {
    if (arc.status !== 'active') return '';
    const words = beatWords(arc);
    const title = escapeHtml(arc.title);

    const openRulings = openRulingsOf(arc);
    if (openRulings.length) {
        // The newest is the one from the latest message; of two from one message, the one stored last.
        let newestRuling = openRulings[0];
        for (const ruling of openRulings) {
            if (ruling.at >= newestRuling.at) newestRuling = ruling;
        }
        const earlierCount = openRulings.length - 1;
        const earlier = earlierCount ? `, and ${earlierCount} earlier` : '';
        const picked = newestRuling.chose ? `, picking <q>${escapeHtml(newestRuling.chose)}</q>` : '';
        const at = typeof newestRuling.at === 'number' ? ` at #${formatNumber(newestRuling.at)}` : '';
        return `<div class="am-alert" role="group" aria-label="Warning for ${title}">
            <i class="fa-solid fa-gavel" aria-hidden="true"></i>
            <p>You overruled the plan — re-plan? <q>${escapeHtml(newestRuling.text)}</q>${picked}${at}${earlier}. Every re-plan follows your rulings as binding.</p>
            <div class="am-alert-actions">
                <button type="button" class="menu_button" data-act="replan" data-id="${arc.id}" title="Re-plan the rest of this arc; its second step lists your rulings, where you can drop one"><i class="fa-solid fa-route" aria-hidden="true"></i> Re-plan</button>
            </div></div>`;
    }

    if (areAllRequiredBeatsDone(arc)) {
        return `<div class="am-alert is-note" role="group" aria-label="Note for ${title}">
            <i class="fa-solid fa-flag-checkered" aria-hidden="true"></i>
            <p>Every ${words.beat} is done, and the arc is still active, so the narrator keeps getting it.</p>
            <div class="am-alert-actions">
                <button type="button" class="menu_button" data-act="complete" data-id="${arc.id}" title="Leaves the prompt; undo stays available while the Arc Manager is open"><i class="fa-solid fa-check" aria-hidden="true"></i> Complete it</button>
            </div></div>`;
    }

    if (isStallNudgeShown(arc, chat.length)) {
        const nonOptionalBeats = selectNonOptionalBeats(arc.beats);
        const openCount = nonOptionalBeats.filter(beat => beat.status !== 'completed').length;
        const messagesSince = Math.max(0, latestMessageIndex() - stallCountStart(arc));
        const perBeat = Math.round(arc.estimatedLength / nonOptionalBeats.length);
        const isSpotlit = arc.focus === 'spotlight';
        const spotlitNote = isSpotlit
            ? ` It is in the spotlight, so the narrator brings its ${plural(openCount, `open ${words.beat}`, `open ${words.beats}`)} to a head.`
            : '';
        const spotlightTitle = arcTier(arc) === 'episode'
            ? 'Push it to the front: the narrator brings its pressures to a head and counts its messages; the stall count restarts'
            : 'Push it to the front: the narrator brings its pressures to a head and also gets its secrets, triggers and clues; the stall count restarts';
        const spotlightButton = isSpotlit
            ? ''
            : `<button type="button" class="menu_button" data-act="spotlight" data-id="${arc.id}" title="${spotlightTitle}"><i class="fa-solid fa-star" aria-hidden="true"></i> Spotlight it</button>`;
        return `<div class="am-alert" role="group" aria-label="Warning for ${title}">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <p>No ${words.beat} in ${formatNumber(messagesSince)} messages — about one is due every ${formatNumber(perBeat)}.${spotlitNote}</p>
            <div class="am-alert-actions">
                <button type="button" class="menu_button" data-act="replan" data-id="${arc.id}" title="Re-plan the rest of this arc from where the story is now"><i class="fa-solid fa-route" aria-hidden="true"></i> Re-plan</button>
                ${spotlightButton}
                <button type="button" class="menu_button am-quiet" data-act="ignore" data-id="${arc.id}" title="Hide this warning until the next ${words.beat} lands or the arc is re-planned">Ignore</button>
            </div></div>`;
    }
    return '';
}

/**
 * What the narrator gets from an active arc, by tier and focus, as the
 * prompt sections build it (injection/builder.js): one sentence after
 * "The narrator gets:".
 * @param {object} arc
 * @param {object[]} activeArcs - To tell whether an episode is the pacing clock
 * @returns {string} HTML string
 */
export function describeWhatNarratorGets(arc, activeArcs) {
    const words = beatWords(arc);
    const standingCount = (arc.beats || []).filter(beat => beat.status !== 'completed').length;
    if (arc.focus === 'paused') {
        return `one line saying the arc exists and is set aside. Its ${words.beats} are not checked and its clock stands still.`;
    }
    if (arc.focus === 'background') {
        return `its <strong>title only</strong>, with orders to keep it off-screen unless your character goes to it or brings it up. Its ${words.beats} still land when you play the thread.`;
    }
    const lists = describePlanLists(arc);
    if (arcTier(arc) === 'episode') {
        const hasActiveBeat = (arc.beats || []).some(beat => beat.status === 'active');
        const lead = hasActiveBeat
            ? 'its premise and <strong>the current scene beat\'s pressure</strong>'
            : 'its premise and <strong>a linger note</strong> (no scene beat is active)';
        const clock = selectPacingClock(activeArcs)?.id === arc.id ? ' It is the pacing clock, so the phase brake counts its messages.' : '';
        return `${lead}, with pacing rules${lists ? `, plus ${lists}` : ''}.${clock}`;
    }
    if (arc.focus === 'spotlight') {
        return `its premise and <strong>${plural(standingCount, 'pressure')} to bring to a head</strong>${lists ? `, plus ${lists}` : ''}. No ${words.beat} is named as a target.`;
    }
    return `its premise and <strong>${plural(standingCount, 'standing pressure')}</strong>, as mood. No secrets, triggers or clues.`;
}

/** "2 secrets as its phase allows, 1 trigger and 3 clues to plant", '' when all are done */
function describePlanLists(arc) {
    const secretCount = (arc.secrets || []).filter(secret => !secret.disclosed).length;
    const triggerCount = (arc.triggers || []).filter(trigger => !trigger.fired).length;
    const clueCount = (arc.foreshadowing || []).filter(clue => !clue.planted).length;
    const parts = [];
    if (secretCount) parts.push(`${plural(secretCount, 'secret')} as its phase allows`);
    if (triggerCount) parts.push(plural(triggerCount, 'trigger'));
    if (clueCount) parts.push(`${plural(clueCount, 'clue')} to plant`);
    if (!parts.length) return '';
    const last = parts.pop();
    return parts.length ? `${parts.join(', ')} and ${last}` : last;
}

/**
 * The past arcs table: each with how it ended, its read-only strip, its
 * last beat and Reactivate.
 * @param {object[]} pastArcs
 * @param {{ expanded: Set<string>, revealed: Set<string> }} view
 * @returns {string} HTML string
 */
function buildPastTable(pastArcs, view) {
    if (!pastArcs.length) return '<p class="am-hint am-past-none">No completed or abandoned arcs yet.</p>';
    const newestFirst = [...pastArcs].sort((first, second) => (Date.parse(second.createdAt) || 0) - (Date.parse(first.createdAt) || 0));
    return `<table class="am-table" aria-label="Past arcs">
        <thead><tr><th scope="col">Arc</th><th scope="col" class="c-tier">Tier</th><th scope="col" class="c-phase">Ended</th>
        <th scope="col">Beats</th><th scope="col" class="c-last">Last beat landed</th><th scope="col" class="c-menu"><span class="sr">Actions</span></th></tr></thead>
        ${newestFirst.map(arc => buildPastArc(arc, view)).join('')}</table>`;
}

/**
 * One past arc's row and its detail row.
 * @param {object} arc
 * @param {{ expanded: Set<string>, revealed: Set<string> }} view
 * @returns {string} HTML string
 */
export function buildPastArc(arc, view) {
    const isExpanded = view.expanded.has(arc.id);
    const ended = arc.status === 'completed'
        ? '<span class="am-ended"><i class="fa-solid fa-check" aria-hidden="true"></i>Completed</span>'
        : '<span class="am-ended"><i class="fa-solid fa-xmark" aria-hidden="true"></i>Abandoned</span>';
    const lastBeat = hasLandedBeat(arc)
        ? `#${formatNumber(arc.lastFulfilledAt)}<span class="am-cell-sub">${messagesAgo(arc.lastFulfilledAt)}</span>`
        : `None<span class="am-cell-sub">started at #${formatNumber(arcMessageStart(arc))}</span>`;
    const plannedOn = arc.createdAt ? `planned ${new Date(arc.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ` : '';
    const subline = `<span class="am-arc-sub">${plannedOn}from #${formatNumber(arcMessageStart(arc))}</span>`;
    const context = { activeArcs: [], pendingMarks: [], view };
    return `<tbody class="am-arc ${isExpanded ? 'is-open' : ''}" id="am-arc-${arc.id}" data-id="${arc.id}">
    <tr class="am-row">
        <td class="c-arc">${buildExpandButton(arc, isExpanded, subline)}</td>
        <td class="c-tier">${TIER_TABLE[arcTier(arc)].label}</td>
        <td class="c-phase">${ended}</td>
        <td class="c-beats">${buildBeatStrip(arc, [], false)}</td>
        <td class="c-last">${lastBeat}</td>
        <td class="c-menu c-reactivate"><button type="button" class="menu_button" data-act="reactivate" data-id="${arc.id}"
            title="Back into the prompt in normal focus, with its beats as they stand; the phase and stall counts restart">
            <i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Reactivate</button></td>
    </tr>
    <tr class="am-detail-row" id="am-detail-${arc.id}" ${isExpanded ? '' : 'hidden'}><td colspan="6">${isExpanded ? buildArcDetail(arc, context) : ''}</td></tr>
    </tbody>`;
}

/**
 * The expanded detail of an arc: what the narrator gets (active arcs), the
 * Reveal switch, the beats with their status control, the title and premise
 * editor, and behind the switch the secrets, clues and triggers and the
 * JSON editor (hidden until opened from the menu). Everything that shows
 * plan text carries `am-plan-only`, so the switch hides it by CSS.
 * @param {object} arc
 * @param {{ activeArcs: object[], pendingMarks: object[], view: { revealed: Set<string> } }} context
 * @returns {string} HTML string
 */
export function buildArcDetail(arc, context) {
    const isReadOnly = arc.status !== 'active';
    const words = beatWords(arc);
    const isRevealed = context.view.revealed.has(arc.id);
    const counts = `${plural((arc.secrets || []).length, 'secret')}, ${plural((arc.foreshadowing || []).length, 'clue')} and ${plural((arc.triggers || []).length, 'trigger')}`;
    const gets = isReadOnly
        ? ''
        : `<p class="am-gets" data-gets="${arc.id}"><span class="lead">The narrator gets:</span> ${describeWhatNarratorGets(arc, context.activeArcs)}</p>`;
    const statusNote = isReadOnly ? '' : `<p class="am-inline-msg" data-beats-msg="${arc.id}" role="status"></p>`;
    const cacheNote = isReadOnly ? '' : '; each toggle costs one prompt-cache miss';
    const jsonSection = isReadOnly ? '' : `<section class="am-sec am-sec-wide am-plan-only" data-json-sec="${arc.id}" hidden aria-labelledby="am-jh-${arc.id}">
                <h3 id="am-jh-${arc.id}">Edit as JSON</h3>
                <form class="am-form" data-json-form="${arc.id}">
                    <p class="am-hint">id, status, tier, focus, the message counters and your rulings are kept as stored, whatever you write here.</p>
                    <label for="am-json-${arc.id}" class="sr">Arc JSON</label>
                    <textarea class="text_pole am-json" id="am-json-${arc.id}" rows="18" spellcheck="false"></textarea>
                    <div class="am-actions">
                        <button type="submit" class="menu_button"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save</button>
                        <button type="button" class="menu_button" data-act="json-cancel" data-id="${arc.id}">Cancel</button>
                        <span class="am-inline-msg" role="status"></span>
                    </div>
                </form>
            </section>`;

    return `<div class="am-detail ${isRevealed ? 'is-revealed' : ''}" data-detail="${arc.id}">
        ${gets}
        <div class="am-detail-bar">
            <label class="am-switch"><input type="checkbox" role="switch" data-reveal="${arc.id}" ${isRevealed ? 'checked' : ''}>
                <span class="am-switch-track" aria-hidden="true"></span>Reveal plan <span class="am-switch-state">${isRevealed ? 'shown' : 'hidden'}</span></label>
            <p class="am-hint am-hidden-only">Spoilers. The premise, every pressure and fulfillment, ${counts} stay hidden until you switch this on.</p>
            <p class="am-hint am-plan-only">The plan of this arc is shown. It is hidden again when the Arc Manager closes.</p>
        </div>
        <div class="am-detail-grid">
            <section class="am-sec" aria-labelledby="am-bh-${arc.id}">
                <h3 id="am-bh-${arc.id}">${words.Beats} <span class="muted">· ${words.note}</span></h3>
                <ol class="am-beats" data-beats="${arc.id}">${(arc.beats || []).map((beat, index) => buildBeatItem(arc, beat, index, isReadOnly)).join('')}</ol>
                ${statusNote}
            </section>
            <section class="am-sec" aria-labelledby="am-ph-${arc.id}">
                <h3 id="am-ph-${arc.id}">Title and premise</h3>
                ${isReadOnly ? buildTitleAndPremiseText(arc) : buildTitleAndPremiseForm(arc)}
            </section>
            <section class="am-sec am-sec-wide am-plan-only" aria-labelledby="am-sh-${arc.id}">
                <h3 id="am-sh-${arc.id}">Secrets, clues and triggers <span class="muted">· done items leave the prompt${cacheNote}</span></h3>
                <div class="am-plan-lists" data-plan-lists="${arc.id}">${Object.keys(PLAN_ITEM_LISTS).map(list => buildPlanList(arc, list, context.pendingMarks, isReadOnly)).join('')}</div>
            </section>
            ${jsonSection}
        </div>
    </div>`;
}

/**
 * The beat's status as a segmented control: pending, active and done for a
 * scene beat, open and done for a milestone; disabled while locked.
 * @returns {string} HTML string
 */
function buildBeatStatusControl(arc, beat, index) {
    const statuses = arcTier(arc) === 'episode' ? ['pending', 'active', 'completed'] : ['active', 'completed'];
    const isLocked = beat.status === 'locked';
    const options = statuses.map(status => `<label class="am-seg-opt"><input type="radio" name="am-bs-${arc.id}-${escapeHtml(beat.id)}" value="${status}" data-beat-status="${arc.id}" data-beat="${escapeHtml(beat.id)}" ${beat.status === status ? 'checked' : ''} ${isLocked ? 'disabled' : ''}>${beatStatusWord(arc, status)}</label>`).join('');
    return `<fieldset class="am-seg" ${isLocked ? 'title="Locked: waits for an earlier scene beat"' : ''}><legend class="sr">Status of ${beatWords(arc).beat} ${index + 1}</legend>${options}</fieldset>`;
}

/** The line after a beat's name: its phase, optional, done by hand, waiting for an earlier beat */
function describeBeat(beat) {
    const parts = [ARC_PHASES[beat.phase]?.label || beat.phase || 'no phase'];
    if (beat.optional) parts.push('optional');
    if (beat.status === 'locked') parts.push('waits for an earlier scene beat');
    return parts.join(' · ');
}

/**
 * One beat of the detail: name, phase, status control, the edit and delete
 * buttons (plan shown only), and its pressure and fulfillment (plan shown
 * only).
 * @returns {string} HTML string
 */
function buildBeatItem(arc, beat, index, isReadOnly) {
    const words = beatWords(arc);
    const control = isReadOnly
        ? `<span class="am-beat-meta am-beat-state">${beatStatusWord(arc, beat.status)}</span>`
        : buildBeatStatusControl(arc, beat, index);
    const tools = isReadOnly ? '' : `<span class="am-beat-tools am-plan-only">
            <button type="button" class="menu_button am-icon-btn" data-act="beat-edit" data-id="${arc.id}" data-beat="${escapeHtml(beat.id)}" aria-label="Edit ${words.beat} ${index + 1}" title="Edit pressure and fulfillment"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
            <button type="button" class="menu_button am-icon-btn" data-act="beat-delete" data-id="${arc.id}" data-beat="${escapeHtml(beat.id)}" aria-label="Delete ${words.beat} ${index + 1}" title="Delete this ${words.beat} (undo while the Arc Manager is open)"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
        </span>`;
    return `<li class="am-beat" data-beat-li="${escapeHtml(beat.id)}">
        <div class="am-beat-row">
            <span class="am-beat-name">${words.Beat} ${index + 1}</span>
            <span class="am-beat-meta">${describeBeat(beat)}</span>
            ${control}${tools}
        </div>
        <dl class="am-beat-text am-plan-only">
            <div><dt>Pressure</dt><dd data-f="pressure">${escapeHtml(beat.pressure || '')}</dd></div>
            <div><dt>Fulfilled when</dt><dd data-f="intention">${escapeHtml(beat.intention || '')}</dd></div>
        </dl>
    </li>`;
}

/**
 * The inline editor of one beat's pressure and fulfillment.
 * @returns {string} HTML string
 */
export function buildBeatEditor(arc, beat) {
    const key = `${arc.id}-${beat.id}`;
    const words = beatWords(arc);
    return `<form class="am-form am-beat-editor am-plan-only" data-beat-form="${arc.id}" data-beat="${escapeHtml(beat.id)}">
        <label for="am-bp-${escapeHtml(key)}">Pressure <span class="muted">· with the knowledge tracker on, the only part the narrator sees</span></label>
        <textarea class="text_pole" id="am-bp-${escapeHtml(key)}" name="pressure" rows="2">${escapeHtml(beat.pressure || '')}</textarea>
        <label for="am-bi-${escapeHtml(key)}">Fulfilled when <span class="muted">· one on-screen moment, past tense</span></label>
        <textarea class="text_pole" id="am-bi-${escapeHtml(key)}" name="intention" rows="2">${escapeHtml(beat.intention || '')}</textarea>
        <div class="am-actions">
            <button type="submit" class="menu_button"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save ${words.beat}</button>
            <button type="button" class="menu_button" data-act="beat-cancel">Cancel</button>
            <span class="am-inline-msg" role="status"></span>
        </div>
    </form>`;
}

/**
 * The title and premise editor of an active arc. The title is no spoiler and
 * shows always; the premise only with the plan shown. Save and Revert stay
 * disabled until something was typed.
 * @param {object} arc
 * @returns {string} HTML string
 */
export function buildTitleAndPremiseForm(arc) {
    return `<form class="am-form" data-pitch="${arc.id}">
        <label for="am-pt-${arc.id}">Title</label>
        <input type="text" class="text_pole" id="am-pt-${arc.id}" name="title" value="${escapeHtml(arc.title)}" autocomplete="off">
        <div class="am-plan-only am-form">
            <label for="am-pp-${arc.id}">Premise</label>
            <textarea class="text_pole" id="am-pp-${arc.id}" name="premise" rows="4">${escapeHtml(arc.premise || '')}</textarea>
        </div>
        <p class="am-hint am-hidden-only">The premise is part of the plan: reveal the plan to read or edit it.</p>
        <div class="am-actions">
            <button type="submit" class="menu_button" disabled><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save</button>
            <button type="button" class="menu_button" data-act="pitch-revert" data-id="${arc.id}" disabled>Revert</button>
            <span class="am-inline-msg" role="status"></span>
        </div>
    </form>`;
}

function buildTitleAndPremiseText(arc) {
    return `<p class="am-pitch-title"><b>${escapeHtml(arc.title)}</b></p>
        <p class="am-plan-only am-pitch-premise">${escapeHtml(arc.premise || '')}</p>
        <p class="am-hint am-hidden-only">The premise is part of the plan: reveal the plan to read it.</p>`;
}

/**
 * One plan list (secrets, clues or triggers) with a checkbox per item.
 * Items the narrator reported and whose mark waits in the queue (ADR-0005)
 * come first, each with when it was reported and Drop report; then the
 * open ones, then the done ones.
 * @param {object} arc
 * @param {'secrets'|'foreshadowing'|'triggers'} list
 * @param {object[]} pendingMarks - The chat's queued marks, all arcs
 * @param {boolean} isReadOnly - A past arc: no toggles, no reports
 * @returns {string} HTML string
 */
export function buildPlanList(arc, list, pendingMarks, isReadOnly) {
    const config = PLAN_ITEM_LISTS[list];
    const items = arc[list] || [];
    const doneCount = items.filter(item => item[config.flag]).length;
    const listMarks = isReadOnly ? [] : waitingMarksOf(arc, pendingMarks).filter(mark => mark.list === list);
    const markOf = itemId => listMarks.find(mark => mark.id === itemId);
    const rankOf = item => {
        if (item[config.flag]) return 2;
        if (markOf(item.id)) return 0;
        return 1;
    };
    const sortedItems = [...items].sort((first, second) => rankOf(first) - rankOf(second));

    let body = '<p class="am-hint">None in this plan.</p>';
    if (items.length) {
        body = `<ul>${sortedItems.map(item => {
            const mark = markOf(item.id);
            const waitingLine = mark
                ? `<p class="am-waiting"><span><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>Reported as ${config.doneWord} at #${formatNumber(mark.at)}, waiting to be applied</span>
                <button type="button" class="am-link-btn" data-act="drop-report" data-id="${arc.id}" data-list="${list}" data-item="${escapeHtml(item.id)}">Drop report</button></p>`
                : '';
            return `<li><label class="am-check"><input type="checkbox" data-plan="${arc.id}" data-list="${list}" data-item="${escapeHtml(item.id)}" ${item[config.flag] ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''}>
            <span class="am-check-text">${escapeHtml(config.text(item))}</span></label>${waitingLine}</li>`;
        }).join('')}</ul>`;
    }
    const waitingNote = listMarks.length ? ` · ${listMarks.length} waiting` : '';
    return `<div class="am-plan-list" data-plan-list="${arc.id}:${list}">
        <h4>${config.label} <span class="muted">· ${doneCount} of ${items.length} ${config.doneWord}${waitingNote}</span></h4>${body}</div>`;
}

// ─── Patching the open popup ────────────────────────────────────────────────

/** The popup's root element, or null when it is not open */
function managerRoot() {
    return document.getElementById('story-arc-manager');
}

function contextOfSession() {
    const activeArcs = session.activeOrder.map(id => getArcById(id)).filter(arc => arc?.status === 'active');
    return { activeArcs, pendingMarks: pendingMarksOfChat(), view: viewOfSession() };
}

/** Rewrite the head summary, the past count and the undo button */
function refreshFrame() {
    const root = managerRoot();
    if (!root) return;
    const context = contextOfSession();
    root.querySelector('#am-summary').innerHTML = buildSummary(context.activeArcs);
    root.querySelector('#am-plan-new').hidden = !context.activeArcs.length;
    root.querySelector('#am-past-count').textContent = buildPastCount(getArcs().filter(arc => arc.status !== 'active'));
    renderUndoButton();
}

/**
 * Patch one arc in place after a change: the row's cells, the warning line
 * and the parts of an open detail a change touches. Editors and their typed
 * text stay; focus stays where it was or moves to the arc's title.
 * @param {string} arcId
 */
function patchArc(arcId) {
    const root = managerRoot();
    const arc = getArcById(arcId);
    const body = root?.querySelector(`#am-arc-${CSS.escape(arcId)}`);
    if (!arc || !body) return;
    const context = contextOfSession();
    const row = body.querySelector('.am-row');
    row.querySelector('.am-title').textContent = arc.title;
    if (arc.status !== 'active') {
        row.querySelector('.c-beats').innerHTML = buildBeatStrip(arc, [], false);
        return;
    }

    row.querySelector('[data-act="menu"]').setAttribute('aria-label', `More actions for ${arc.title}`);
    row.querySelector('legend').textContent = `Focus of ${arc.title}`;
    row.querySelector('.c-phase').innerHTML = buildPhaseCell(arc);
    const focusedBeat = row.querySelector('.c-beats').contains(document.activeElement) ? document.activeElement.dataset.beat : null;
    row.querySelector('.c-beats').innerHTML = buildBeatStrip(arc, context.pendingMarks, true);
    if (focusedBeat) row.querySelector(`.am-cell[data-beat="${CSS.escape(focusedBeat)}"]`)?.focus();
    const hadLastFocus = row.querySelector('.c-last').contains(document.activeElement);
    row.querySelector('.c-last').innerHTML = buildLastBeatCell(arc);
    if (hadLastFocus) row.querySelector('.am-expand').focus();
    const focusInput = row.querySelector(`input[data-focus][value="${arc.focus}"]`);
    if (focusInput) focusInput.checked = true;

    const alertRow = body.querySelector('.am-alert-row');
    const alert = buildArcAlert(arc);
    const wasShown = !alertRow.hidden;
    const hadAlertFocus = alertRow.contains(document.activeElement);
    alertRow.hidden = !alert;
    alertRow.classList.toggle('is-new', !!alert && !wasShown);
    alertRow.firstElementChild.innerHTML = alert;
    if (hadAlertFocus && !alert) row.querySelector('.am-expand').focus();

    patchDetail(arc, context);
}

/** Patch the parts of an open detail a status change touches; editors and typed text stay. */
function patchDetail(arc, context) {
    const detail = managerRoot()?.querySelector(`[data-detail="${CSS.escape(arc.id)}"]`);
    if (!detail) return;
    const gets = detail.querySelector('[data-gets]');
    if (gets) gets.innerHTML = `<span class="lead">The narrator gets:</span> ${describeWhatNarratorGets(arc, context.activeArcs)}`;
    for (const beat of arc.beats || []) {
        const item = detail.querySelector(`[data-beat-li="${CSS.escape(beat.id)}"]`);
        if (!item) continue;
        for (const input of item.querySelectorAll('input[data-beat-status]')) {
            input.checked = input.value === beat.status;
            input.disabled = beat.status === 'locked';
        }
        item.querySelector('.am-beat-meta').textContent = describeBeat(beat);
    }
    const lists = detail.querySelector('[data-plan-lists]');
    if (lists && !lists.contains(document.activeElement)) {
        lists.innerHTML = Object.keys(PLAN_ITEM_LISTS).map(list => buildPlanList(arc, list, context.pendingMarks, false)).join('');
    }
}

/**
 * Rebuild an arc's whole tbody in the table its status belongs to: after
 * complete, abandon, reactivate, and an undo. The arc keeps its place in
 * the active order; expanded and revealed stay as they were.
 * @param {string} arcId
 */
function placeArc(arcId) {
    const root = managerRoot();
    const arc = getArcById(arcId);
    if (!root || !arc) return;
    root.querySelector(`#am-arc-${CSS.escape(arcId)}`)?.remove();

    if (arc.status === 'active' && !session.activeOrder.includes(arcId)) {
        const sorted = sortActiveArcs([...session.activeOrder.map(id => getArcById(id)).filter(Boolean), arc]);
        session.activeOrder.splice(sorted.findIndex(candidate => candidate.id === arcId), 0, arcId);
    }
    if (arc.status !== 'active') {
        session.activeOrder = session.activeOrder.filter(id => id !== arcId);
    }

    const context = contextOfSession();
    const allArcs = getArcs();
    const activeTable = root.querySelector('#am-active table');
    if (arc.status === 'active' && activeTable) {
        const holder = document.createElement('table');
        holder.innerHTML = buildActiveArc(arc, context);
        const nextId = session.activeOrder.slice(session.activeOrder.indexOf(arcId) + 1).find(id => root.querySelector(`#am-arc-${CSS.escape(id)}`));
        const nextBody = nextId ? root.querySelector(`#am-arc-${CSS.escape(nextId)}`) : null;
        activeTable.insertBefore(holder.firstElementChild, nextBody);
    } else if (arc.status === 'active' || !context.activeArcs.length) {
        root.querySelector('#am-active').innerHTML = buildActiveTable(context.activeArcs, allArcs, context.pendingMarks, context.view);
    }
    root.querySelector('#am-past-wrap').innerHTML = buildPastTable(allArcs.filter(candidate => candidate.status !== 'active'), context.view);
    for (const otherId of session.activeOrder) {
        if (otherId !== arcId) patchArc(otherId);
    }
    refreshFrame();
}

function setExpanded(arcId, isOpen) {
    const root = managerRoot();
    const body = root?.querySelector(`#am-arc-${CSS.escape(arcId)}`);
    const arc = getArcById(arcId);
    if (!body || !arc) return;
    const detailRow = body.querySelector('.am-detail-row');
    if (isOpen) session.expanded.add(arcId); else session.expanded.delete(arcId);
    if (isOpen && !detailRow.firstElementChild.firstElementChild) {
        detailRow.firstElementChild.innerHTML = buildArcDetail(arc, contextOfSession());
    }
    detailRow.hidden = !isOpen;
    body.classList.toggle('is-open', isOpen);
    body.querySelector('.am-expand').setAttribute('aria-expanded', String(isOpen));
}

function setRevealed(arcId, isOn) {
    if (isOn) session.revealed.add(arcId); else session.revealed.delete(arcId);
    const detail = managerRoot()?.querySelector(`[data-detail="${CSS.escape(arcId)}"]`);
    if (!detail) return;
    detail.classList.toggle('is-revealed', isOn);
    detail.querySelector('[data-reveal]').checked = isOn;
    detail.querySelector('.am-switch-state').textContent = isOn ? 'shown' : 'hidden';
    if (!isOn) {
        detail.querySelectorAll('.am-beat-editor').forEach(form => form.remove());
        const jsonSection = detail.querySelector('[data-json-sec]');
        if (jsonSection) jsonSection.hidden = true;
    }
}

/** Rebuild an open detail from the stored arc: after a JSON save or an undo that changed plan text */
function rebuildDetail(arcId) {
    const detailCell = managerRoot()?.querySelector(`#am-detail-${CSS.escape(arcId)} > td`);
    const arc = getArcById(arcId);
    if (detailCell?.firstElementChild && arc) detailCell.innerHTML = buildArcDetail(arc, contextOfSession());
}

// ─── Status strip and undo button ───────────────────────────────────────────

/**
 * The status strip's message: what was saved, with Undo when the message
 * reports a change, or why something was refused. A timer line runs out
 * over `seconds`, paused while hovered.
 * @param {string} message - HTML
 * @param {{ withUndo?: boolean, icon?: string, seconds?: number, isError?: boolean }} [options]
 * @returns {string} HTML string
 */
export function buildStatusStrip(message, { withUndo = false, icon = 'fa-check', seconds, isError = false } = {}) {
    const duration = seconds ?? (withUndo ? 8 : 4);
    const undoButton = withUndo ? '<button type="button" class="menu_button" data-act="undo"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Undo</button>' : '';
    return `<div class="am-toast ${isError ? 'is-error' : ''}" ${isError ? 'role="alert"' : ''}>
        <i class="fa-solid ${icon}" aria-hidden="true"></i>
        <span class="am-toast-msg">${message}</span>
        ${undoButton}
        <button type="button" class="menu_button am-icon-btn am-quiet" data-act="dismiss" aria-label="Dismiss" title="Dismiss"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        <span class="am-toast-timer" style="animation-duration:${duration}s"></span>
    </div>`;
}

/** Show a message in the status strip (buildStatusStrip); it goes when its timer runs out */
function showStatus(message, options = {}) {
    const live = managerRoot()?.querySelector('#am-live');
    if (!live) return;
    live.innerHTML = buildStatusStrip(message, options);
    live.querySelector('.am-toast-timer').addEventListener('animationend', dismissStatus, { once: true });
    renderUndoButton();
}

function dismissStatus() {
    const root = managerRoot();
    const live = root?.querySelector('#am-live');
    if (!live) return;
    const hadFocus = live.contains(document.activeElement);
    live.innerHTML = '';
    renderUndoButton();
    if (hadFocus) (root.querySelector('#am-undo-slot button') || root.querySelector('#am-title')).focus();
}

/** The footer's undo button for the newest edit, while the status strip offers no Undo of its own */
function renderUndoButton() {
    const root = managerRoot();
    const slot = root?.querySelector('#am-undo-slot');
    if (!slot) return;
    const label = newestArcEditLabel();
    const stripHasUndo = !!root.querySelector('#am-live [data-act="undo"]');
    slot.innerHTML = label && !stripHasUndo
        ? `<button type="button" class="menu_button am-undo-btn" data-act="undo" title="Undo the last change of this session (${arcUndo.size()} in all)">
            <i class="fa-solid fa-rotate-left" aria-hidden="true"></i><span>Undo: ${escapeHtml(label)}</span></button>`
        : '';
}

/**
 * Save one change through `edit`, record it for undo, patch the popup and
 * report it with Undo.
 * @param {string} label - Plain text, for the undo button
 * @param {() => Promise<void>} edit
 * @param {() => string} describe - The status message, HTML, built after the edit
 * @param {{ icon?: string, seconds?: number, patch?: () => void }} [options]
 */
async function commitEdit(label, edit, describe, options = {}) {
    await runArcEdit(label, edit);
    updateProgress();
    if (options.patch) options.patch();
    refreshFrame();
    showStatus(describe(), { withUndo: true, icon: options.icon, seconds: options.seconds });
}

/** Undo the newest edit and put the popup in line with the restored arcs */
async function undoInPopup() {
    const before = new Map(getArcs().map(arc => [arc.id, JSON.stringify(arc)]));
    const { error, label } = await undoArcEdit();
    if (error) {
        const what = label ? `Can't undo “${escapeHtml(label)}”: ` : '';
        renderUndoButton();
        showStatus(`${what}${escapeHtml(error)}`, { icon: 'fa-triangle-exclamation', isError: true, seconds: 9 });
        return;
    }
    for (const arc of getArcs()) {
        if (before.get(arc.id) === JSON.stringify(arc)) continue;
        placeArc(arc.id);
        rebuildDetail(arc.id);
    }
    refreshFrame();
    showStatus(`Undone: ${escapeHtml(label || 'the last change')}.`, { icon: 'fa-rotate-left', seconds: 4 });
}

// ─── Actions ────────────────────────────────────────────────────────────────

const boldTitle = arc => `<b>${escapeHtml(arc.title)}</b>`;

async function changeFocus(arcId, focus) {
    const arc = getArcById(arcId);
    if (!arc) return;
    const wasFocus = arc.focus;
    const previousSpotlit = focus === 'spotlight'
        ? getArcs().find(candidate => candidate.status === 'active' && candidate.focus === 'spotlight' && candidate.id !== arcId)
        : null;
    const labels = { paused: 'Paused', background: 'Background', normal: 'Normal focus', spotlight: 'Spotlight' };

    await commitEdit(`${labels[focus]}: ${arc.title}`, async () => {
        if (focus === 'paused') {
            await pauseArc(arcId);
        } else if (focus === 'spotlight') {
            // Only one arc in the spotlight: the previous one goes back to normal
            await spotlightArc(arcId);
        } else {
            await resumeArc(arcId, focus);
        }
    }, () => {
        const stored = getArcById(arcId);
        let message = `${boldTitle(stored)} back to normal focus.`;
        if (focus === 'paused') message = `${boldTitle(stored)} paused.`;
        if (focus === 'background') message = `${boldTitle(stored)} goes on off-screen.`;
        if (focus === 'normal' && wasFocus === 'paused') message = `${boldTitle(stored)} resumed in normal focus; its clock runs again.`;
        if (focus === 'spotlight') {
            message = previousSpotlit
                ? `${boldTitle(stored)} is in the spotlight; ${boldTitle(previousSpotlit)} went back to normal.`
                : `${boldTitle(stored)} is in the spotlight.`;
        }
        const gets = describeWhatNarratorGets(stored, contextOfSession().activeArcs).replace(/<\/?strong>/g, '');
        return `${message} The narrator now gets ${gets}`;
    }, {
        seconds: 9,
        patch: () => {
            // Every row: the spotlight and the pacing clock may have moved
            for (const id of session.activeOrder) patchArc(id);
        },
    });
}

async function endArc(arcId, status) {
    const arc = getArcById(arcId);
    if (!arc) return;
    const root = managerRoot();
    const body = root.querySelector(`#am-arc-${CSS.escape(arcId)}`);
    const nextFocus = body?.nextElementSibling?.querySelector('.am-expand') || body?.previousElementSibling?.querySelector?.('.am-expand') || root.querySelector('#am-past > summary');
    const isCompleted = status === 'completed';
    session.expanded.delete(arcId);

    await commitEdit(`${isCompleted ? 'Completed' : 'Abandoned'} ${arc.title}`, async () => {
        await updateArc(arcId, { status });
    }, () => (isCompleted
        ? `${boldTitle(arc)} completed. It left the prompt and its beats are no longer checked.`
        : `${boldTitle(arc)} abandoned. It left the prompt unfinished; Reactivate under Past arcs brings it back.`), {
        icon: isCompleted ? 'fa-check' : 'fa-box-archive',
        seconds: 10,
        patch: () => placeArc(arcId),
    });
    (root.querySelector('#am-active .am-expand') ? nextFocus : root.querySelector('#am-active [data-act="plan-new"]'))?.focus();
}

async function reactivate(arcId) {
    const arc = getArcById(arcId);
    if (!arc) return;
    await commitEdit(`Reactivated ${arc.title}`, () => reactivateArc(arcId),
        () => `${boldTitle(arc)} is active again, in normal focus, with its beats as they stand. Its phase and stall counts restart at #${formatNumber(arcMessageStart(getArcById(arcId)))}.`,
        { icon: 'fa-rotate-left', patch: () => placeArc(arcId) });
    managerRoot()?.querySelector(`#am-arc-${CSS.escape(arcId)} .am-expand`)?.focus();
}

async function changeBeatStatus(arcId, beatId, status) {
    const arc = getArcById(arcId);
    const index = arc?.beats.findIndex(beat => beat.id === beatId) ?? -1;
    if (index < 0) return;
    const words = beatWords(arc);
    const wasWarned = isStallNudgeShown(arc, chat.length);
    const statusWord = beatStatusWord(arc, status).toLowerCase();

    await commitEdit(`${words.Beat} ${index + 1} of ${arc.title} set to ${statusWord}`, () => setBeatStatusByHand(arcId, beatId, status), () => {
        const stored = getArcById(arcId);
        let extra = '';
        if (status === 'completed') {
            extra = wasWarned ? ' The stall count restarts here; the warning is gone.' : ` It counts as landed at #${formatNumber(stored.lastFulfilledAt)}.`;
            if (areAllRequiredBeatsDone(stored)) extra += ` That was the last open ${words.beat}.`;
        }
        return `${words.Beat} ${index + 1} of ${boldTitle(stored)} set to ${statusWord}.${extra}`;
    }, { seconds: 8, patch: () => patchArc(arcId) });
}

async function ignoreStallOf(arcId) {
    const arc = getArcById(arcId);
    if (!arc) return;
    await commitEdit(`Ignored the stall of ${arc.title}`, () => ignoreStall(arcId),
        () => `Stall warning of ${boldTitle(arc)} hidden until the next ${beatWords(arc).beat} lands or you re-plan.`,
        { icon: 'fa-eye-slash', patch: () => patchArc(arcId) });
    managerRoot()?.querySelector(`#am-arc-${CSS.escape(arcId)} .c-last .am-link-btn`)?.focus();
}

async function showStallOf(arcId) {
    const arc = getArcById(arcId);
    if (!arc) return;
    await commitEdit(`Showed the stall of ${arc.title} again`, () => showIgnoredStall(arcId),
        () => `Stall warning of ${boldTitle(arc)} shown again.`,
        { icon: 'fa-eye', patch: () => patchArc(arcId) });
    managerRoot()?.querySelector(`#am-arc-${CSS.escape(arcId)} .am-alert-row .menu_button`)?.focus();
}

async function deleteBeat(arcId, beatId) {
    const arc = getArcById(arcId);
    const root = managerRoot();
    if (!arc || !root) return;
    const words = beatWords(arc);
    const message = root.querySelector(`[data-beats-msg="${CSS.escape(arcId)}"]`);
    // An arc without beats has nothing to drive it and can never complete.
    if (arc.beats.length === 1) {
        message.textContent = `An arc needs at least one ${words.beat}. Abandon the arc instead.`;
        message.classList.add('is-error');
        return;
    }
    const index = arc.beats.findIndex(beat => beat.id === beatId);
    let isNowCompleted = false;

    await commitEdit(`Deleted ${words.beat} ${index + 1} of ${arc.title}`, async () => {
        const beats = removeBeat(arc.beats, beatId);
        // Same rule as recognition: no open non-optional beat left means the arc is done.
        const openBeats = selectNonOptionalBeats(beats).filter(beat => beat.status !== 'completed');
        isNowCompleted = openBeats.length === 0;
        await updateArc(arcId, { beats, status: isNowCompleted ? 'completed' : arc.status });
    }, () => {
        const completedNote = isNowCompleted ? ' No open one is left, so the arc is completed.' : '';
        return `${words.Beat} ${index + 1} deleted from ${boldTitle(arc)}; it left the plan and the prompt.${completedNote}`;
    }, {
        icon: 'fa-trash',
        patch: () => {
            if (isNowCompleted) {
                placeArc(arcId);
                return;
            }
            const list = root.querySelector(`[data-beats="${CSS.escape(arcId)}"]`);
            const stored = getArcById(arcId);
            list.innerHTML = stored.beats.map((beat, position) => buildBeatItem(stored, beat, position, false)).join('');
            patchArc(arcId);
            list.querySelector(`.am-beat:nth-child(${Math.min(index + 1, stored.beats.length)}) [data-act="beat-delete"]`)?.focus();
        },
    });
}

async function togglePlanItemOf(arcId, list, itemId) {
    const arc = getArcById(arcId);
    const config = PLAN_ITEM_LISTS[list];
    const index = arc?.[list]?.findIndex(item => item.id === itemId) ?? -1;
    if (index < 0) return;
    const isDone = !arc[list][index][config.flag];
    const hadMark = waitingMarksOf(arc, pendingMarksOfChat()).some(mark => mark.list === list && mark.id === itemId);

    await commitEdit(`${config.one} ${index + 1} of ${arc.title} ${isDone ? config.doneWord : 'open'}`, async () => {
        // A queued model mark for this item would undo the hand toggle on
        // flush. Dropped first so updateArc's save covers it.
        dropPendingMark(arcId, list, itemId);
        await updateArc(arcId, { [list]: togglePlanItem(arc[list], itemId, config.flag) });
    }, () => {
        const effect = isDone ? '; it leaves the prompt' : '; it is back in the prompt';
        const markNote = hadMark ? ', and the waiting report is used up' : '';
        return `${config.one} ${index + 1} of ${boldTitle(arc)} marked ${isDone ? config.doneWord : 'open'}${effect}${markNote}.`;
    }, { seconds: 6, patch: () => patchPlanList(arcId, list, itemId) });
}

async function dropReport(arcId, list, itemId) {
    const arc = getArcById(arcId);
    const config = PLAN_ITEM_LISTS[list];
    const index = arc?.[list]?.findIndex(item => item.id === itemId) ?? -1;
    if (index < 0) return;
    const noun = config.one.toLowerCase();
    await commitEdit(`Dropped the report on ${noun} ${index + 1} of ${arc.title}`, async () => {
        dropPendingMark(arcId, list, itemId);
        await saveMetadata();
    }, () => `Report dropped: ${noun} ${index + 1} of ${boldTitle(arc)} stays open and in the prompt.`,
    { icon: 'fa-hourglass-end', patch: () => patchPlanList(arcId, list, itemId) });
}

/** Rebuild one plan list, keep the focus on the item, and patch the row's report count */
function patchPlanList(arcId, list, itemId) {
    const root = managerRoot();
    const box = root?.querySelector(`[data-plan-list="${CSS.escape(`${arcId}:${list}`)}"]`);
    const arc = getArcById(arcId);
    if (box && arc) {
        box.outerHTML = buildPlanList(arc, list, pendingMarksOfChat(), false);
        root.querySelector(`[data-plan-list="${CSS.escape(`${arcId}:${list}`)}"] input[data-item="${CSS.escape(itemId)}"]`)?.focus();
    }
    patchArc(arcId);
}

// ─── Editors ────────────────────────────────────────────────────────────────

function openBeatEditor(arcId, beatId) {
    const item = managerRoot()?.querySelector(`[data-beats="${CSS.escape(arcId)}"] [data-beat-li="${CSS.escape(beatId)}"]`);
    const arc = getArcById(arcId);
    const beat = arc?.beats.find(candidate => candidate.id === beatId);
    if (!item || !beat) return;
    let form = item.querySelector('.am-beat-editor');
    if (!form) {
        item.insertAdjacentHTML('beforeend', buildBeatEditor(arc, beat));
        form = item.querySelector('.am-beat-editor');
    }
    form.querySelector('textarea').focus();
}

function closeBeatEditor(form) {
    const item = form.closest('.am-beat');
    form.remove();
    item?.querySelector('[data-act="beat-edit"]')?.focus();
}

async function saveBeat(form) {
    const arcId = form.dataset.beatForm;
    const beatId = form.dataset.beat;
    const arc = getArcById(arcId);
    const index = arc?.beats.findIndex(beat => beat.id === beatId) ?? -1;
    if (index < 0) return;
    const words = beatWords(arc);
    const message = form.querySelector('.am-inline-msg');
    const edit = {
        pressure: form.elements.pressure.value.trim(),
        intention: form.elements.intention.value.trim(),
    };
    form.elements.pressure.removeAttribute('aria-invalid');
    form.elements.intention.removeAttribute('aria-invalid');
    const error = checkBeatEdit(arc.tier, edit);
    if (error) {
        const field = /pressure/i.test(error) ? form.elements.pressure : form.elements.intention;
        field.setAttribute('aria-invalid', 'true');
        field.focus();
        message.textContent = `${error} Nothing was saved.`;
        message.classList.add('is-error');
        return;
    }

    await commitEdit(`Edited ${words.beat} ${index + 1} of ${arc.title}`, async () => {
        const beats = arc.beats.map(beat => beat.id === beatId ? { ...beat, pressure: edit.pressure, intention: edit.intention } : beat);
        await updateArc(arcId, { beats });
    }, () => `${words.Beat} ${index + 1} of ${boldTitle(arc)} updated.`, {
        seconds: 6,
        patch: () => {
            const item = form.closest('.am-beat');
            item.querySelector('[data-f="pressure"]').textContent = edit.pressure;
            item.querySelector('[data-f="intention"]').textContent = edit.intention;
            closeBeatEditor(form);
            item.classList.remove('is-flash');
            void item.offsetWidth;
            item.classList.add('is-flash');
        },
    });
}

/** Enable Save and Revert once the form differs from the stored arc */
function updatePitchFormState(form) {
    const arc = getArcById(form.dataset.pitch);
    if (!arc) return;
    const isDirty = form.elements.title.value !== arc.title || form.elements.premise.value !== (arc.premise || '');
    form.querySelector('button[type="submit"]').disabled = !isDirty;
    form.querySelector('[data-act="pitch-revert"]').disabled = !isDirty;
    const message = form.querySelector('.am-inline-msg');
    if (!message.classList.contains('is-error')) message.textContent = isDirty ? 'Unsaved changes' : '';
}

async function savePitch(form) {
    const arcId = form.dataset.pitch;
    const arc = getArcById(arcId);
    if (!arc) return;
    const message = form.querySelector('.am-inline-msg');
    message.classList.remove('is-error');
    form.elements.title.removeAttribute('aria-invalid');
    const { updates, error } = applyTitleAndPremiseEdit(arc, { title: form.elements.title.value, premise: form.elements.premise.value });
    if (error) {
        const isTitle = error.startsWith('title');
        if (isTitle) {
            form.elements.title.setAttribute('aria-invalid', 'true');
            form.elements.title.focus();
        }
        const hint = !isTitle && !session.revealed.has(arcId) ? ' Reveal the plan to fix it.' : ' Nothing was saved.';
        message.textContent = `${error.charAt(0).toUpperCase()}${error.slice(1)}${hint}`;
        message.classList.add('is-error');
        return;
    }

    await commitEdit(`Edited the title and premise of ${updates.title}`, () => updateArc(arcId, updates),
        () => `Title and premise of ${boldTitle(getArcById(arcId))} changed.`, {
            patch: () => {
                form.elements.title.value = updates.title;
                form.elements.premise.value = updates.premise;
                patchArc(arcId);
                updatePitchFormState(form);
                message.textContent = 'Saved';
            },
        });
}

/** The arc as the JSON editor shows it: without the fields the save keeps anyway and the player cannot see elsewhere */
function arcForJsonEditor(arc) {
    const { rulings, stallIgnoredFrom, ...shown } = arc;
    void rulings;
    void stallIgnoredFrom;
    return shown;
}

function openJsonEditor(arcId) {
    const section = managerRoot()?.querySelector(`[data-json-sec="${CSS.escape(arcId)}"]`);
    const arc = getArcById(arcId);
    if (!section || !arc) return;
    section.hidden = false;
    const textarea = section.querySelector('textarea');
    textarea.value = JSON.stringify(arcForJsonEditor(arc), null, 2);
    section.querySelector('.am-inline-msg').textContent = '';
    section.scrollIntoView({ block: 'nearest' });
    textarea.focus();
}

async function saveJson(form) {
    const arcId = form.dataset.jsonForm;
    const storedArc = getArcById(arcId);
    if (!storedArc) return;
    const message = form.querySelector('.am-inline-msg');
    const textarea = form.querySelector('textarea');
    const { arc, error } = applyArcEdit(storedArc, textarea.value);
    if (error) {
        message.textContent = `${error} Nothing was saved.`;
        message.classList.add('is-error');
        textarea.setAttribute('aria-invalid', 'true');
        return;
    }

    await commitEdit(`Edited ${arc.title} as JSON`, () => replaceArc(storedArc, arc),
        () => `${boldTitle(arc)} replaced from JSON.`, {
            patch: () => {
                rebuildDetail(arcId);
                patchArc(arcId);
                managerRoot()?.querySelector(`[data-reveal="${CSS.escape(arcId)}"]`)?.focus();
            },
        });
}

// ─── The ⋯ menu and the beat tooltip ────────────────────────────────────────

/** The button whose menu is open */
let menuOpener = null;

/**
 * The menu and the tooltip live in the popup's dialog, outside the
 * scrolling content, as fixed overlays: appended to the body they would
 * sit under the dialog's top layer.
 * @param {HTMLElement} root
 */
function addOverlays(root) {
    const dialog = root.closest('dialog') || root.parentElement;
    dialog.insertAdjacentHTML('beforeend', `<div class="am-menu" id="am-menu" role="menu" hidden></div><div class="am-tip" id="am-tip" role="tooltip" hidden></div>`);
}

/**
 * The items of an active arc's ⋯ menu: re-plan; edit title and premise,
 * beats, JSON; complete, abandon.
 * @param {object} arc
 * @param {boolean} isRevealed - Whether the arc shows its plan
 * @returns {string} HTML string
 */
export function buildArcMenuItems(arc, isRevealed) {
    const words = beatWords(arc);
    const item = (act, icon, label, description) => `<button type="button" role="menuitem" tabindex="-1" data-act="${act}" data-id="${arc.id}">
        <i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span>${description ? `<span class="d">${description}</span>` : ''}</button>`;
    return `
        ${item('replan', 'fa-route', 'Re-plan…', `Regenerate the unfulfilled part from where the story is now${openRulingsOf(arc).length ? ', following your rulings' : ''}`)}
        <hr>
        ${item('edit-pitch', 'fa-pen', 'Edit title and premise', isRevealed ? '' : 'The premise stays hidden until you reveal the plan')}
        ${item('edit-beats', 'fa-list-check', `Edit ${words.beats}`, isRevealed ? '' : 'Reveals the plan of this arc')}
        ${item('edit-json', 'fa-code', 'Edit as JSON', isRevealed ? '' : 'Reveals the plan of this arc')}
        <hr>
        ${item('complete', 'fa-check', 'Complete', 'Leaves the prompt now; its beats are no longer checked. Undo while the Arc Manager is open.')}
        ${item('abandon', 'fa-xmark', 'Abandon', 'Leaves the prompt unfinished now. Undo while the Arc Manager is open; Reactivate later.')}`;
}

function openMenu(button) {
    const menu = document.getElementById('am-menu');
    const arcId = button.dataset.id;
    const arc = getArcById(arcId);
    if (!menu || !arc) return;
    menuOpener = button;
    menu.innerHTML = buildArcMenuItems(arc, session.revealed.has(arcId));
    menu.setAttribute('aria-label', `Actions for ${arc.title}`);
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    positionMenu();
    menu.querySelector('button').focus();
}

function positionMenu() {
    const menu = document.getElementById('am-menu');
    if (!menu || menu.hidden || !menuOpener) return;
    const openerBox = menuOpener.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const fitsBelow = openerBox.bottom + 4 + menuBox.height < window.innerHeight - 8;
    menu.style.top = `${fitsBelow ? openerBox.bottom + 4 : Math.max(8, openerBox.top - 4 - menuBox.height)}px`;
    menu.style.left = `${Math.max(8, openerBox.right - menuBox.width)}px`;
}

function closeMenu(returnFocus = true) {
    const menu = document.getElementById('am-menu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    menuOpener?.setAttribute('aria-expanded', 'false');
    if (returnFocus) menuOpener?.focus();
    menuOpener = null;
}

function showTip(element) {
    const tip = document.getElementById('am-tip');
    if (!tip) return;
    tip.textContent = element.dataset.tip;
    tip.hidden = false;
    const elementBox = element.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    tip.style.top = `${elementBox.bottom + 6}px`;
    tip.style.left = `${Math.min(window.innerWidth - tipBox.width - 8, Math.max(8, elementBox.left + elementBox.width / 2 - tipBox.width / 2))}px`;
}

function hideTip() {
    const tip = document.getElementById('am-tip');
    if (tip) tip.hidden = true;
}

// ─── Event Wiring ───────────────────────────────────────────────────────────

/** Close the popup; `handoff` names what opens after it */
function closeManager(popup, handoff = null) {
    handoffAfterClose = handoff;
    if (typeof popup?.complete === 'function') popup.complete(0);
}

function wireManagerEvents(popup) {
    const root = managerRoot();
    if (!root) return;
    addOverlays(root);
    const $doc = $(document);
    $doc.off('.storyArcManager');
    const inManager = element => element.closest('#story-arc-manager, #am-menu');

    $doc.on('click.storyArcManager', '[data-act]', async function (event) {
        if (!inManager(this)) return;
        const act = this.dataset.act;
        const arcId = this.dataset.id;
        if (this.closest('#am-menu')) {
            closeMenu(false);
        }
        switch (act) {
            case 'expand': setExpanded(arcId, this.getAttribute('aria-expanded') !== 'true'); break;
            case 'menu': {
                const menu = document.getElementById('am-menu');
                if (!menu.hidden && menuOpener === this) closeMenu(); else openMenu(this);
                break;
            }
            case 'cell': {
                setExpanded(arcId, true);
                const item = root.querySelector(`[data-beats="${CSS.escape(arcId)}"] [data-beat-li="${CSS.escape(this.dataset.beat)}"]`);
                item?.scrollIntoView({ block: 'nearest' });
                (item?.querySelector('input:checked') || item?.querySelector('input'))?.focus();
                item?.classList.remove('is-flash');
                void item?.offsetWidth;
                item?.classList.add('is-flash');
                break;
            }
            case 'replan': closeManager(popup, { kind: 'replan', arcId }); break;
            case 'plan-new': closeManager(popup, { kind: 'plan-new' }); break;
            case 'knowledge': closeManager(popup, { kind: 'knowledge' }); break;
            case 'close': closeManager(popup); break;
            case 'spotlight': await changeFocus(arcId, 'spotlight'); break;
            case 'ignore': await ignoreStallOf(arcId); break;
            case 'unignore': await showStallOf(arcId); break;
            case 'complete': await endArc(arcId, 'completed'); break;
            case 'abandon': await endArc(arcId, 'abandoned'); break;
            case 'reactivate': await reactivate(arcId); break;
            case 'open-past': {
                root.querySelector('#am-past').open = true;
                root.querySelector('#am-past [data-act="reactivate"]')?.focus();
                break;
            }
            case 'edit-pitch': {
                setExpanded(arcId, true);
                const titleInput = root.querySelector(`#am-pt-${CSS.escape(arcId)}`);
                titleInput?.focus();
                titleInput?.select();
                break;
            }
            case 'edit-beats': {
                setExpanded(arcId, true);
                setRevealed(arcId, true);
                const beats = root.querySelector(`[data-beats="${CSS.escape(arcId)}"]`);
                beats?.scrollIntoView({ block: 'nearest' });
                beats?.querySelector('[data-act="beat-edit"]')?.focus();
                break;
            }
            case 'edit-json':
                setExpanded(arcId, true);
                setRevealed(arcId, true);
                openJsonEditor(arcId);
                break;
            case 'beat-edit': openBeatEditor(arcId, this.dataset.beat); break;
            case 'beat-cancel': closeBeatEditor(this.closest('form')); break;
            case 'beat-delete': await deleteBeat(arcId, this.dataset.beat); break;
            case 'drop-report': await dropReport(arcId, this.dataset.list, this.dataset.item); break;
            case 'pitch-revert': {
                const form = this.closest('form');
                const arc = getArcById(arcId);
                form.elements.title.value = arc.title;
                form.elements.premise.value = arc.premise || '';
                form.querySelector('.am-inline-msg').classList.remove('is-error');
                updatePitchFormState(form);
                form.elements.title.focus();
                break;
            }
            case 'json-cancel': {
                this.closest('[data-json-sec]').hidden = true;
                root.querySelector(`[data-reveal="${CSS.escape(arcId)}"]`)?.focus();
                break;
            }
            case 'undo': {
                root.querySelector('#am-live').innerHTML = '';
                await undoInPopup();
                break;
            }
            case 'dismiss': dismissStatus(); break;
        }
        event.preventDefault();
    });

    $doc.on('change.storyArcManager', '#story-arc-manager input', async function () {
        if (this.dataset.focus) {
            await changeFocus(this.dataset.focus, this.value);
        } else if (this.dataset.beatStatus) {
            await changeBeatStatus(this.dataset.beatStatus, this.dataset.beat, this.value);
        } else if (this.dataset.reveal) {
            setRevealed(this.dataset.reveal, this.checked);
        } else if (this.dataset.plan) {
            await togglePlanItemOf(this.dataset.plan, this.dataset.list, this.dataset.item);
        }
    });

    $doc.on('input.storyArcManager', '#story-arc-manager form', function (event) {
        event.target.removeAttribute('aria-invalid');
        const message = this.querySelector('.am-inline-msg');
        message?.classList.remove('is-error');
        if (this.dataset.pitch) updatePitchFormState(this);
        if (this.dataset.jsonForm && message) message.textContent = 'Unsaved changes';
    });

    $doc.on('submit.storyArcManager', '#story-arc-manager form', async function (event) {
        event.preventDefault();
        if (this.dataset.pitch) await savePitch(this);
        else if (this.dataset.beatForm) await saveBeat(this);
        else if (this.dataset.jsonForm) await saveJson(this);
    });

    $doc.on('keydown.storyArcManager', function (event) {
        const menu = document.getElementById('am-menu');
        // The menu: arrows, Home/End, Escape back to its button; Escape never closes the popup from here
        if (menu && !menu.hidden && menu.contains(event.target)) {
            const items = [...menu.querySelectorAll('button')];
            const position = items.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') items[(position + 1) % items.length].focus();
            else if (event.key === 'ArrowUp') items[(position - 1 + items.length) % items.length].focus();
            else if (event.key === 'Home') items[0].focus();
            else if (event.key === 'End') items[items.length - 1].focus();
            else if (event.key === 'Escape') closeMenu();
            else if (event.key === 'Tab') { closeMenu(false); return; }
            else return;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!event.target.closest?.('#story-arc-manager')) return;
        if (event.key === 'Escape' && event.target.closest('.am-beat-editor')) {
            event.preventDefault();
            event.stopPropagation();
            closeBeatEditor(event.target.closest('form'));
            return;
        }
        if (event.key === 'Escape') hideTip();
        // Beat strip: one tab stop, arrows move between beats
        const cell = event.target.closest('.am-cell, .am-shape[data-tip]');
        if (!cell || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const cells = [...cell.closest('.am-strip-cells').querySelectorAll('.am-cell, .am-shape[data-tip]')];
        let position = cells.indexOf(cell);
        if (event.key === 'ArrowRight') position = Math.min(position + 1, cells.length - 1);
        if (event.key === 'ArrowLeft') position = Math.max(position - 1, 0);
        if (event.key === 'Home') position = 0;
        if (event.key === 'End') position = cells.length - 1;
        event.preventDefault();
        cells.forEach((candidate, candidatePosition) => { candidate.tabIndex = candidatePosition === position ? 0 : -1; });
        cells[position].focus();
    });

    $doc.on('mousedown.storyArcManager', function (event) {
        const menu = document.getElementById('am-menu');
        if (!menu || menu.hidden || menu.contains(event.target) || menuOpener?.contains(event.target)) return;
        closeMenu(false);
    });
    $doc.on('mouseover.storyArcManager', '#story-arc-manager [data-tip]', function () { showTip(this); });
    $doc.on('mouseout.storyArcManager', '#story-arc-manager [data-tip]', hideTip);
    $doc.on('focusin.storyArcManager', function (event) {
        const element = event.target.closest?.('#story-arc-manager [data-tip]');
        if (element && element.matches(':focus-visible')) showTip(element); else hideTip();
    });
    // The content scrolls inside the popup; fixed overlays would drift from their anchor
    root.closest('.popup-content')?.addEventListener('scroll', () => { closeMenu(false); hideTip(); }, { passive: true });
    $(window).on('resize.storyArcManager', positionMenu);
}
