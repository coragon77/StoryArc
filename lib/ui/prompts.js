/**
 * @file The Prompts popup and the drawer's Prompts entry, as pure HTML builders
 * @module ui/prompts
 *
 * What Story Arc sends to the planning and tracker models, as templates it
 * fills in: the seven prompts in two groups on the left, the chosen prompt on
 * the right with a Template / Last sent switch. Built on the Arc Manager's
 * grammar (head, segmented control, Reveal switch, alert and note lines,
 * status bar) and the sent view's reader; lib/css/prompts.css holds only what
 * those lack.
 *
 * Every builder takes plain views: the prompts as describePrompts returns
 * them ({ prompts, editedCount }), the draft in the editor and the last-sent
 * record. Nothing here opens, saves or listens.
 *
 * While the player types, only buildPromptChecks and buildPromptActions are
 * rebuilt (into #pp-checks and #pp-actions); the textarea is never
 * re-rendered, so SillyTavern's large editor keeps writing into it.
 */

import { escapeHtml } from '/scripts/utils.js';
import { estimateTokens } from '../context/chat-history.js';
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
};

/** SillyTavern's own expand icon: its document handler opens the large editor for `data-for`. */
const EXPAND_EDITOR = `<i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="${PROMPT_EDITOR_ID}" title="Expand the editor" role="button" tabindex="0" aria-label="Expand the editor"></i>`;
/** The same icon for a read-only text: Story Arc opens it in a large popup of its own. */
const EXPAND_READER = '<i class="pp-expand-read fa-solid fa-maximize right_menu_button" data-act="expand-read" title="Expand" role="button" tabindex="0" aria-label="Expand"></i>';
const SHOW_BUILT_IN_BUTTON = '<button type="button" class="menu_button" data-act="show-builtin"><i class="fa-solid fa-eye" aria-hidden="true"></i>Show built-in</button>';

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
            <p><code>{{${escapeHtml(name)}}}</code> is not one Story Arc fills in: the model gets it as written.</p></div>`);
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
        const runs = prompt.runs.charAt(0).toLowerCase() + prompt.runs.slice(1);
        return `<div class="pp-empty"><h4>Nothing sent yet this session</h4>
            <p>Story Arc keeps the last prompt of each kind it sent, with everything filled in, until SillyTavern reloads. ${escapeHtml(prompt.displayName)} is sent ${escapeHtml(runs)}.</p></div>
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
