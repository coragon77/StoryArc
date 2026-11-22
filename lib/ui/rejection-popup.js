/**
 * Story Arc - The take-out of a rejected span: the notice, the dialog and
 * the message menu entry (design docs/plans/2026-11-22-rejected-replies-design.md).
 *
 * The notice appears when the knowledge extraction recognised a rewrite
 * request and its new version (KnowledgeUpdateResult.rewriteOffer); its
 * Review opens the dialog with the proposed span ticked. The menu entry
 * "Reject from here…" opens the same dialog from any message. The dialog
 * keeps the chat's message objects, not their indices, so a deletion
 * meanwhile cannot make it take out the wrong message; a message that is
 * gone (another chat was loaded) takes nothing out.
 */

import { chat, saveMetadata } from '/script.js';
import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { isEnabled } from '../core/settings.js';
import { REWRITE_OFFERED_KEY, isMarkedOutOfCharacter, messageIdOf } from '../knowledge/message-ids.js';
import { findNewVersionAfter, proposeRejectedSpan, proposeSpanFromMessage, takeOutRejectedSpan } from '../knowledge/rejection.js';
import { updateKnowledgeStatus } from './knowledge-status.js';
import { updateProgress } from './progress.js';

/** How many messages before the proposed start the dialog lists, so the start can move back. */
const ROWS_BEFORE_START = 12;

/** The class of the message menu entry. */
const MENU_BUTTON_CLASS = 'story-arc-reject-button';

/** What a take-out does, in the player's words. */
const CONSEQUENCE_TEXT = 'The ticked messages are hidden from the narrator and from summaries, and what Story Arc learned from them is taken back. '
    + 'Unhiding them later shows them to the narrator again, but the knowledge does not come back.';

// ─── The notice ───

/** The open notice, closed when the chat changes under it. */
let offerToast = null;

/**
 * Show the notice for a recognised rewrite: the new version and the
 * request are found by their message ids. The new version is marked as
 * offered, so its next extraction offers nothing again.
 * @param {{requestMessageId: string, newVersionMessageId: string}} rewriteOffer
 */
export async function showRewriteOffer(rewriteOffer) {
    const requestMessage = chat.find(message => messageIdOf(message) === rewriteOffer.requestMessageId);
    const newVersion = chat.find(message => messageIdOf(message) === rewriteOffer.newVersionMessageId);
    if (!requestMessage || !newVersion) return;
    if (!newVersion.extra || typeof newVersion.extra !== 'object') newVersion.extra = {};
    newVersion.extra[REWRITE_OFFERED_KEY] = true;
    await saveMetadata();

    closeRewriteOffer();
    const newVersionIndex = chat.indexOf(newVersion);
    offerToast = toastr.info(
        `Reply #${newVersionIndex} is a rewrite you asked for. Click to review what it replaces and take it out.`,
        'Story Arc',
        {
            timeOut: 0,
            extendedTimeOut: 0,
            closeButton: true,
            onclick: () => {
                offerToast = null;
                const requestIndex = chat.indexOf(requestMessage);
                const currentNewVersionIndex = chat.indexOf(newVersion);
                if (requestIndex === -1 || currentNewVersionIndex === -1) return;
                const span = proposeRejectedSpan(chat, requestIndex, currentNewVersionIndex);
                openRejectionDialog(span).catch(err => console.warn('[Story Arc] The take-out dialog failed:', err));
            },
        },
    );
}

/**
 * Close the open notice, if any: after a chat change, a deletion or a
 * swipe its messages may be gone or moved.
 */
export function closeRewriteOffer() {
    if (!offerToast) return;
    toastr.clear(offerToast);
    offerToast = null;
}

// ─── The menu entry ───

/**
 * Add "Reject from here…" to ST's message menu template, so every message
 * ST renders gets it, and to the messages already on screen; one click
 * handler serves them all.
 */
export function addRejectMenuEntry() {
    const html = `<div title="Reject from here… (Story Arc)" class="mes_button ${MENU_BUTTON_CLASS} fa-solid fa-eraser"></div>`;
    $('#message_template .mes_buttons .extraMesButtons').prepend(html);
    $('#chat .mes .extraMesButtons').not(`:has(.${MENU_BUTTON_CLASS})`).prepend(html);
    $(document).off('click.storyArcReject').on('click.storyArcReject', `.${MENU_BUTTON_CLASS}`, function () {
        if (!isEnabled()) {
            toastr.info('Story Arc is off.', 'Story Arc');
            return;
        }
        const messageIndex = Number($(this).closest('.mes').attr('mesid'));
        if (!Number.isInteger(messageIndex) || !chat[messageIndex]) return;
        openRejectionDialog(proposeSpanFromMessage(chat, messageIndex))
            .catch(err => console.warn('[Story Arc] The take-out dialog failed:', err));
    });
}

// ─── The dialog ───

/** The open dialog's rows and popup; null while none is open. */
let dialog = null;

/**
 * Open the dialog with a proposed span ticked: the messages from
 * ROWS_BEFORE_START before its start to its end, then the new version,
 * which cannot be ticked. Ticking a row before the first ticked one ticks
 * the rows between, so the start moves back in one click.
 * @param {{start: number, end: number}} span
 */
async function openRejectionDialog(span) {
    if (dialog) return;
    const firstRowIndex = Math.max(0, span.start - ROWS_BEFORE_START);
    const proposedIndices = new Set();
    for (let index = span.start; index <= span.end; index++) proposedIndices.add(index);
    const newVersionIndex = findNewVersionAfter(chat, span.end, proposedIndices);
    const rows = [];
    for (let index = firstRowIndex; index <= span.end; index++) {
        rows.push({ message: chat[index], ticked: proposedIndices.has(index), isNewVersion: false });
    }
    if (newVersionIndex !== null) rows.push({ message: chat[newVersionIndex], ticked: false, isNewVersion: true });

    const popup = new Popup(`<div class="story-arc-reject" id="story-arc-reject">${renderDialog(rows)}</div>`, POPUP_TYPE.TEXT, 'Take out rejected messages', {
        okButton: false,
        cancelButton: false,
        wide: true,
        allowVerticalScrolling: true,
    });
    dialog = { rows, popup };
    const popupPromise = popup.show();
    await delay(50);
    wireDialogEvents();
    // The ticked rows in view: the dialog opens at the proposal, not at the top.
    document.querySelector('#story-arc-reject .story-arc-reject-row.is-ticked')?.scrollIntoView({ block: 'center' });

    await popupPromise;
    $(document).off('.storyArcRejectDialog');
    dialog = null;
}

/**
 * The dialog's content: the consequence, one row per message, the status
 * line and the buttons.
 * @param {{message: object, ticked: boolean, isNewVersion: boolean}[]} rows
 * @returns {string}
 */
function renderDialog(rows) {
    const rowHtml = rows.map((row, rowIndex) => {
        const index = chat.indexOf(row.message);
        const name = escapeHtml(row.message?.name || (row.message?.is_user ? 'You' : 'Narrator'));
        const firstLine = escapeHtml(String(row.message?.mes || '').trim().split('\n')[0].slice(0, 160));
        const tags = [];
        if (isMarkedOutOfCharacter(row.message?.mes)) tags.push('<span class="story-arc-reject-tag">OOC</span>');
        if (row.message?.is_system) tags.push('<span class="story-arc-reject-tag">hidden</span>');
        if (row.isNewVersion) {
            return `<li class="story-arc-reject-row is-new-version">
                <span class="story-arc-reject-box"></span>
                <span class="story-arc-reject-index">#${index}</span>
                <span class="story-arc-reject-who">${name}</span>
                <span class="story-arc-reject-tag is-strong">new version</span>
                <span class="story-arc-reject-text">${firstLine}</span>
            </li>`;
        }
        return `<li class="story-arc-reject-row${row.ticked ? ' is-ticked' : ''}">
            <label>
                <input type="checkbox" data-reject-row="${rowIndex}"${row.ticked ? ' checked' : ''}>
                <span class="story-arc-reject-index">#${index}</span>
                <span class="story-arc-reject-who">${name}</span>
                ${tags.join('')}
                <span class="story-arc-reject-text">${firstLine}</span>
            </label>
        </li>`;
    }).join('');
    return `<p class="story-arc-reject-intro">${escapeHtml(CONSEQUENCE_TEXT)}</p>
        <ul class="story-arc-reject-rows">${rowHtml}</ul>
        <div class="story-arc-reject-status" aria-live="polite"></div>
        <div class="story-arc-reject-buttons">
            <div class="menu_button" data-reject-action="take-out">Take out</div>
            <div class="menu_button" data-reject-action="cancel">Cancel</div>
        </div>`;
}

/**
 * Bind the dialog's checkboxes and buttons. A tick before the first ticked
 * row ticks the rows between; every other change is the row's alone.
 */
function wireDialogEvents() {
    const $doc = $(document);
    $doc.off('.storyArcRejectDialog');
    $doc.on('change.storyArcRejectDialog', '#story-arc-reject input[data-reject-row]', function () {
        const rowIndex = Number(this.dataset.rejectRow);
        const firstTicked = dialog.rows.findIndex(row => row.ticked);
        dialog.rows[rowIndex].ticked = this.checked;
        if (this.checked && firstTicked !== -1 && rowIndex < firstTicked) {
            for (let between = rowIndex + 1; between < firstTicked; between++) dialog.rows[between].ticked = true;
        }
        refreshTicks();
    });
    $doc.on('click.storyArcRejectDialog', '#story-arc-reject [data-reject-action="cancel"]', () => dialog.popup.complete(0));
    $doc.on('click.storyArcRejectDialog', '#story-arc-reject [data-reject-action="take-out"]', () => {
        confirmTakeOut().catch(err => {
            console.warn('[Story Arc] The take-out failed:', err);
            showDialogStatus('The take-out failed; the browser console has the details.');
        });
    });
}

/** Show the rows' ticks as the dialog state has them. */
function refreshTicks() {
    $('#story-arc-reject input[data-reject-row]').each(function () {
        const row = dialog.rows[Number(this.dataset.rejectRow)];
        this.checked = row.ticked;
        $(this).closest('.story-arc-reject-row').toggleClass('is-ticked', row.ticked);
    });
}

/**
 * @param {string} text
 */
function showDialogStatus(text) {
    $('#story-arc-reject .story-arc-reject-status').text(text);
}

/**
 * Take out the ticked rows' messages, found again by the message objects;
 * refused when one is gone. Closes the dialog on success and reports what
 * was taken back; the re-read of the new version reports when it is done.
 */
async function confirmTakeOut() {
    const tickedMessages = dialog.rows.filter(row => row.ticked && !row.isNewVersion).map(row => row.message);
    if (tickedMessages.length === 0) {
        showDialogStatus('Tick at least one message.');
        return;
    }
    const tickedIndices = tickedMessages.map(message => chat.indexOf(message));
    if (tickedIndices.includes(-1)) {
        showDialogStatus('The chat changed since this dialog opened; close it and open it again.');
        return;
    }
    const result = await takeOutRejectedSpan(tickedIndices);
    if (result.error) {
        showDialogStatus(result.error);
        return;
    }
    dialog.popup.complete(1);
    updateKnowledgeStatus();
    updateProgress();
    const factsText = result.factsDropped === 1 ? '1 fact' : `${result.factsDropped} facts`;
    const rereadText = result.newVersionIndex === null ? '' : ` Reading #${result.newVersionIndex} again.`;
    toastr.success(`Took out ${result.taken} message(s); ${factsText} taken back.${rereadText}`, 'Story Arc');
    result.reread
        .then(reread => {
            if (!reread) return;
            if (reread.ledgerChanged) updateKnowledgeStatus();
            if (reread.beatsChanged) updateProgress();
        })
        .catch(err => console.warn('[Story Arc] Reading the new version again failed:', err));
}
