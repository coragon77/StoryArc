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

/**
 * The open dialog: the message its rows start at, the message the span
 * reaches to, the ticked messages and the popup; null while none is open.
 * Messages, not indices, so a deletion meanwhile moves nothing.
 */
let dialog = null;

/**
 * Open the dialog with a proposed span ticked. Its rows run from
 * ROWS_BEFORE_START before the start to the span's end, then the new
 * version (findNewVersionAfter). Ticking a row before the first ticked one
 * ticks the rows between, so the start moves back in one click; ticking the
 * new version takes it into the span, and the next story reply becomes the
 * new version (a rewrite the player rejected too, such as Aegis 423).
 * @param {{start: number, end: number}} span
 */
async function openRejectionDialog(span) {
    if (dialog) return;
    const ticked = new Set();
    for (let index = span.start; index <= span.end; index++) ticked.add(chat[index]);
    dialog = {
        firstMessage: chat[Math.max(0, span.start - ROWS_BEFORE_START)],
        endMessage: chat[span.end],
        ticked,
        popup: null,
    };

    const html = `<div class="story-arc-reject" id="story-arc-reject">
        <h3 class="story-arc-reject-title">Take out rejected messages</h3>
        <p class="story-arc-reject-intro">${escapeHtml(CONSEQUENCE_TEXT)}</p>
        <ul class="story-arc-reject-rows">${renderRows()}</ul>
        <div class="story-arc-reject-status" aria-live="polite"></div>
        <div class="story-arc-reject-buttons">
            <div class="menu_button" data-reject-action="take-out">Take out</div>
            <div class="menu_button" data-reject-action="cancel">Cancel</div>
        </div>
    </div>`;
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        allowVerticalScrolling: true,
    });
    dialog.popup = popup;
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
 * The rows as the dialog state has them: from its first message to the
 * span's end, then the new version after the last ticked message. Each row
 * carries its message's current index; a message that is gone leaves no row.
 * @returns {string}
 */
function renderRows() {
    const firstIndex = Math.max(0, chat.indexOf(dialog.firstMessage));
    const tickedIndices = new Set([...dialog.ticked].map(message => chat.indexOf(message)).filter(index => index !== -1));
    const endIndex = Math.max(chat.indexOf(dialog.endMessage), ...tickedIndices);
    const newVersionIndex = findNewVersionAfter(chat, endIndex, tickedIndices);
    const lastIndex = newVersionIndex ?? endIndex;

    const rowHtml = [];
    for (let index = firstIndex; index <= lastIndex; index++) {
        const message = chat[index];
        if (!message) continue;
        const isTicked = dialog.ticked.has(message);
        const isNewVersion = index === newVersionIndex;
        const name = escapeHtml(message.name || (message.is_user ? 'You' : 'Narrator'));
        const firstLine = escapeHtml(String(message.mes || '').trim().split('\n')[0].slice(0, 160));
        const tags = [];
        if (isNewVersion) tags.push('<span class="story-arc-reject-tag is-strong">new version</span>');
        if (isMarkedOutOfCharacter(message.mes)) tags.push('<span class="story-arc-reject-tag">OOC</span>');
        if (message.is_system) tags.push('<span class="story-arc-reject-tag">hidden</span>');
        const rowClasses = ['story-arc-reject-row'];
        if (isTicked) rowClasses.push('is-ticked');
        if (isNewVersion) rowClasses.push('is-new-version');
        rowHtml.push(`<li class="${rowClasses.join(' ')}">
            <label>
                <input type="checkbox" data-reject-index="${index}"${isTicked ? ' checked' : ''}>
                <span class="story-arc-reject-index">#${index}</span>
                <span class="story-arc-reject-who">${name}</span>
                <span class="story-arc-reject-tags">${tags.join('')}</span>
                <span class="story-arc-reject-text">${firstLine}</span>
            </label>
        </li>`);
    }
    return rowHtml.join('');
}

/**
 * Bind the dialog's checkboxes and buttons. A tick before the first ticked
 * message ticks the messages between; a tick on the new version takes it
 * into the span. Every change renders the rows again.
 */
function wireDialogEvents() {
    const $doc = $(document);
    $doc.off('.storyArcRejectDialog');
    $doc.on('change.storyArcRejectDialog', '#story-arc-reject input[data-reject-index]', function () {
        const index = Number(this.dataset.rejectIndex);
        const message = chat[index];
        if (!message) return;
        const tickedIndices = [...dialog.ticked].map(tickedMessage => chat.indexOf(tickedMessage)).filter(tickedIndex => tickedIndex !== -1);
        const firstTickedIndex = tickedIndices.length ? Math.min(...tickedIndices) : null;
        if (!this.checked) {
            dialog.ticked.delete(message);
        } else {
            dialog.ticked.add(message);
            if (firstTickedIndex !== null && index < firstTickedIndex) {
                for (let between = index + 1; between < firstTickedIndex; between++) dialog.ticked.add(chat[between]);
            }
            if (index > chat.indexOf(dialog.endMessage)) dialog.endMessage = message;
        }
        $('#story-arc-reject .story-arc-reject-rows').html(renderRows());
        $(`#story-arc-reject input[data-reject-index="${index}"]`).trigger('focus');
    });
    $doc.on('click.storyArcRejectDialog', '#story-arc-reject [data-reject-action="cancel"]', () => dialog.popup.complete(0));
    $doc.on('click.storyArcRejectDialog', '#story-arc-reject [data-reject-action="take-out"]', () => {
        confirmTakeOut().catch(err => {
            console.warn('[Story Arc] The take-out failed:', err);
            showDialogStatus('The take-out failed; the browser console has the details.');
        });
    });
}

/**
 * @param {string} text
 */
function showDialogStatus(text) {
    $('#story-arc-reject .story-arc-reject-status').text(text);
}

/**
 * Take out the ticked messages, found again by their objects; refused when
 * one is gone. Closes the dialog on success and reports what was taken
 * back; the re-read of the new version refreshes the status line when done.
 */
async function confirmTakeOut() {
    const tickedMessages = [...dialog.ticked];
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
