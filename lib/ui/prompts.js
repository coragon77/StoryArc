/**
 * @file The Prompts popup and the drawer's Prompts entry
 * @module ui/prompts
 *
 * What Story Arc sends to the planning and tracker models, as templates it
 * fills in: the seven prompts in two groups on the left, the chosen prompt on
 * the right with a Template / Last sent switch. Built on the Arc Manager's
 * grammar (head, segmented control, Reveal switch, alert and note lines,
 * status bar) and the sent view's reader; lib/css/prompts.css holds only what
 * those lack.
 *
 * In the order it runs: showPromptsPopup opens the popup and binds its
 * controls; the session turns clicks and typing into stored edits
 * (prompt-edits.js) and the view; the pure HTML builders take that view:
 * the prompts as describePrompts returns them ({ prompts, editedCount }),
 * the draft in the editor and the last-sent record.
 *
 * While the player types, only buildPromptChecks and buildPromptActions are
 * rebuilt (into #pp-checks and #pp-actions); the textarea is never
 * re-rendered, so SillyTavern's large editor keeps writing into it.
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { getSettings } from '../core/settings.js';
import { estimateTokens } from '../context/chat-history.js';
import { loadBuiltInTemplate, readLastSentPrompt } from '../planning/generator.js';
import {
    PROMPT_CATALOG, checkPromptPlaceholders, describePrompts, keepPromptEdit, resetPromptEdit, restorePromptEdit, savePromptEdit,
} from '../planning/prompt-edits.js';
import { formatNumber } from './beat-strip.js';

/** The id of the template editor, the `data-for` of SillyTavern's expand icon. */
export const PROMPT_EDITOR_ID = 'pp-editor';

const PROMPT_GROUPS = [
    { id: 'planning', label: 'Planning an arc' },
    { id: 'tracker', label: 'Knowledge tracker' },
];

/** What a missing placeholder costs, where the code knows it; others get a general sentence. */
const MISSING_PLACEHOLDER_MEANING = {
    CLAIMED_CLUES: 'the narrator\'s clue claims never reach the check, so every PLANTED claim is dropped',
    MESSAGES: 'the new messages never reach the model, so nothing is learned',
    DEVELOPMENTS: 'no beat can be recognised as fulfilled',
    USER_DIRECTION: 'your direction for the arc never reaches the planner',
    THREAD_BLOCK: 'the rule that keeps the plan inside the arc\'s thread never reaches the model',
};

/** SillyTavern's own expand icon: its document handler opens the large editor for `data-for`. */
const EXPAND_EDITOR = `<i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="${PROMPT_EDITOR_ID}" title="Expand the editor" role="button" tabindex="0" aria-label="Expand the editor"></i>`;
/** The same icon for a read-only text: Story Arc opens it in a large popup of its own. */
const EXPAND_READER = '<i class="pp-expand-read fa-solid fa-maximize right_menu_button" data-act="expand-read" title="Expand" role="button" tabindex="0" aria-label="Expand"></i>';
const SHOW_BUILT_IN_BUTTON = '<button type="button" class="menu_button" data-act="show-builtin"><i class="fa-solid fa-eye" aria-hidden="true"></i>Show built-in</button>';

// ─── Show the popup ───

/** The open popup's session; null while none is open. */
let openSession = null;
/** The popup is open or loading. */
let isPromptsPopupOpen = false;

/**
 * Open the Prompts popup (SillyTavern's Popup, large and wide). It opens in
 * the template view with Reveal off, every time. A second popup while one is
 * open is not opened.
 */
export async function showPromptsPopup() {
    // Set before the first load: a double click must not open two popups
    if (isPromptsPopupOpen) return;
    isPromptsPopupOpen = true;
    try {
        openSession = await startPromptsSession();
    } catch (err) {
        console.error('[Story Arc] Could not load the prompts:', err);
        toastr.error(`Story Arc could not load its prompts: ${err.message}`);
        isPromptsPopupOpen = false;
        return;
    }

    // Whatever fails from here on, the popup's handlers go and the button opens it again
    try {
        const popup = new Popup(`<div class="am pp" id="story-arc-prompts">${buildPromptsContent(promptsViewOf(openSession))}</div>`, POPUP_TYPE.TEXT, '', {
            okButton: false,
            cancelButton: false,
            wide: true,
            large: true,
            // The list and the text scroll on their own; the head and the status bar stay
            allowVerticalScrolling: false,
        });
        const popupPromise = popup.show();
        await delay(50);
        wirePromptsEvents(popup);
        // The browser focuses the scrolling list and frames it; the chosen prompt's row is where the player is
        document.getElementById('story-arc-prompts')?.querySelector('.pp-row[aria-current="true"]')?.focus();

        await popupPromise;
    } catch (err) {
        console.error('[Story Arc] The Prompts popup failed:', err);
        toastr.error(`Story Arc's Prompts popup failed: ${err.message}`);
    } finally {
        $(document).off('.storyArcPrompts');
        openSession = null;
        isPromptsPopupOpen = false;
    }
}

/**
 * Bind the popup's controls, delegated on the document and namespaced like
 * the other popups. A click renders the popup again from the session.
 * Typing never does: SillyTavern's expand icon (`.editor_maximize`) opens
 * its large editor with a reference to #pp-editor and writes every keystroke
 * back with a jQuery-triggered `input`, which only a jQuery listener sees.
 * A re-rendered textarea would cut that link, so typing rebuilds only
 * #pp-checks and #pp-actions.
 * @param {object} popup - The ST popup
 */
function wirePromptsEvents(popup) {
    const $doc = $(document);
    $doc.off('.storyArcPrompts');
    const root = '#story-arc-prompts';

    $doc.on('click.storyArcPrompts', `${root} [data-pp]`, function () {
        selectPrompt(openSession, this.dataset.pp);
        rerenderPrompts(`[data-pp="${CSS.escape(this.dataset.pp)}"]`);
    });
    $doc.on('change.storyArcPrompts', `${root} input[name="pp-mode"]`, function () {
        switchPromptsMode(openSession, this.value);
        rerenderPrompts(`input[name="pp-mode"][value="${this.value}"]`);
    });
    $doc.on('change.storyArcPrompts', `${root} #pp-reveal`, function () {
        setPromptsReveal(openSession, this.checked);
        rerenderPrompts('#pp-reveal');
    });
    $doc.on('input.storyArcPrompts', `${root} #${PROMPT_EDITOR_ID}`, function () {
        typePromptDraft(openSession, this.value);
        const view = promptsViewOf(openSession);
        const prompt = view.prompts.prompts.find(candidate => candidate.name === view.selectedName);
        $(`${root} #pp-checks`).html(buildPromptChecks(prompt, view.draft));
        $(`${root} #pp-actions`).html(buildPromptActions(prompt, view.draft, view.message));
    });
    $doc.on('click.storyArcPrompts', `${root} [data-act]`, function () {
        const action = this.dataset.act;
        if (action === 'expand-read') {
            showReadOnlyText(readOnlyTextOf(openSession));
            return;
        }
        const storedEditsChanged = runPromptAction(openSession, action);
        // Never into the editor: an Enter that clicked the button would land there as a new line
        let focusSelector = '.pp-row[aria-current="true"]';
        if (action === 'save' || action === 'reset') focusSelector = '[data-act="undo"]';
        if (action === 'show-builtin') focusSelector = '[data-act="back"]';
        rerenderPrompts(focusSelector);
        if (storedEditsChanged) refreshPromptsDrawer(openSession.prompts);
    });
    // Enter reaches the expand icons through SillyTavern's keyboard handler (.right_menu_button); Space does not.
    $doc.on('keydown.storyArcPrompts', `${root} .editor_maximize, ${root} [data-act="expand-read"]`, function (event) {
        if (event.key !== ' ') return;
        event.preventDefault();
        $(this).trigger('click');
    });
    $doc.on('click.storyArcPrompts', `${root} #pp-close`, () => popup.complete(0));
}

/**
 * Render the popup again in place from the session. The list keeps its
 * scroll position and the given control gets the focus.
 * @param {string} focusSelector
 */
function rerenderPrompts(focusSelector) {
    const root = document.getElementById('story-arc-prompts');
    if (!root) return;
    const listScroll = root.querySelector('.pp-list')?.scrollTop ?? 0;
    root.innerHTML = buildPromptsContent(promptsViewOf(openSession));
    const list = root.querySelector('.pp-list');
    if (list) list.scrollTop = listScroll;
    root.querySelector(focusSelector)?.focus();
}

/** The read-only text on show: the built-in text, or the last sent prompt once revealed. */
function readOnlyTextOf(session) {
    const view = promptsViewOf(session);
    if (view.mode === 'sent') return view.revealed && view.lastSent ? view.lastSent.text : '';
    return selectedPromptOf(session).builtIn;
}

/**
 * The read-only expand: the text in a large SillyTavern popup of Story
 * Arc's own (SillyTavern's large editor would let the player type into it).
 * @param {string} text
 */
function showReadOnlyText(text) {
    if (!text) return;
    const popup = new Popup(`<div class="sv-text pp-read-large" tabindex="0">${escapeHtml(text)}</div>`, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: false,
    });
    popup.show();
}

/**
 * Keep the drawer's Prompts button ("N edited") and the note under it current.
 * @param {{prompts: object[], editedCount: number}} promptsView - describePrompts
 */
export function refreshPromptsDrawer(promptsView) {
    $('#story-arc-prompts-btn').replaceWith(buildPromptsButton(promptsView));
    $('#story-arc-prompts-note').html(buildPromptsDrawerNote(promptsView));
}

// ─── The session: what clicks and typing do ───

/**
 * All seven prompts described from their built-in texts and the stored
 * edits, as the drawer and the popup show them.
 * @returns {Promise<{prompts: object[], editedCount: number}>}
 */
export async function describeStoredPrompts() {
    const builtInTexts = {};
    for (const entry of PROMPT_CATALOG) {
        builtInTexts[entry.name] = await loadBuiltInTemplate(entry.name);
    }
    return describePrompts(builtInTexts, getSettings().promptOverrides);
}

/**
 * A new session of the popup: the template view, Reveal off, on the first
 * prompt whose built-in text changed since its edit (so its note is in
 * view), otherwise on the first prompt. Each prompt gets its own draft,
 * message and undo when first shown.
 * @returns {Promise<object>} The session
 */
export async function startPromptsSession() {
    const prompts = await describeStoredPrompts();
    const changedPrompt = prompts.prompts.find(prompt => prompt.state === 'changed');
    const builtIns = Object.fromEntries(prompts.prompts.map(prompt => [prompt.name, prompt.builtIn]));
    return {
        builtIns,
        prompts,
        selectedName: (changedPrompt ?? prompts.prompts[0]).name,
        mode: 'template',
        revealed: false,
        promptSessions: {},
    };
}

/** The chosen prompt's description. */
function selectedPromptOf(session) {
    return session.prompts.prompts.find(prompt => prompt.name === session.selectedName);
}

/** The chosen prompt's draft, message and undo, created from its stored text on first use. */
function selectedPromptSessionOf(session) {
    const prompt = selectedPromptOf(session);
    if (!session.promptSessions[prompt.name]) {
        session.promptSessions[prompt.name] = { draft: prompt.text, message: null, undo: null };
    }
    return session.promptSessions[prompt.name];
}

/**
 * The view buildPromptsContent takes, from the session: the draft checked
 * against the built-in placeholders, the message with whether Undo is on
 * offer, and the last-sent record of the chosen prompt.
 * @param {object} session
 * @returns {object} The view
 */
export function promptsViewOf(session) {
    const prompt = selectedPromptOf(session);
    const promptSession = selectedPromptSessionOf(session);
    const { missing, unknown } = checkPromptPlaceholders(prompt.builtIn, promptSession.draft);
    const message = promptSession.message
        ? { ...promptSession.message, undo: Boolean(promptSession.undo) }
        : null;
    const record = readLastSentPrompt(prompt.name);
    const lastSent = record
        ? { text: record.text, at: record.sentAt, purpose: record.purpose, length: record.length, edited: record.usedEdit }
        : null;
    return {
        prompts: session.prompts,
        selectedName: session.selectedName,
        mode: session.mode,
        revealed: session.revealed,
        draft: { text: promptSession.draft, missing, unknown },
        message,
        lastSent,
    };
}

/**
 * Choose a prompt in the list. Show built-in returns to the template, and
 * Reveal hides again.
 * @param {object} session
 * @param {string} name - Template file name
 */
export function selectPrompt(session, name) {
    session.selectedName = name;
    if (session.mode === 'builtin') session.mode = 'template';
    session.revealed = false;
}

/**
 * The Template / Last sent switch.
 * @param {object} session
 * @param {'template'|'sent'} mode
 */
export function switchPromptsMode(session, mode) {
    session.mode = mode;
}

/**
 * The Reveal switch of Last sent.
 * @param {object} session
 * @param {boolean} revealed
 */
export function setPromptsReveal(session, revealed) {
    session.revealed = revealed;
}

/**
 * The player typed (in the field or SillyTavern's large editor): the draft
 * changes, the last message goes. Nothing is stored.
 * @param {object} session
 * @param {string} text
 */
export function typePromptDraft(session, text) {
    const promptSession = selectedPromptSessionOf(session);
    promptSession.draft = text;
    promptSession.message = null;
}

/**
 * One button of the chosen prompt: save, reset, discard, undo, keep,
 * show-builtin, back. Save, Reset and Keep mine store at once; Undo puts
 * back the stored edit and the draft from before the last Save or Reset.
 * @param {object} session
 * @param {string} action - The button's data-act
 * @returns {boolean} Whether the stored edits changed (the drawer shows them)
 */
export function runPromptAction(session, action) {
    const prompt = selectedPromptOf(session);
    const promptSession = selectedPromptSessionOf(session);
    const storedEdit = getSettings().promptOverrides?.[prompt.name] ?? null;
    let storedEditsChanged = false;

    if (action === 'show-builtin') {
        session.mode = 'builtin';
    }
    if (action === 'back') {
        session.mode = 'template';
    }
    if (action === 'save') {
        const { missing, unknown } = checkPromptPlaceholders(prompt.builtIn, promptSession.draft);
        promptSession.undo = { storedEdit: storedEdit && { ...storedEdit }, draft: promptSession.draft };
        // The built-in text word for word is no edit
        if (promptSession.draft === prompt.builtIn) {
            resetPromptEdit(prompt.name);
        } else {
            savePromptEdit(prompt.name, promptSession.draft, prompt.builtIn);
        }
        const warned = missing.length + unknown.length > 0;
        promptSession.message = warned
            ? { ok: false, text: 'Saved with the warning above. It is sent from the next call on.' }
            : { ok: true, text: 'Saved. It is sent from the next call on, in every chat.' };
        storedEditsChanged = true;
    }
    if (action === 'reset') {
        promptSession.undo = { storedEdit: storedEdit && { ...storedEdit }, draft: promptSession.draft };
        resetPromptEdit(prompt.name);
        promptSession.draft = prompt.builtIn;
        promptSession.message = { ok: true, text: 'Reset to the built-in prompt.' };
        session.mode = 'template';
        storedEditsChanged = true;
    }
    if (action === 'discard') {
        promptSession.draft = prompt.text;
        promptSession.message = null;
    }
    if (action === 'keep') {
        keepPromptEdit(prompt.name, prompt.builtIn);
        promptSession.undo = null;
        promptSession.message = { ok: true, text: 'Kept your edit. This note comes back only if the built-in prompt changes again.' };
        session.mode = 'template';
        storedEditsChanged = true;
    }
    if (action === 'undo' && promptSession.undo) {
        restorePromptEdit(prompt.name, promptSession.undo.storedEdit);
        promptSession.draft = promptSession.undo.draft;
        promptSession.undo = null;
        promptSession.message = { ok: true, text: 'Undone.' };
        storedEditsChanged = true;
    }

    if (storedEditsChanged) {
        session.prompts = describePrompts(session.builtIns, getSettings().promptOverrides);
    }
    return storedEditsChanged;
}

// ─── The HTML ───

/**
 * The whole popup: head, the list, the chosen prompt's pane, the status bar.
 * @param {object} view
 * @param {{prompts: object[], editedCount: number}} view.prompts - describePrompts
 * @param {string} view.selectedName - The chosen prompt's template name
 * @param {'template'|'builtin'|'sent'} view.mode - Template, Show built-in or Last sent
 * @param {boolean} view.revealed - Reveal is on (Last sent)
 * @param {{text: string, missing: string[], unknown: string[]}} view.draft - The text in the editor and its check
 * @param {{ok: boolean, text: string, undo: boolean}|null} view.message - After Save, Reset or Keep mine
 * @param {{text: string, at: number|string, purpose: string, length: number, edited: boolean}|null} view.lastSent - The last prompt sent for this template this session
 * @returns {string} HTML
 */
export function buildPromptsContent(view) {
    const prompt = view.prompts.prompts.find(candidate => candidate.name === view.selectedName);
    return `
        <div class="am-head"><div class="am-head-text"><h2>Prompts</h2><p class="am-summary">${buildSummary(view.prompts)}</p></div></div>
        <div class="pp-split">
            <nav class="pp-list" aria-label="Prompts">${buildList(view.prompts.prompts, view.selectedName)}</nav>
            <div class="pp-pane">${buildPane(view, prompt)}</div>
        </div>
        <div class="am-controls">
            <span class="sv-status"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Some parts are built in code and not shown here: the tier rules of the outline and the detail tasks of the knowledge update.</span>
            <button type="button" class="menu_button" id="pp-close">Close</button>
        </div>`;
}

/** The summary line: how many prompts are edited, and that edits apply to every chat. */
function buildSummary(promptsView) {
    const edited = promptsView.editedCount
        ? `<b>${formatNumber(promptsView.editedCount)} of ${formatNumber(promptsView.prompts.length)} edited</b>`
        : 'All built-in';
    return `What Story Arc sends to the planning and tracker models, as templates it fills in. ${edited} · your edits apply to every chat.`;
}

/** The list: two groups, one row per prompt with its state word and when it runs. */
function buildList(prompts, selectedName) {
    return PROMPT_GROUPS.map(group => `
        <section class="pp-group" aria-labelledby="pp-g-${group.id}">
            <h3 class="pp-group-label" id="pp-g-${group.id}">${group.label}</h3>
            <ul class="pp-rows">${prompts.filter(prompt => prompt.group === group.id).map(prompt => `
                <li><button type="button" class="pp-row" data-pp="${escapeHtml(prompt.name)}" aria-current="${prompt.name === selectedName}">
                    <span class="pp-row-name">${escapeHtml(prompt.displayName)}</span>${buildStateWord(prompt)}
                    <span class="pp-row-runs">${escapeHtml(prompt.runs)}</span>
                </button></li>`).join('')}
            </ul>
        </section>`).join('');
}

/** The state word: Built-in, Edited with a pen, or Edited · built-in changed with an info icon. */
function buildStateWord(prompt) {
    if (prompt.state === 'changed') {
        return '<span class="pp-state is-edited is-changed"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>Edited · built-in changed</span>';
    }
    if (prompt.state === 'edited') {
        return '<span class="pp-state is-edited"><i class="fa-solid fa-pen" aria-hidden="true"></i>Edited</span>';
    }
    return '<span class="pp-state">Built-in</span>';
}

/** The pane: the prompt's name and facts, the Template / Last sent switch, then the chosen view. */
function buildPane(view, prompt) {
    let body = buildTemplateView(prompt, view.draft, view.message);
    if (view.mode === 'builtin') body = buildBuiltInView(prompt);
    if (view.mode === 'sent') body = buildSentView(prompt, view.lastSent, view.revealed);
    return `
        <div class="pp-pane-head">
            <div class="pp-pane-title"><h3>${escapeHtml(prompt.displayName)}</h3>
                <p>${escapeHtml(prompt.name)} · ${escapeHtml(prompt.runs)} · ${escapeHtml(prompt.profile)}</p></div>
            ${buildTools(view, prompt)}
        </div>${body}`;
}

/** The Template / Last sent switch, and Reveal while a last-sent prompt is on show. */
function buildTools(view, prompt) {
    const isSent = view.mode === 'sent';
    const reveal = isSent && view.lastSent ? `
        <label class="am-switch"><input type="checkbox" role="switch" id="pp-reveal" ${view.revealed ? 'checked' : ''}>
            <span class="am-switch-track" aria-hidden="true"></span>Reveal <span class="am-switch-state">${view.revealed ? 'shown' : 'hidden'}</span></label>` : '';
    return `<div class="pp-pane-tools">
        <fieldset class="am-seg" role="radiogroup" aria-label="Which text of ${escapeHtml(prompt.displayName)}">
            <label class="am-seg-opt"><input type="radio" name="pp-mode" value="template" ${isSent ? '' : 'checked'}><i class="fa-solid fa-file-lines" aria-hidden="true"></i><span>Template</span></label>
            <label class="am-seg-opt"><input type="radio" name="pp-mode" value="sent" ${isSent ? 'checked' : ''}><i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span>Last sent</span></label>
        </fieldset>${reveal}
    </div>`;
}

/** The template view: the note, the checks, the editor and its buttons. */
function buildTemplateView(prompt, draft, message) {
    return `
        ${buildChangedNote(prompt, 'template')}
        <div class="pp-checks" id="pp-checks">${buildPromptChecks(prompt, draft)}</div>
        <label class="sr" for="${PROMPT_EDITOR_ID}">Template of ${escapeHtml(prompt.displayName)}</label>
        <textarea id="${PROMPT_EDITOR_ID}" class="text_pole pp-editor" spellcheck="false">${escapeHtml(draft.text)}</textarea>
        <div class="pp-actions" id="pp-actions">${buildPromptActions(prompt, draft, message)}</div>`;
}

/**
 * The note on a prompt whose built-in text changed since the edit: Show
 * built-in (not while it shows), Keep mine, Reset to built-in.
 */
function buildChangedNote(prompt, mode) {
    if (prompt.state !== 'changed') return '';
    return `<div class="am-alert is-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        <p>The built-in prompt changed in this version of Story Arc since you edited it. Your edit is still the one sent.</p>
        <div class="am-alert-actions">
            ${mode === 'builtin' ? '' : SHOW_BUILT_IN_BUTTON}
            <button type="button" class="menu_button am-quiet" data-act="keep">Keep mine</button>
            <button type="button" class="menu_button" data-act="reset"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Reset to built-in</button>
        </div></div>`;
}

/**
 * What changes while the player types: one warning per missing and unknown
 * placeholder, then the count line with SillyTavern's expand icon.
 * Rebuilt into #pp-checks; the textarea stays.
 * @param {object} prompt - One prompt of describePrompts
 * @param {{text: string, missing: string[], unknown: string[]}} draft - The text in the editor and its check
 * @returns {string} HTML
 */
export function buildPromptChecks(prompt, draft) {
    // The note already offers the built-in text: one button for it, not two.
    const showBuiltIn = prompt.state === 'changed' ? '' : `<div class="am-alert-actions">${SHOW_BUILT_IN_BUTTON}</div>`;
    const warnings = [];
    for (const name of draft.missing) {
        const meaning = MISSING_PLACEHOLDER_MEANING[name] || 'what Story Arc fills in there never reaches the model';
        warnings.push(`<div class="am-alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <p><code>{{${escapeHtml(name)}}}</code> is missing: ${meaning}.</p>${warnings.length ? '' : showBuiltIn}</div>`);
    }
    for (const name of draft.unknown) {
        warnings.push(`<div class="am-alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <p><code>{{${escapeHtml(name)}}}</code> is not in this prompt's built-in text: Story Arc may not fill it in, and then the model gets it as written.</p></div>`);
    }

    const total = prompt.placeholders.length;
    const filled = total - draft.missing.length;
    const count = draft.missing.length
        ? `Fills ${formatNumber(filled)} of ${formatNumber(total)} placeholders`
        : `Fills all ${formatNumber(total)} placeholders`;
    return `${warnings.join('')}
        <div class="pp-field-bar"><p class="pp-count">${count} · ${formatNumber(draft.text.length)} characters</p>${EXPAND_EDITOR}</div>`;
}

/**
 * The editor's buttons: Save (the one primary, disabled while nothing
 * changed), Reset to built-in (edited prompts only), Discard changes (only
 * with unsaved changes), and the message with Undo. Rebuilt into #pp-actions.
 * @param {object} prompt - One prompt of describePrompts
 * @param {{text: string}} draft - The text in the editor
 * @param {{ok: boolean, text: string, undo: boolean}|null} message - After Save, Reset or Keep mine
 * @returns {string} HTML
 */
export function buildPromptActions(prompt, draft, message) {
    const hasUnsavedChanges = draft.text !== prompt.text;
    const reset = prompt.state === 'built-in' ? '' : '<button type="button" class="menu_button am-quiet" data-act="reset"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Reset to built-in</button>';
    const discard = hasUnsavedChanges ? '<button type="button" class="menu_button am-quiet" data-act="discard">Discard changes</button>' : '';
    let messageLine = '';
    if (message) {
        const icon = message.ok ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : '';
        const undo = message.undo ? ' <button type="button" class="am-link-btn" data-act="undo">Undo</button>' : '';
        messageLine = `<span class="am-inline-msg${message.ok ? ' is-ok' : ''}" role="status">${icon}${escapeHtml(message.text)}${undo}</span>`;
    }
    return `<button type="button" class="menu_button am-primary" data-act="save" ${hasUnsavedChanges ? '' : 'disabled'}><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>Save</button>
        ${reset}
        ${discard}
        ${messageLine}`;
}

/** Show built-in: the shipped text, read-only, with the way back to the edit. */
function buildBuiltInView(prompt) {
    return `
        ${buildChangedNote(prompt, 'builtin')}
        <div class="pp-read-bar"><span><b>Built-in prompt</b>, read-only · ${formatNumber(prompt.placeholders.length)} placeholders · ${formatNumber(prompt.builtIn.length)} characters</span>
            <button type="button" class="am-link-btn" data-act="back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>Back to your edit</button>${EXPAND_READER}</div>
        <div class="sv-text pp-read" tabindex="0">${escapeHtml(prompt.builtIn)}</div>
        <div class="pp-actions"></div>`;
}

/** Last sent: empty, hidden behind Reveal, or the filled text. */
function buildSentView(prompt, lastSent, revealed) {
    if (!lastSent) {
        return `<div class="pp-empty"><h4>Nothing sent yet this session</h4>
            <p>Story Arc keeps the last prompt of each kind it sent, with everything filled in, until SillyTavern reloads.</p>
            <p class="muted">When it is sent: ${escapeHtml(prompt.runs)}.</p></div>
            <div class="pp-actions"></div>`;
    }

    const sentAt = new Date(lastSent.at);
    const time = Number.isNaN(sentAt.getTime()) ? '' : `at <b>${sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b> `;
    const source = lastSent.edited ? 'from your edit' : 'from the built-in prompt';
    // The expand icon only once the text shows: a hidden prompt has nothing to enlarge.
    const bar = `<div class="pp-read-bar"><span>Sent ${time}for ${escapeHtml(lastSent.purpose)} · ${formatNumber(lastSent.length)} characters, about ${formatNumber(estimateTokens(lastSent.text))} tokens · ${source}</span>${revealed ? EXPAND_READER : ''}</div>`;
    if (!revealed) {
        return `${bar}<div class="pp-hidden-wrap"><p><span class="sv-hidden"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i>Filled prompt hidden</span></p>
            <p>It carries what the plans keep from you: the arcs' secrets, the developments the story may reach and the clues the narrator claims.</p>
            <p class="muted">Switch on Reveal to read it. It hides again when the popup closes.</p></div>
            <div class="pp-actions"></div>`;
    }
    return `${bar}<div class="sv-text pp-read" tabindex="0">${escapeHtml(lastSent.text)}</div><div class="pp-actions"></div>`;
}

/**
 * The drawer's Prompts button, beside Create arc preset, with a muted
 * "N edited" while any prompt is edited.
 * @param {{editedCount: number}} promptsView - describePrompts
 * @returns {string} HTML
 */
export function buildPromptsButton(promptsView) {
    const count = promptsView.editedCount ? ` <span class="muted">${formatNumber(promptsView.editedCount)} edited</span>` : '';
    return `<button type="button" id="story-arc-prompts-btn" class="menu_button" title="The prompts Story Arc sends to the planning and tracker models: read the last one sent, edit the wording"><i class="fa-solid fa-file-lines" aria-hidden="true"></i> Prompts${count}</button>`;
}

/**
 * The drawer's note under the buttons, only while an edited prompt's
 * built-in text changed since the edit.
 * @param {{prompts: object[]}} promptsView - describePrompts
 * @returns {string} HTML, empty when no prompt is `changed`
 */
export function buildPromptsDrawerNote(promptsView) {
    const changedNames = promptsView.prompts.filter(prompt => prompt.state === 'changed').map(prompt => prompt.displayName);
    if (!changedNames.length) return '';
    const named = changedNames.length === 1
        ? `The built-in ${changedNames[0]} prompt changed since you edited it.`
        : `The built-in ${changedNames.slice(0, -1).join(', ')} and ${changedNames.at(-1)} prompts changed since you edited them.`;
    return `<div class="story-arc-drawer-note" role="status"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        <span>${escapeHtml(named)} Open Prompts to compare or reset.</span></div>`;
}
