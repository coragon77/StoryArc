/**
 * @file Knowledge popup — review what the updates changed and correct the knowledge ledger by hand
 * @module ui/knowledge-popup
 *
 * Opened from the Arc Manager, the wand menu and the drawer (ADR-0007). Three
 * tabs. "What changed" lists the change items of the newest update records
 * (listChangeItems), one line per change with its fixes and "Fine" on the
 * line; reviewed lines fold away, records stored before the items show as
 * count summaries. "Cast & facts" is one search field over characters,
 * aliases and facts, with each character's and fact's sheet, the add forms,
 * merge and delete in place. "Map" draws the cast in rings around the scene
 * for seeing and finding: selecting a character opens the same character
 * sheet beside it, a drop of one character onto another its merge preview.
 * The names to check sit in the first two tabs and are marked on the map. Facts are
 * shown openly; only a holder entry from an arc plan (`how: 'plan'`) stays
 * hidden until revealed. Every edit goes through saveLedgerEdit and can be
 * undone from the status bar while the popup is open (#68).
 *
 * Every holder entry created here is user-entered (`how: 'user'`,
 * `at: null`), which survives every rollback; so is every detail entry
 * (`by: 'user'`, `at: null`), which also locks its kind against the
 * extraction.
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { chat, saveMetadata } from '/script.js';
import { getKnowledgeLedger, isCharacterDetailsEnabled } from '../core/settings.js';
import { DETAIL_KINDS, DETAIL_STATUS_VALUES, HOLDER_HOW } from '../core/constants.js';
import { characterDisplayName, characterName, isDetailLocked, isSameDetailValue, listChangeItems, nextLedgerId } from '../knowledge/ledger.js';
import { foldName, listCharactersWithNames, listTakenNames, nameWords } from '../knowledge/names.js';
import { messageIdOf } from '../knowledge/message-ids.js';
import { updateKnowledgeStatus } from './knowledge-status.js';
import { createUndoStack } from './undo-stack.js';

/**
 * Show the knowledge popup for the current chat.
 */
export async function showKnowledgePopup() {
    knowledgeView = createKnowledgeView();
    mapScreenPositions = new Map();
    mapRenderCache = null;
    const html = buildKnowledgeContent(getKnowledgeLedger(), chat, isCharacterDetailsEnabled(), knowledgeView);

    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        // The tab panels scroll, so the search field and the status bar stay put.
        allowVerticalScrolling: false,
    });

    const popupPromise = popup.show();
    startKnowledgeUndoSession();
    try {
        // Small delay for DOM render (same as the arc manager)
        await delay(50);
        wireKnowledgeEvents(popup);
        drawKeyHints();
        await popupPromise;
    } finally {
        // Cleanup — leaving these bound fires them again from the next popup
        $(document).off('.storyArcKnowledge');
        mapStageObserver?.disconnect();
        mapStageObserver = null;
        mapScreenPositions = new Map();
        mapRenderCache = null;
        Object.assign(mapPointer, { pointerId: null, id: null, isPanning: false, isDragging: false });
        endKnowledgeUndoSession();
    }
}

/**
 * The undo stack of the open popup session; null while no popup is open,
 * so a ledger edit saved from elsewhere records nothing.
 * @type {ReturnType<typeof createUndoStack>|null}
 */
let knowledgeUndo = null;

/**
 * Start an empty undo stack for a new popup session. Undo never outlives the
 * popup: the next one starts with nothing to undo.
 */
export function startKnowledgeUndoSession() {
    knowledgeUndo = createUndoStack({
        read: getKnowledgeLedger,
        write: restoreStoredLedger,
        changedMessage: 'The ledger changed since this edit (an update ran); undo is no longer possible.',
    });
}

/** End the popup session; its undo stack is dropped. */
export function endKnowledgeUndoSession() {
    knowledgeUndo = null;
}

/**
 * Put a ledger snapshot back into the stored ledger object, key by key in
 * the snapshot's order, so the next undo's comparison sees the exact state
 * the earlier edit produced. The object is kept for the reason
 * saveLedgerEdit gives.
 * @param {object} snapshot
 */
function restoreStoredLedger(snapshot) {
    const storedLedger = getKnowledgeLedger();
    for (const key of Object.keys(storedLedger)) delete storedLedger[key];
    Object.assign(storedLedger, snapshot);
}

// ─── View state ─────────────────────────────────────────────────────────────

/**
 * The open popup's view state: which tab, what is typed and open. Only the
 * popup reads it; nothing in it is stored with the chat.
 * @type {ReturnType<typeof createKnowledgeView>}
 */
let knowledgeView = createKnowledgeView();

/**
 * A fresh view state, as the popup opens: What changed, nothing typed, no
 * editor open, the plan holders hidden.
 * - `editors`: area → the open editor `{ mode, characterId?, factId?, kind?, targetId?, keepSelf?, shown? }`.
 *   An area is a What changed line (its key), a name check (`clash:<id>`), the
 *   character sheet (`sheet`), the fact sheet (`fs`) or an add sheet (`add`).
 * - `drafts`: field key → what the player typed, so a redraw never loses it.
 * - `sheet`: the open sheet `{ type: 'character'|'fact'|'add', id, back?, from? }`.
 * - `recordFacts`: the facts an earlier record stored, shown in Cast & facts.
 * - `moved`: line key → { fromId: toId } for the holder moves made from that line.
 * - `keep`: line keys a fix reviewed, kept visible until the popup closes.
 * - `undoLabels`: what each undoable edit of this session did, newest last.
 * - `map`: the Map tab's pane size (measured), zoom (1 fits the cast) and
 *   pan, its filter, the node the arrow keys are on, the character picked up
 *   with M (`carry`) and a drag in progress `{ id, x, y, overId }`.
 * - `focusKey` / `focusAfter`: where the focus goes after the next redraw (restoreFocus).
 * @returns {object}
 */
export function createKnowledgeView() {
    return {
        tab: 'changes',
        showReviewed: false,
        openGroups: new Set(),
        keep: new Set(),
        editors: new Map(),
        drafts: {},
        errors: {},
        revealed: new Set(),
        query: '',
        recordFacts: null,
        charLimit: 8,
        factLimit: 15,
        sheet: null,
        heldQuery: '',
        heldLimit: 30,
        touched: [],
        stripOpen: { changes: false, cast: false },
        foldOpen: { retracted: false, all: false },
        newFactHolders: [],
        moved: {},
        fixes: {},
        pickerActive: {},
        status: { message: 'Every edit saves at once; Undo stays here until the next update.', kind: 'info' },
        undoLabels: [],
        map: { pane: { w: 1000, h: 600 }, zoom: 1, panX: 0, panY: 0, filter: '', focusId: null, carry: null, drag: null },
    };
}

// ─── What changed: the lines ────────────────────────────────────────────────

/** The order of the line types inside one record */
const LINE_ORDER = ['character', 'detail', 'fact', 'learned', 'retracted', 'name', 'scene'];

/**
 * The What changed lines of the update log. Each record that lists its
 * change items (listChangeItems) is a group, newest first; within it one
 * line per change: a new character, a detail set, a new fact with the
 * holders it was learned by, holders added to an older fact ("learned"), a
 * retraction, a name, the scene. A line covers one or more items and counts
 * as reviewed when every one is marked (reviewedMarks). Records without
 * items (older records, skips and rollbacks) come back as `earlier`, newest
 * first. Without `withDetails` the detail lines are left out, as the popup
 * shows no details then.
 * @param {object} ledger
 * @param {boolean} [withDetails]
 * @returns {{ groups: { key: string, record: object, lines: object[] }[], earlier: object[] }}
 */
export function listChangeLines(ledger, withDetails = true) {
    const updateLog = ledger.updateLog || [];
    const reviewedMarks = new Set(ledger.reviewedMarks || []);
    const groups = [];
    const earlier = [];
    for (let index = updateLog.length - 1; index >= 0; index--) {
        const record = updateLog[index];
        if (!record.items) {
            earlier.push(record);
            continue;
        }
        const groupKey = `r${index}`;
        const lines = changeLinesOfRecord(record, groupKey, withDetails);
        for (const line of lines) line.reviewed = line.itemKeys.every(key => reviewedMarks.has(key));
        groups.push({ key: groupKey, record, lines });
    }
    return { groups, earlier };
}

/**
 * The lines of one record, in LINE_ORDER. The holder items of one fact make
 * one line: "fact" when the record created the fact, else "learned".
 * @param {object} record - An updateLog record with items
 * @param {string} groupKey
 * @param {boolean} withDetails
 * @returns {object[]} Each `{ key, groupKey, type, itemKeys, ... }`; key is its first item's key
 */
function changeLinesOfRecord(record, groupKey, withDetails) {
    const lines = [];
    const factLines = new Map();
    const newLine = (type, item, fields) => ({ key: item.key, groupKey, type, itemKeys: [item.key], ...fields });
    for (const item of listChangeItems(record)) {
        if (item.kind === 'character') lines.push(newLine('character', item, { characterId: item.characterId }));
        if (item.kind === 'detail' && withDetails) {
            lines.push(newLine('detail', item, { characterId: item.characterId, detailKind: item.detailKind, messageId: item.messageId }));
        }
        if (item.kind === 'holder') {
            const factLine = factLines.get(item.factId);
            if (factLine) {
                factLine.itemKeys.push(item.key);
                factLine.holderIds.push(item.characterId);
                continue;
            }
            const type = (record.factsCreated || []).includes(item.factId) ? 'fact' : 'learned';
            const line = newLine(type, item, { factId: item.factId, holderIds: [item.characterId] });
            factLines.set(item.factId, line);
            lines.push(line);
        }
        if (item.kind === 'retracted') lines.push(newLine('retracted', item, { factId: item.factId }));
        if (item.kind === 'name') lines.push(newLine('name', item, { characterId: item.characterId, name: item.name }));
        if (item.kind === 'scene') lines.push(newLine('scene', item, { present: item.present }));
    }
    return lines.sort((first, second) => LINE_ORDER.indexOf(first.type) - LINE_ORDER.indexOf(second.type));
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/** How a holder learned a fact, as the popup shows it */
const HOW_LABELS = {
    [HOLDER_HOW.witnessed]: 'witnessed',
    [HOLDER_HOW.told]: 'told',
    [HOLDER_HOW.user]: 'entered by you',
    [HOLDER_HOW.plan]: 'planned',
};

/** A detail kind as a label */
const KIND_LABELS = { gender: 'Gender', age: 'Age', role: 'Role', relation: 'Relation', status: 'Status' };

/**
 * The whole popup: the heading with the ledger's size, the two tabs, the
 * open tab's panel and the status bar with Undo and Close.
 * @param {object} ledger - The knowledge ledger
 * @param {object[]} [chatMessages] - ST's chat array, to find a name check's message by its message id
 * @param {boolean} [withDetails] - Whether character details are switched on (isCharacterDetailsEnabled)
 * @param {object} [view] - The view state (createKnowledgeView)
 * @returns {string} HTML string
 */
export function buildKnowledgeContent(ledger, chatMessages = [], withDetails = true, view = createKnowledgeView()) {
    const context = createRenderContext(ledger, chatMessages, withDetails, view);
    const isWhatChanged = view.tab === 'changes';
    const isCast = view.tab === 'cast';
    const isMap = view.tab === 'map';
    return `
    <div class="story-arc-knowledge" id="story-arc-knowledge">
        <div class="k-head"><h2 class="k-title" id="sa-k-title" tabindex="-1">Knowledge</h2><p class="k-meta" id="sa-k-meta">${buildMetaText(context)}</p></div>
        <div class="k-tabs" role="tablist" aria-label="Knowledge">
            <button type="button" class="k-tab" role="tab" id="sa-k-tab-changes" aria-controls="sa-k-panel-changes" data-act="tab" data-tab="changes" aria-selected="${isWhatChanged}" tabindex="${isWhatChanged ? 0 : -1}">What changed ${buildChangesCount(context)}</button>
            <button type="button" class="k-tab" role="tab" id="sa-k-tab-cast" aria-controls="sa-k-panel-cast" data-act="tab" data-tab="cast" aria-selected="${isCast}" tabindex="${isCast ? 0 : -1}">Cast &amp; facts</button>
            <button type="button" class="k-tab" role="tab" id="sa-k-tab-map" aria-controls="sa-k-panel-map" data-act="tab" data-tab="map" aria-selected="${isMap}" tabindex="${isMap ? 0 : -1}">Map</button>
        </div>
        <div class="k-panel" role="tabpanel" id="sa-k-panel-changes" aria-labelledby="sa-k-tab-changes"${isWhatChanged ? '' : ' hidden'}>${isWhatChanged ? buildWhatChangedPanel(context) : ''}</div>
        <div class="k-panel" role="tabpanel" id="sa-k-panel-cast" aria-labelledby="sa-k-tab-cast"${isCast ? '' : ' hidden'}>${isCast ? buildCastPanel(context) : ''}</div>
        <div class="k-panel" role="tabpanel" id="sa-k-panel-map" aria-labelledby="sa-k-tab-map"${isMap ? '' : ' hidden'}>${isMap ? buildMapPanel(context) : ''}</div>
        <div class="k-statusbar">
            <div class="k-status" id="sa-k-status">${buildStatus(view)}</div>
            <div class="k-hints" id="sa-k-hints" aria-hidden="true"></div>
            <button type="button" class="menu_button" data-act="close">Close</button>
        </div>
    </div>`;
}

/**
 * What every builder reads: the ledger, the view and lookups built once per
 * render. `held` is per character the facts they hold, how often they told
 * someone and the latest message of their entries.
 * @returns {object}
 */
function createRenderContext(ledger, chatMessages, withDetails, view) {
    const charactersById = new Map(ledger.characters.map(character => [character.id, character]));
    const held = new Map(ledger.characters.map(character => [character.id, { list: [], told: 0, last: -1 }]));
    for (const fact of ledger.facts) {
        for (const holder of fact.holders) {
            const holdings = held.get(holder.characterId);
            if (holdings) {
                holdings.list.push({ fact, holder });
                if (holder.at !== null && holder.at !== undefined && holder.at > holdings.last) holdings.last = holder.at;
            }
            const teller = holder.toldBy && held.get(holder.toldBy);
            if (teller) teller.told++;
        }
    }
    return {
        ledger,
        chatMessages,
        withDetails,
        view,
        charactersById,
        held,
        lines: listChangeLines(ledger, withDetails),
        retractedFacts: ledger.retractedFacts || [],
        present: ledger.scene?.present || [],
    };
}

/** The facts a character holds, with the counts (createRenderContext) */
function heldOf(context, characterId) {
    return context.held.get(characterId) || { list: [], told: 0, last: -1 };
}

/** The facts a character holds other than through an arc plan: what the popup counts as what they know */
function knownHoldingsOf(context, characterId) {
    return heldOf(context, characterId).list.filter(({ holder }) => holder.how !== HOLDER_HOW.plan);
}

/** A character's display name by id, or a note that the record is gone */
function nameOf(context, characterId) {
    const character = context.charactersById.get(characterId);
    return character ? characterDisplayName(context.ledger, character) : 'a character no longer in the ledger';
}

/** The latest entry of a detail kind, or null while unknown */
function currentDetail(character, kind) {
    const history = character?.details?.[kind];
    return history?.length ? history[history.length - 1] : null;
}

/** The latest entry of a kind the story wrote (not the player's) */
function storyDetail(character, kind) {
    return (character?.details?.[kind] || []).filter(entry => entry.by !== 'user').at(-1) || null;
}

/** A detail value as text; a relation as "<other>'s <kinship>", like the display name */
function detailValueText(context, kind, value) {
    if (kind === 'relation') return `${nameOf(context, value.of)}'s ${value.kind}`;
    return String(value);
}

/** gender · age · role · status (and relation for a named character), as known */
function detailsSummary(context, character) {
    if (!context.withDetails) return character.aliases.length ? `also ${character.aliases.join(', ')}` : '';
    const parts = [];
    for (const kind of ['gender', 'age', 'role', 'status']) {
        const entry = currentDetail(character, kind);
        if (entry) parts.push(detailValueText(context, kind, entry.value));
    }
    const relation = currentDetail(character, 'relation');
    if (character.name.trim() && relation) parts.push(detailValueText(context, 'relation', relation.value));
    return parts.join(' · ');
}

/** How a holder learned a fact, with the teller */
function howText(context, holder) {
    if (holder.how === HOLDER_HOW.told && holder.toldBy) return `told by ${nameOf(context, holder.toldBy)}`;
    return HOW_LABELS[holder.how] || holder.how;
}

/** Where a holder entry comes from */
function atText(holder) {
    return holder.at === null || holder.at === undefined ? 'entered by you' : `message #${holder.at}`;
}

/** The latest message of a fact's entries, -1 when only the player entered it */
function factAt(fact) {
    return fact.holders.reduce((latest, holder) => (holder.at !== null && holder.at !== undefined && holder.at > latest ? holder.at : latest), -1);
}

/** A fact by id: live, retracted (with the message that took it back) or gone */
function factState(context, factId) {
    const liveFact = context.ledger.facts.find(fact => fact.id === factId);
    if (liveFact) return { fact: liveFact, state: 'live' };
    const retraction = context.retractedFacts.findLast(candidate => candidate.fact.id === factId);
    if (retraction) return { fact: retraction.fact, state: 'retracted', at: retraction.at };
    return { fact: null, state: 'gone' };
}

/** "3 facts", "1 fact" */
function plural(count, one, many = `${one}s`) {
    return `${count} ${count === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C" */
function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "5" or "5–6" */
function rangeText(from, to) {
    return from === to ? `${from}` : `${from}–${to}`;
}

/**
 * A button in ST's own look. `data-fk` names it for the focus restore after
 * a redraw: its action and data.
 */
function buildButton({ act, label = '', icon = '', data = {}, cls = '', aria = '', title = '', disabled = false, expanded = null }) {
    const dataAttributes = Object.entries(data).map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`).join('');
    const focusKey = escapeHtml([act, ...Object.values(data)].join('|'));
    return `<button type="button" class="menu_button k-btn ${cls}" data-act="${act}"${dataAttributes} data-fk="${focusKey}"`
        + `${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}${title ? ` title="${escapeHtml(title)}"` : ''}${disabled ? ' disabled' : ''}`
        + `${expanded === null ? '' : ` aria-expanded="${expanded}"`}>`
        + `${icon ? `<i class="fa-solid fa-${icon}" aria-hidden="true"></i>` : ''}${label ? `<span>${escapeHtml(label)}</span>` : ''}</button>`;
}

/** A character's name as a link-like button that opens their sheet */
function buildNameButton(context, characterId, from = '') {
    if (!context.charactersById.has(characterId)) return escapeHtml(nameOf(context, characterId));
    return `<button type="button" class="k-name" data-act="sheet" data-cid="${escapeHtml(characterId)}" data-from="${escapeHtml(from)}" data-fk="sheet|${escapeHtml(characterId)}|${escapeHtml(from)}" title="Open in Cast &amp; facts">${escapeHtml(nameOf(context, characterId))}</button>`;
}

/** A field's typed value, or what it shows before any typing */
function draftOf(context, key, fallback) {
    return Object.prototype.hasOwnProperty.call(context.view.drafts, key) ? context.view.drafts[key] : fallback;
}

/** The error of an area's last refused edit, or '' */
function buildError(context, area) {
    const error = context.view.errors[area];
    return error ? `<p class="k-error" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>${escapeHtml(error)}</p>` : '';
}

/** A check mark with text */
function buildOkMark(text) {
    return `<span class="k-mark is-ok"><i class="fa-solid fa-check" aria-hidden="true"></i>${escapeHtml(text)}</span>`;
}

/** Keys as <kbd>: "Ctrl Z" → two keys */
function buildKeys(keys) {
    return keys.split(' ').map(key => `<kbd>${escapeHtml(key)}</kbd>`).join(' ');
}

/** characters · facts · updated at · in the scene */
function buildMetaText(context) {
    const { ledger } = context;
    if (ledger.characters.length === 0 && ledger.facts.length === 0) return 'The ledger is empty · no update yet';
    const presentNames = context.present.map(characterId => nameOf(context, characterId));
    const updated = ledger.lastUpdatedAt === null || ledger.lastUpdatedAt === undefined ? 'not updated yet' : `updated at message #${ledger.lastUpdatedAt}`;
    return escapeHtml(`${plural(ledger.characters.length, 'character')} · ${plural(ledger.facts.length, 'fact')} · ${updated} · in the scene: ${joinNames(presentNames) || 'nobody'}`);
}

/** The number of open lines, on the What changed tab */
function buildChangesCount(context) {
    const openCount = context.lines.groups.flatMap(group => group.lines).filter(line => !line.reviewed).length;
    return `<span class="k-count" id="sa-k-changes-count" data-zero="${openCount === 0}" aria-label="${openCount} to review">${openCount}</span>`;
}

/** The status message and the Undo button */
function buildStatus(view) {
    const { message, kind } = view.status;
    const icon = kind === 'ok' ? 'check' : kind === 'refused' ? 'circle-exclamation' : 'circle-info';
    const messageHtml = message
        ? `<span class="k-status-msg is-${kind}" role="status" aria-live="polite" title="${escapeHtml(message)}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i>${escapeHtml(message)}</span>`
        : '<span class="k-status-msg" role="status" aria-live="polite"></span>';
    const newestLabel = view.undoLabels[view.undoLabels.length - 1];
    const undoHtml = newestLabel ? buildButton({ act: 'undo', label: 'Undo', icon: 'rotate-left', title: `Undo: ${newestLabel} (Ctrl+Z)` }) : '';
    return messageHtml + undoHtml;
}

// ─── Names to check ─────────────────────────────────────────────────────────

/**
 * The names to check, in both tabs: each character the extraction added
 * with a name another character has, who has it now, the message it was
 * named in, and the three fixes. Names and message numbers only, never a
 * fact. '' when nothing is flagged.
 * @param {object} context
 * @param {'changes'|'cast'} tab
 * @returns {string} HTML string
 */
function buildNamesToCheck(context, tab) {
    const flaggedCharacters = context.ledger.characters.filter(character => character.nameClash);
    if (flaggedCharacters.length === 0) return '';

    const rowsHtml = flaggedCharacters.map(character => {
        const area = `clash:${character.id}`;
        const editor = context.view.editors.get(area);
        const nameLines = listNameClashLines(context, character);
        const messageIndex = findNameClashMessage(character.nameClash, context.chatMessages);
        const whyHtml = nameLines.length
            ? `${nameLines.map(line => `<q>${escapeHtml(line.name)}</q> is also a name of ${escapeHtml(joinNames(line.names))}`).join('; ')} · named in message #${escapeHtml(String(messageIndex))}`
            : `No other character has this name any more: the clash is gone. · named in message #${escapeHtml(String(messageIndex))}`;
        return `<li class="k-clash" data-area="${escapeHtml(area)}" data-character-id="${escapeHtml(character.id)}">
            <span class="k-clash-who">${buildNameButton(context, character.id, area)}</span>
            <span class="k-clash-why">${whyHtml}</span>
            <span class="k-row-actions">${buildClashActions(character, area, editor, nameLines.length > 0)}</span>
            ${editor ? `<div class="k-editor${editor.mode === 'delete' ? ' is-danger' : ''}">${buildEditor(context, area, editor)}</div>` : ''}
        </li>`;
    }).join('');
    const isOpen = context.view.stripOpen[tab];
    const peek = flaggedCharacters.map(character => characterDisplayName(context.ledger, character)).join(', ');
    return `<details class="k-strip" id="sa-k-names-${tab}" data-strip="${tab}"${isOpen ? ' open' : ''}>
        <summary><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><span class="k-strip-title"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Names to check (${flaggedCharacters.length})</span><span class="k-strip-peek">${escapeHtml(peek)}</span></summary>
        <p class="k-strip-note">Added by the story with a name another character has. Keep the name for a relative, merge the same person, or rename here first and then in the chat text, so a re-read of the message does not add the old name again.</p>
        <ul>${rowsHtml}</ul>
    </details>`;
}

/** Per shared name of a flagged character, who has it now; names nobody else has drop out */
function listNameClashLines(context, character) {
    const nameLines = [];
    for (const sharedName of character.nameClash.names) {
        const others = listCharactersWithNames(context.ledger, [sharedName], character.id);
        if (others.length === 0) continue;
        nameLines.push({ name: sharedName, names: others.map(other => characterDisplayName(context.ledger, other)), ids: others.map(other => other.id) });
    }
    return nameLines;
}

function buildClashActions(character, area, editor, hasClash) {
    const data = { area, cid: character.id };
    if (!hasClash) return buildButton({ act: 'keep-name', label: 'Not a clash', data, title: 'No other character has this name any more: clear the check' });
    return buildButton({ act: 'keep-name', label: 'Keep the name', data, title: 'The name is right (a relative, say): stop flagging it' })
        + buildButton({ act: 'ed-names', label: 'Rename', icon: 'pen', data, expanded: editor?.mode === 'names' })
        + buildButton({ act: 'ed-merge', label: 'Same person as…', icon: 'code-merge', data, expanded: editor?.mode === 'merge', title: 'One person held twice: merge the two records' });
}

/**
 * The message a flagged character was named in: its current index, found by
 * its message id while that message is still in the chat, else the stored index.
 * @param {{ at: number, messageId?: string }} nameClash
 * @param {object[]} chatMessages
 * @returns {number}
 */
function findNameClashMessage(nameClash, chatMessages) {
    if (nameClash.messageId) {
        const currentIndex = chatMessages.findIndex(chatMessage => messageIdOf(chatMessage) === nameClash.messageId);
        if (currentIndex !== -1) return currentIndex;
    }
    return nameClash.at;
}

// ─── What changed ───────────────────────────────────────────────────────────

/**
 * The What changed panel: the names to check, the groups of the records
 * with items, newest first, then the earlier records as count summaries.
 * @param {object} context
 * @returns {string} HTML string
 */
function buildWhatChangedPanel(context) {
    const { groups, earlier } = context.lines;
    if (groups.length === 0 && earlier.length === 0) {
        return `<div class="k-changes">${buildNamesToCheck(context, 'changes')}<div class="k-empty"><h3>No update yet</h3>
            <p>While the knowledge tracker is on, it reads each new pair of messages and records who learned what, who is in the scene and each character's details. Every update then lists here what it changed, one line each, with the fix on the line.</p>
            <p>Nothing to review until then. To enter something by hand, use Cast &amp; facts.</p>
            <div class="k-row-actions">${buildButton({ act: 'tab', label: 'Open Cast & facts', icon: 'magnifying-glass', data: { tab: 'cast' } })}</div></div></div>`;
    }
    const openCount = groups.flatMap(group => group.lines).filter(line => !line.reviewed).length;
    let html = `<div class="k-changes">${buildNamesToCheck(context, 'changes')}
        <div class="k-intro">
            <p>What the latest updates changed, newest first. Fix a line where it is wrong; mark it Fine where it is right. Reviewed lines fold away.</p>
            <label><input type="checkbox" data-act="show-reviewed"${context.view.showReviewed ? ' checked' : ''}> Show reviewed lines</label>
        </div>`;
    if (groups.length > 0 && openCount === 0 && !context.view.showReviewed) {
        html += `<div class="k-empty" id="sa-k-changes-empty"><h3>Everything is reviewed</h3><p>The next update's changes show up here. To look something up or fix an older entry, search in Cast &amp; facts.</p>
            <div class="k-row-actions">${buildButton({ act: 'tab', label: 'Search Cast & facts', icon: 'magnifying-glass', data: { tab: 'cast' } })}<span class="k-small k-muted">or press ${buildKeys('/')}</span></div></div>`;
    }
    html += groups.map(group => buildGroup(context, group)).join('');
    html += buildEarlierRecords(context, earlier);
    return `${html}</div>`;
}

/** "Messages 5–6", "Message 5, read again" */
function recordTitle(record) {
    const range = record.from === record.to ? `Message ${record.from}` : `Messages ${record.from}–${record.to}`;
    if (record.kind === 'reextract') return `${range}, read again`;
    if (record.kind === 'rollback') return `Rolled back from message ${record.from}`;
    return range;
}

/** What a record did, as counts */
function recordCounts(record) {
    if (record.kind === 'skipped') return [`not read (${record.reason})`];
    if (record.kind === 'rollback') {
        const parts = [];
        if (record.factsDropped?.length) parts.push(`${plural(record.factsDropped.length, 'fact')} dropped`);
        if (record.holdersDropped) parts.push(`${plural(record.holdersDropped, 'holder')} dropped`);
        if (record.factsRestored?.length) parts.push(`${plural(record.factsRestored.length, 'fact')} restored`);
        if (record.detailsDropped) parts.push(`${plural(record.detailsDropped, 'detail')} dropped`);
        return parts;
    }
    const parts = [];
    const newCharacters = record.answer?.newCharacters || 0;
    if (newCharacters) parts.push(plural(newCharacters, 'new character'));
    if (record.factsCreated?.length) parts.push(`${plural(record.factsCreated.length, 'fact')} learned`);
    if (record.holdersAdded) parts.push(`${plural(record.holdersAdded, 'holder')} added`);
    const detailCount = (record.detailsSet || 0) + (record.detailsChanged || 0);
    if (detailCount) parts.push(`${plural(detailCount, 'detail')} set`);
    if (record.factsRetracted?.length) parts.push(`${plural(record.factsRetracted.length, 'fact')} retracted`);
    if (record.newNamesAdded) parts.push(plural(record.newNamesAdded, 'new name'));
    return parts;
}

/** One record's group: its heading, the review state and its open lines */
function buildGroup(context, group) {
    const { view } = context;
    const title = recordTitle(group.record);
    const summary = recordCounts(group.record).join(' · ') || 'nothing changed';
    const head = tools => `<div class="k-group-head"><h3 class="k-group-title" id="sa-k-gt-${group.key}">${escapeHtml(title)}</h3><span class="k-group-sum">${escapeHtml(summary)}</span><span class="k-group-tools">${tools}</span></div>`;
    const sectionStart = `<section class="k-group" id="sa-k-g-${group.key}" data-group="${group.key}" aria-labelledby="sa-k-gt-${group.key}">`;
    if (group.lines.length === 0) return `${sectionStart}${head('<span class="k-group-state k-muted">Nothing to review</span>')}</section>`;

    const openLines = group.lines.filter(line => !line.reviewed);
    const showsReviewed = view.showReviewed || view.openGroups.has(group.key);
    const visibleLines = group.lines.filter(line => !line.reviewed || showsReviewed || view.keep.has(line.key));
    const hiddenCount = group.lines.filter(line => line.reviewed && !view.keep.has(line.key)).length;
    if (visibleLines.length === 0) {
        const tools = buildOkMark(group.lines.length === 1 ? 'Reviewed' : `All ${group.lines.length} reviewed`)
            + buildButton({ act: 'show-group', label: 'Show', data: { group: group.key }, cls: 'is-quiet', aria: `Show the ${group.lines.length} reviewed lines of ${title}`, expanded: false });
        return `${sectionStart}${head(tools)}</section>`;
    }
    const tools = [
        openLines.length ? `<span class="k-group-state">${openLines.length} to review</span>` : buildOkMark('All reviewed'),
        hiddenCount && !view.showReviewed ? buildButton({ act: 'show-group', label: showsReviewed ? `Hide ${hiddenCount} reviewed` : `Show ${hiddenCount} reviewed`, data: { group: group.key }, cls: 'is-quiet', expanded: showsReviewed }) : '',
        openLines.length > 1 ? buildButton({ act: 'review-group', label: 'All fine', icon: 'check-double', data: { group: group.key }, title: 'Mark every open line of this update reviewed' }) : '',
    ].join('');
    return `${sectionStart}${head(tools)}<ul class="k-lines">${visibleLines.map(line => buildLine(context, line)).join('')}</ul></section>`;
}

/**
 * The earlier records: one count line each, the ones that changed nothing
 * gathered into one line. "Open in Cast & facts" shows the facts the record
 * stored, never a reconstruction by message number.
 */
function buildEarlierRecords(context, earlier) {
    if (earlier.length === 0) return '';
    let rowsHtml = '';
    let quietRecords = [];
    const flushQuiet = () => {
        if (quietRecords.length === 0) return;
        const ranges = quietRecords.map(record => rangeText(record.from, record.to) + (record.kind === 'reextract' ? ' (read again)' : ''));
        rowsHtml += `<li class="k-sum is-quiet">Nothing changed in ${escapeHtml(joinNames(ranges))}.</li>`;
        quietRecords = [];
    };
    for (const record of earlier) {
        const counts = recordCounts(record);
        if (counts.length === 0) {
            quietRecords.push(record);
            continue;
        }
        flushQuiet();
        const storedFactCount = (record.factsCreated?.length || 0) + (record.factsRetracted?.length || 0);
        // Facts the record stored open as its list; an update that stored
        // only holders or details offers the message search of its range.
        const isExtraction = record.kind === 'update' || record.kind === 'reextract';
        let openButton = '';
        if (storedFactCount > 0) {
            openButton = buildButton({ act: 'record-facts', label: 'Open in Cast & facts', icon: 'arrow-right', data: { index: (context.ledger.updateLog || []).indexOf(record) }, cls: 'is-quiet', title: 'The facts this update stored' });
        } else if (isExtraction) {
            openButton = buildButton({ act: 'message-search', label: 'Message search', icon: 'magnifying-glass', data: { from: record.from, to: record.to }, cls: 'is-quiet', title: `Everything dated in messages ${rangeText(record.from, record.to)}` });
        }
        rowsHtml += `<li class="k-sum"><span class="k-sum-range">${escapeHtml(recordTitle(record))}</span><span class="k-sum-what">${escapeHtml(counts.join(', '))}</span>${openButton}</li>`;
    }
    flushQuiet();
    return `<section class="k-group k-older" aria-labelledby="sa-k-gt-older">
        <div class="k-group-head"><h3 class="k-group-title" id="sa-k-gt-older">Earlier updates</h3><span class="k-group-sum">${plural(earlier.length, 'update')}</span></div>
        <p class="k-older-note">These were recorded as counts only. “Open in Cast &amp; facts” shows the facts such an update stored; “Message search” finds everything dated in its messages.</p>
        <ul class="k-sums">${rowsHtml}</ul></section>`;
}

/** Fine, or Reviewed with Reopen */
function buildFineButton(line) {
    if (line.reviewed) return buildOkMark('Reviewed') + buildButton({ act: 'unreview', label: 'Reopen', data: { line: line.key }, cls: 'is-quiet', aria: 'Reopen this line for review' });
    return buildButton({ act: 'review', label: 'Fine', icon: 'check', data: { line: line.key }, title: 'Fine as it is: mark reviewed (F)' });
}

/** One line: what kind of change, the sentence, its fixes and Fine, and its open editor */
function buildLine(context, line) {
    const { kind, body, actions } = buildLineBody(context, line);
    const editor = context.view.editors.get(line.key);
    const isDanger = editor && (editor.mode === 'fdelete' || editor.mode === 'delete');
    return `<li class="k-line${line.reviewed ? ' is-reviewed' : ''}" data-line="${escapeHtml(line.key)}" data-area="${escapeHtml(line.key)}" tabindex="-1">
        <div class="k-kind">${escapeHtml(kind)}</div>
        <div class="k-body">${body}</div>
        <div class="k-actions">${actions}${buildFineButton(line)}</div>
        ${editor ? `<div class="k-editor${isDanger ? ' is-danger' : ''}">${buildEditor(context, line.key, editor)}</div>` : ''}
    </li>`;
}

/** The kind label, the sentence and the fixes of a line, by its type */
function buildLineBody(context, line) {
    const { view } = context;
    const character = context.charactersById.get(line.characterId);
    if (line.type === 'character') {
        if (!character) return { kind: 'New character', body: '<p class="k-text k-muted">A character no longer in the ledger.</p>', actions: '' };
        const summary = detailsSummary(context, character);
        const editor = view.editors.get(line.key);
        return {
            kind: 'New character',
            body: `<p class="k-text">${buildNameButton(context, character.id, line.key)} is new in the ledger</p>${summary ? `<p class="k-sub">${escapeHtml(summary)}</p>` : ''}`,
            actions: buildButton({ act: 'ed-merge', label: 'Same person as…', icon: 'code-merge', data: { area: line.key, cid: character.id }, expanded: editor?.mode === 'merge', title: 'One person held twice: merge the two records' })
                + buildButton({ act: 'ed-delete', label: 'Delete…', icon: 'trash', data: { area: line.key, cid: character.id }, expanded: editor?.mode === 'delete' }),
        };
    }
    if (line.type === 'detail') return buildDetailLineBody(context, line, character);
    if (line.type === 'fact' || line.type === 'learned') return buildFactLineBody(context, line);
    if (line.type === 'retracted') {
        const { fact, state, at } = factState(context, line.factId);
        const chipsHtml = (fact?.holders || []).map(holder => buildHolderChip(context, line.key, fact, holder, false)).join('');
        let note = '';
        let actions = '';
        if (state === 'retracted') {
            note = at === null || at === undefined
                ? '<p class="k-note k-muted">You marked it not true: the narrator is no longer told it.</p>'
                : `<p class="k-note k-muted">The story said at message #${escapeHtml(String(at))} that this is no longer true, so the narrator is no longer told it.</p>`;
            actions = buildButton({ act: 'restore', label: 'Still true', icon: 'rotate-left', data: { area: line.key, fid: line.factId }, title: 'Wrongly retracted: put the fact back with its holders' });
        } else if (state === 'live') {
            note = `<p class="k-note">${buildOkMark('You put it back as true.')}</p>`;
        } else {
            note = '<p class="k-note k-muted">The fact is no longer in the ledger.</p>';
        }
        return {
            kind: 'Retracted',
            body: `<p class="k-text"><span class="k-muted">No longer true:</span> ${escapeHtml(fact?.text || '')}</p>${chipsHtml ? `<div class="k-holders"><span class="k-muted k-small">Was known to</span>${chipsHtml}</div>` : ''}${note}`,
            actions,
        };
    }
    if (line.type === 'name') {
        const stillHasName = character && [character.name, ...character.aliases].some(name => name.toLowerCase() === line.name.toLowerCase());
        const isAlias = character && character.aliases.some(alias => alias.toLowerCase() === line.name.toLowerCase());
        const body = character
            ? `<p class="k-text">“${escapeHtml(line.name)}” is now a name of ${buildNameButton(context, character.id, line.key)}</p>${stillHasName ? '' : '<p class="k-note k-muted">They no longer have this name.</p>'}`
            : `<p class="k-text">“${escapeHtml(line.name)}” went to a character no longer in the ledger.</p>`;
        const isNamedRelative = character && !isAlias && character.name.toLowerCase() === line.name.toLowerCase()
            && Boolean(character.details?.relation?.length);
        let actions = '';
        if (isAlias) actions = buildButton({ act: 'drop-alias', label: 'Not their name', icon: 'xmark', data: { area: line.key, cid: character.id, name: line.name }, title: 'Take this alias off them' });
        if (isNamedRelative) actions = buildButton({ act: 'unname', label: 'Not their name', icon: 'xmark', data: { area: line.key, cid: character.id }, title: 'The story has not named them: make them an unnamed relative again' });
        return { kind: 'New name', body, actions };
    }
    // The scene
    const presentNames = line.present.map(characterId => nameOf(context, characterId));
    return { kind: 'Scene', body: `<p class="k-text">In the scene: ${escapeHtml(joinNames(presentNames) || 'nobody')}</p>`, actions: '' };
}

/** A detail line: the value the update set, at its message, and whether it still counts */
function buildDetailLineBody(context, line, character) {
    const kindName = line.detailKind;
    if (!character) return { kind: 'Detail', body: `<p class="k-text">${escapeHtml(kindName)} of a character no longer in the ledger.</p>`, actions: '' };
    const history = character.details?.[kindName] || [];
    const storyEntries = history.filter(entry => entry.by !== 'user');
    const entry = line.messageId === undefined ? storyEntries.at(-1) : history.find(candidate => candidate.messageId === line.messageId);
    const editor = context.view.editors.get(line.key);
    const editButton = buildButton({ act: 'ed-detail', label: 'Edit', icon: 'pen', data: { area: line.key, cid: character.id, kind: kindName }, expanded: editor?.mode === 'detail' });
    if (!entry) {
        return {
            kind: 'Detail',
            body: `<p class="k-text">${buildNameButton(context, character.id, line.key)}'s ${escapeHtml(kindName)} was set here</p><p class="k-note k-muted">That entry is no longer in the ledger.</p>`,
            actions: editButton,
        };
    }
    const current = currentDetail(character, kindName);
    let note = '';
    if (current?.by === 'user') {
        note = isSameDetailValue(kindName, current.value, entry.value)
            ? buildOkMark('Locked by you at this value.')
            : `<span class="k-mark"><i class="fa-solid fa-lock" aria-hidden="true"></i>Locked by you: ${escapeHtml(detailValueText(context, kindName, current.value))}.</span>`;
    } else if (current && current !== entry) {
        note = `<span class="k-muted">Changed later, at message #${escapeHtml(String(current.at))}, to ${escapeHtml(detailValueText(context, kindName, current.value))}.</span>`;
    }
    return {
        kind: 'Detail',
        body: `<p class="k-text">${buildNameButton(context, character.id, line.key)}'s ${escapeHtml(kindName)} set to <b>${escapeHtml(detailValueText(context, kindName, entry.value))}</b> <span class="k-muted k-small">· message #${escapeHtml(String(entry.at))}</span></p>${note ? `<p class="k-note">${note}</p>` : ''}`,
        actions: editButton,
    };
}

/** A new fact or holders added to an older one: the text, the holders of the line, and the fixes */
function buildFactLineBody(context, line) {
    const { fact, state, at } = factState(context, line.factId);
    const isLive = state === 'live';
    const moved = context.view.moved[line.key] || {};
    const chipsHtml = line.holderIds.map(holderId => {
        // The holder's own entry first: a move that was undone gave it back
        const ownHolder = fact?.holders.find(holder => holder.characterId === holderId);
        if (ownHolder) return buildHolderChip(context, line.key, fact, ownHolder, isLive);
        const toId = moved[holderId];
        const movedHolder = toId ? fact?.holders.find(holder => holder.characterId === toId) : null;
        if (movedHolder) {
            return `<span class="k-chip is-removed"><b>${escapeHtml(nameOf(context, holderId))}</b></span><i class="fa-solid fa-arrow-right k-muted" aria-label="moved to"></i>${buildHolderChip(context, line.key, fact, movedHolder, isLive)}`;
        }
        return `<span class="k-chip is-removed"><b>${escapeHtml(nameOf(context, holderId))}</b><span class="k-how">removed</span></span>`;
    }).join('');
    const text = escapeHtml(fact?.text || '');
    let body = line.type === 'learned'
        ? `<div class="k-holders k-holders-first">${chipsHtml}<span class="k-muted">learned:</span></div><p class="k-text k-text-after">${text}</p>`
        : `<p class="k-text">${text}</p><div class="k-holders"><span class="k-muted k-small">Learned by</span>${chipsHtml}</div>`;
    if (fact?.public) body += '<p class="k-note k-muted"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i>Public: everyone knows it.</p>';
    const isPlayerRetraction = state === 'retracted' && (at === null || at === undefined);
    if (isPlayerRetraction) body += '<p class="k-note k-muted">You marked it not true: the narrator is no longer told it.</p>';
    else if (state === 'retracted') body += `<p class="k-note k-muted">The story took it back at message #${escapeHtml(String(at))}.</p>`;
    if (state === 'gone') body += `<p class="k-note">${buildOkMark('Gone: the narrator is no longer told it.')}</p>`;
    const fix = context.view.fixes[line.key];
    if (fix && isLive) body += `<p class="k-note">${buildOkMark(fix)}</p>`;
    const editor = context.view.editors.get(line.key);
    const data = { area: line.key, fid: line.factId };
    let actions = '';
    if (isLive) {
        actions = buildButton({ act: 'ed-text', label: 'Edit', icon: 'pen', data, expanded: editor?.mode === 'text' })
            + buildButton({ act: 'ed-add', label: 'Add holder', icon: 'user-plus', data, expanded: editor?.mode === 'add' })
            + buildButton({ act: 'retract', label: 'Not true', icon: 'ban', data, title: 'It did not happen: take it back, as an out-of-character correction would' })
            + buildButton({ act: 'ed-fdelete', label: 'Delete…', icon: 'trash', data, expanded: editor?.mode === 'fdelete' });
    }
    if (state === 'retracted') actions = buildButton({ act: 'restore', label: 'Still true', icon: 'rotate-left', data, title: 'Put the fact back with its holders' });
    return { kind: line.type === 'fact' ? 'New fact' : 'Learned', body, actions };
}

/**
 * The one look of a holder entry. A `plan` entry is a spoiler until the
 * player reveals it; an editable chip opens the holder's fixes.
 */
function buildHolderChip(context, area, fact, holder, editable) {
    const revealKey = `${fact.id}:${holder.characterId}`;
    if (holder.how === HOLDER_HOW.plan && !context.view.revealed.has(revealKey)) {
        return `<button type="button" class="k-chip is-spoiler" data-act="reveal" data-key="${escapeHtml(revealKey)}" data-fk="reveal|${escapeHtml(revealKey)}" title="This holder comes from an arc plan: a spoiler"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i>Planned holder <span class="k-how">show</span></button>`;
    }
    const label = `<b>${escapeHtml(nameOf(context, holder.characterId))}</b><span class="k-how">${escapeHtml(howText(context, holder))}</span>`;
    if (!editable) return `<span class="k-chip">${label}</span>`;
    const editor = context.view.editors.get(area);
    const isOpen = Boolean(editor && (editor.mode === 'holder' || editor.mode === 'move') && editor.factId === fact.id && editor.characterId === holder.characterId);
    return `<button type="button" class="k-chip" data-act="ed-holder" data-area="${escapeHtml(area)}" data-fid="${escapeHtml(fact.id)}" data-cid="${escapeHtml(holder.characterId)}" data-fk="chip|${escapeHtml(area)}|${escapeHtml(holder.characterId)}" aria-expanded="${isOpen}" title="Fix this holder">${label}</button>`;
}

// ─── Editors: one set for the lines, the name checks and the sheets ─────────

/**
 * The open editor of an area, by its mode.
 * @param {object} context
 * @param {string} area
 * @param {object} editor
 * @returns {string} HTML string
 */
function buildEditor(context, area, editor) {
    const { ledger } = context;
    const fact = editor.factId ? ledger.facts.find(candidate => candidate.id === editor.factId) : null;
    const character = editor.characterId ? context.charactersById.get(editor.characterId) : null;
    const cancelButton = buildButton({ act: 'ed-close', label: 'Cancel', data: { area }, cls: 'is-quiet' });
    if (editor.mode === 'holder') {
        const holder = fact?.holders.find(candidate => candidate.characterId === editor.characterId);
        if (!holder) return '';
        const data = { area, fid: fact.id, cid: holder.characterId };
        const name = nameOf(context, holder.characterId);
        return `<h4>${escapeHtml(name)} <span class="k-muted">· ${escapeHtml(howText(context, holder))} · ${escapeHtml(atText(holder))}</span></h4>
            <div class="k-row-actions">
                ${buildButton({ act: 'ed-move', label: 'Move to…', icon: 'right-left', data, title: 'Wrong person: give this entry to someone else (M)' })}
                ${buildButton({ act: 'remove-holder', label: 'Remove', icon: 'user-minus', data, title: `${name} does not know it (Del)` })}
                ${buildButton({ act: 'sheet', label: `Open ${name}`, icon: 'arrow-right', data: { cid: holder.characterId, from: area }, cls: 'is-quiet' })}
                ${cancelButton}
            </div>`;
    }
    if (editor.mode === 'move' || editor.mode === 'add') {
        if (!fact) return '';
        return buildPicker(context, area) + `<div class="k-row-actions">${cancelButton}</div>`;
    }
    if (editor.mode === 'text') {
        if (!fact) return '';
        return `<label class="k-label" for="sa-k-${escapeHtml(area)}-text">Fact</label>
            <textarea id="sa-k-${escapeHtml(area)}-text" class="text_pole" rows="3" data-draft="${escapeHtml(area)}:text" data-fk="text|${escapeHtml(area)}">${escapeHtml(draftOf(context, `${area}:text`, fact.text))}</textarea>
            <label class="k-check"><input type="checkbox" data-draft="${escapeHtml(area)}:public"${draftOf(context, `${area}:public`, fact.public) ? ' checked' : ''}> Public: everyone knows it</label>
            <p class="k-help">The holders stay: how each one learned it is still true of the corrected fact.</p>
            ${buildError(context, area)}
            <div class="k-row-actions">${buildButton({ act: 'save-text', label: 'Save', icon: 'floppy-disk', data: { area, fid: fact.id } })}${cancelButton}<span class="k-small k-muted">${buildKeys('Ctrl')}+${buildKeys('Enter')} saves</span></div>`;
    }
    if (editor.mode === 'fdelete') {
        if (!fact) return '';
        return `<h4>Delete this fact?</h4>
            <ul class="k-consequence"><li>${fact.holders.length ? `${plural(fact.holders.length, 'holder')} stop knowing it.` : 'Nobody holds it.'}</li><li>The narrator is no longer told it. You can undo right after.</li></ul>
            ${buildError(context, area)}
            <div class="k-row-actions">${buildButton({ act: 'fdelete-go', label: 'Delete fact', icon: 'trash', data: { area, fid: fact.id }, cls: 'is-danger' })}${cancelButton}</div>`;
    }
    if (editor.mode === 'names') {
        if (!character) return '';
        return `<h4>Rename ${escapeHtml(characterDisplayName(ledger, character))}</h4>${buildNamesFields(context, area, character)}${buildError(context, area)}
            <div class="k-row-actions">${buildButton({ act: 'save-names', label: 'Save names', icon: 'floppy-disk', data: { area, cid: character.id } })}${cancelButton}</div>`;
    }
    if (editor.mode === 'detail') return character ? buildDetailEditor(context, area, editor, character) : '';
    if (editor.mode === 'merge') return character ? buildMergeEditor(context, area, editor, character) : '';
    if (editor.mode === 'delete') return character ? buildDeleteEditor(context, area, character) : '';
    return '';
}

/** Name and aliases fields of a character or of the add form */
function buildNamesFields(context, area, character) {
    const id = `sa-k-${escapeHtml(area)}`;
    return `<div class="k-names-form">
        <div><label class="k-label" for="${id}-name">Name</label><input id="${id}-name" class="text_pole" type="text" data-draft="${escapeHtml(area)}:name" data-fk="name|${escapeHtml(area)}" value="${escapeHtml(draftOf(context, `${area}:name`, character.name))}" placeholder="No name yet"></div>
        <div><label class="k-label" for="${id}-aliases">Aliases <span class="k-label-hint">comma-separated</span></label><input id="${id}-aliases" class="text_pole" type="text" data-draft="${escapeHtml(area)}:aliases" value="${escapeHtml(draftOf(context, `${area}:aliases`, character.aliases.join(', ')))}"></div>
    </div>`;
}

/**
 * The editor of one detail kind: a text field, the status select, or a
 * relation's kinship word and the other character. Saving locks the kind.
 */
function buildDetailEditor(context, area, editor, character) {
    const kind = editor.kind;
    const current = currentDetail(character, kind);
    const fieldId = `sa-k-${escapeHtml(area)}-v`;
    let fieldHtml;
    if (kind === 'status') {
        const value = draftOf(context, `${area}:v`, current?.value || '');
        const optionsHtml = ['', ...DETAIL_STATUS_VALUES].map(status => `<option value="${status}"${status === value ? ' selected' : ''}>${status || 'unknown'}</option>`).join('');
        fieldHtml = `<label class="k-label" for="${fieldId}">Status</label><select id="${fieldId}" class="text_pole" data-draft="${escapeHtml(area)}:v" data-fk="detail|${escapeHtml(area)}">${optionsHtml}</select>`;
    } else if (kind === 'relation') {
        const ofId = draftOf(context, `${area}:of`, current?.value.of || '');
        fieldHtml = `<div class="k-fields">
            <div><label class="k-label" for="${fieldId}">Kinship word</label><input id="${fieldId}" class="text_pole" type="text" data-draft="${escapeHtml(area)}:v" data-fk="detail|${escapeHtml(area)}" value="${escapeHtml(draftOf(context, `${area}:v`, current?.value.kind || ''))}" placeholder="e.g. mother"></div>
            <div><span class="k-label">Of</span><p class="k-picked-one">${ofId ? `<b>${escapeHtml(nameOf(context, ofId))}</b>` : '<span class="k-unknown">nobody chosen</span>'}</p></div>
        </div><div class="k-gap">${buildPicker(context, area)}</div>`;
    } else {
        const placeholder = kind === 'role' ? ' placeholder="job or place in the world, and where it puts them"' : '';
        fieldHtml = `<label class="k-label" for="${fieldId}">${KIND_LABELS[kind]}</label><input id="${fieldId}" class="text_pole k-full" type="text" data-draft="${escapeHtml(area)}:v" data-fk="detail|${escapeHtml(area)}" value="${escapeHtml(draftOf(context, `${area}:v`, current?.value || ''))}"${placeholder}>`;
    }
    return `${fieldHtml}
        <p class="k-help">A value you set is locked: the story no longer changes it.${kind === 'relation' ? ' A relation needs a kinship word and another character.' : ''}</p>
        ${buildError(context, area)}
        <div class="k-row-actions">${buildButton({ act: 'save-detail', label: 'Save and lock', icon: 'lock', data: { area, cid: character.id, kind } })}${buildButton({ act: 'ed-close', label: 'Cancel', data: { area }, cls: 'is-quiet' })}</div>`;
}

/**
 * Merge: pick the other record, read what the merge does, confirm or keep
 * the other record instead. The refusal comes from mergeCharacters itself.
 */
function buildMergeEditor(context, area, editor, character) {
    const cancelButton = buildButton({ act: 'ed-close', label: 'Cancel', data: { area }, cls: 'is-quiet' });
    if (!editor.targetId || !context.charactersById.has(editor.targetId)) {
        return buildPicker(context, area) + `<div class="k-row-actions">${cancelButton}</div>`;
    }
    const mainId = editor.keepSelf ? character.id : editor.targetId;
    const otherId = editor.keepSelf ? editor.targetId : character.id;
    const { error } = mergeCharacters(context.ledger, mainId, otherId);
    const lines = listMergeConsequences(context, mainId, otherId);
    return `<h4>Merge ${escapeHtml(nameOf(context, otherId))} into ${escapeHtml(nameOf(context, mainId))}?</h4>
        <ul class="k-consequence">${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        ${error ? `<p class="k-error" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>${escapeHtml(error)}</p>` : buildError(context, area)}
        <div class="k-row-actions">
            ${buildButton({ act: 'merge-go', label: `Merge into ${nameOf(context, mainId)}`, icon: 'code-merge', data: { area }, cls: 'is-danger', disabled: Boolean(error) })}
            ${buildButton({ act: 'merge-swap', label: `Keep ${nameOf(context, otherId)} instead`, icon: 'right-left', data: { area } })}
            ${buildButton({ act: 'merge-repick', label: 'Choose another', data: { area }, cls: 'is-quiet' })}
            ${cancelButton}
        </div>`;
}

/** What a merge of `otherId` into `mainId` does, in sentences, as mergeCharacters does it */
function listMergeConsequences(context, mainId, otherId) {
    const main = context.charactersById.get(mainId);
    const other = context.charactersById.get(otherId);
    const lines = [];
    const name = main.name.trim() ? main.name : other.name.trim();
    const mainName = nameOf(context, mainId);
    const otherName = nameOf(context, otherId);
    if (!main.name.trim() && other.name.trim()) lines.push(`${mainName} takes the name ${other.name}.`);
    const otherNames = [other.name, ...other.aliases].filter(candidate => candidate.trim()
        && candidate.toLowerCase() !== name.toLowerCase()
        && !main.aliases.some(alias => alias.toLowerCase() === candidate.toLowerCase()));
    if (otherNames.length) lines.push(`${otherNames.map(candidate => `“${candidate}”`).join(', ')} become${otherNames.length === 1 ? 's an alias' : ' aliases'} of ${name || mainName}.`);
    const otherHoldings = heldOf(context, otherId).list;
    const bothHold = otherHoldings.filter(({ fact }) => fact.holders.some(holder => holder.characterId === mainId)).length;
    lines.push(otherHoldings.length
        ? `${plural(otherHoldings.length, 'fact')} ${otherName} knows move to ${name || mainName}${bothHold ? `; ${bothHold} of them ${name || mainName} knows already and keeps once` : ''}.`
        : `${otherName} knows no facts.`);
    const toldCount = heldOf(context, otherId).told;
    if (toldCount) lines.push(`${plural(toldCount, '“told by” note')} now name ${name || mainName} as the teller.`);
    if (context.withDetails) {
        for (const kind of DETAIL_KINDS) {
            const otherEntry = currentDetail(other, kind);
            if (!otherEntry || (kind === 'relation' && (otherEntry.value.of === mainId || otherEntry.value.of === otherId))) continue;
            const mainEntry = currentDetail(main, kind);
            const otherLocked = isDetailLocked(other, kind);
            const mainLocked = isDetailLocked(main, kind);
            if (!mainEntry) lines.push(`${KIND_LABELS[kind]} ${detailValueText(context, kind, otherEntry.value)} moves over from ${otherName}.`);
            else if (otherLocked && !mainLocked) lines.push(`${KIND_LABELS[kind]}: ${otherName}'s locked ${detailValueText(context, kind, otherEntry.value)} replaces ${detailValueText(context, kind, mainEntry.value)}.`);
            else if (!isSameDetailValue(kind, mainEntry.value, otherEntry.value)) lines.push(`${KIND_LABELS[kind]}: ${name || mainName}'s ${detailValueText(context, kind, mainEntry.value)} stays; ${otherName}'s ${detailValueText(context, kind, otherEntry.value)} is dropped.`);
        }
    }
    const relating = context.ledger.characters.filter(character => character.id !== mainId && character.id !== otherId
        && (character.details?.relation || []).some(entry => entry.value.of === otherId));
    if (relating.length) lines.push(`The relation of ${joinNames(relating.map(character => nameOf(context, character.id)))} now points at ${name || mainName}.`);
    if (context.present.includes(otherId)) lines.push(`${name || mainName} takes ${otherName}'s place in the scene.`);
    lines.push(`${otherName}'s record goes${other.nameClash ? ', and its name check with it' : ''}. You can undo right after.`);
    return lines;
}

/** Delete a character: what goes with them (deleteCharacter's `removed`), or why it is refused */
function buildDeleteEditor(context, area, character) {
    const name = characterDisplayName(context.ledger, character);
    const cancelButton = buildButton({ act: 'ed-close', label: 'Cancel', data: { area }, cls: 'is-quiet' });
    const { error, removed } = deleteCharacter(context.ledger, character.id);
    if (error) {
        const dependents = context.ledger.characters.filter(candidate => !candidate.name.trim()
            && (candidate.details?.relation || []).some(entry => entry.value.of === character.id));
        return `<h4>${escapeHtml(name)} cannot be deleted yet</h4><p class="k-error" role="alert"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>${escapeHtml(error)}</p>
            <div class="k-row-actions">${dependents.map(dependent => buildButton({ act: 'sheet', label: `Open ${characterDisplayName(context.ledger, dependent)}`, icon: 'arrow-right', data: { cid: dependent.id, from: '' } })).join('')}${cancelButton}</div>`;
    }
    const lines = [];
    const factCount = removed.holderEntries + removed.facts.length;
    lines.push(factCount ? `They stop knowing ${plural(factCount, 'fact')}.` : 'They know no facts.');
    if (removed.facts.length) lines.push(`${plural(removed.facts.length, 'fact')} only they know ${removed.facts.length === 1 ? 'goes' : 'go'} with them: ${removed.facts.map(fact => `“${fact.text}”`).join(', ')}.`);
    const toldCount = heldOf(context, character.id).told;
    if (toldCount) lines.push(`${plural(toldCount, 'entry', 'entries')} they told ${toldCount === 1 ? 'reads' : 'read'} as witnessed.`);
    if (removed.relations.length) lines.push(`The relation of ${joinNames(removed.relations.map(relation => nameOf(context, relation.characterId)))} to them goes.`);
    lines.push('To keep what they know under another record, use “Same person as…” instead. You can undo right after.');
    return `<h4>Delete ${escapeHtml(name)} from the ledger?</h4>
        <ul class="k-consequence">${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        ${buildError(context, area)}
        <div class="k-row-actions">${buildButton({ act: 'delete-go', label: `Delete ${name}`, icon: 'trash', data: { area, cid: character.id }, cls: 'is-danger' })}${cancelButton}</div>`;
}

// ─── Picker: one typeahead over the cast ────────────────────────────────────

/**
 * What a picker of an area is for, by the editor open there or the add
 * sheet: its label, who it leaves out, its suggestions while nothing is
 * typed, and a hint.
 * @returns {{ label: string, exclude: Set<string>, suggestions: {character: object, why: string}[], hint: string }}
 */
function pickerConfig(context, area) {
    const { ledger, view } = context;
    const editor = view.editors.get(area);
    const fact = editor?.factId ? ledger.facts.find(candidate => candidate.id === editor.factId) : null;
    const character = editor?.characterId ? context.charactersById.get(editor.characterId) : null;
    if (editor?.mode === 'move' && fact) {
        const holder = fact.holders.find(candidate => candidate.characterId === editor.characterId);
        return {
            label: `Move ${nameOf(context, editor.characterId)}'s entry to`,
            exclude: new Set([editor.characterId]),
            suggestions: listNamedIn(context, fact.text).filter(named => named.id !== editor.characterId)
                .map(named => ({ character: named, why: fact.holders.some(other => other.characterId === named.id) ? 'named in the fact · knows it already' : 'named in the fact' })),
            hint: holder ? `The entry keeps how and when it was learned (${howText(context, holder)}, ${atText(holder)}). If the one you pick knows it already, their own entry stays and this one goes.` : '',
        };
    }
    if (editor?.mode === 'add' && fact) {
        return {
            label: 'Add a holder: who else knows this',
            exclude: new Set(fact.holders.map(holder => holder.characterId)),
            suggestions: listNamedIn(context, fact.text).map(named => ({ character: named, why: 'named in the fact' })),
            hint: 'Entered by you, so no rollback removes it.',
        };
    }
    if (editor?.mode === 'merge' && character) {
        const words = characterNameWords(character);
        return {
            label: `${characterDisplayName(ledger, character)} is the same person as`,
            exclude: new Set([character.id]),
            suggestions: listCharactersWithNames(ledger, words, character.id).map(other => ({ character: other, why: 'shares a name' })),
            hint: '',
        };
    }
    if (editor?.mode === 'detail' && character) {
        return {
            label: 'Choose the other character',
            exclude: new Set([character.id]),
            suggestions: listCharactersWithNames(ledger, characterNameWords(character), character.id).map(other => ({ character: other, why: 'shares a name' })),
            hint: '',
        };
    }
    if (area === 'add' && view.sheet?.id === 'relative') {
        return { label: 'Choose the character they are related to', exclude: new Set(), suggestions: [], hint: '' };
    }
    if (area === 'add' && view.sheet?.id === 'fact') {
        const text = String(draftOf(context, 'add:text', view.sheet.prefill?.text || ''));
        return {
            label: 'Add a holder',
            exclude: new Set(view.newFactHolders),
            suggestions: listNamedIn(context, text).map(named => ({ character: named, why: 'named in the text' })),
            hint: '',
        };
    }
    return { label: 'Choose a character', exclude: new Set(), suggestions: [], hint: '' };
}

/** A named character's name words, of its name and aliases */
function characterNameWords(character) {
    if (!character.name.trim()) return [];
    return [character.name, ...character.aliases].flatMap(name => nameWords(name));
}

/** The named characters whose name or an alias (three letters or more) the text names as a whole word */
function listNamedIn(context, text) {
    const foldedText = ` ${foldName(text)} `;
    return context.ledger.characters.filter(character => character.name.trim()
        && [character.name, ...character.aliases].filter(name => name.length > 2).some(name => {
            const pattern = foldName(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`[^\\p{L}]${pattern}[^\\p{L}]`, 'u').test(foldedText);
        }));
}

/** The picker of an area: its field and its options */
function buildPicker(context, area) {
    const pickerId = `${area}:p`;
    const config = pickerConfig(context, area);
    const domId = `sa-k-${escapeHtml(pickerId.replace(/[^A-Za-z0-9_-]/g, '-'))}`;
    return `<div class="k-picker">
        <label class="k-label" for="${domId}-in">${escapeHtml(config.label)}</label>
        <input id="${domId}-in" class="text_pole" type="search" role="combobox" aria-expanded="true" aria-controls="${domId}-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Type a name or alias" data-picker="${escapeHtml(area)}" data-fk="picker|${escapeHtml(area)}" value="${escapeHtml(draftOf(context, pickerId, ''))}">
        <ul class="k-options" role="listbox" id="${domId}-list" aria-label="Matching characters">${buildPickerOptions(context, area)}</ul>
        ${config.hint ? `<p class="k-help">${escapeHtml(config.hint)}</p>` : ''}
    </div>`;
}

/** The options of a picker for what is typed; the active one selected */
function buildPickerOptions(context, area) {
    const pickerId = `${area}:p`;
    const { head, matches } = matchPickerCharacters(context, String(draftOf(context, pickerId, '')), pickerConfig(context, area));
    const active = Math.min(context.view.pickerActive[pickerId] || 0, Math.max(matches.length - 1, 0));
    const domId = `sa-k-${pickerId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    return (head ? `<li class="k-opt-head" role="presentation">${escapeHtml(head)}</li>` : '')
        + matches.map((match, index) => `<li role="option" id="${escapeHtml(domId)}-o${index}" data-pick="${escapeHtml(area)}" data-cid="${escapeHtml(match.character.id)}" aria-selected="${index === active}"><span>${escapeHtml(characterDisplayName(context.ledger, match.character))}</span><span class="k-why">${escapeHtml(match.why || '')}</span></li>`).join('');
}

/**
 * The characters a picker offers: for an empty field its suggestions, who is
 * in the scene, who the player changed and who was in the story lately; for
 * typed text the characters whose name or alias contains it, best first
 * (whole name, start of the name, start of a word, anywhere; an alias after
 * a name). At most eight.
 */
function matchPickerCharacters(context, typed, config) {
    const query = foldName(typed.trim());
    const { ledger, view } = context;
    if (!query) {
        const seen = new Set();
        const matches = [];
        const push = (character, why) => {
            if (!character || config.exclude.has(character.id) || seen.has(character.id)) return;
            seen.add(character.id);
            matches.push({ character, why });
        };
        config.suggestions.forEach(suggestion => push(suggestion.character, suggestion.why));
        context.present.forEach(characterId => push(context.charactersById.get(characterId), 'in the scene'));
        view.touched.filter(key => key.startsWith('c:')).forEach(key => push(context.charactersById.get(key.slice(2)), 'changed by you'));
        const recent = [...ledger.characters].sort((first, second) => heldOf(context, second.id).last - heldOf(context, first.id).last);
        for (const character of recent) {
            if (matches.length >= 8) break;
            push(character, 'recently in the story');
        }
        return { head: 'Suggested', matches: matches.slice(0, 8) };
    }
    const matches = searchCharacters(context, typed).filter(match => !config.exclude.has(match.character.id))
        .map(match => ({ character: match.character, why: match.kind === 'alias' ? `also ${match.name}` : detailsSummary(context, match.character) }));
    return { head: matches.length ? '' : 'No character has that name or alias', matches: matches.slice(0, 8) };
}

/**
 * Characters by name or alias, best match first: the whole name, its
 * start, the start of a word, anywhere; an alias half a step after a name;
 * then who knows more.
 * @returns {{ character: object, score: number, name: string, kind: 'name'|'alias' }[]}
 */
function searchCharacters(context, typed) {
    const query = foldName(typed.trim());
    if (!query) return [];
    const matches = [];
    for (const character of context.ledger.characters) {
        let best = null;
        const names = [[characterDisplayName(context.ledger, character), 'name'], ...character.aliases.map(alias => [alias, 'alias'])];
        for (const [name, kind] of names) {
            const foldedName = foldName(name);
            const position = foldedName.indexOf(query);
            if (position < 0) continue;
            let score = 4;
            if (foldedName === query) score = 0;
            else if (position === 0) score = 1;
            else if (/[\s\-'.]/.test(foldedName[position - 1])) score = 2;
            if (kind === 'alias') score += 0.5;
            if (!best || score < best.score) best = { score, name, kind };
        }
        if (best) matches.push({ character, ...best });
    }
    // A tie goes to who knows more; planned facts do not count, or the order would give a plan away
    const knownCount = new Map(matches.map(match => [match.character.id, knownHoldingsOf(context, match.character.id).length]));
    return matches.sort((first, second) => first.score - second.score
        || knownCount.get(second.character.id) - knownCount.get(first.character.id));
}

// ─── Cast & facts ───────────────────────────────────────────────────────────

/** The Cast & facts panel: the search field, the names to check and the main region */
function buildCastPanel(context) {
    const { view } = context;
    return `<div class="k-cast">
        <div class="k-search" role="search">
            <div class="k-search-box">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <label for="sa-k-q" class="k-visually-hidden">Find a character, an alias or a fact</label>
                <input id="sa-k-q" type="search" autocomplete="off" spellcheck="false" data-fk="search|q" placeholder="Find a character, alias or fact, or #2927 for a message" value="${escapeHtml(view.query)}" aria-controls="sa-k-cast-main" aria-describedby="sa-k-qcount">
                <div class="k-search-aside"><span id="sa-k-qcount" aria-live="polite">${escapeHtml(searchCountText(context))}</span><button type="button" class="k-iconbtn" id="sa-k-qclear" data-act="clear-q" aria-label="Clear the search" title="Clear the search (Esc)"${view.query ? '' : ' hidden'}><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
            </div>
        </div>
        <div id="sa-k-cast-strip">${buildNamesToCheck(context, 'cast')}</div>
        <div id="sa-k-cast-main">${buildCastMain(context)}</div>
    </div>`;
}

/** What the search found, next to the field; '' while a sheet is open or nothing is typed */
function searchCountText(context) {
    const { view } = context;
    const query = view.query.trim();
    if (view.sheet || !query) return '';
    const range = parseMessageSearch(query);
    if (range) return '';
    return `${plural(searchCharacters(context, query).length, 'character')} · ${plural(searchFacts(context, query).length, 'fact')}`;
}

/**
 * The main region of Cast & facts: the open sheet, an earlier record's
 * facts, the search results, or the default lists.
 * @param {object} context
 * @returns {string} HTML string
 */
function buildCastMain(context) {
    const { view, ledger } = context;
    const sheet = view.sheet;
    if (sheet?.type === 'character' && context.charactersById.has(sheet.id)) return buildCharacterSheet(context, context.charactersById.get(sheet.id));
    if (sheet?.type === 'fact') {
        const fact = ledger.facts.find(candidate => candidate.id === sheet.id);
        if (fact) return buildFactSheet(context, fact);
    }
    if (sheet?.type === 'add') return buildAddSheet(context, sheet);
    if (view.recordFacts && !view.query.trim()) return buildRecordFacts(context, view.recordFacts);
    return view.query.trim() ? buildSearchResults(context) : buildDefaultLists(context);
}

/** "#2927" or "#2926–2927": the message range of a message search, else null */
function parseMessageSearch(query) {
    const match = query.match(/^#\s*(\d+)(?:\s*[-–]\s*#?(\d+))?$/);
    if (!match) return null;
    return { from: Number(match[1]), to: Number(match[2] || match[1]) };
}

/** The search words of a query, folded */
function searchTerms(query) {
    return foldName(query.trim()).split(/\s+/).filter(Boolean);
}

/** The facts that have every search word, newest first */
function searchFacts(context, query) {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    return context.ledger.facts.filter(fact => {
        const foldedText = foldName(fact.text);
        return terms.every(term => foldedText.includes(term));
    }).sort((first, second) => factAt(second) - factAt(first));
}

/** The retracted facts that have every search word */
function searchRetracted(context, query) {
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    return context.retractedFacts.filter(retraction => {
        const foldedText = foldName(retraction.fact.text);
        return terms.every(term => foldedText.includes(term));
    });
}

/** The text with the search words marked */
function highlight(text, query) {
    const words = searchTerms(query || '');
    if (words.length === 0) return escapeHtml(text);
    // Folding keeps the letters' positions only without combining marks; mark by the folded text when it does.
    const foldedText = foldName(text);
    if (foldedText.length !== text.length) return escapeHtml(text);
    const marked = new Array(text.length).fill(false);
    // The whole query first, so "pier 7" marks the space between its words too
    for (const word of [words.join(' '), ...words]) {
        let position = foldedText.indexOf(word);
        while (position !== -1) {
            for (let index = position; index < position + word.length; index++) marked[index] = true;
            position = foldedText.indexOf(word, position + word.length);
        }
    }
    let html = '';
    let index = 0;
    while (index < text.length) {
        const isMarked = marked[index];
        let end = index;
        while (end < text.length && marked[end] === isMarked) end++;
        const part = escapeHtml(text.slice(index, end));
        html += isMarked ? `<mark>${part}</mark>` : part;
        index = end;
    }
    return html;
}

/** A results group with its heading */
function buildResultGroup(title, hint, innerHtml, id = '') {
    return `<section class="k-rgroup"${id ? ` id="${id}"` : ''}><div class="k-rgroup-head"><h3>${title}</h3>${hint ? `<span class="k-small">${hint}</span>` : ''}</div>${innerHtml}</section>`;
}

/** One character as a result row; Enter opens the sheet */
function buildCharacterRow(context, character, query = '', match = null, line = null) {
    const name = characterDisplayName(context.ledger, character);
    let aliasNote = '';
    if (match?.kind === 'alias') aliasNote = ` <span class="k-alias">also ${highlight(match.name, query)}</span>`;
    else if (character.aliases.length) aliasNote = ` <span class="k-alias">also ${escapeHtml(character.aliases.slice(0, 3).join(', '))}${character.aliases.length > 3 ? '…' : ''}</span>`;
    const title = match && match.kind !== 'alias' ? highlight(name, query) : escapeHtml(name);
    const flags = [];
    if (context.present.includes(character.id)) flags.push('<span class="k-flag"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>in the scene</span>');
    if (character.nameClash) flags.push('<span class="k-flag is-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>name to check</span>');
    if (!character.name.trim()) flags.push('<span class="k-flag"><i class="fa-solid fa-people-roof" aria-hidden="true"></i>unnamed relative</span>');
    const summary = line ?? (context.withDetails ? detailsSummary(context, character) : '');
    return `<button type="button" class="k-row" data-open="character:${escapeHtml(character.id)}" data-character-id="${escapeHtml(character.id)}" data-fk="row|character:${escapeHtml(character.id)}">
        <i class="fa-solid fa-user" aria-hidden="true"></i>
        <span class="k-row-main"><span class="k-row-title">${title}${aliasNote}</span><span class="k-row-line">${summary ? escapeHtml(summary) : (context.withDetails ? 'No details known' : '')}</span></span>
        <span class="k-row-side"><span>knows ${knownHoldingsOf(context, character.id).length}</span>${flags.join('')}</span>
    </button>`;
}

/** Who holds a fact, the plan holders counted but not named */
function holderSummary(context, fact) {
    const shownHolders = fact.holders.filter(holder => holder.how !== HOLDER_HOW.plan);
    const plannedCount = fact.holders.length - shownHolders.length;
    let summary = shownHolders.slice(0, 3).map(holder => `${nameOf(context, holder.characterId)} (${howText(context, holder)})`).join(', ') || 'Known to no one';
    if (shownHolders.length > 3) summary += ` +${shownHolders.length - 3}`;
    if (plannedCount) summary += ` · ${plural(plannedCount, 'planned holder')} hidden`;
    return summary;
}

/** One fact as a result row */
function buildFactRow(context, fact, query = '', why = null) {
    const at = factAt(fact);
    return `<button type="button" class="k-row" data-open="fact:${escapeHtml(fact.id)}" data-fact-id="${escapeHtml(fact.id)}" data-fk="row|fact:${escapeHtml(fact.id)}">
        <i class="fa-solid fa-file-lines" aria-hidden="true"></i>
        <span class="k-row-main"><span class="k-row-text">${highlight(fact.text, query)}</span><span class="k-row-line">${escapeHtml(why || holderSummary(context, fact))}</span></span>
        <span class="k-row-side">${at >= 0 ? `<span>#${at}</span>` : '<span>by you</span>'}${fact.public ? '<span class="k-flag"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i>public</span>' : ''}</span>
    </button>`;
}

/** A retracted fact with Still true */
function buildRetractedRow(context, retraction, query = '') {
    const area = `rt:${retraction.fact.id}`;
    const holderNames = retraction.fact.holders.filter(holder => holder.how !== HOLDER_HOW.plan).map(holder => nameOf(context, holder.characterId));
    return `<div class="k-retracted" data-area="${escapeHtml(area)}" data-fact-id="${escapeHtml(retraction.fact.id)}"><i class="fa-solid fa-ban" aria-hidden="true"></i>
        <div><p class="k-text">${highlight(retraction.fact.text, query)}</p><p class="k-sub">Was known to ${escapeHtml(joinNames(holderNames) || 'no one')} · ${retraction.at === null || retraction.at === undefined ? 'marked not true by you' : `taken back at message #${escapeHtml(String(retraction.at))}`}</p></div>
        <div class="k-row-actions">${buildButton({ act: 'restore', label: 'Still true', icon: 'rotate-left', data: { area, fid: retraction.fact.id }, title: 'Wrongly retracted: put the fact back with its holders' })}</div></div>`;
}

/** A row that opens an add sheet, prefilled */
function buildAddRow(kind, labelHtml, icon, data = {}) {
    const dataAttributes = Object.entries(data).map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`).join('');
    return `<button type="button" class="k-row is-add" data-act="add" data-kind="${kind}"${dataAttributes} data-fk="add|${kind}|${escapeHtml(Object.values(data).join('|'))}"><i class="fa-solid fa-${icon}" aria-hidden="true"></i><span class="k-row-main"><span class="k-row-title">${labelHtml}</span></span><span></span></button>`;
}

/**
 * Search results: characters, what the best match knows, facts, retracted
 * facts, and the add rows; `#N` or `#N–M` is a message search instead.
 */
function buildSearchResults(context) {
    const { view } = context;
    const query = view.query.trim();
    const range = parseMessageSearch(query);
    if (range) return buildMessageSearch(context, range.from, range.to);

    const characterMatches = searchCharacters(context, query);
    const facts = searchFacts(context, query);
    const retractions = searchRetracted(context, query);
    let html = '';
    if (characterMatches.length) {
        const moreButton = characterMatches.length > view.charLimit
            ? `<div class="k-more">${buildButton({ act: 'more', label: `Show ${Math.min(20, characterMatches.length - view.charLimit)} more of ${characterMatches.length}`, data: { what: 'characters' } })}</div>` : '';
        html += buildResultGroup('Characters', `${characterMatches.length}`, characterMatches.slice(0, view.charLimit).map(match => buildCharacterRow(context, match.character, query, match)).join('') + moreButton);
        const best = characterMatches[0];
        const bestHoldings = knownHoldingsOf(context, best.character.id);
        const isClearBest = best.score <= 2 && (characterMatches.length === 1 || characterMatches[1].score > best.score);
        if (isClearBest && bestHoldings.length) {
            const bestName = characterDisplayName(context.ledger, best.character);
            const newest = [...bestHoldings].sort((first, second) => factAt(second.fact) - factAt(first.fact)).slice(0, 4);
            html += buildResultGroup(`What ${escapeHtml(bestName)} knows`, `latest 4 of ${bestHoldings.length} · all in their sheet`, newest.map(({ fact, holder }) => (
                buildFactRow(context, fact, '', `${bestName}: ${howText(context, holder)}, ${atText(holder)}`)
            )).join(''));
        }
    }
    if (facts.length) {
        const moreButton = facts.length > view.factLimit
            ? `<div class="k-more">${buildButton({ act: 'more', label: `Show ${Math.min(25, facts.length - view.factLimit)} more of ${facts.length}`, data: { what: 'facts' } })}</div>` : '';
        html += buildResultGroup('Facts', `${facts.length} · newest first`, facts.slice(0, view.factLimit).map(fact => buildFactRow(context, fact, query)).join('') + moreButton);
    }
    if (retractions.length) html += buildResultGroup('Retracted by the story', `${retractions.length}`, retractions.map(retraction => buildRetractedRow(context, retraction, query)).join(''));
    if (!characterMatches.length && !facts.length && !retractions.length) return html + buildNoMatch(context, query);
    if (query.length >= 2) {
        html += buildResultGroup('Add', '', buildAddRow('character', `Add <q>${escapeHtml(query)}</q> as a new character`, 'user-plus', { name: query })
            + buildAddRow('fact', `Add <q>${escapeHtml(query)}</q> as a fact`, 'plus', { text: query }));
    }
    return html;
}

/**
 * A message search: everything dated in a message range. It is a search by
 * message number, labelled so, not an update's own list.
 */
function buildMessageSearch(context, from, to) {
    const isInRange = at => at !== null && at !== undefined && at >= from && at <= to;
    const facts = context.ledger.facts.filter(fact => fact.holders.some(holder => isInRange(holder.at))).sort((first, second) => factAt(second) - factAt(first));
    const details = [];
    if (context.withDetails) {
        for (const character of context.ledger.characters) {
            for (const kind of DETAIL_KINDS) {
                for (const entry of character.details?.[kind] || []) {
                    if (isInRange(entry.at) && entry.by !== 'user') details.push({ character, kind, entry });
                }
            }
        }
    }
    const retractions = context.retractedFacts.filter(retraction => isInRange(retraction.at));
    const label = rangeText(from, to);
    let html = `<p class="k-help k-search-note">Message search: everything dated in message${from === to ? '' : 's'} ${label} — holder entries, details the story set, and retractions.</p>`;
    if (details.length) {
        html += buildResultGroup(`Details set in ${label}`, `${details.length}`, details.map(({ character, kind, entry }) => buildCharacterRow(context, character, '', null,
            `${kind}: ${detailValueText(context, kind, entry.value)} at message #${entry.at}${isDetailLocked(character, kind) ? ' · locked by you since' : ''}`)).join(''));
    }
    if (facts.length) {
        html += buildResultGroup(`Facts learned in ${label}`, `${facts.length}`, facts.map(fact => buildFactRow(context, fact, '', fact.holders.filter(holder => isInRange(holder.at))
            .map(holder => (holder.how === HOLDER_HOW.plan ? 'a planned holder' : `${nameOf(context, holder.characterId)} (${howText(context, holder)})`)).join(', '))).join(''));
    }
    if (retractions.length) html += buildResultGroup(`Retracted in ${label}`, `${retractions.length}`, retractions.map(retraction => buildRetractedRow(context, retraction)).join(''));
    if (!details.length && !facts.length && !retractions.length) {
        html += `<div class="k-nomatch"><h3>Nothing is dated in message${from === to ? '' : 's'} ${label}</h3><p>Either nothing was learned there, or a later rollback removed it.</p></div>`;
    }
    return html;
}

/**
 * The facts an earlier update stored (its factsCreated and factsRetracted),
 * as they are now. Its holders and details were stored as counts only.
 */
function buildRecordFacts(context, recordFacts) {
    const label = rangeText(recordFacts.from, recordFacts.to);
    const createdHtml = recordFacts.factsCreated.map(factId => {
        const { fact, state, at } = factState(context, factId);
        if (state === 'live') return buildFactRow(context, fact);
        if (state === 'retracted') return buildRetractedRow(context, { fact, at });
        return `<p class="k-help k-indent">A fact this update learned is no longer in the ledger.</p>`;
    }).join('');
    const retractedHtml = recordFacts.factsRetracted.map(factId => {
        const { fact, state, at } = factState(context, factId);
        if (state === 'retracted') return buildRetractedRow(context, { fact, at });
        if (state === 'live') return buildFactRow(context, fact, '', 'Retracted here, put back since');
        return `<p class="k-help k-indent">A fact this update retracted is no longer in the ledger.</p>`;
    }).join('');
    let html = `<p class="k-help k-search-note">The facts the update of message${recordFacts.from === recordFacts.to ? '' : 's'} ${label} stored. Its holders and details were recorded as counts only.</p>
        <div class="k-addbar">${buildButton({ act: 'message-search', label: `Message search: everything dated in ${label}`, icon: 'magnifying-glass', data: { from: recordFacts.from, to: recordFacts.to } })}${buildButton({ act: 'clear-q', label: 'Back', cls: 'is-quiet' })}</div>`;
    if (createdHtml) html += buildResultGroup('Facts learned', `${recordFacts.factsCreated.length}`, createdHtml);
    if (retractedHtml) html += buildResultGroup('Facts retracted', `${recordFacts.factsRetracted.length}`, retractedHtml);
    return html;
}

/** No match: offer to add what was typed, as a character, an unnamed relative ("X's mother") or a fact */
function buildNoMatch(context, query) {
    let html = `<div class="k-nomatch"><h3>No match for <q>${escapeHtml(query)}</q></h3>`;
    const rows = [];
    let note = '';
    const relationMatch = query.match(/^(.+?)['’]s\s+([\p{L}-]+)$/u);
    if (relationMatch && context.withDetails) {
        const owner = searchCharacters(context, relationMatch[1])[0];
        if (owner && owner.score <= 2) {
            const ownerName = characterDisplayName(context.ledger, owner.character);
            rows.push(buildAddRow('relative', `Add <q>${escapeHtml(ownerName)}'s ${escapeHtml(relationMatch[2])}</q> as an unnamed relative`, 'people-roof', { of: owner.character.id, kinship: relationMatch[2] }));
        }
    } else {
        note = buildTakenNameHint(context, query, false);
        rows.push(buildAddRow('character', `Add <q>${escapeHtml(query)}</q> as a new character`, 'user-plus', { name: query }));
    }
    rows.push(buildAddRow('fact', `Add <q>${escapeHtml(query)}</q> as a fact`, 'plus', { text: query }));
    return `${html}${note}${rows.join('')}</div>`;
}

/** The note that a typed name's words are taken already, with whose; '' when they are free */
function buildTakenNameHint(context, name, isForm) {
    const words = nameWords(name);
    const sharers = words.length ? listCharactersWithNames(context.ledger, words, null) : [];
    if (sharers.length === 0) return '';
    const sharerNames = sharers.slice(0, 4).map(sharer => characterDisplayName(context.ledger, sharer));
    const others = sharers.length > 4 ? ' and others' : '';
    const sharedWords = words.filter(word => listCharactersWithNames(context.ledger, [word], null).length > 0);
    if (isForm) {
        return `<p class="k-help"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> “${escapeHtml(sharedWords.join(', '))}” is already a name of ${escapeHtml(joinNames(sharerNames))}${others}. Fine for a relative; otherwise pick a name nobody has.</p>`;
    }
    return `<p><q>${escapeHtml(sharedWords.join(', '))}</q> is already a name of ${escapeHtml(joinNames(sharerNames))}${others}. A new character shares a taken name only when the story makes them related.</p>`;
}

/** Before any search: the add buttons, what the player changed, the scene, retracted facts and everyone A–Z */
function buildDefaultLists(context) {
    const { ledger, view } = context;
    const relativeButton = context.withDetails ? buildButton({ act: 'add', label: 'Add unnamed relative', icon: 'people-roof', data: { kind: 'relative' } }) : '';
    const addButtons = buildButton({ act: 'add', label: 'Add character', icon: 'user-plus', data: { kind: 'character' } })
        + relativeButton
        + buildButton({ act: 'add', label: 'Add fact', icon: 'plus', data: { kind: 'fact' } });
    if (ledger.characters.length === 0 && ledger.facts.length === 0) {
        return `<div class="k-empty"><h3>The ledger is empty</h3>
            <p>It fills on its own while the knowledge tracker reads the story: characters as they appear, facts as someone learns them on screen.</p>
            <p>You can also enter what the story already established. A holder or detail you enter survives every rollback.</p>
            <div class="k-row-actions">${addButtons}</div></div>`;
    }
    let html = `<div class="k-addbar">${addButtons}<span class="k-small k-muted">or type a name or a sentence above and add it from the results</span></div>`;
    const changedHtml = view.touched.map(key => {
        const [type, id] = [key.slice(0, 1), key.slice(2)];
        if (type === 'c') return context.charactersById.has(id) ? buildCharacterRow(context, context.charactersById.get(id)) : '';
        const fact = ledger.facts.find(candidate => candidate.id === id);
        return fact ? buildFactRow(context, fact) : '';
    }).join('');
    if (changedHtml) html += buildResultGroup('Changed by you', 'this session', changedHtml);
    const presentRows = context.present.map(characterId => context.charactersById.get(characterId)).filter(Boolean).map(character => buildCharacterRow(context, character)).join('');
    html += buildResultGroup('In the scene', ledger.scene?.at !== null && ledger.scene?.at !== undefined ? `at message #${ledger.scene.at}` : '', presentRows || '<p class="k-help k-indent">Nobody is in the scene.</p>');
    if (context.retractedFacts.length) {
        const newestFirst = [...context.retractedFacts].sort((first, second) => second.at - first.at);
        html += `<details class="k-fold k-rgroup" data-fold="retracted"${view.foldOpen.retracted ? ' open' : ''}><summary><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><h3>Retracted by the story</h3><span class="k-small k-muted">${context.retractedFacts.length} · newest first · the narrator is no longer told these</span></summary>
            ${view.foldOpen.retracted ? newestFirst.map(retraction => buildRetractedRow(context, retraction)).join('') : ''}</details>`;
    }
    const everyone = [...ledger.characters].sort((first, second) => characterDisplayName(ledger, first).localeCompare(characterDisplayName(ledger, second)));
    html += `<details class="k-fold k-rgroup" data-fold="all"${view.foldOpen.all ? ' open' : ''}><summary><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><h3>All characters</h3><span class="k-small k-muted">${everyone.length} · A–Z</span></summary>${view.foldOpen.all ? everyone.map(character => buildCharacterRow(context, character)).join('') : ''}</details>`;
    return html;
}

// ─── Sheets ─────────────────────────────────────────────────────────────────

/** Back to where the sheet was opened from */
function buildSheetTop(context) {
    const { view } = context;
    const sheet = view.sheet;
    let label = 'Back';
    // The map goes back to a character, else to the map (closeSheet)
    if (view.tab === 'map') label = sheet.back?.type === 'character' ? `Back to ${nameOf(context, sheet.back.id)}` : 'Back to the map';
    else if (sheet.back) label = sheet.back.type === 'character' ? `Back to ${nameOf(context, sheet.back.id)}` : 'Back to the fact';
    else if (sheet.from?.startsWith('changes|')) label = 'Back to What changed';
    else if (view.query.trim()) label = `Back to results for “${view.query.trim()}”`;
    return `<div class="k-sheet-top">${buildButton({ act: 'close-sheet', label, icon: 'arrow-left' })}<span class="k-small k-muted">${buildKeys('Esc')}</span></div>`;
}

/** The sheet's own editor (merge, delete, fact delete) under its head, when open */
function buildSheetEditor(context, area, modes) {
    const editor = context.view.editors.get(area);
    if (!editor || !modes.includes(editor.mode)) return '';
    const isDanger = editor.mode === 'delete' || editor.mode === 'fdelete';
    return `<div class="k-editor${isDanger ? ' is-danger' : ''}">${buildEditor(context, area, editor)}</div>`;
}

/**
 * A character's sheet: names, details with their lock state (only
 * `withDetails`), what they know, merge and delete.
 */
function buildCharacterSheet(context, character) {
    const { view, ledger } = context;
    const editor = view.editors.get('sheet');
    const holdings = heldOf(context, character.id);
    const name = characterDisplayName(ledger, character);
    const subParts = [character.aliases.length ? `also ${escapeHtml(character.aliases.join(', '))}` : 'no aliases'];
    if (!character.name.trim()) subParts.push('<span class="k-flag"><i class="fa-solid fa-people-roof" aria-hidden="true"></i>unnamed relative</span>');
    if (context.present.includes(character.id)) subParts.push('<span class="k-flag"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>in the scene</span>');
    subParts.push(`knows ${plural(knownHoldingsOf(context, character.id).length, 'fact')}`);
    if (holdings.told) subParts.push(`told others ${plural(holdings.told, 'time')}`);
    let clashHtml = '';
    if (character.nameClash) {
        const nameLines = listNameClashLines(context, character);
        const why = nameLines.length
            ? nameLines.map(line => `“${escapeHtml(line.name)}” is also a name of ${escapeHtml(joinNames(line.names))}.`).join(' ')
            : 'No other character has this name any more.';
        const messageIndex = findNameClashMessage(character.nameClash, context.chatMessages);
        clashHtml = `<div class="k-clashbox"><p class="k-note k-flush"><span class="k-mark is-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>Name to check:</span> ${why} <span class="k-muted">Named in message #${escapeHtml(String(messageIndex))}.</span></p>
            <div class="k-row-actions">${buildButton({ act: 'keep-name', label: nameLines.length ? 'Keep the name' : 'Not a clash', data: { area: 'sheet', cid: character.id } })}${nameLines.length ? '<span class="k-small k-muted">or merge with “Same person as…” above, or rename below: saving the names clears the check</span>' : ''}</div></div>`;
    }
    const detailsHtml = context.withDetails
        ? `<section class="k-sec" id="sa-k-sec-details" aria-labelledby="sa-k-sh-details"><h4 id="sa-k-sh-details">Details <kbd>D</kbd></h4>
            <p class="k-help">Recorded only as the story text states them. A value you set or lock stays: the story no longer changes it.</p>
            <dl class="k-details">${DETAIL_KINDS.map(kind => buildDetailRow(context, character, kind, editor)).join('')}</dl>
        </section>`
        : '';
    return `<article class="k-sheet" id="sa-k-sheet" aria-labelledby="sa-k-sheet-title">${buildSheetTop(context)}
        <div class="k-sheet-head">
            <div><h3 class="k-sheet-name" id="sa-k-sheet-title" tabindex="-1">${escapeHtml(name)}</h3><p class="k-sheet-sub">${subParts.map(part => `<span>${part}</span>`).join('')}</p></div>
            <div class="k-row-actions">${buildButton({ act: 'ed-merge', label: 'Same person as…', icon: 'code-merge', data: { area: 'sheet', cid: character.id }, expanded: editor?.mode === 'merge' })}${buildButton({ act: 'ed-delete', label: 'Delete…', icon: 'trash', data: { area: 'sheet', cid: character.id }, expanded: editor?.mode === 'delete' })}</div>
        </div>
        ${buildSheetEditor(context, 'sheet', ['merge', 'delete'])}
        ${clashHtml}
        <div class="k-sheet-grid">
            <div>
                <section class="k-sec" id="sa-k-sec-names" aria-labelledby="sa-k-sh-names"><h4 id="sa-k-sh-names">Names <kbd>N</kbd></h4>
                    ${buildNamesFields(context, 'sheet', character)}
                    ${character.name.trim() ? '' : '<p class="k-help">Give them a name once the story names them; the record keeps its details.</p>'}
                    ${editor ? '' : buildError(context, 'sheet')}
                    <div class="k-row-actions k-gap">${buildButton({ act: 'save-names', label: 'Save names', icon: 'floppy-disk', data: { area: 'sheet', cid: character.id } })}<span class="k-small k-muted">${buildKeys('Enter')} saves</span></div>
                </section>
                ${detailsHtml}
            </div>
            ${buildHeldSection(context, character, editor)}
        </div>
    </article>`;
}

/** One detail row: the value, where it came from (the lock state) and its fixes */
function buildDetailRow(context, character, kind, editor) {
    const current = currentDetail(character, kind);
    const story = storyDetail(character, kind);
    const isOpen = editor?.mode === 'detail' && editor.kind === kind;
    const data = { area: 'sheet', cid: character.id, kind };
    const editButton = label => buildButton({ act: 'ed-detail', label, icon: 'pen', data, aria: `${label} ${kind}`, expanded: isOpen });
    let valueHtml;
    let sourceHtml;
    let actionsHtml;
    if (!current) {
        valueHtml = '<span class="k-unknown">unknown</span>';
        sourceHtml = '<span class="k-src">The story has not stated it.</span>';
        actionsHtml = editButton('Set');
    } else if (current.by === 'user') {
        valueHtml = escapeHtml(detailValueText(context, kind, current.value));
        let tail = '';
        if (story && !isSameDetailValue(kind, story.value, current.value)) tail = ` · the story said ${escapeHtml(detailValueText(context, kind, story.value))}${story.at === null ? '' : ` at message #${story.at}`}`;
        else if (story) tail = ` · the story says the same${story.at === null ? '' : ` (message #${story.at})`}`;
        sourceHtml = `<span class="k-src is-locked"><i class="fa-solid fa-lock" aria-hidden="true"></i>Locked by you${tail}</span>`;
        actionsHtml = editButton('Edit') + buildButton({
            act: 'unlock', label: story ? 'Unlock' : 'Clear', icon: story ? 'lock-open' : 'eraser', data,
            title: story ? `Unlock: the story's ${detailValueText(context, kind, story.value)} counts again` : 'Clear: the detail becomes unknown',
        });
    } else {
        valueHtml = escapeHtml(detailValueText(context, kind, current.value));
        const where = current.at === null || current.at === undefined ? 'From the record' : `From the story, message #${current.at}`;
        sourceHtml = `<span class="k-src"><i class="fa-solid fa-lock-open" aria-hidden="true"></i>${where}</span>`;
        actionsHtml = editButton('Edit') + buildButton({ act: 'lock', label: 'Lock', icon: 'lock', data, title: 'Keep this value: the story can no longer change it' });
    }
    return `<div class="k-detail" data-detail="${kind}"><dt>${KIND_LABELS[kind]}</dt><dd>${valueHtml}${sourceHtml}</dd><dd class="k-row-actions">${actionsHtml}</dd>${isOpen ? `<div class="k-editor">${buildEditor(context, 'sheet', editor)}</div>` : ''}</div>`;
}

/**
 * What a character knows, newest first, with a filter; each entry with
 * Move, Remove and Open. The facts an arc plan gives them (`how: 'plan'`)
 * are the spoiler: they fold into one "N planned facts" line with Show, and
 * neither they nor other characters' hidden plan entries are counted.
 */
function buildHeldSection(context, character, editor) {
    const { view } = context;
    const name = characterDisplayName(context.ledger, character);
    const byNewest = (first, second) => factAt(second.fact) - factAt(first.fact);
    const knownHoldings = knownHoldingsOf(context, character.id).sort(byNewest);
    const plannedHoldings = heldOf(context, character.id).list.filter(({ holder }) => holder.how === HOLDER_HOW.plan).sort(byNewest);
    const plansRevealed = view.revealed.has(`plans:${character.id}`);
    const listedHoldings = plansRevealed ? [...knownHoldings, ...plannedHoldings] : knownHoldings;
    const terms = searchTerms(view.heldQuery);
    const matching = terms.length ? listedHoldings.filter(({ fact }) => terms.every(term => foldName(fact.text).includes(term))) : listedHoldings;
    const shown = matching.slice(0, view.heldLimit);
    const rowsHtml = shown.map(({ fact, holder }) => {
        const isOpen = editor?.mode === 'move' && editor.factId === fact.id;
        const data = { fid: fact.id, cid: character.id };
        const actionsHtml = buildButton({ act: 'sheet-move', label: 'Move to…', icon: 'right-left', data, title: 'Not theirs: give this entry to someone else (M)', expanded: isOpen })
            + buildButton({ act: 'sheet-remove', label: 'Remove', icon: 'user-minus', data, title: `${name} does not know this (Del)` })
            + buildButton({ act: 'open-fact', icon: 'arrow-right', data: { fid: fact.id }, cls: 'is-quiet', aria: 'Open the fact', title: 'Open the fact (Enter)' });
        const otherCount = fact.holders.filter(other => other.characterId !== character.id
            && (other.how !== HOLDER_HOW.plan || view.revealed.has(`${fact.id}:${other.characterId}`))).length;
        return `<li class="k-item" tabindex="0" data-row="${escapeHtml(fact.id)}" data-fid="${escapeHtml(fact.id)}" data-cid="${escapeHtml(character.id)}" aria-label="${escapeHtml(fact.text.slice(0, 120))}">
            <p class="k-item-text">${highlight(fact.text, view.heldQuery)}</p>
            <div class="k-item-meta"><span class="k-chip"><b>${escapeHtml(name)}</b><span class="k-how">${escapeHtml(howText(context, holder))}</span></span><span>${escapeHtml(atText(holder))}</span>${fact.public ? '<span class="k-flag"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i>public</span>' : ''}<span>${otherCount ? `also known to ${plural(otherCount, 'other')}` : 'only they know it'}</span></div>
            <div class="k-item-acts">${actionsHtml}</div>
            ${isOpen ? `<div class="k-editor">${buildEditor(context, 'sheet', editor)}</div>` : ''}
        </li>`;
    }).join('');
    const revealKey = `plans:${character.id}`;
    const plannedFoldHtml = plannedHoldings.length && !plansRevealed
        ? `<li class="k-item is-masked" tabindex="0" data-masked="1" aria-label="${escapeHtml(plural(plannedHoldings.length, 'planned fact'))}, hidden as a spoiler">
            <p class="k-item-text">${escapeHtml(plural(plannedHoldings.length, 'planned fact'))}</p>
            <div class="k-item-meta"><span>${plannedHoldings.length === 1 ? 'An arc plan gives them this.' : 'An arc plan gives them these.'}</span></div>
            <div class="k-item-acts">${buildButton({ act: 'reveal', label: 'Show', icon: 'eye', data: { key: revealKey } })}</div>
        </li>` : '';
    const listHtml = knownHoldings.length || plannedHoldings.length
        ? `<ul class="k-list" id="sa-k-held" aria-label="Facts ${escapeHtml(name)} knows">${plannedFoldHtml}${rowsHtml || (terms.length ? '<li class="k-list-foot k-help">No fact matches.</li>' : '')}</ul>`
        : `<p class="k-help">${escapeHtml(name)} knows nothing the ledger has recorded. Add them as a holder from a fact.</p>`;
    const moreHtml = matching.length > shown.length
        ? `<div class="k-list-foot">${buildButton({ act: 'more-held', label: `Show ${Math.min(30, matching.length - shown.length)} more of ${matching.length - shown.length}` })}</div>` : '';
    return `<section class="k-sec" id="sa-k-sec-held" aria-labelledby="sa-k-sh-held"><h4 id="sa-k-sh-held">Knows <span class="k-small">${plural(knownHoldings.length, 'fact')}</span> <kbd>F</kbd></h4>
        <div class="k-filter"><label class="k-visually-hidden" for="sa-k-held-q">Find in what ${escapeHtml(name)} knows</label><input id="sa-k-held-q" class="text_pole" type="search" data-search="held" data-fk="search|held" placeholder="Find in what ${escapeHtml(name)} knows" value="${escapeHtml(view.heldQuery)}"><span class="k-small k-muted">${terms.length ? `${matching.length} match` : 'newest first'}</span></div>
        ${listHtml}${moreHtml}
    </section>`;
}

/** A fact's sheet: its text and public flag, its holders with Move, Remove and Open, Add holder, Delete */
function buildFactSheet(context, fact) {
    const { view } = context;
    const editor = view.editors.get('fs');
    const at = factAt(fact);
    const rowsHtml = fact.holders.map(holder => {
        const revealKey = `${fact.id}:${holder.characterId}`;
        if (holder.how === HOLDER_HOW.plan && !view.revealed.has(revealKey)) {
            return `<li class="k-item is-masked" tabindex="0" data-row="${escapeHtml(holder.characterId)}" data-fid="${escapeHtml(fact.id)}" data-cid="${escapeHtml(holder.characterId)}" data-masked="1" aria-label="A planned holder, hidden as a spoiler">
            <p class="k-item-text">A planned holder: an arc plan meant them to know this. Hidden as a spoiler.</p>
            <div class="k-item-acts">${buildButton({ act: 'reveal', label: 'Show', icon: 'eye', data: { key: revealKey } })}</div></li>`;
        }
        const holderName = nameOf(context, holder.characterId);
        const isOpen = editor?.mode === 'move' && editor.characterId === holder.characterId;
        const data = { fid: fact.id, cid: holder.characterId };
        return `<li class="k-item" tabindex="0" data-row="${escapeHtml(holder.characterId)}" data-fid="${escapeHtml(fact.id)}" data-cid="${escapeHtml(holder.characterId)}" aria-label="${escapeHtml(`${holderName}, ${howText(context, holder)}`)}">
            <div class="k-item-meta k-item-first"><span class="k-chip"><b>${escapeHtml(holderName)}</b><span class="k-how">${escapeHtml(howText(context, holder))}</span></span><span>${escapeHtml(atText(holder))}</span>${context.present.includes(holder.characterId) ? '<span class="k-flag"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>in the scene</span>' : ''}</div>
            <div class="k-item-acts">${buildButton({ act: 'fs-move', label: 'Move to…', icon: 'right-left', data, title: 'Wrong person: give this entry to someone else (M)', expanded: isOpen })}${buildButton({ act: 'fs-remove', label: 'Remove', icon: 'user-minus', data, title: `${holderName} does not know it (Del)` })}${buildButton({ act: 'sheet', icon: 'arrow-right', data: { cid: holder.characterId, from: '' }, cls: 'is-quiet', aria: `Open ${holderName}`, title: `Open ${holderName} (Enter)` })}</div>
            ${isOpen ? `<div class="k-editor">${buildEditor(context, 'fs', editor)}</div>` : ''}</li>`;
    }).join('');
    const isAddOpen = editor?.mode === 'add';
    return `<article class="k-sheet" id="sa-k-sheet" aria-labelledby="sa-k-sheet-title" data-fact-id="${escapeHtml(fact.id)}">${buildSheetTop(context)}
        <div class="k-sheet-head"><div><h3 class="k-sheet-name" id="sa-k-sheet-title" tabindex="-1">Fact</h3>
            <p class="k-sheet-sub"><span>${at >= 0 ? `latest entry at message #${at}` : 'entered by you'}</span><span>${plural(fact.holders.length, 'holder')}</span>${fact.public ? '<span class="k-flag"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i>public</span>' : ''}</p></div>
            <div class="k-row-actions">${buildButton({ act: 'retract', label: 'Not true', icon: 'ban', data: { area: 'fs', fid: fact.id }, title: 'It did not happen: take it back, as an out-of-character correction would' })}${buildButton({ act: 'ed-fdelete', label: 'Delete…', icon: 'trash', data: { area: 'fs', fid: fact.id }, expanded: editor?.mode === 'fdelete' })}</div></div>
        ${buildSheetEditor(context, 'fs', ['fdelete'])}
        <div class="k-sheet-grid">
            <section class="k-sec">
                <label class="k-label" for="sa-k-fs-text">Text</label>
                <textarea id="sa-k-fs-text" class="text_pole" rows="4" data-draft="fs:text" data-fk="text|fs">${escapeHtml(draftOf(context, 'fs:text', fact.text))}</textarea>
                <label class="k-check"><input type="checkbox" data-draft="fs:public"${draftOf(context, 'fs:public', fact.public) ? ' checked' : ''}> Public: everyone knows it</label>
                <p class="k-help">The holders stay: how each one learned it is still true of the corrected fact.</p>
                ${buildError(context, 'fs')}
                <div class="k-row-actions k-gap">${buildButton({ act: 'save-text', label: 'Save', icon: 'floppy-disk', data: { area: 'fs', fid: fact.id } })}<span class="k-small k-muted">${buildKeys('Ctrl')}+${buildKeys('Enter')} saves</span></div>
            </section>
            <section class="k-sec" aria-labelledby="sa-k-sh-holders"><h4 id="sa-k-sh-holders">Known to <span class="k-small">${plural(fact.holders.length, 'holder')}</span></h4>
                ${fact.holders.length ? `<ul class="k-list" id="sa-k-holders" aria-label="Holders">${rowsHtml}</ul>` : '<p class="k-help">Known to no one: the narrator is told it for nobody. Add a holder or delete the fact.</p>'}
                <div class="k-list-foot">${buildButton({ act: 'ed-add', label: 'Add holder', icon: 'user-plus', data: { area: 'fs', fid: fact.id }, expanded: isAddOpen })}</div>
                ${isAddOpen ? `<div class="k-editor">${buildEditor(context, 'fs', editor)}</div>` : ''}
            </section>
        </div>
    </article>`;
}

/** The add sheets: a character, an unnamed relative, a fact */
function buildAddSheet(context, sheet) {
    const prefill = sheet.prefill || {};
    const actionsFor = (act, label) => `${buildError(context, 'add')}<div class="k-row-actions k-gap-l">${buildButton({ act, label, icon: 'plus' })}${buildButton({ act: 'close-sheet', label: 'Cancel', cls: 'is-quiet' })}</div>`;
    let bodyHtml;
    if (sheet.id === 'character') {
        const typedName = draftOf(context, 'add:name', prefill.name || '');
        bodyHtml = `<h3 class="k-sheet-name" id="sa-k-sheet-title" tabindex="-1">Add character</h3><p class="k-sheet-sub">A character the story has, which the ledger missed.</p>
            <section class="k-sec k-form">${buildNamesFields(context, 'add', { name: typedName, aliases: [] })}<div id="sa-k-taken-hint">${buildTakenNameHint(context, typedName, true)}</div>${actionsFor('create-character', 'Add character')}</section>`;
    } else if (sheet.id === 'relative') {
        const ofId = draftOf(context, 'add:of', prefill.of || '');
        const isPicking = !ofId || context.view.drafts['add:repick'];
        bodyHtml = `<h3 class="k-sheet-name" id="sa-k-sheet-title" tabindex="-1">Add unnamed relative</h3><p class="k-sheet-sub">A recurring relative the story has not named yet, such as “Kendra Osei's mother”.</p>
            <section class="k-sec k-form"><div class="k-fields">
                <div><label class="k-label" for="sa-k-add-kin">Kinship word</label><input id="sa-k-add-kin" class="text_pole" type="text" data-draft="add:kin" data-fk="name|add" value="${escapeHtml(draftOf(context, 'add:kin', prefill.kinship || ''))}" placeholder="e.g. mother"></div>
                <div><span class="k-label">Relative of</span><p class="k-row-actions k-picked-one">${ofId ? `<b>${escapeHtml(nameOf(context, ofId))}</b>${buildButton({ act: 'repick-of', label: 'Change', cls: 'is-quiet' })}` : '<span class="k-unknown">nobody chosen</span>'}</p></div>
            </div>
            ${isPicking ? `<div class="k-gap">${buildPicker(context, 'add')}</div>` : ''}
            ${actionsFor('create-relative', 'Add unnamed relative')}</section>`;
    } else {
        const holderChipsHtml = context.view.newFactHolders.map(characterId => `<span class="k-chip"><b>${escapeHtml(nameOf(context, characterId))}</b><span class="k-how">entered by you</span><button type="button" class="k-x" data-act="drop-new-holder" data-cid="${escapeHtml(characterId)}" aria-label="Remove ${escapeHtml(nameOf(context, characterId))}" title="Remove ${escapeHtml(nameOf(context, characterId))}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`).join('');
        bodyHtml = `<h3 class="k-sheet-name" id="sa-k-sheet-title" tabindex="-1">Add fact</h3><p class="k-sheet-sub">Something the story established that the ledger missed.</p>
            <section class="k-sec k-form">
                <label class="k-label" for="sa-k-add-text">What is known <span class="k-label-hint">a short sentence that names who and what</span></label>
                <textarea id="sa-k-add-text" class="text_pole" rows="3" data-draft="add:text" data-fk="text|add">${escapeHtml(draftOf(context, 'add:text', prefill.text || ''))}</textarea>
                <label class="k-check"><input type="checkbox" data-draft="add:public"${draftOf(context, 'add:public', false) ? ' checked' : ''}> Public: everyone knows it</label>
                <div class="k-gap-l"><span class="k-label">Known to</span><div class="k-picked">${holderChipsHtml || '<span class="k-small k-muted">Nobody yet</span>'}</div></div>
                <div class="k-gap">${buildPicker(context, 'add')}</div>
                ${actionsFor('create-fact', 'Add fact')}</section>`;
    }
    return `<article class="k-sheet" id="sa-k-sheet" aria-labelledby="sa-k-sheet-title">${buildSheetTop(context)}${bodyHtml}</article>`;
}

// ─── Map ────────────────────────────────────────────────────────────────────

/** How many messages back a fact still counts as recent on the map */
const MAP_RECENT_WINDOW = 100;

/** The rings from the centre out, their size against the outer ring, and their titles */
const MAP_RINGS = ['scene', 'recent', 'earlier', 'none'];
const MAP_RING_SCALE = { scene: 0, recent: 0.42, earlier: 0.71, none: 1 };
const MAP_RING_TITLES = { scene: 'In the scene', recent: 'Recent', earlier: 'Earlier', none: 'No facts' };

/** A label's height on screen, in pixels */
const MAP_LABEL_HEIGHT = 18;

/**
 * The Map panel: the filter and zoom bar, the stage with the cast in rings
 * (buildMapScene), the legend, and the selected character's sheet beside the
 * map — the same sheet as in Cast & facts (buildCharacterSheet). Below a
 * width where both do not fit, the sheet takes the map's place (CSS).
 * @param {object} context
 * @returns {string} HTML string
 */
function buildMapPanel(context) {
    const { view, ledger } = context;
    const selected = mapSelectedId(context);
    if (ledger.characters.length === 0) {
        return `<div class="k-empty"><h3>Nobody on the map yet</h3>
            <p>The map shows every character of the ledger in rings around the scene. It fills while the knowledge tracker reads the story, or as you add characters in Cast &amp; facts.</p>
            <div class="k-row-actions">${buildButton({ act: 'tab', label: 'Open Cast & facts', icon: 'magnifying-glass', data: { tab: 'cast' } })}</div></div>`;
    }
    const scene = buildMapScene(context);
    return `<div class="k-map" id="sa-k-map" data-sheet="${Boolean(selected)}">
        <div class="k-map-main">
            <div class="k-map-bar">
                <div class="k-search-box k-map-filter">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <label for="sa-k-map-q" class="k-visually-hidden">Filter the map by name or alias</label>
                    <input id="sa-k-map-q" class="text_pole" type="search" autocomplete="off" spellcheck="false" data-fk="search|map" placeholder="Filter by name or alias" value="${escapeHtml(view.map.filter)}" aria-describedby="sa-k-map-count">
                </div>
                <span class="k-small k-muted" id="sa-k-map-count" aria-live="polite">${escapeHtml(scene.countText)}</span>
                <span class="k-map-spacer"></span>
                <div class="k-map-zoom" role="group" aria-label="Zoom">
                    ${buildButton({ act: 'map-zoom', icon: 'minus', data: { by: 'out' }, aria: 'Zoom out', title: 'Zoom out (−)' })}
                    <button type="button" class="menu_button k-btn" data-act="map-zoom" data-by="fit" data-fk="map-zoom|fit" title="Show the whole cast (0)" aria-label="Fit the whole cast, zoom now ${scene.zoomPercent}%"><span id="sa-k-map-zoom">${scene.zoomPercent}%</span></button>
                    ${buildButton({ act: 'map-zoom', icon: 'plus', data: { by: 'in' }, aria: 'Zoom in', title: 'Zoom in (+)' })}
                </div>
            </div>
            <div class="k-map-stage" id="sa-k-map-stage">${scene.html}</div>
            <div class="k-map-legend" aria-hidden="true">
                <span>Rings: in the scene · recent (last ${MAP_RECENT_WINDOW} messages) · earlier · no facts</span>
                <span><span class="k-map-key-dot is-big"></span><span class="k-map-key-dot"></span>size: facts known</span>
                <span><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>name to check</span>
                <span><span class="k-map-key-line"></span>relation</span>
                <span>Drag one character onto another to merge</span>
                <span>${buildKeys('← ↑ → ↓')} move ${buildKeys('Enter')} open ${buildKeys('M')} merge into…</span>
            </div>
        </div>
        ${buildMapSide(context)}
    </div>`;
}

/** The selected character's sheet beside the map, or '' */
function buildMapSide(context) {
    const selected = mapSelectedId(context);
    if (!selected) return '';
    return `<aside class="k-map-side" id="sa-k-map-side" data-cid="${escapeHtml(selected)}" aria-label="Character sheet">${buildCharacterSheet(context, context.charactersById.get(selected))}</aside>`;
}

/** The character whose sheet is open on the map, or null */
function mapSelectedId(context) {
    const sheet = context.view.sheet;
    return sheet?.type === 'character' && context.charactersById.has(sheet.id) ? sheet.id : null;
}

/**
 * The map's drawing at the view's zoom and pane size: the rings with their
 * titles, the name-family bands, the relation lines, the selected
 * character's shared-name links, a drag's line, and one button per
 * character. Labels show where they fit (placeMapLabels).
 * @param {object} context
 * @param {object} [layout] - The context's layoutCastMap, when the caller keeps it (mapRenderState)
 * @returns {{ html: string, countText: string, zoomPercent: number, positions: Map<string, {x: number, y: number}> }}
 */
function buildMapScene(context, layout = layoutCastMap(context)) {
    const { view } = context;
    const mapView = view.map;
    const { pane, aspect, fitK } = mapProjection(mapView);
    const k = fitK * mapView.zoom;
    const tx = pane.w / 2 + mapView.panX;
    const ty = pane.h / 2 + mapView.panY;
    const toScreen = id => {
        const place = layout.places.get(id);
        return { x: place.ux * aspect * k + tx, y: place.uy * k + ty };
    };
    const selected = mapSelectedId(context);
    const query = foldName(mapView.filter.trim());
    const matches = query ? new Set(context.ledger.characters.filter(character => [characterDisplayName(context.ledger, character), ...character.aliases]
        .some(name => foldName(name).includes(query))).map(character => character.id)) : null;
    const sharers = selected ? layout.sharersOf(selected) : new Map();
    const related = new Set();
    for (const relation of layout.relations) {
        if (relation.a === selected) related.add(relation.b);
        if (relation.b === selected) related.add(relation.a);
    }
    const focusId = mapFocusId(context, layout);

    const positions = new Map();
    const nodes = [];
    for (const ring of MAP_RINGS) {
        for (const id of layout.rings[ring]) {
            const screen = toScreen(id);
            positions.set(id, screen);
            const character = context.charactersById.get(id);
            const isMatch = matches ? matches.has(id) : false;
            const isDim = Boolean(matches && !isMatch && id !== selected);
            const place = layout.places.get(id);
            let priority = { scene: 900, recent: 500, earlier: 300, none: 100 }[ring] + Math.min(layout.known.get(id), 99);
            if (id === focusId) priority += 1200;
            if (sharers.has(id) || related.has(id)) priority += 1500;
            if (character.nameClash) priority += 250;
            if (isDim) priority -= 1000;
            nodes.push({
                id, ring, screen, character, isMatch, isDim,
                inView: screen.x >= 0 && screen.y >= 0 && screen.x <= pane.w && screen.y <= pane.h,
                size: mapDotSize(layout, id),
                name: characterDisplayName(context.ledger, character),
                fontSize: 13,
                bold: ring === 'scene' || id === selected || isMatch,
                angle: place.angle,
                priority,
                forced: id === selected || isMatch || id === mapView.carry || id === mapView.drag?.overId,
            });
        }
    }
    const blocked = mapRingTitleRects(layout, pane, aspect, k, tx, ty);
    placeMapLabels(nodes, pane, blocked);

    const svg = [];
    for (const ring of ['recent', 'earlier', 'none']) {
        const rx = layout.ringRadius[ring] * aspect * k;
        const ry = layout.ringRadius[ring] * k;
        svg.push(`<ellipse class="k-map-ring" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"/>`);
        svg.push(`<text class="k-map-ringt" x="${tx.toFixed(1)}" y="${(ty - ry + 4).toFixed(1)}" text-anchor="middle">${escapeHtml(`${MAP_RING_TITLES[ring]} · ${layout.rings[ring].length}`)}</text>`);
    }
    if (layout.rings.scene.length) {
        svg.push(`<text class="k-map-ringt" x="${tx.toFixed(1)}" y="${mapSceneTitleY(layout, k, ty).toFixed(1)}" text-anchor="middle">In the scene</text>`);
    }
    const bandWidth = Math.max(10, Math.min(24, 16 * mapView.zoom));
    for (const band of layout.familyBands) {
        const first = layout.places.get(band.ids[0]);
        const last = layout.places.get(band.ids[band.ids.length - 1]);
        const t0 = first.angle - first.step * 0.38;
        const t1 = last.angle + last.step * 0.38;
        const rx = layout.ringRadius[band.ring] * aspect * k;
        const ry = layout.ringRadius[band.ring] * k;
        const p0 = { x: rx * Math.cos(t0) + tx, y: ry * Math.sin(t0) + ty };
        const p1 = { x: rx * Math.cos(t1) + tx, y: ry * Math.sin(t1) + ty };
        svg.push(`<path class="k-map-fam" data-family="${escapeHtml(band.key)}" data-members="${escapeHtml(band.ids.join(' '))}" stroke-width="${bandWidth.toFixed(1)}" d="M${p0.x.toFixed(1)},${p0.y.toFixed(1)} A${rx.toFixed(1)},${ry.toFixed(1)} 0 ${t1 - t0 > Math.PI ? 1 : 0} 1 ${p1.x.toFixed(1)},${p1.y.toFixed(1)}"/>`);
    }
    const placedRects = [...blocked, ...nodes.filter(node => node.label).map(node => node.label)];
    const dotRects = nodes.map(node => ({ x: node.screen.x - node.size / 2 - 1, y: node.screen.y - node.size / 2 - 1, w: node.size + 2, h: node.size + 2 }));
    const showRelationWords = mapView.zoom >= 0.8;
    for (const relation of layout.relations) {
        const from = positions.get(relation.a);
        const to = positions.get(relation.b);
        const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const bend = Math.min(60, length * 0.18);
        const control = { x: middle.x - dy / length * bend, y: middle.y + dx / length * bend };
        const isHot = relation.a === selected || relation.b === selected;
        // The filter dims a relation unless one of its two characters matches
        const isDim = Boolean(matches && !matches.has(relation.a) && !matches.has(relation.b));
        const relationClass = `${isHot ? ' is-hot' : ''}${isDim ? ' is-dim' : ''}`;
        svg.push(`<path class="k-map-rel${relationClass}" data-pair="${escapeHtml(`${relation.a}|${relation.b}`)}" data-kinds="${escapeHtml(relation.words.map(word => word.text).join(' · '))}" d="M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${control.x.toFixed(1)},${control.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}"/>`);
        if (!showRelationWords && !isHot) continue;
        let firstPoint = null;
        for (const word of relation.words) {
            const steps = word.from === relation.a ? [0.3, 0.22, 0.4, 0.15, 0.5] : [0.7, 0.78, 0.6, 0.85, 0.5];
            const curvePoints = steps.map(t => ({
                x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
                y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
            }));
            // The second word of a pair stacks under or over the first
            const stacked = firstPoint ? [{ x: firstPoint.x, y: firstPoint.y + 16 }, { x: firstPoint.x, y: firstPoint.y - 16 }] : [];
            const point = placeMapText([...stacked, ...curvePoints], word.text, pane, placedRects, dotRects, isHot);
            if (!point) continue;
            firstPoint = firstPoint || point;
            svg.push(`<text class="k-map-relt${isDim ? ' is-dim' : ''}" x="${point.x.toFixed(1)}" y="${(point.y + 4).toFixed(1)}" text-anchor="middle">${escapeHtml(word.text)}</text>`);
        }
    }
    if (selected) {
        const from = positions.get(selected);
        for (const [otherId, words] of sharers) {
            const to = positions.get(otherId);
            svg.push(`<line class="k-map-share" x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}"/>`);
            if (sharers.size > 6) continue;
            const candidates = [0.5, 0.4, 0.6, 0.3, 0.7].map(t => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - 2 }));
            const point = placeMapText(candidates, words.join(', '), pane, placedRects, dotRects, false);
            if (point) svg.push(`<text class="k-map-sharet" x="${point.x.toFixed(1)}" y="${(point.y + 4).toFixed(1)}" text-anchor="middle">${escapeHtml(words.join(', '))}</text>`);
        }
    }
    // A drag: its line under the nodes, its sentence over the labels
    const drag = mapView.drag;
    let dragHintHtml = '';
    if (drag && positions.has(drag.id)) {
        const from = positions.get(drag.id);
        svg.push(`<line class="k-map-dragl" x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${drag.x.toFixed(1)}" y2="${drag.y.toFixed(1)}"/>`);
        const text = drag.overId ? `Merge ${nameOf(context, drag.id)} into ${nameOf(context, drag.overId)}` : `Merge ${nameOf(context, drag.id)} into…`;
        const hintX = Math.max(4, Math.min(drag.x + 14, pane.w - estimateTextWidth(text, 13, true) - 12));
        dragHintHtml = `<div class="k-map-dragt" style="transform:translate(${hintX.toFixed(1)}px,${(drag.y + 16).toFixed(1)}px)">${escapeHtml(text)}</div>`;
    }

    const nodesHtml = nodes.map(node => {
        const { id, ring, character } = node;
        const classes = ['k-map-node', `is-${ring}`, `side-${node.side}`];
        if (character.nameClash) classes.push('is-clash');
        if (id === selected) classes.push('is-sel');
        if (node.isMatch) classes.push('is-match');
        if (node.isDim) classes.push('is-dim');
        if (id === mapView.carry) classes.push('is-carry');
        if (id === mapView.drag?.overId) classes.push('is-target');
        const knownCount = layout.known.get(id);
        const relationOf = !character.name.trim() ? currentDetail(character, 'relation')?.value.of : null;
        const labelParts = [`${node.name}${character.aliases.length ? `, also ${character.aliases.join(', ')}` : ''}.`, `${MAP_RING_TITLES[ring]}, knows ${plural(knownCount, 'fact')}`];
        if (character.nameClash) labelParts[1] += ', name to check';
        if (relationOf && layout.places.get(id).joinedAnchor) labelParts[1] += `, placed with ${nameOf(context, relationOf)}`;
        return `<button type="button" class="${classes.join(' ')}" data-act="map-node" data-cid="${escapeHtml(id)}" data-ring="${ring}" data-family="${escapeHtml(layout.families.get(id).key)}" data-fk="map|${escapeHtml(id)}" tabindex="${id === focusId ? 0 : -1}"`
            + ` aria-label="${escapeHtml(labelParts.join(' '))}"${id === selected ? ' aria-current="true"' : ''} style="--d:${node.size}px;transform:translate(${node.screen.x.toFixed(1)}px,${node.screen.y.toFixed(1)}px)">`
            + `<span class="k-map-dot"></span><span class="k-map-lab${node.label ? '' : ' is-off'}">${escapeHtml(node.name)}</span>`
            + `${character.nameClash ? '<i class="k-map-flag fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : ''}</button>`;
    }).join('');

    // One rule for both numbers: a name counts when its dot is in the pane
    const hiddenNames = nodes.filter(node => node.inView && !node.label).length;
    let countText = `${plural(context.ledger.characters.length, 'character')} · every name shown`;
    if (matches) countText = `${matches.size} of ${context.ledger.characters.length}`;
    else if (hiddenNames) countText = `${plural(context.ledger.characters.length, 'character')} · ${plural(hiddenNames, 'name')} hidden: zoom in or hover`;
    const svgHtml = `<svg class="k-map-svg" aria-hidden="true" width="${pane.w}" height="${pane.h}">${svg.join('')}</svg>`;
    const nodesGroupHtml = `<div class="k-map-nodes" role="group" aria-label="Map: arrow keys move between characters, Enter opens one, M picks one up to merge it into another">${nodesHtml}${dragHintHtml}</div>`;
    return {
        html: svgHtml + nodesGroupHtml,
        countText,
        zoomPercent: Math.round(mapView.zoom * 100),
        positions,
    };
}

/**
 * Where every character sits, in units of the outer ring (radius 1, before
 * the pane's aspect stretches it wide), and who belongs with whom. The
 * scene sits in the centre; then who learned a fact in the last
 * MAP_RECENT_WINDOW messages; then who learned one earlier; then who knows
 * none. An unnamed relative without facts of its own takes its anchor's
 * ring. Within a ring, records sorted by name family sit side by side.
 * Facts from an arc plan do not count, so the map gives no plan away.
 * Deterministic: the same ledger gives the same layout.
 * @param {object} context
 * @returns {object}
 */
function layoutCastMap(context) {
    const { ledger } = context;
    const lastUpdatedAt = ledger.lastUpdatedAt ?? -Infinity;
    const present = new Set(context.present);
    const known = new Map();
    const ringOf = new Map();
    for (const character of ledger.characters) {
        const holdings = knownHoldingsOf(context, character.id);
        known.set(character.id, holdings.length);
        const lastAt = holdings.reduce((latest, { holder }) => (holder.at !== null && holder.at !== undefined && holder.at > latest ? holder.at : latest), -Infinity);
        let ring = 'none';
        if (present.has(character.id)) ring = 'scene';
        else if (holdings.length > 0 && lastAt >= lastUpdatedAt - MAP_RECENT_WINDOW) ring = 'recent';
        else if (holdings.length > 0) ring = 'earlier';
        ringOf.set(character.id, ring);
    }
    const joinedAnchor = new Set();
    for (const character of ledger.characters) {
        if (character.name.trim() || ringOf.get(character.id) !== 'none') continue;
        const anchorRing = ringOf.get(currentDetail(character, 'relation')?.value.of);
        if (anchorRing === 'recent' || anchorRing === 'earlier') {
            ringOf.set(character.id, anchorRing);
            joinedAnchor.add(character.id);
        }
    }

    // Each record's taken names, once: the families and the shared-name links read them
    const takenNames = new Map(ledger.characters.map(character => [character.id, listTakenNames({ characters: [character] })]));
    const families = listMapFamilies(context, takenNames);
    const sortKey = new Map(ledger.characters.map(character => [character.id,
        `${families.get(character.id).key}\u0001${character.name.trim() ? '0' : '1'}${foldName(characterDisplayName(ledger, character))}\u0001${character.id}`]));
    const rings = { scene: [], recent: [], earlier: [], none: [] };
    for (const character of ledger.characters) rings[ringOf.get(character.id)].push(character.id);
    for (const ring of MAP_RINGS) rings[ring].sort((first, second) => (sortKey.get(first) < sortKey.get(second) ? -1 : 1));

    const ringRadius = { ...MAP_RING_SCALE };
    const places = new Map();
    const sceneCount = rings.scene.length;
    rings.scene.forEach((id, index) => {
        const angle = -Math.PI / 2 + (index / sceneCount) * Math.PI * 2;
        const radius = sceneCount === 1 ? 0 : 0.11;
        places.set(id, { ux: radius * Math.cos(angle), uy: radius * Math.sin(angle), angle, step: 0, ring: 'scene' });
    });
    for (const ring of ['recent', 'earlier', 'none']) {
        const ids = rings[ring];
        // The gap at the top of the ring holds its title
        const gap = 0.5 / Math.max(ringRadius[ring], 0.1) * 0.42;
        const step = (Math.PI * 2 - gap) / Math.max(ids.length, 1);
        ids.forEach((id, index) => {
            const angle = -Math.PI / 2 + gap / 2 + step * (index + 0.5);
            places.set(id, { ux: ringRadius[ring] * Math.cos(angle), uy: ringRadius[ring] * Math.sin(angle), angle, step, ring, joinedAnchor: joinedAnchor.has(id) });
        });
    }

    const familySize = new Map();
    for (const family of families.values()) if (family.shared) familySize.set(family.key, (familySize.get(family.key) || 0) + 1);
    const familyBands = [];
    for (const ring of ['recent', 'earlier', 'none']) {
        const ids = rings[ring];
        let start = 0;
        while (start < ids.length) {
            const family = families.get(ids[start]);
            let end = start;
            while (end + 1 < ids.length && families.get(ids[end + 1]).key === family.key) end++;
            if (family.shared && familySize.get(family.key) > 1 && end > start) familyBands.push({ ring, key: family.key, label: family.label, ids: ids.slice(start, end + 1) });
            start = end + 1;
        }
    }

    // One line per pair, the kinship words near the record that carries each
    const pairs = new Map();
    for (const character of ledger.characters) {
        const relation = currentDetail(character, 'relation')?.value;
        if (!relation || !context.charactersById.has(relation.of) || relation.of === character.id) continue;
        const [a, b] = [character.id, relation.of].sort((first, second) => (sortKey.get(first) < sortKey.get(second) ? -1 : 1));
        const key = `${a}|${b}`;
        if (!pairs.has(key)) pairs.set(key, { a, b, words: [] });
        pairs.get(key).words.push({ from: character.id, text: relation.kind });
    }

    return {
        rings,
        places,
        ringRadius,
        known,
        families,
        familyBands,
        relations: [...pairs.values()],
        maxKnown: Math.max(1, ...known.values()),
        sharersOf: id => listMapSharers(context, takenNames, id),
    };
}

/**
 * The name family each record sits in on the map: its surname when another
 * record has it, else its most shared name word, else its own surname. A
 * short record whose every name word sits in a longer record's name (Raj
 * in Raj Barrows) joins that record's family; an unnamed relative sits in
 * its anchor's. `shared` says whether another record has the family word.
 * @param {object} context
 * @param {Map<string, Map<string, string>>} takenNames - Per character id its taken names (listTakenNames)
 * @returns {Map<string, {key: string, label: string, shared: boolean}>}
 */
function listMapFamilies(context, takenNames) {
    const { ledger } = context;
    const owners = mapNameWordOwners(takenNames);
    const homeFamily = (character, depth) => {
        if (!character.name.trim()) {
            const anchor = context.charactersById.get(currentDetail(character, 'relation')?.value.of);
            if (anchor && depth < 2) return homeFamily(anchor, depth + 1);
            return { key: '~', label: '', shared: false };
        }
        const words = nameWords(character.name);
        const lastWord = words[words.length - 1] || character.name;
        const surname = lastWord.split('-').filter(Boolean)[0] || lastWord;
        if ((owners.get(foldName(surname))?.size || 0) > 1) return { key: foldName(surname), label: surname, shared: true };
        let best = null;
        for (const word of words) {
            for (const part of new Set([word, ...word.split('-')])) {
                const ownerCount = owners.get(foldName(part))?.size || 0;
                if (ownerCount > 1 && (!best || ownerCount > best.ownerCount)) best = { key: foldName(part), label: part, ownerCount };
            }
        }
        if (best) return { key: best.key, label: best.label, shared: true };
        return { key: foldName(surname), label: surname, shared: false };
    };
    const families = new Map(ledger.characters.map(character => [character.id, homeFamily(character, 0)]));
    // The words of each name alone (aliases left out), hyphen parts included
    const ownWords = new Map(ledger.characters.map(character => [character.id,
        new Set(nameWords(character.name).flatMap(word => [word, ...word.split('-')]).filter(Boolean).map(foldName))]));
    for (const character of ledger.characters) {
        if (!character.name.trim()) continue;
        const mine = ownWords.get(character.id);
        if (mine.size === 0) continue;
        const containers = ledger.characters.filter(other => other.id !== character.id && other.name.trim()
            && ownWords.get(other.id).size > mine.size && [...mine].every(word => ownWords.get(other.id).has(word)));
        if (containers.length === 0) continue;
        const best = containers.sort((first, second) => knownHoldingsOf(context, second.id).length - knownHoldingsOf(context, first.id).length)[0];
        families.set(character.id, { ...families.get(best.id), shared: true });
        // Its unnamed relatives follow it
        for (const relative of ledger.characters) {
            if (!relative.name.trim() && currentDetail(relative, 'relation')?.value.of === character.id) families.set(relative.id, families.get(character.id));
        }
    }
    return families;
}

/** Folded name word → the ids of the records that have it */
function mapNameWordOwners(takenNames) {
    const owners = new Map();
    for (const [characterId, taken] of takenNames) {
        for (const word of taken.keys()) {
            if (!owners.has(word)) owners.set(word, new Set());
            owners.get(word).add(characterId);
        }
    }
    return owners;
}

/** The other records that share a name word with one record: id → the printed words */
function listMapSharers(context, takenNames, characterId) {
    const character = context.charactersById.get(characterId);
    const sharers = new Map();
    if (!character?.name.trim()) return sharers;
    const mine = takenNames.get(characterId);
    for (const other of context.ledger.characters) {
        if (other.id === characterId || !other.name.trim()) continue;
        const theirs = takenNames.get(other.id);
        const words = [...mine.keys()].filter(word => theirs.has(word)).map(word => mine.get(word));
        if (words.length) sharers.set(other.id, words);
    }
    return sharers;
}

/**
 * The pane, the stretch of the rings to the pane's shape and the scale
 * that fits the whole cast (zoom 1). Room is left outside the outer ring
 * for its labels.
 */
function mapProjection(mapView) {
    const pane = { w: Math.max(200, mapView.pane.w), h: Math.max(160, mapView.pane.h) };
    const radiusY = pane.h / 2 - 34;
    const radiusXMax = pane.w / 2 - 112;
    const aspect = Math.max(1, Math.min(1.9, radiusXMax / Math.max(radiusY, 1)));
    const fitK = Math.max(60, Math.min(radiusY, radiusXMax / aspect));
    return { pane, aspect, fitK };
}

/** A dot's diameter: 8 px for no facts up to 28 px for who knows the most */
function mapDotSize(layout, characterId) {
    return Math.round(8 + 20 * Math.sqrt(layout.known.get(characterId) / layout.maxKnown));
}

/** The node the arrow keys start from: the focused one, else the selected, else the scene's first */
function mapFocusId(context, layout) {
    const { map } = context.view;
    if (map.focusId && context.charactersById.has(map.focusId)) return map.focusId;
    const selected = mapSelectedId(context);
    if (selected) return selected;
    return layout.rings.scene[0] || layout.rings.recent[0] || layout.rings.earlier[0] || layout.rings.none[0] || null;
}

/** The scene title's height: above the scene's circle, or above its one dot */
function mapSceneTitleY(layout, k, ty) {
    if (layout.rings.scene.length > 1) return ty - 0.11 * k - 30;
    return ty - mapDotSize(layout, layout.rings.scene[0]) / 2 - 10;
}

/** Where the ring titles sit, so no label covers them */
function mapRingTitleRects(layout, pane, aspect, k, tx, ty) {
    const rects = [];
    for (const ring of ['recent', 'earlier', 'none']) {
        const width = estimateTextWidth(`${MAP_RING_TITLES[ring]} · ${layout.rings[ring].length}`, 13, false);
        rects.push({ x: tx - width / 2, y: ty - layout.ringRadius[ring] * k - 9, w: width, h: 17 });
    }
    if (layout.rings.scene.length) {
        const width = estimateTextWidth('In the scene', 13, false);
        rects.push({ x: tx - width / 2, y: mapSceneTitleY(layout, k, ty) - 13, w: width, h: 17 });
    }
    return rects;
}

/**
 * A text's width in pixels, estimated from its length, in Node as in the
 * browser, so the same ledger and pane label the same characters. It errs
 * wide: a label too long for its gap stays hidden rather than overlapping.
 */
function estimateTextWidth(text, fontSize, bold) {
    return text.length * fontSize * (bold ? 0.6 : 0.56) + 8;
}

/**
 * Place the labels, most important first: the selected character, filter
 * matches, a merge's two halves (always shown), then the focused node, who
 * shares a name or a relation with the selection, the scene, who knows
 * most. Each tries beside its dot on the side away from the centre, then
 * above or below it away from the centre, then the inner side; a label that
 * covers another label, a dot, a name-to-check flag, a ring title or
 * leaves the pane is not shown (hover and focus still show it); a dot
 * outside the pane gets no label. Sets `side` and `label` (its rectangle,
 * or null) on each node.
 */
function placeMapLabels(nodes, pane, blocked) {
    // A flag sits over its own label (CSS), so only the other labels keep off it
    const flags = nodes.filter(node => node.character.nameClash)
        .map(node => ({ id: node.id, x: node.screen.x + node.size / 2 - 4, y: node.screen.y - node.size / 2 - 9, w: 12, h: 12 }));
    const placed = [...blocked];
    const dots = nodes.map(node => ({ id: node.id, x: node.screen.x - node.size / 2 - 1, y: node.screen.y - node.size / 2 - 1, w: node.size + 2, h: node.size + 2 }));
    const order = [...nodes].sort((first, second) => (second.forced ? 10000 : 0) + second.priority - (first.forced ? 10000 : 0) - first.priority
        || (first.id < second.id ? -1 : 1));
    for (const node of order) {
        if (!node.inView) {
            node.side = 'r';
            node.label = null;
            continue;
        }
        const width = estimateTextWidth(node.name, node.fontSize, node.bold);
        const outward = Math.cos(node.angle) >= -0.02 ? 'r' : 'l';
        const inward = outward === 'r' ? 'l' : 'r';
        const vertical = Math.sin(node.angle) < 0 ? 't' : 'b';
        // Last, beside the dot but half a row up or down, away from the centre first
        const halfRows = vertical === 't' ? [`${outward}u`, `${outward}d`] : [`${outward}d`, `${outward}u`];
        const sides = node.ring === 'scene' ? ['b', 'r', 'l'] : [outward, vertical, inward, vertical === 't' ? 'b' : 't', ...halfRows];
        let chosen = null;
        for (const side of sides) {
            const rect = mapLabelRect(side, node.screen, node.size, width);
            const fits = rect.x > 2 && rect.y > 2 && rect.x + rect.w < pane.w - 2 && rect.y + rect.h < pane.h - 2
                && !placed.some(other => mapRectsOverlap(rect, other))
                && !dots.some(dot => dot.id !== node.id && mapRectsOverlap(rect, dot))
                && !flags.some(flag => flag.id !== node.id && mapRectsOverlap(rect, flag));
            if (fits) {
                chosen = { side, rect };
                break;
            }
        }
        // A label that must show takes the side where it covers the fewest labels
        if (!chosen && node.forced) {
            const covered = side => placed.filter(other => mapRectsOverlap(mapLabelRect(side, node.screen, node.size, width), other)).length;
            const side = sides.reduce((best, candidate) => (covered(candidate) < covered(best) ? candidate : best));
            chosen = { side, rect: mapLabelRect(side, node.screen, node.size, width) };
        }
        node.side = chosen ? chosen.side : sides[0];
        node.label = chosen ? chosen.rect : null;
        if (chosen) placed.push(chosen.rect);
    }
}

/** A label's rectangle on one side of its dot: r, l, t (above) or b (below); ru, rd, lu, ld beside it half a row up or down */
function mapLabelRect(side, screen, size, width) {
    if (side.length === 2) {
        const beside = mapLabelRect(side[0], screen, size, width);
        return { ...beside, y: beside.y + (side[1] === 'u' ? -MAP_LABEL_HEIGHT / 2 - 1 : MAP_LABEL_HEIGHT / 2 + 1) };
    }
    if (side === 'r') return { x: screen.x + size / 2 + 4, y: screen.y - MAP_LABEL_HEIGHT / 2, w: width, h: MAP_LABEL_HEIGHT };
    if (side === 'l') return { x: screen.x - size / 2 - 4 - width, y: screen.y - MAP_LABEL_HEIGHT / 2, w: width, h: MAP_LABEL_HEIGHT };
    if (side === 't') return { x: screen.x - width / 2, y: screen.y - size / 2 - 3 - MAP_LABEL_HEIGHT, w: width, h: MAP_LABEL_HEIGHT };
    return { x: screen.x - width / 2, y: screen.y + size / 2 + 3, w: width, h: MAP_LABEL_HEIGHT };
}

function mapRectsOverlap(first, second) {
    return first.x < second.x + second.w && second.x < first.x + first.w && first.y < second.y + second.h && second.y < first.y + first.h;
}

/** A free-floating word (a kinship, a shared name) at the first candidate point where it covers no label and no dot */
function placeMapText(candidates, text, pane, placed, dots, force) {
    const width = estimateTextWidth(text, 13, false);
    for (const point of candidates) {
        const rect = { x: point.x - width / 2, y: point.y - 9, w: width, h: 16 };
        if (rect.x < 2 || rect.y < 2 || rect.x + rect.w > pane.w - 2 || rect.y + rect.h > pane.h - 2) continue;
        if (placed.some(other => mapRectsOverlap(rect, other)) || dots.some(dot => mapRectsOverlap(rect, dot))) continue;
        placed.push(rect);
        return point;
    }
    if (!force) return null;
    // A word that must show may cross a dot, but not another word or label, while a candidate allows
    for (const point of candidates) {
        const rect = { x: point.x - width / 2, y: point.y - 9, w: width, h: 16 };
        if (placed.some(other => mapRectsOverlap(rect, other))) continue;
        placed.push(rect);
        return point;
    }
    return candidates[0];
}

/**
 * A drop of one character onto another, by drag or by the M key: open the
 * dropped character's sheet with the merge preview of it into the other,
 * the same preview "Same person as…" shows. Nothing is merged until the
 * player confirms there (merge-go, saveLedgerEdit).
 * @param {object} view - The view state (createKnowledgeView)
 * @param {string} fromId - The character that goes
 * @param {string} toId - The character that stays
 */
export function startMapMerge(view, fromId, toId) {
    view.sheet = { type: 'character', id: fromId, from: null, back: null };
    view.heldQuery = '';
    view.heldLimit = 30;
    for (const key of Object.keys(view.drafts)) {
        if (key.startsWith('sheet:')) delete view.drafts[key];
    }
    delete view.errors.sheet;
    view.editors.set('sheet', { mode: 'merge', characterId: fromId, targetId: toId, keepSelf: false });
    view.map.carry = null;
    view.map.drag = null;
    view.map.focusId = toId;
}

// ─── Event wiring ───────────────────────────────────────────────────────────

/**
 * Bind the popup's events: clicks, typing and keys by document-level
 * delegation, the `toggle` of its `<details>` on the popup root (the event
 * does not bubble, so jQuery cannot delegate it; the capture phase reaches
 * the root).
 * @param {Popup} popup
 */
function wireKnowledgeEvents(popup) {
    const $doc = $(document);
    $doc.off('.storyArcKnowledge');
    const isInPopup = element => Boolean(element?.closest?.('#story-arc-knowledge'));

    // A picker option keeps the focus in its field
    $doc.on('mousedown.storyArcKnowledge', '#story-arc-knowledge [data-pick]', event => event.preventDefault());
    $doc.on('click.storyArcKnowledge', '#story-arc-knowledge [data-pick]', function () {
        pickCharacter(this.dataset.pick, this.dataset.cid);
    });
    $doc.on('click.storyArcKnowledge', '#story-arc-knowledge [data-open]', function () {
        const [type, ...idParts] = this.dataset.open.split(':');
        openSheet(type, idParts.join(':'), null);
    });
    $doc.on('click.storyArcKnowledge', '#story-arc-knowledge [data-act]', function () {
        if (this.disabled) return;
        // The show-reviewed checkbox acts on change
        if (this.matches('input[type="checkbox"]')) return;
        if (this.dataset.act === 'close') {
            if (typeof popup?.complete === 'function') popup.complete(0);
            return;
        }
        const action = KNOWLEDGE_ACTIONS[this.dataset.act];
        if (action) action(this);
    });
    $doc.on('input.storyArcKnowledge', '#story-arc-knowledge input, #story-arc-knowledge textarea', function () {
        onKnowledgeInput(this);
    });
    $doc.on('change.storyArcKnowledge', '#story-arc-knowledge input, #story-arc-knowledge select', function () {
        if (this.dataset.act === 'show-reviewed') {
            knowledgeView.showReviewed = this.checked;
            knowledgeView.focusAfter = ['[data-act="show-reviewed"]'];
            refreshKnowledgePopup();
            return;
        }
        if (this.dataset.draft && (this.type === 'checkbox' || this.tagName === 'SELECT')) {
            knowledgeView.drafts[this.dataset.draft] = this.type === 'checkbox' ? this.checked : this.value;
        }
    });
    $doc.on('keydown.storyArcKnowledge', event => {
        if (!isInPopup(event.target)) return;
        onKnowledgeKeydown(event);
    });
    $doc.on('focusin.storyArcKnowledge', '#story-arc-knowledge', () => drawKeyHints());

    // The map's pointer and wheel: on the root, which outlives every redraw;
    // natively, as jQuery cannot bind a wheel listener that prevents scrolling.
    const root = document.getElementById('story-arc-knowledge');
    root?.addEventListener('pointerdown', onMapPointerDown);
    root?.addEventListener('pointermove', onMapPointerMove);
    root?.addEventListener('pointerup', onMapPointerEnd);
    root?.addEventListener('pointercancel', onMapPointerEnd);
    root?.addEventListener('wheel', onMapWheel, { passive: false });
    if (knowledgeView.tab === 'map') observeMapStage();

    root?.addEventListener('toggle', event => {
        const details = event.target;
        if (details.dataset?.strip) knowledgeView.stripOpen[details.dataset.strip] = details.open;
        if (details.dataset?.fold) {
            knowledgeView.foldOpen[details.dataset.fold] = details.open;
            // The rows are drawn when the fold opens, not before
            if (details.open && !details.querySelector('.k-row, .k-retracted')) {
                knowledgeView.focusAfter = [`[data-fold="${details.dataset.fold}"] summary`];
                refreshCastMain();
            }
        }
    }, true);
}

/** Typing: a field's draft, a picker's options, the search, the filter of what a character knows */
function onKnowledgeInput(field) {
    const view = knowledgeView;
    if (field.dataset.draft) view.drafts[field.dataset.draft] = field.type === 'checkbox' ? field.checked : field.value;
    if (field.dataset.picker) {
        const area = field.dataset.picker;
        view.drafts[`${area}:p`] = field.value;
        view.pickerActive[`${area}:p`] = 0;
        refreshPickerOptions(field);
        return;
    }
    if (field.id === 'sa-k-q') {
        view.query = field.value;
        view.charLimit = 8;
        view.factLimit = 15;
        view.sheet = null;
        view.recordFacts = null;
        if (view.query.trim()) view.stripOpen.cast = false;
        refreshCastMain({ withStrip: true });
        return;
    }
    if (field.id === 'sa-k-map-q') {
        view.map.filter = field.value;
        requestMapDraw();
        return;
    }
    if (field.dataset.search === 'held') {
        view.heldQuery = field.value;
        view.heldLimit = 30;
        const caret = field.selectionStart;
        refreshCastMain();
        const newField = document.getElementById('sa-k-held-q');
        newField?.focus();
        newField?.setSelectionRange(caret, caret);
        return;
    }
    if (field.dataset.draft === 'add:name') {
        const hint = document.getElementById('sa-k-taken-hint');
        if (hint) hint.innerHTML = buildTakenNameHint(currentRenderContext(), field.value, true);
    }
}

/** The render context of the stored ledger and the open popup's view */
function currentRenderContext() {
    return createRenderContext(getKnowledgeLedger(), chat, isCharacterDetailsEnabled(), knowledgeView);
}

/** The popup's root element, or null while it is not open (also under Node) */
function popupRoot() {
    if (typeof document === 'undefined') return null;
    return document.getElementById('story-arc-knowledge');
}

/** Whether an area is a What changed line */
function findLine(context, lineKey) {
    return context.lines.groups.flatMap(group => group.lines).find(line => line.key === lineKey) || null;
}

/** The result with every item of the line marked reviewed */
function withLineReviewed(result, line) {
    let reviewed = result;
    for (const itemKey of line.itemKeys) {
        const marked = markChangeItemReviewed(reviewed.ledger, itemKey);
        if (!marked.error) reviewed = { ...reviewed, ledger: marked.ledger };
    }
    return reviewed;
}

/** Remember what the player changed, for "Changed by you" and the pickers */
function touch(key) {
    knowledgeView.touched = [key, ...knowledgeView.touched.filter(touchedKey => touchedKey !== key)].slice(0, 8);
}

/**
 * Run one hand edit: the pure edit on the stored ledger; a refusal shows in
 * the area's editor, a success is saved (undoable) after `beforeSave` set
 * the view. An edit made from a What changed line also marks that line
 * reviewed, in the same undo step, and keeps it in view with `fix`.
 * @param {string} area
 * @param {string} label - What the edit did, for the status bar and Undo
 * @param {function(object): {ledger: object|null, error: string|null}} makeResult - Gets the stored ledger
 * @param {{ fix?: string, beforeSave?: function(object): void }} [options] - beforeSave gets the result
 * @returns {Promise<boolean>} Whether it was saved
 */
async function runLedgerEdit(area, label, makeResult, { fix = '', beforeSave = null } = {}) {
    const view = knowledgeView;
    let result = makeResult(getKnowledgeLedger());
    if (result.error) {
        view.errors[area] = result.error;
        view.status = { message: result.error, kind: 'refused' };
        refreshKnowledgePopup();
        return false;
    }
    delete view.errors[area];
    const line = findLine(currentRenderContext(), area);
    if (line) {
        result = withLineReviewed(result, line);
        view.keep.add(line.key);
        if (fix) view.fixes[line.key] = fix;
    }
    beforeSave?.(result);
    await saveLedgerEdit(result, label);
    return true;
}

/** The sheet to go back to, or none */
function backTarget() {
    const sheet = knowledgeView.sheet;
    return sheet?.back ? { ...sheet.back, from: sheet.from } : null;
}

/** Give a holder entry to another character */
function moveHolderFrom(area, factId, fromId, toId) {
    const context = currentRenderContext();
    const fact = context.ledger.facts.find(candidate => candidate.id === factId);
    const alreadyHolds = fact?.holders.some(holder => holder.characterId === toId);
    const fromName = nameOf(context, fromId);
    const toName = nameOf(context, toId);
    const label = alreadyHolds ? `${toName} knew it already; ${fromName}'s entry removed` : `${fromName}'s entry moved to ${toName}`;
    return runLedgerEdit(area, label, ledger => moveFactHolder(ledger, factId, fromId, toId), {
        beforeSave: () => {
            if (findLine(context, area)) knowledgeView.moved[area] = { ...knowledgeView.moved[area], [fromId]: toId };
            knowledgeView.editors.delete(area);
            touch(`f:${factId}`);
            knowledgeView.focusAfter = area === 'fs' ? [{ attribute: 'data-row', value: toId }] : [{ attribute: 'data-area', value: area }];
        },
    });
}

/** Take a fact away from a character */
function removeHolderFrom(area, factId, characterId) {
    const name = nameOf(currentRenderContext(), characterId);
    return runLedgerEdit(area, `${name} no longer holds the fact`, ledger => removeFactHolder(ledger, factId, characterId), {
        beforeSave: () => {
            if (knowledgeView.editors.get(area)?.factId === factId) knowledgeView.editors.delete(area);
            touch(`f:${factId}`);
        },
    });
}

/** The typed value of a detail editor, in the form saveCharacterDetails reads */
function typedDetailOf(area, kind, current) {
    const drafts = knowledgeView.drafts;
    if (kind === 'relation') {
        const kinship = Object.prototype.hasOwnProperty.call(drafts, `${area}:v`) ? drafts[`${area}:v`] : current?.value.kind || '';
        const ofId = Object.prototype.hasOwnProperty.call(drafts, `${area}:of`) ? drafts[`${area}:of`] : current?.value.of || '';
        return { kind: String(kinship), of: String(ofId) };
    }
    return String(Object.prototype.hasOwnProperty.call(drafts, `${area}:v`) ? drafts[`${area}:v`] : current?.value || '');
}

/** A detail's current value in the form of its editor field */
function shownDetailOf(kind, current) {
    if (kind === 'relation') return { kind: current?.value.kind || '', of: current?.value.of || '' };
    return current ? String(current.value) : '';
}

/** Open an editor in an area, closing what was open there; a second click on its button closes it */
function toggleEditor(area, editor, focusKey) {
    const openEditor = knowledgeView.editors.get(area);
    if (openEditor && openEditor.mode === editor.mode && openEditor.characterId === editor.characterId
        && openEditor.factId === editor.factId && openEditor.kind === editor.kind) {
        closeEditor(area);
        return;
    }
    openEditorIn(area, editor, focusKey);
}

function openEditorIn(area, editor, focusKey) {
    const view = knowledgeView;
    delete view.errors[area];
    for (const key of Object.keys(view.drafts)) {
        if (key.startsWith(`${area}:`) && !(area === 'sheet' && /:(name|aliases)$/.test(key))) delete view.drafts[key];
    }
    view.editors.set(area, editor);
    view.focusKey = focusKey;
    refreshKnowledgePopup();
}

function closeEditor(area) {
    const view = knowledgeView;
    const editor = view.editors.get(area);
    view.editors.delete(area);
    delete view.errors[area];
    for (const key of Object.keys(view.drafts)) {
        if (key.startsWith(`${area}:`) && !/:(name|aliases)$/.test(key)) delete view.drafts[key];
    }
    view.focusAfter = editor?.row
        ? [{ attribute: 'data-row', value: editor.row }]
        : [{ attribute: 'data-area', value: area }, '#sa-k-sheet-title'];
    view.focusKey = null;
    refreshKnowledgePopup({ ignoreFocus: true });
}

/** A picked character, by what the area's picker is for */
async function pickCharacter(area, characterId) {
    const view = knowledgeView;
    if (!characterId) return;
    delete view.drafts[`${area}:p`];
    view.pickerActive[`${area}:p`] = 0;
    const editor = view.editors.get(area);
    if (editor?.mode === 'move') {
        await moveHolderFrom(area, editor.factId, editor.characterId, characterId);
        return;
    }
    if (editor?.mode === 'add') {
        const name = nameOf(currentRenderContext(), characterId);
        await runLedgerEdit(area, `${name} added as a holder`, ledger => addFactHolder(ledger, editor.factId, characterId), {
            beforeSave: () => {
                view.editors.delete(area);
                touch(`f:${editor.factId}`);
            },
        });
        return;
    }
    if (editor?.mode === 'merge') {
        editor.targetId = characterId;
        editor.keepSelf = false;
        view.focusKey = `merge-go|${area}`;
        refreshKnowledgePopup({ ignoreFocus: true });
        return;
    }
    if (editor?.mode === 'detail') {
        view.drafts[`${area}:of`] = characterId;
        view.focusKey = `detail|${area}`;
        refreshKnowledgePopup({ ignoreFocus: true });
        return;
    }
    if (area === 'add' && view.sheet?.id === 'relative') {
        view.drafts['add:of'] = characterId;
        delete view.drafts['add:repick'];
        view.focusKey = 'create-relative';
        refreshKnowledgePopup({ ignoreFocus: true });
        return;
    }
    if (area === 'add' && view.sheet?.id === 'fact') {
        view.newFactHolders = [...view.newFactHolders, characterId];
        view.focusKey = 'picker|add';
        refreshKnowledgePopup({ ignoreFocus: true });
    }
}

/**
 * Every button's action, by its `data-act`. Each gets the button; the data
 * it needs is on it.
 */
const KNOWLEDGE_ACTIONS = {
    tab(button) {
        setTab(button.dataset.tab);
        if (button.dataset.tab === 'cast') document.getElementById('sa-k-q')?.focus();
    },
    review(button) { reviewLine(button.dataset.line); },
    async unreview(button) {
        const context = currentRenderContext();
        const line = findLine(context, button.dataset.line);
        if (!line) return;
        let result = { ledger: context.ledger, error: null };
        for (const itemKey of line.itemKeys) result = unmarkChangeItemReviewed(result.ledger, itemKey);
        knowledgeView.keep.add(line.key);
        knowledgeView.focusKey = `review|${line.key}`;
        await saveLedgerEdit(result, 'line reopened for review');
    },
    async 'review-group'(button) {
        const context = currentRenderContext();
        const group = context.lines.groups.find(candidate => candidate.key === button.dataset.group);
        if (!group) return;
        const openLines = group.lines.filter(line => !line.reviewed);
        let result = { ledger: context.ledger, error: null };
        for (const line of openLines) result = withLineReviewed(result, line);
        knowledgeView.focusAfter = [`#sa-k-g-${group.key} button`, '#sa-k-changes-empty button'];
        await saveLedgerEdit(result, `${plural(openLines.length, 'line')} marked reviewed`);
    },
    'show-group'(button) {
        const groupKey = button.dataset.group;
        if (knowledgeView.openGroups.has(groupKey)) knowledgeView.openGroups.delete(groupKey);
        else knowledgeView.openGroups.add(groupKey);
        knowledgeView.focusKey = `show-group|${groupKey}`;
        refreshKnowledgePopup({ ignoreFocus: true });
    },
    sheet(button) { openSheet('character', button.dataset.cid, button.dataset.from || null); },
    'record-facts'(button) {
        const record = (getKnowledgeLedger().updateLog || [])[Number(button.dataset.index)];
        if (!record) return;
        knowledgeView.recordFacts = { from: record.from, to: record.to, factsCreated: record.factsCreated || [], factsRetracted: record.factsRetracted || [] };
        knowledgeView.query = '';
        knowledgeView.sheet = null;
        knowledgeView.stripOpen.cast = false;
        setTab('cast');
        document.getElementById('sa-k-title')?.focus();
    },
    'message-search'(button) {
        knowledgeView.query = `#${rangeText(Number(button.dataset.from), Number(button.dataset.to))}`;
        knowledgeView.recordFacts = null;
        knowledgeView.sheet = null;
        knowledgeView.stripOpen.cast = false;
        if (knowledgeView.tab === 'cast') refreshCastMain({ withStrip: true });
        else setTab('cast');
        document.getElementById('sa-k-q')?.focus();
    },
    reveal(button) {
        knowledgeView.revealed.add(button.dataset.key);
        knowledgeView.focusAfter = [{ attribute: 'data-key', value: button.dataset.key }, '[data-row] [data-act="sheet-move"]', '#sa-k-sheet-title'];
        refreshKnowledgePopup({ ignoreFocus: true });
    },
    'ed-holder'(button) {
        const { area, fid, cid } = button.dataset;
        toggleEditor(area, { mode: 'holder', factId: fid, characterId: cid }, `ed-move|${area}|${fid}|${cid}`);
    },
    'ed-move'(button) {
        const { area, fid, cid } = button.dataset;
        openEditorIn(area, { mode: 'move', factId: fid, characterId: cid }, `picker|${area}`);
    },
    'ed-add'(button) { toggleEditor(button.dataset.area, { mode: 'add', factId: button.dataset.fid }, `picker|${button.dataset.area}`); },
    'ed-text'(button) { toggleEditor(button.dataset.area, { mode: 'text', factId: button.dataset.fid }, `text|${button.dataset.area}`); },
    'ed-fdelete'(button) {
        const { area, fid } = button.dataset;
        toggleEditor(area, { mode: 'fdelete', factId: fid }, `fdelete-go|${area}|${fid}`);
    },
    'ed-names'(button) { toggleEditor(button.dataset.area, { mode: 'names', characterId: button.dataset.cid }, `name|${button.dataset.area}`); },
    'ed-merge'(button) {
        const { area, cid } = button.dataset;
        const context = currentRenderContext();
        const character = context.charactersById.get(cid);
        if (!character) return;
        // A name check with one other record: that one is the merge's other half
        const others = character.nameClash ? [...new Set(listNameClashLines(context, character).flatMap(line => line.ids))] : [];
        const targetId = others.length === 1 ? others[0] : null;
        toggleEditor(area, { mode: 'merge', characterId: cid, targetId, keepSelf: false }, targetId ? `merge-go|${area}` : `picker|${area}`);
    },
    'ed-delete'(button) {
        const { area, cid } = button.dataset;
        toggleEditor(area, { mode: 'delete', characterId: cid }, `delete-go|${area}|${cid}`);
    },
    'ed-detail'(button) {
        const { area, cid, kind } = button.dataset;
        toggleEditor(area, { mode: 'detail', characterId: cid, kind }, `detail|${area}`);
    },
    'ed-close'(button) { closeEditor(button.dataset.area); },
    'remove-holder'(button) { removeHolderFrom(button.dataset.area, button.dataset.fid, button.dataset.cid); },
    'sheet-move'(button) {
        const { fid, cid } = button.dataset;
        toggleEditor('sheet', { mode: 'move', factId: fid, characterId: cid, row: fid }, 'picker|sheet');
    },
    'sheet-remove'(button) {
        knowledgeView.focusAfter = ['#sa-k-held .k-item'];
        removeHolderFrom('sheet', button.dataset.fid, button.dataset.cid);
    },
    'fs-move'(button) {
        const { fid, cid } = button.dataset;
        toggleEditor('fs', { mode: 'move', factId: fid, characterId: cid, row: cid }, 'picker|fs');
    },
    'fs-remove'(button) {
        knowledgeView.focusAfter = ['#sa-k-holders .k-item', '#sa-k-sheet-title'];
        removeHolderFrom('fs', button.dataset.fid, button.dataset.cid);
    },
    'fdelete-go'(button) {
        const { area, fid } = button.dataset;
        const fact = getKnowledgeLedger().facts.find(candidate => candidate.id === fid);
        const holderCount = fact ? fact.holders.length : 0;
        runLedgerEdit(area, `fact deleted (${plural(holderCount, 'holder')} no longer know it)`, ledger => deleteFact(ledger, fid), {
            beforeSave: () => {
                knowledgeView.editors.delete(area);
                if (knowledgeView.sheet?.type === 'fact' && knowledgeView.sheet.id === fid) knowledgeView.sheet = backTarget();
                knowledgeView.focusAfter = [{ attribute: 'data-area', value: area }, '#sa-k-sheet-title', '#sa-k-q'];
            },
        });
    },
    restore(button) {
        const { area, fid } = button.dataset;
        runLedgerEdit(area, 'fact put back as true', ledger => restoreRetractedFact(ledger, fid), {
            beforeSave: () => touch(`f:${fid}`),
        });
    },
    'save-text'(button) {
        const { area, fid } = button.dataset;
        const fact = getKnowledgeLedger().facts.find(candidate => candidate.id === fid);
        if (!fact) return;
        const text = String(knowledgeView.drafts[`${area}:text`] ?? fact.text);
        const isPublic = Boolean(knowledgeView.drafts[`${area}:public`] ?? fact.public);
        runLedgerEdit(area, 'fact corrected', ledger => {
            const edited = editFactText(ledger, fid, text);
            return edited.error ? edited : setFactPublic(edited.ledger, fid, isPublic);
        }, {
            fix: 'You corrected the text.',
            beforeSave: () => {
                delete knowledgeView.drafts[`${area}:text`];
                delete knowledgeView.drafts[`${area}:public`];
                if (area !== 'fs') knowledgeView.editors.delete(area);
                touch(`f:${fid}`);
            },
        });
    },
    'save-names'(button) {
        const { area, cid } = button.dataset;
        const character = getKnowledgeLedger().characters.find(candidate => candidate.id === cid);
        if (!character) return;
        const name = String(knowledgeView.drafts[`${area}:name`] ?? character.name);
        const aliasesText = String(knowledgeView.drafts[`${area}:aliases`] ?? character.aliases.join(', '));
        const before = characterDisplayName(getKnowledgeLedger(), character);
        const label = name.trim() !== character.name ? `${before} renamed to ${name.trim() || 'no name'}` : `names of ${before} saved`;
        runLedgerEdit(area, label, ledger => {
            const renamed = renameCharacter(ledger, cid, name);
            return renamed.error ? renamed : setCharacterAliases(renamed.ledger, cid, splitAliases(aliasesText));
        }, {
            beforeSave: () => {
                delete knowledgeView.drafts[`${area}:name`];
                delete knowledgeView.drafts[`${area}:aliases`];
                if (area !== 'sheet') knowledgeView.editors.delete(area);
                touch(`c:${cid}`);
            },
        });
    },
    'keep-name'(button) {
        const { area, cid } = button.dataset;
        const next = button.closest('.k-clash')?.nextElementSibling?.dataset.area;
        runLedgerEdit(area, `kept the name ${characterName(getKnowledgeLedger(), cid)}`, ledger => keepCharacterName(ledger, cid), {
            beforeSave: () => {
                knowledgeView.editors.delete(area);
                touch(`c:${cid}`);
                knowledgeView.focusAfter = next ? [{ attribute: 'data-area', value: next, then: '[data-act="keep-name"]' }, '#sa-k-title'] : ['#sa-k-title'];
            },
        });
    },
    lock(button) {
        const { area, cid, kind } = button.dataset;
        runLedgerEdit(area, `${characterName(getKnowledgeLedger(), cid)}'s ${kind} locked`, ledger => lockCharacterDetail(ledger, cid, kind), {
            beforeSave: () => touch(`c:${cid}`),
        });
    },
    unlock(button) {
        const { area, cid, kind } = button.dataset;
        const character = getKnowledgeLedger().characters.find(candidate => candidate.id === cid);
        if (!character) return;
        const current = currentDetail(character, kind);
        const emptied = kind === 'relation' ? { kind: '', of: '' } : '';
        const label = storyDetail(character, kind) ? `${characterName(getKnowledgeLedger(), cid)}'s ${kind} unlocked: the story's value counts again` : `${characterName(getKnowledgeLedger(), cid)}'s ${kind} cleared`;
        runLedgerEdit(area, label, ledger => saveCharacterDetails(ledger, cid, { [kind]: emptied }, { [kind]: shownDetailOf(kind, current) }), {
            beforeSave: () => touch(`c:${cid}`),
        });
    },
    'save-detail'(button) {
        const { area, cid, kind } = button.dataset;
        const character = getKnowledgeLedger().characters.find(candidate => candidate.id === cid);
        if (!character) return;
        const current = currentDetail(character, kind);
        const typed = typedDetailOf(area, kind, current);
        const shown = shownDetailOf(kind, current);
        const isUnchanged = kind === 'relation'
            ? typed.kind.trim().toLowerCase() === shown.kind.toLowerCase() && typed.of === shown.of
            : typed.trim().toLowerCase() === shown.toLowerCase();
        const name = characterName(getKnowledgeLedger(), cid);
        // Saving the value as it is locks it, as Lock does
        const makeResult = isUnchanged && current && !isDetailLocked(character, kind)
            ? ledger => lockCharacterDetail(ledger, cid, kind)
            : ledger => saveCharacterDetails(ledger, cid, { [kind]: typed }, { [kind]: shown });
        runLedgerEdit(area, `${name}'s ${kind} set and locked`, makeResult, {
            beforeSave: () => {
                for (const suffix of ['v', 'of', 'p']) delete knowledgeView.drafts[`${area}:${suffix}`];
                knowledgeView.editors.delete(area);
                touch(`c:${cid}`);
                knowledgeView.focusAfter = area === 'sheet' ? [`[data-detail="${kind}"] .k-btn`] : [{ attribute: 'data-area', value: area }];
            },
        });
    },
    'merge-swap'(button) {
        const editor = knowledgeView.editors.get(button.dataset.area);
        if (!editor) return;
        editor.keepSelf = !editor.keepSelf;
        knowledgeView.focusKey = `merge-swap|${button.dataset.area}`;
        refreshKnowledgePopup({ ignoreFocus: true });
    },
    'merge-repick'(button) {
        const editor = knowledgeView.editors.get(button.dataset.area);
        if (!editor) return;
        editor.targetId = null;
        knowledgeView.focusKey = `picker|${button.dataset.area}`;
        refreshKnowledgePopup({ ignoreFocus: true });
    },
    'merge-go'(button) {
        const area = button.dataset.area;
        const editor = knowledgeView.editors.get(area);
        if (!editor?.targetId) return;
        const mainId = editor.keepSelf ? editor.characterId : editor.targetId;
        const otherId = editor.keepSelf ? editor.targetId : editor.characterId;
        const storedLedger = getKnowledgeLedger();
        runLedgerEdit(area, `${characterName(storedLedger, otherId)} merged into ${characterName(storedLedger, mainId)}`, ledger => mergeCharacters(ledger, mainId, otherId), {
            beforeSave: () => {
                knowledgeView.editors.delete(area);
                knowledgeView.touched = knowledgeView.touched.filter(key => key !== `c:${otherId}`);
                touch(`c:${mainId}`);
                if (knowledgeView.sheet?.type === 'character' && (knowledgeView.sheet.id === otherId || knowledgeView.sheet.id === mainId)) {
                    knowledgeView.sheet = { ...knowledgeView.sheet, id: mainId };
                }
                knowledgeView.focusAfter = ['#sa-k-sheet-title', '#sa-k-title'];
            },
        });
    },
    'delete-go'(button) {
        const { area, cid } = button.dataset;
        const name = characterName(getKnowledgeLedger(), cid);
        runLedgerEdit(area, name, ledger => deleteCharacter(ledger, cid), {
            beforeSave: result => {
                const onlyTheirs = result.removed?.facts.length || 0;
                result.label = `${name} deleted${onlyTheirs ? `, with ${plural(onlyTheirs, 'fact')} only they knew` : ''}`;
                knowledgeView.editors.delete(area);
                knowledgeView.touched = knowledgeView.touched.filter(key => key !== `c:${cid}`);
                if (knowledgeView.sheet?.id === cid) knowledgeView.sheet = backTarget();
                knowledgeView.focusAfter = ['#sa-k-q', '#sa-k-map-q', '#sa-k-title'];
            },
        });
    },
    retract(button) {
        const { area, fid } = button.dataset;
        runLedgerEdit(area, 'fact marked not true', ledger => retractFact(ledger, fid), {
            beforeSave: () => {
                knowledgeView.editors.delete(area);
                if (knowledgeView.sheet?.type === 'fact' && knowledgeView.sheet.id === fid) knowledgeView.sheet = backTarget();
                knowledgeView.focusAfter = [{ attribute: 'data-area', value: area }, '#sa-k-sheet-title', '#sa-k-q'];
            },
        });
    },
    unname(button) {
        const { area, cid } = button.dataset;
        runLedgerEdit(area, `${characterName(getKnowledgeLedger(), cid)} is unnamed again`, ledger => unnameCharacter(ledger, cid), {
            fix: 'You took the name off them.',
            beforeSave: () => touch(`c:${cid}`),
        });
    },
    'drop-alias'(button) {
        const { area, cid, name } = button.dataset;
        runLedgerEdit(area, `“${name}” is no longer a name of ${characterName(getKnowledgeLedger(), cid)}`, ledger => {
            const character = ledger.characters.find(candidate => candidate.id === cid);
            if (!character) return { ledger: null, error: 'This character is no longer in the ledger.' };
            return setCharacterAliases(ledger, cid, character.aliases.filter(alias => alias.toLowerCase() !== name.toLowerCase()));
        }, { fix: 'You took the name off them.', beforeSave: () => touch(`c:${cid}`) });
    },
    undo() { undoLedgerEdit(); },
    'map-node'(button) {
        if (mapPointer.suppressClick) return;
        const characterId = button.dataset.cid;
        const carried = knowledgeView.map.carry;
        if (carried && carried !== characterId) {
            proposeMapMerge(carried, characterId);
            return;
        }
        if (carried === characterId) {
            toggleMapCarry(characterId);
            return;
        }
        // Choosing on the map is a selection, not a step to go back from
        knowledgeView.sheet = null;
        openSheet('character', characterId, null);
    },
    'map-zoom'(button) { zoomMap(button.dataset.by); },
    'close-sheet'() { closeSheet(); },
    'clear-q'() {
        knowledgeView.query = '';
        knowledgeView.sheet = null;
        knowledgeView.recordFacts = null;
        refreshCastMain({ withStrip: true });
        document.getElementById('sa-k-q')?.focus();
    },
    more(button) {
        if (button.dataset.what === 'characters') knowledgeView.charLimit += 20;
        else knowledgeView.factLimit += 25;
        refreshCastMain();
    },
    'more-held'() {
        knowledgeView.heldLimit += 30;
        refreshCastMain();
    },
    'open-fact'(button) { openSheet('fact', button.dataset.fid, null); },
    add(button) {
        const { kind, name, text, kinship, of } = button.dataset;
        openSheet('add', kind, null, { name, text, kinship, of });
    },
    'repick-of'() {
        knowledgeView.drafts['add:repick'] = true;
        knowledgeView.focusKey = 'picker|add';
        refreshKnowledgePopup({ ignoreFocus: true });
    },
    'drop-new-holder'(button) {
        knowledgeView.newFactHolders = knowledgeView.newFactHolders.filter(characterId => characterId !== button.dataset.cid);
        knowledgeView.focusKey = 'picker|add';
        refreshKnowledgePopup({ ignoreFocus: true });
    },
    'create-character'() {
        const prefill = knowledgeView.sheet?.prefill || {};
        const name = String(knowledgeView.drafts['add:name'] ?? prefill.name ?? '');
        const aliases = splitAliases(knowledgeView.drafts['add:aliases'] ?? '');
        const id = nextLedgerId('c', getKnowledgeLedger().characters);
        runLedgerEdit('add', `${name.trim() || 'character'} added`, ledger => addCharacter(ledger, { id, name, aliases }), {
            beforeSave: () => {
                delete knowledgeView.drafts['add:name'];
                delete knowledgeView.drafts['add:aliases'];
                touch(`c:${id}`);
                knowledgeView.sheet = { type: 'character', id, from: null, back: null };
                knowledgeView.focusAfter = ['#sa-k-sheet-title'];
            },
        });
    },
    'create-relative'() {
        const prefill = knowledgeView.sheet?.prefill || {};
        const kind = String(knowledgeView.drafts['add:kin'] ?? prefill.kinship ?? '');
        const ofId = String(knowledgeView.drafts['add:of'] ?? prefill.of ?? '');
        const id = nextLedgerId('c', getKnowledgeLedger().characters);
        runLedgerEdit('add', 'unnamed relative added', ledger => addUnnamedRelative(ledger, { id, kind, of: ofId }), {
            beforeSave: () => {
                for (const key of ['add:kin', 'add:of', 'add:repick']) delete knowledgeView.drafts[key];
                touch(`c:${id}`);
                knowledgeView.sheet = { type: 'character', id, from: null, back: null };
                knowledgeView.focusAfter = ['#sa-k-sheet-title'];
            },
        });
    },
    'create-fact'() {
        const prefill = knowledgeView.sheet?.prefill || {};
        const text = String(knowledgeView.drafts['add:text'] ?? prefill.text ?? '');
        const isPublic = Boolean(knowledgeView.drafts['add:public']);
        const holderIds = [...knowledgeView.newFactHolders];
        const id = nextLedgerId('f', getKnowledgeLedger().facts);
        runLedgerEdit('add', 'fact added', ledger => {
            const added = addFact(ledger, { id, text, holderIds });
            return added.error || !isPublic ? added : setFactPublic(added.ledger, id, true);
        }, {
            beforeSave: () => {
                knowledgeView.newFactHolders = [];
                delete knowledgeView.drafts['add:text'];
                delete knowledgeView.drafts['add:public'];
                touch(`f:${id}`);
                knowledgeView.sheet = { type: 'fact', id, from: null, back: null };
                knowledgeView.focusAfter = ['#sa-k-sheet-title'];
            },
        });
    },
};

/** "Fine": fold the line away and mark its items reviewed */
async function reviewLine(lineKey) {
    const view = knowledgeView;
    const line = findLine(currentRenderContext(), lineKey);
    if (!line) return;
    const element = findFocusTarget(document, [{ attribute: 'data-line', value: lineKey }]);
    const neighbour = element?.nextElementSibling || element?.previousElementSibling;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (element && !view.showReviewed && !view.openGroups.has(line.groupKey) && !reducedMotion) {
        element.classList.add('is-folding');
        await delay(180);
    }
    view.keep.delete(lineKey);
    view.editors.delete(lineKey);
    view.focusAfter = neighbour?.dataset.line
        ? [{ attribute: 'data-line', value: neighbour.dataset.line }]
        : [`#sa-k-g-${line.groupKey} button`, '#sa-k-changes-empty button', '#sa-k-title'];
    await saveLedgerEdit(withLineReviewed({ ledger: getKnowledgeLedger(), error: null }, line), 'line marked reviewed');
}

// ─── Tabs and sheets ────────────────────────────────────────────────────────

function setTab(tab) {
    const root = popupRoot();
    if (!root) return;
    knowledgeView.tab = tab;
    for (const tabButton of root.querySelectorAll('.k-tab')) {
        const isOn = tabButton.dataset.tab === tab;
        tabButton.setAttribute('aria-selected', String(isOn));
        tabButton.tabIndex = isOn ? 0 : -1;
    }
    // The map shows only a character's sheet; a fact or add sheet left open in Cast & facts closes
    if (tab === 'map' && knowledgeView.sheet && knowledgeView.sheet.type !== 'character') knowledgeView.sheet = null;
    if (tab !== 'map') {
        knowledgeView.map.carry = null;
        knowledgeView.map.drag = null;
    }
    const context = currentRenderContext();
    const builders = { changes: buildWhatChangedPanel, cast: buildCastPanel, map: buildMapPanel };
    for (const [panelTab, buildPanel] of Object.entries(builders)) {
        const panel = document.getElementById(`sa-k-panel-${panelTab}`);
        panel.hidden = panelTab !== tab;
        panel.innerHTML = panelTab === tab ? buildPanel(context) : '';
    }
    if (tab === 'map') observeMapStage();
    else mapStageObserver?.disconnect();
    drawKeyHints();
}

/**
 * Open a sheet in Cast & facts, from wherever: a character, a fact or an
 * add form (prefilled). The sheet it replaces is where Back goes.
 * @param {'character'|'fact'|'add'} type
 * @param {string} id - The character's or fact's id; for an add form its kind
 * @param {string|null} from - The area it was opened from, for Back
 * @param {object} [prefill]
 */
function openSheet(type, id, from, prefill = null) {
    const view = knowledgeView;
    const previous = view.tab === 'cast' || view.tab === 'map' ? view.sheet : null;
    view.sheet = {
        type,
        id,
        from: from ? `${view.tab}|${from}` : (previous?.from || null),
        prefill,
        back: previous && previous.type !== 'add' ? { type: previous.type, id: previous.id } : null,
    };
    view.heldQuery = '';
    view.heldLimit = 30;
    for (const area of ['sheet', 'fs', 'add']) {
        view.editors.delete(area);
        delete view.errors[area];
    }
    for (const key of Object.keys(view.drafts)) {
        if (/^(sheet|fs|add):/.test(key)) delete view.drafts[key];
    }
    if (type === 'add') view.newFactHolders = [];
    view.stripOpen.cast = false;
    // A character opened on the map stays on the map, its sheet beside it
    if (view.tab === 'map' && type === 'character') {
        view.map.focusId = id;
        refreshMapPanel();
        // Beside the map the focus stays on the node, so the arrows go on from there;
        // where the sheet takes the map's place, the sheet takes the focus
        const stage = document.getElementById('sa-k-map-stage');
        if (stage && stage.getClientRects().length > 0) focusMapNode(id);
        else document.getElementById('sa-k-sheet-title')?.focus();
        return;
    }
    if (view.tab !== 'cast') setTab('cast');
    else refreshCastMain({ withStrip: true });
    const castPanel = document.getElementById('sa-k-panel-cast');
    if (castPanel) castPanel.scrollTop = 0;
    const firstField = type === 'add' ? document.querySelector('#sa-k-sheet input.text_pole, #sa-k-sheet textarea') : null;
    (firstField || document.getElementById('sa-k-sheet-title'))?.focus();
}

function closeSheet() {
    const view = knowledgeView;
    const sheet = view.sheet;
    const ledger = getKnowledgeLedger();
    // The map goes back only to a character, the one kind of sheet it shows
    const backExists = sheet?.back && !(view.tab === 'map' && sheet.back.type !== 'character') && (sheet.back.type === 'character'
        ? ledger.characters.some(character => character.id === sheet.back.id)
        : ledger.facts.some(fact => fact.id === sheet.back.id));
    if (backExists) {
        view.sheet = { type: sheet.back.type, id: sheet.back.id, from: sheet.from, back: null };
        if (view.tab === 'map') refreshMapPanel();
        else refreshCastMain();
        document.getElementById('sa-k-sheet-title')?.focus();
        return;
    }
    view.sheet = null;
    if (view.tab === 'map') {
        view.editors.delete('sheet');
        if (sheet?.type === 'character') view.map.focusId = sheet.id;
        refreshMapPanel();
        focusMapNode(view.map.focusId);
        return;
    }
    if (sheet?.from?.startsWith('changes|')) {
        const area = sheet.from.slice('changes|'.length);
        setTab('changes');
        const target = findFocusTarget(document, [{ attribute: 'data-area', value: area }]);
        target?.focus();
        target?.scrollIntoView({ block: 'center' });
        return;
    }
    refreshCastMain({ withStrip: true });
    const row = sheet ? findFocusTarget(document, [{ attribute: 'data-fk', value: `row|${sheet.type}:${sheet.id}` }]) : null;
    (row || document.getElementById('sa-k-q'))?.focus();
}

// ─── Map: redraw and input ──────────────────────────────────────────────────

/**
 * Redraw the Map panel after an edit or a selection: the sheet beside the
 * map (its scroll kept) and the drawing. The filter field and the bar stay,
 * so neither typing nor the zoom is lost.
 * @param {{ context?: object }} [options]
 */
function refreshMapPanel({ context = currentRenderContext() } = {}) {
    const panel = document.getElementById('sa-k-panel-map');
    if (!panel) return;
    const mapElement = document.getElementById('sa-k-map');
    // The first character added, or the last one gone: the panel changes shape
    if (!mapElement || context.ledger.characters.length === 0) {
        panel.innerHTML = buildMapPanel(context);
        observeMapStage();
        if (knowledgeView.focusAfter || knowledgeView.focusKey) restoreFocus(null);
        return;
    }
    const oldSide = document.getElementById('sa-k-map-side');
    const sameSheet = oldSide && oldSide.dataset.cid === mapSelectedId(context);
    const sideScroll = sameSheet ? oldSide.scrollTop : 0;
    const hadSideFocus = Boolean(oldSide?.contains(document.activeElement));
    oldSide?.remove();
    mapElement.insertAdjacentHTML('beforeend', buildMapSide(context));
    mapElement.dataset.sheet = String(Boolean(mapSelectedId(context)));
    const newSide = document.getElementById('sa-k-map-side');
    if (newSide) newSide.scrollTop = sideScroll;
    drawMap(mapRenderState(context));
    if (knowledgeView.focusAfter || knowledgeView.focusKey) restoreFocus(null);
    // A focus lost with the old sheet goes to the new sheet's title, else to the map
    if (hadSideFocus && !popupRoot().contains(document.activeElement)) {
        (document.getElementById('sa-k-sheet-title') || document.getElementById('sa-k-map-q'))?.focus();
    }
}

/**
 * Draw the map into its stage at the stage's measured size. A hidden stage
 * (the sheet took its place) keeps its last drawing. The focus stays on the
 * node it was on. Pan, zoom, the filter and a resize reuse the kept layout
 * (mapRenderState); only a changed ledger lays the map out again.
 * @param {{ context: object, layout: object }} [state]
 */
function drawMap({ context, layout } = mapRenderState()) {
    const stage = document.getElementById('sa-k-map-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) return;
    const view = knowledgeView;
    view.map.pane = { w: Math.round(rect.width), h: Math.round(rect.height) };
    const focusedId = document.activeElement?.closest?.('#sa-k-map-stage') ? document.activeElement.dataset.cid : null;
    const scene = buildMapScene(context, layout);
    stage.innerHTML = scene.html;
    mapScreenPositions = scene.positions;
    const count = document.getElementById('sa-k-map-count');
    if (count) count.textContent = scene.countText;
    const zoom = document.getElementById('sa-k-map-zoom');
    if (zoom) zoom.textContent = `${scene.zoomPercent}%`;
    if (focusedId) focusMapNode(focusedId);
}

/** Where each node sat in the last drawing, for the arrow keys; emptied as a popup opens and closes */
let mapScreenPositions = new Map();

/**
 * The render context and map layout of the last drawing, with the ledger
 * parts they were built from; null as a popup opens and closes.
 * @type {{ key: Array, context: object, layout: object }|null}
 */
let mapRenderCache = null;

/**
 * The render context and layout to draw from: the kept ones while the
 * ledger is the same (an edit or an undo replaces its lists, so their
 * identity tells), else built anew. A fresh context (after an edit) is
 * laid out at once.
 * @param {object|null} [freshContext]
 * @returns {{ context: object, layout: object }}
 */
function mapRenderState(freshContext = null) {
    const ledger = freshContext ? freshContext.ledger : getKnowledgeLedger();
    const withDetails = freshContext ? freshContext.withDetails : isCharacterDetailsEnabled();
    const key = [ledger, ledger.characters, ledger.facts, ledger.scene, ledger.lastUpdatedAt, withDetails];
    const isSame = mapRenderCache && key.every((part, index) => part === mapRenderCache.key[index]);
    if (freshContext || !isSame) {
        const context = freshContext || createRenderContext(ledger, chat, withDetails, knowledgeView);
        mapRenderCache = { key, context, layout: layoutCastMap(context) };
    }
    return mapRenderCache;
}

/** Whether a drawing is already asked for the next frame */
let mapDrawPending = false;

/** Draw the map in the next frame, once however often it is asked */
function requestMapDraw() {
    if (mapDrawPending) return;
    mapDrawPending = true;
    requestAnimationFrame(() => {
        mapDrawPending = false;
        drawMap();
    });
}

/** Put the focus on a node (the one the arrow keys start from) without scrolling the popup */
function focusMapNode(characterId) {
    const stage = document.getElementById('sa-k-map-stage');
    if (!stage || !characterId) return;
    knowledgeView.map.focusId = characterId;
    for (const node of stage.querySelectorAll('.k-map-node')) node.tabIndex = node.dataset.cid === characterId ? 0 : -1;
    findFocusTarget(stage, [{ attribute: 'data-cid', value: characterId }])?.focus({ preventScroll: true });
}

/** The open map's watcher of its stage size; disconnected when the map or the popup closes */
let mapStageObserver = null;

/** Redraw the map whenever its stage changes size (the popup resized, the sheet opened or closed) */
function observeMapStage() {
    mapStageObserver?.disconnect();
    const stage = document.getElementById('sa-k-map-stage');
    if (!stage || typeof ResizeObserver === 'undefined') return;
    // The observer reports before the frame is painted: drawing at once shows no frame at the old size
    mapStageObserver = new ResizeObserver(() => drawMap());
    mapStageObserver.observe(stage);
}

/**
 * Zoom around a point of the stage, keeping that point under the pointer.
 * The zoom stays between 0.6 and 6 times the fit.
 */
function zoomMapAt(x, y, factor) {
    const mapView = knowledgeView.map;
    const { pane, fitK } = mapProjection(mapView);
    const zoom = Math.min(6, Math.max(0.6, mapView.zoom * factor));
    const ratio = zoom / mapView.zoom;
    const tx = pane.w / 2 + mapView.panX;
    const ty = pane.h / 2 + mapView.panY;
    mapView.panX = x - (x - tx) * ratio - pane.w / 2;
    mapView.panY = y - (y - ty) * ratio - pane.h / 2;
    mapView.zoom = zoom;
    if (fitK) requestMapDraw();
}

/** The zoom buttons and keys: in, out, or fit the whole cast */
function zoomMap(by) {
    const mapView = knowledgeView.map;
    if (by === 'fit') {
        mapView.zoom = 1;
        mapView.panX = 0;
        mapView.panY = 0;
        requestMapDraw();
        return;
    }
    zoomMapAt(mapView.pane.w / 2, mapView.pane.h / 2, by === 'in' ? 1.35 : 1 / 1.35);
}

/** Pick a character up to merge it into the next one chosen, or put it down again */
function toggleMapCarry(characterId) {
    const mapView = knowledgeView.map;
    const name = nameOf(currentRenderContext(), characterId);
    mapView.carry = mapView.carry === characterId ? null : characterId;
    reportKnowledgeMessage(mapView.carry
        ? `Merging ${name}: move to the record that stays and press Enter. Esc cancels.`
        : 'Merge cancelled.', 'info');
    requestMapDraw();
    drawKeyHints();
}

/** Open the merge preview of a drop and put the focus on its confirm button */
function proposeMapMerge(fromId, toId) {
    const context = currentRenderContext();
    startMapMerge(knowledgeView, fromId, toId);
    reportKnowledgeMessage(`Merge ${nameOf(context, fromId)} into ${nameOf(context, toId)}? Read what it does, then confirm.`, 'info');
    refreshMapPanel();
    document.querySelector('#sa-k-map-side [data-act="merge-go"]:not([disabled])')?.focus();
}

/** A press on the map: on a node it may become a drag, elsewhere it pans */
const mapPointer = { pointerId: null, id: null, isPanning: false, isDragging: false, x0: 0, y0: 0, panX0: 0, panY0: 0, suppressClick: false };

function onMapPointerDown(event) {
    const stage = event.target.closest?.('#sa-k-map-stage');
    if (!stage || event.button !== 0) return;
    const node = event.target.closest('.k-map-node');
    Object.assign(mapPointer, { pointerId: event.pointerId, id: node ? node.dataset.cid : null, isPanning: !node, isDragging: false, x0: event.clientX, y0: event.clientY,
        panX0: knowledgeView.map.panX, panY0: knowledgeView.map.panY });
    // A node takes the pointer only once it is dragged, so a plain click still reaches it
    if (!node) {
        stage.setPointerCapture(event.pointerId);
        stage.classList.add('is-panning');
    }
}

function onMapPointerMove(event) {
    if (event.pointerId !== mapPointer.pointerId) return;
    const stage = document.getElementById('sa-k-map-stage');
    if (!stage) return;
    const mapView = knowledgeView.map;
    if (mapPointer.isPanning) {
        mapView.panX = mapPointer.panX0 + event.clientX - mapPointer.x0;
        mapView.panY = mapPointer.panY0 + event.clientY - mapPointer.y0;
        requestMapDraw();
        return;
    }
    if (!mapPointer.id) return;
    // A press whose release never reached the map (outside it, or the popup closed) is over
    if ((event.buttons & 1) === 0) {
        Object.assign(mapPointer, { pointerId: null, id: null, isPanning: false, isDragging: false });
        mapView.drag = null;
        return;
    }
    if (!mapPointer.isDragging) {
        if (Math.hypot(event.clientX - mapPointer.x0, event.clientY - mapPointer.y0) <= 6) return;
        mapPointer.isDragging = true;
        stage.setPointerCapture(event.pointerId);
    }
    const rect = stage.getBoundingClientRect();
    const under = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.k-map-node');
    const overId = under && under.dataset.cid !== mapPointer.id ? under.dataset.cid : null;
    mapView.drag = { id: mapPointer.id, x: event.clientX - rect.left, y: event.clientY - rect.top, overId };
    requestMapDraw();
}

function onMapPointerEnd(event) {
    if (event.pointerId !== mapPointer.pointerId) return;
    document.getElementById('sa-k-map-stage')?.classList.remove('is-panning');
    const drag = knowledgeView.map.drag;
    if (mapPointer.isDragging) {
        // The click that ends a drag opens nothing
        mapPointer.suppressClick = true;
        setTimeout(() => { mapPointer.suppressClick = false; }, 0);
    }
    Object.assign(mapPointer, { pointerId: null, id: null, isPanning: false, isDragging: false });
    knowledgeView.map.drag = null;
    if (drag?.overId && event.type === 'pointerup') {
        proposeMapMerge(drag.id, drag.overId);
        return;
    }
    requestMapDraw();
}

function onMapWheel(event) {
    const stage = event.target.closest?.('#sa-k-map-stage');
    if (!stage) return;
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomMapAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015));
}

/**
 * The keys on a map node: the arrows go to the nearest node that way
 * (panning it into view), M picks the node up to merge it (Enter on another
 * node then opens the merge preview), Esc puts it down. Enter and Space
 * click the node's button, which opens its sheet.
 * @returns {boolean} Whether the key was the map's
 */
function onMapNodeKeydown(event, node) {
    const key = event.key;
    const id = node.dataset.cid;
    const directions = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    if (directions[key]) {
        event.preventDefault();
        const [unitX, unitY] = directions[key];
        const from = mapScreenPositions.get(id);
        if (!from) return true;
        let best = null;
        let bestScore = Infinity;
        for (const [otherId, to] of mapScreenPositions) {
            if (otherId === id) continue;
            const along = (to.x - from.x) * unitX + (to.y - from.y) * unitY;
            if (along <= 2) continue;
            const across = Math.abs((to.x - from.x) * unitY - (to.y - from.y) * unitX);
            const score = along + across * 2.2;
            if (score < bestScore) {
                bestScore = score;
                best = otherId;
            }
        }
        if (!best) return true;
        focusMapNode(best);
        const target = mapScreenPositions.get(best);
        const { pane } = knowledgeView.map;
        if (target.x < 70 || target.x > pane.w - 70 || target.y < 50 || target.y > pane.h - 50) {
            knowledgeView.map.panX += pane.w / 2 - target.x;
            knowledgeView.map.panY += pane.h / 2 - target.y;
        }
        requestMapDraw();
        drawKeyHints();
        return true;
    }
    if ((key === 'm' || key === 'M') && hasNoModifiers(event)) {
        event.preventDefault();
        toggleMapCarry(id);
        return true;
    }
    if (key === 'Escape' && knowledgeView.map.carry) {
        event.preventDefault();
        toggleMapCarry(knowledgeView.map.carry);
        return true;
    }
    return false;
}

/** The filter's best match for Enter: a name that starts with the text first, then who knows most */
function bestMapMatch(context) {
    const query = foldName(context.view.map.filter.trim());
    if (!query) return null;
    const matches = searchCharacters(context, query);
    return matches.length ? matches[0].character.id : null;
}

// ─── Redraw ─────────────────────────────────────────────────────────────────

/**
 * Redraw the popup after an edit: the heading, the tab count, the open
 * panel and the status bar; the search field stays as typed. Typed text
 * lives in the view's drafts, so a redraw loses none. The focus returns to
 * the control it was on (by `data-fk`), else to the view's `focusKey` or
 * `focusAfter`. No-op while the popup is not open.
 * @param {{ ignoreFocus?: boolean }} [options] - ignoreFocus: go to focusKey / focusAfter first
 */
function refreshKnowledgePopup({ ignoreFocus = false } = {}) {
    const root = popupRoot();
    if (!root) return;
    const view = knowledgeView;
    const focusedKey = ignoreFocus ? null : document.activeElement?.dataset?.fk || null;
    // A text field keeps its caret: the redraw restores the text from the drafts, not the cursor
    const focusedField = document.activeElement;
    const caret = focusedKey && isTypingField(focusedField) && typeof focusedField.selectionStart === 'number'
        ? [focusedField.selectionStart, focusedField.selectionEnd] : null;
    const context = currentRenderContext();
    root.querySelector('#sa-k-meta').innerHTML = buildMetaText(context);
    root.querySelector('#sa-k-changes-count').outerHTML = buildChangesCount(context);
    if (view.tab === 'changes') {
        const panel = root.querySelector('#sa-k-panel-changes');
        const scrollTop = panel.scrollTop;
        panel.innerHTML = buildWhatChangedPanel(context);
        panel.scrollTop = scrollTop;
    } else if (view.tab === 'map') {
        refreshMapPanel({ context });
    } else {
        refreshCastMain({ withStrip: true, context });
    }
    root.querySelector('#sa-k-status').innerHTML = buildStatus(view);
    restoreFocus(focusedKey);
    if (caret && document.activeElement?.dataset?.fk === focusedKey) document.activeElement.setSelectionRange?.(caret[0], caret[1]);
    drawKeyHints();
}

/** Redraw the main region of Cast & facts (and the names strip), keeping its scroll */
function refreshCastMain({ withStrip = false, context = currentRenderContext() } = {}) {
    const main = document.getElementById('sa-k-cast-main');
    if (!main) return;
    const panel = document.getElementById('sa-k-panel-cast');
    const scrollTop = panel.scrollTop;
    if (withStrip) document.getElementById('sa-k-cast-strip').innerHTML = buildNamesToCheck(context, 'cast');
    main.innerHTML = buildCastMain(context);
    const searchField = document.getElementById('sa-k-q');
    if (searchField && searchField.value !== knowledgeView.query) searchField.value = knowledgeView.query;
    document.getElementById('sa-k-qclear').hidden = !knowledgeView.query;
    document.getElementById('sa-k-qcount').textContent = searchCountText(context);
    panel.scrollTop = scrollTop;
    if (knowledgeView.focusAfter || knowledgeView.focusKey) restoreFocus(null);
}

/** Redraw a picker's options for what is typed */
function refreshPickerOptions(field) {
    const area = field.dataset.picker;
    const list = document.getElementById(field.getAttribute('aria-controls'));
    if (!list) return;
    list.innerHTML = buildPickerOptions(currentRenderContext(), area);
    const active = list.querySelector('[aria-selected="true"]');
    field.setAttribute('aria-activedescendant', active?.id || '');
}

/**
 * Put the focus back after a redraw: the same control, else the view's
 * focusKey, else the first of the view's focusAfter targets that finds an
 * element (findFocusTarget).
 */
function restoreFocus(focusedKey) {
    const view = knowledgeView;
    const root = popupRoot();
    if (!root) return;
    const keyTargets = [focusedKey, view.focusKey].filter(Boolean).map(key => ({ attribute: 'data-fk', value: key }));
    const target = findFocusTarget(root, [...keyTargets, ...(view.focusAfter || [])]);
    view.focusKey = null;
    view.focusAfter = null;
    if (target && target !== document.activeElement) target.focus();
}

/**
 * The first element a list of focus targets finds under `root`, in the
 * order listed. A target is a fixed selector, or `{ attribute, value, then? }`:
 * the element whose attribute has exactly that value (then the first match
 * of the `then` selector inside it). Values are compared, never put into a
 * selector, so a line key or a name with a comma or a quote cannot break it.
 * @param {{ querySelector: Function, querySelectorAll: Function }} root
 * @param {(string|{attribute: string, value: string, then?: string})[]} targets
 * @returns {object|null}
 */
export function findFocusTarget(root, targets) {
    for (const target of targets) {
        if (typeof target === 'string') {
            const element = root.querySelector(target);
            if (element) return element;
            continue;
        }
        const holder = [...root.querySelectorAll(`[${target.attribute}]`)].find(candidate => candidate.getAttribute(target.attribute) === target.value);
        const element = holder && target.then ? holder.querySelector(target.then) : holder;
        if (element) return element;
    }
    return null;
}

// ─── Keyboard ───────────────────────────────────────────────────────────────

/** Whether an element takes typing */
function isTypingField(element) {
    return element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');
}

/** No Ctrl, Meta or Alt */
function hasNoModifiers(event) {
    return !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 * The popup's keys. Esc closes what is open (an editor, a sheet, the
 * search) and only then lets SillyTavern close the popup: its `<dialog>`
 * closes on an Escape keydown nobody prevented.
 */
function onKnowledgeKeydown(event) {
    const view = knowledgeView;
    const target = event.target;
    const key = event.key;

    if (target.dataset?.picker) {
        const area = target.dataset.picker;
        const pickerId = `${area}:p`;
        const options = [...document.getElementById(target.getAttribute('aria-controls'))?.querySelectorAll('[data-pick]') || []];
        if (key === 'ArrowDown' || key === 'ArrowUp') {
            event.preventDefault();
            if (options.length === 0) return;
            const current = view.pickerActive[pickerId] || 0;
            view.pickerActive[pickerId] = (current + (key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
            refreshPickerOptions(target);
            document.getElementById(target.getAttribute('aria-activedescendant') || '')?.scrollIntoView({ block: 'nearest' });
        } else if (key === 'Enter') {
            event.preventDefault();
            const active = options[Math.min(view.pickerActive[pickerId] || 0, options.length - 1)];
            if (active) pickCharacter(area, active.dataset.cid);
        } else if (key === 'Escape') {
            event.preventDefault();
            if (view.editors.has(area)) closeEditor(area);
            else document.getElementById('sa-k-sheet-title')?.focus();
        }
        return;
    }

    if (target.classList?.contains('k-tab') && (key === 'ArrowRight' || key === 'ArrowLeft')) {
        event.preventDefault();
        const tabs = ['changes', 'cast', 'map'];
        const nextTab = tabs[(tabs.indexOf(view.tab) + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        setTab(nextTab);
        document.getElementById(`sa-k-tab-${nextTab}`)?.focus();
        return;
    }

    const mapNode = target.closest?.('.k-map-node');
    if (mapNode && onMapNodeKeydown(event, mapNode)) return;

    if (target.id === 'sa-k-map-q') {
        if (key === 'Enter') {
            event.preventDefault();
            const best = bestMapMatch(currentRenderContext());
            if (best) KNOWLEDGE_ACTIONS['map-node']({ dataset: { cid: best } });
            return;
        }
        if (key === 'ArrowDown') {
            event.preventDefault();
            focusMapNode(bestMapMatch(currentRenderContext()) || view.map.focusId || document.querySelector('#sa-k-map-stage .k-map-node')?.dataset.cid);
            return;
        }
        if (key === 'Escape' && view.map.filter) {
            event.preventDefault();
            view.map.filter = '';
            target.value = '';
            requestMapDraw();
            return;
        }
        // An empty filter's Esc goes on: back to the sheet, or it closes the sheet
        if (key !== 'Escape') return;
    }

    // The zoom keys, anywhere on the map but in a field
    if (view.tab === 'map' && !isTypingField(target) && target.closest?.('.k-map-main') && hasNoModifiers(event)) {
        const zoomBy = { '+': 'in', '=': 'in', '-': 'out', 0: 'fit' }[key];
        if (zoomBy) {
            event.preventDefault();
            zoomMap(zoomBy);
            return;
        }
    }

    if (target.id === 'sa-k-q') {
        if (key === 'ArrowDown') {
            event.preventDefault();
            document.querySelector('#sa-k-cast-main .k-row, #sa-k-cast-main .k-item, #sa-k-sheet-title')?.focus();
        } else if (key === 'Enter') {
            event.preventDefault();
            if (view.sheet) document.getElementById('sa-k-sheet-title')?.focus();
            else document.querySelector('#sa-k-cast-main .k-row')?.click();
        } else if (key === 'Escape' && (view.sheet || view.query || view.recordFacts)) {
            event.preventDefault();
            if (view.sheet) closeSheet();
            else KNOWLEDGE_ACTIONS['clear-q']();
        }
        return;
    }

    // Ctrl+Enter saves a text area; Enter saves a one-line field of a form
    if (key === 'Enter' && (event.ctrlKey || event.metaKey) && target.tagName === 'TEXTAREA') {
        event.preventDefault();
        target.closest('.k-editor, .k-sec')?.querySelector('[data-act^="save-"], [data-act^="create-"]')?.click();
        return;
    }
    if (key === 'Enter' && target.matches?.('input.text_pole[data-draft]')) {
        const saveButton = target.closest('.k-editor, .k-sec')?.querySelector('[data-act^="save-"], [data-act^="create-"]');
        if (saveButton) {
            event.preventDefault();
            saveButton.click();
            return;
        }
    }

    if (target.classList?.contains('k-row')) {
        const rows = [...document.querySelectorAll('#sa-k-cast-main .k-row')];
        const index = rows.indexOf(target);
        if (key === 'ArrowDown') { event.preventDefault(); rows[Math.min(index + 1, rows.length - 1)]?.focus(); return; }
        if (key === 'ArrowUp') { event.preventDefault(); if (index <= 0) document.getElementById('sa-k-q')?.focus(); else rows[index - 1].focus(); return; }
        if (key === 'Home') { event.preventDefault(); rows[0]?.focus(); return; }
        if (key === 'End') { event.preventDefault(); rows[rows.length - 1]?.focus(); return; }
        if (key.length === 1 && key !== ' ' && hasNoModifiers(event)) { document.getElementById('sa-k-q')?.focus(); return; }
    }

    if (target.classList?.contains('k-item')) {
        const rows = [...target.parentElement.querySelectorAll(':scope > .k-item')];
        const index = rows.indexOf(target);
        if (key === 'ArrowDown') { event.preventDefault(); rows[Math.min(index + 1, rows.length - 1)].focus(); return; }
        if (key === 'ArrowUp') { event.preventDefault(); if (index > 0) rows[index - 1].focus(); else document.getElementById('sa-k-sheet-title')?.focus(); return; }
        if (hasNoModifiers(event)) {
            const isHeld = Boolean(target.closest('#sa-k-held'));
            if (target.dataset.masked) {
                if (key === 'Enter') { event.preventDefault(); target.querySelector('[data-act="reveal"]')?.click(); }
                return;
            }
            if (key === 'm' || key === 'M') { event.preventDefault(); target.querySelector(`[data-act="${isHeld ? 'sheet-move' : 'fs-move'}"]`)?.click(); return; }
            if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); target.querySelector(`[data-act="${isHeld ? 'sheet-remove' : 'fs-remove'}"]`)?.click(); return; }
            if (key === 'Enter' && target === document.activeElement) {
                event.preventDefault();
                if (isHeld) openSheet('fact', target.dataset.fid, null);
                else openSheet('character', target.dataset.cid, null);
                return;
            }
        }
    }

    const line = target.closest?.('.k-line');
    if (line && !isTypingField(target) && hasNoModifiers(event)) {
        if (key === 'ArrowDown' || key === 'ArrowUp') {
            const lines = [...document.querySelectorAll('#sa-k-panel-changes .k-line')];
            const index = lines.indexOf(line);
            const nextLine = lines[key === 'ArrowDown' ? index + 1 : index - 1];
            if (nextLine) {
                event.preventDefault();
                nextLine.focus();
                nextLine.scrollIntoView({ block: 'nearest' });
            }
            return;
        }
        if ((key === 'f' || key === 'F') && !line.classList.contains('is-reviewed')) {
            event.preventDefault();
            reviewLine(line.dataset.line);
            return;
        }
    }

    if (key === 'Escape') {
        const areaHolder = target.closest?.('[data-area]');
        let area = areaHolder?.dataset.area || null;
        if (!area && target.closest?.('#sa-k-sheet')) area = ['sheet', 'fs', 'add'].find(candidate => view.editors.has(candidate)) || null;
        if (area && view.editors.has(area)) { event.preventDefault(); closeEditor(area); return; }
        if (isTypingField(target) && view.sheet) { event.preventDefault(); document.getElementById('sa-k-sheet-title')?.focus(); return; }
        if ((view.tab === 'cast' || view.tab === 'map') && view.sheet) { event.preventDefault(); closeSheet(); return; }
        if (view.tab === 'cast' && document.activeElement?.id !== 'sa-k-q') { event.preventDefault(); document.getElementById('sa-k-q')?.focus(); return; }
        // Nothing open: SillyTavern closes the popup
        return;
    }
    if (isTypingField(target)) return;
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'Z')) { event.preventDefault(); undoLedgerEdit(); return; }
    if (key === '/' && hasNoModifiers(event)) {
        event.preventDefault();
        const mapFilter = view.tab === 'map' ? document.getElementById('sa-k-map-q') : null;
        if (mapFilter) {
            mapFilter.focus();
            mapFilter.select();
            return;
        }
        if (view.tab !== 'cast') setTab('cast');
        const searchField = document.getElementById('sa-k-q');
        searchField?.focus();
        searchField?.select();
        return;
    }
    if ((view.tab === 'cast' || (view.tab === 'map' && target.closest?.('#sa-k-map-side'))) && view.sheet?.type === 'character' && hasNoModifiers(event)) {
        if (key === 'n' || key === 'N') { event.preventDefault(); document.getElementById('sa-k-sheet-name')?.focus(); return; }
        if (key === 'd' || key === 'D') { event.preventDefault(); document.querySelector('#sa-k-sec-details .k-btn')?.focus(); return; }
        if (key === 'f' || key === 'F') { event.preventDefault(); (document.querySelector('#sa-k-held .k-item') || document.getElementById('sa-k-held-q'))?.focus(); }
    }
}

/** The keys that work where the focus is, in the status bar */
function drawKeyHints() {
    const hints = document.getElementById?.('sa-k-hints');
    if (!hints) return;
    const view = knowledgeView;
    const element = document.activeElement;
    let list = [[buildKeys('/'), 'search']];
    if (element?.dataset?.picker) list = [[buildKeys('↑ ↓'), 'choose'], [buildKeys('Enter'), 'pick'], [buildKeys('Esc'), 'cancel']];
    else if (element?.id === 'sa-k-q') list = view.sheet ? [[buildKeys('↓'), 'into the sheet'], [buildKeys('Esc'), 'back to results']] : [[buildKeys('↓'), 'results'], [buildKeys('Enter'), 'open the first'], [buildKeys('Esc'), 'clear']];
    else if (element?.id === 'sa-k-map-q') list = [[buildKeys('Enter'), 'open the best match'], [buildKeys('↓'), 'to the map'], [buildKeys('Esc'), 'clear']];
    else if (element?.classList?.contains('k-map-node')) {
        list = view.map.carry
            ? [[buildKeys('← ↑ → ↓'), 'move'], [buildKeys('Enter'), 'merge into this one'], [buildKeys('Esc'), 'cancel']]
            : [[buildKeys('← ↑ → ↓'), 'move'], [buildKeys('Enter'), 'open'], [buildKeys('M'), 'merge into…'], [`${buildKeys('+')} ${buildKeys('−')}`, 'zoom'], [buildKeys('0'), 'fit']];
    } else if (element?.classList?.contains('k-row')) list = [[buildKeys('↑ ↓'), 'move'], [buildKeys('Enter'), 'open'], ['type', 'to search'], [buildKeys('Esc'), 'search field']];
    else if (element?.classList?.contains('k-item')) {
        list = element.dataset.masked
            ? [[buildKeys('Enter'), 'show'], [buildKeys('Esc'), 'back']]
            : [[buildKeys('↑ ↓'), 'move'], [buildKeys('Enter'), element.closest('#sa-k-held') ? 'open fact' : 'open character'], [buildKeys('M'), 'move to…'], [buildKeys('Del'), 'remove'], [buildKeys('Esc'), 'back']];
    } else if (element?.closest?.('.k-line')) list = [[buildKeys('↑ ↓'), 'next line'], [buildKeys('F'), 'fine'], [buildKeys('/'), 'search'], [buildKeys('Tab'), 'actions']];
    else if ((view.tab === 'cast' || (view.tab === 'map' && element?.closest?.('#sa-k-map-side'))) && view.sheet?.type === 'character') list = [[buildKeys('N'), 'names'], [buildKeys('D'), 'details'], [buildKeys('F'), 'facts'], [buildKeys('Esc'), 'back'], [buildKeys('/'), 'search']];
    else if (view.tab === 'cast' && view.sheet) list = [[buildKeys('Tab'), 'next'], [buildKeys('Esc'), 'back'], [buildKeys('/'), 'search']];
    if (view.undoLabels.length) list.push([`${buildKeys('Ctrl')}+${buildKeys('Z')}`, 'undo']);
    hints.innerHTML = list.map(([keys, text], index) => `<span class="${index > 2 ? 'k-hint-wide' : ''}">${keys} ${escapeHtml(text)}</span>`).join('');
}

/** The aliases typed into a comma-separated field */
function splitAliases(text) {
    return String(text || '').split(',');
}

/**
 * Show a message in the popup's status bar, or as a toast while the popup
 * is not open.
 * @param {string} message
 * @param {'ok'|'info'|'refused'} kind
 */
function reportKnowledgeMessage(message, kind) {
    knowledgeView.status = { message, kind };
    const statusElement = popupRoot()?.querySelector('#sa-k-status');
    if (statusElement) {
        statusElement.innerHTML = buildStatus(knowledgeView);
        return;
    }
    if (kind === 'refused') toastr.warning(message);
}

/**
 * Store the result of a ledger edit and redraw the popup, or show why the
 * edit was refused. The edited lists are copied onto the stored ledger rather
 * than replacing it, because another module (the extraction) may hold that
 * object across an await; it then keeps writing into the stored ledger.
 * @param {{ ledger: object|null, error: string|null, label?: string }} result - `label` overrides the label
 * @param {string} [label] - What the edit did, for the status bar and the Undo button
 * @returns {Promise<{ error: string|null }>}
 */
export async function saveLedgerEdit(result, label = 'edit saved') {
    const { ledger, error } = result;
    if (error) {
        reportKnowledgeMessage(error, 'refused');
        return { error };
    }
    const editLabel = result.label || label;

    // Every popup edit passes here, so this is where undo records it.
    const before = knowledgeUndo?.capture();
    const storedLedger = getKnowledgeLedger();
    storedLedger.characters = ledger.characters;
    storedLedger.facts = ledger.facts;
    // A merge also changes the scenes and the retracted facts; a ledger
    // without them (an old one) leaves the stored ones alone.
    if (ledger.scene !== undefined) storedLedger.scene = ledger.scene;
    if (ledger.sceneHistory !== undefined) storedLedger.sceneHistory = ledger.sceneHistory;
    if (ledger.retractedFacts !== undefined) storedLedger.retractedFacts = ledger.retractedFacts;
    // A reviewed mark (markChangeItemReviewed); a ledger without marks leaves the stored ones alone.
    if (ledger.reviewedMarks !== undefined) storedLedger.reviewedMarks = ledger.reviewedMarks;
    knowledgeUndo?.record(before);
    // The undo stack recorded the edit only when it changed something.
    if (knowledgeUndo && knowledgeUndo.capture() !== before) knowledgeView.undoLabels.push(editLabel);
    await saveMetadata();
    knowledgeView.status = { message: `Saved: ${editLabel}.`, kind: 'ok' };
    refreshKnowledgePopup();
    // The status line counts the flagged characters; an edit here may clear one.
    updateKnowledgeStatus();
    return { error: null };
}

/**
 * Undo the newest hand edit of this popup session and redraw, or show why
 * undo is refused (nothing to undo, or the ledger changed since the edit).
 * @returns {Promise<{ error: string|null }>}
 */
export async function undoLedgerEdit() {
    const { error } = knowledgeUndo ? knowledgeUndo.undo() : { error: 'Nothing to undo.' };
    const view = knowledgeView;
    if (error) {
        const newestLabel = view.undoLabels[view.undoLabels.length - 1];
        // A refused undo drops the stack (createUndoStack)
        view.undoLabels = [];
        const shown = newestLabel && popupRoot() ? `Cannot undo “${newestLabel}”: ${error}` : error;
        reportKnowledgeMessage(shown, 'refused');
        if (popupRoot()) drawKeyHints();
        return { error };
    }
    const label = view.undoLabels.pop() || 'the last edit';
    view.editors.clear();
    // A fix note would describe the edit just taken back
    view.fixes = {};
    await saveMetadata();
    view.status = { message: `Undone: ${label}.`, kind: 'info' };
    refreshKnowledgePopup();
    updateKnowledgeStatus();
    return { error: null };
}

// ─── Ledger edits ───────────────────────────────────────────────────────────
//
// Pure: each edit takes the ledger and returns a new one, or an error for the
// player when the edit is refused. Names and aliases are unique across
// characters, ignoring case, because the knowledge block and the extraction
// find a character by any of them.

/**
 * Add a character the player entered by hand.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {{ id: string, name: string, aliases: string[] }} character
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function addCharacter(ledger, { id, name, aliases }) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return { ledger: null, error: 'A character needs a name.' };

    const cleanAliases = cleanAliasList(aliases);
    const error = findNameConflict(ledger, id, [trimmedName, ...cleanAliases]);
    if (error) return { ledger: null, error };

    const newCharacter = { id, name: trimmedName, aliases: cleanAliases };
    return { ledger: { ...ledger, characters: [...ledger.characters, newCharacter] }, error: null };
}

/**
 * Add an unnamed relative the player entered by hand: a record with an
 * empty name whose relation, a player entry (`at: null, by: 'user'`),
 * gives its display name ("Kendra Osei's mother"). The player's relation
 * survives every rollback and locks the kind against the extraction.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {{ id: string, kind: string, of: string }} relative - The kinship word as typed and the other character's id
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function addUnnamedRelative(ledger, { id, kind, of }) {
    const kinship = String(kind || '').trim();
    if (!kinship || !findCharacter(ledger, of)) {
        return { ledger: null, error: 'An unnamed relative needs a kinship word and another character.' };
    }

    const newCharacter = {
        id,
        name: '',
        aliases: [],
        details: { relation: [{ value: { kind: kinship, of }, at: null, by: 'user' }] },
    };
    const displayName = characterDisplayName(ledger, newCharacter);
    const characterWithName = ledger.characters.find(character =>
        characterDisplayName(ledger, character).toLowerCase() === displayName.toLowerCase());
    if (characterWithName) return { ledger: null, error: `${displayName} is already in the ledger.` };

    return { ledger: { ...ledger, characters: [...ledger.characters, newCharacter] }, error: null };
}

/** Aliases trimmed, without blanks and without repeats (ignoring case), in the order given. */
function cleanAliasList(aliases) {
    const cleanAliases = [];
    for (const alias of aliases) {
        const trimmedAlias = String(alias || '').trim();
        if (!trimmedAlias) continue;
        const isRepeat = cleanAliases.some(kept => kept.toLowerCase() === trimmedAlias.toLowerCase());
        if (isRepeat) continue;
        cleanAliases.push(trimmedAlias);
    }
    return cleanAliases;
}

/**
 * The error for the first of `names` another character already goes by, or
 * null when all are free.
 * @param {object} ledger
 * @param {string} characterId - The character the names are for; their own names do not conflict
 * @param {string[]} names
 * @returns {string|null}
 */
function findNameConflict(ledger, characterId, names) {
    const otherCharacters = ledger.characters.filter(character => character.id !== characterId);
    for (const name of names) {
        const characterWithName = otherCharacters.find(character => [character.name, ...character.aliases]
            .some(otherName => otherName.toLowerCase() === name.toLowerCase()));
        if (characterWithName) return `"${name}" is already a name of ${characterDisplayName(ledger, characterWithName)}.`;
    }
    return null;
}

/**
 * Rename a character. The id stays, so their facts and details stay
 * theirs; this is also how the player names an unnamed relative. An
 * unnamed relative saved with an empty name stays unnamed. Clears the
 * reused-name flag (withoutNameClash).
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} characterId
 * @param {string} name
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function renameCharacter(ledger, characterId, name) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
        const storedCharacter = findCharacter(ledger, characterId);
        if (storedCharacter && !storedCharacter.name.trim()) {
            return replaceCharacter(ledger, characterId, character => withoutNameClash(character));
        }
        return { ledger: null, error: 'A character needs a name.' };
    }

    const error = findNameConflict(ledger, characterId, [trimmedName]);
    if (error) return { ledger: null, error };

    return replaceCharacter(ledger, characterId, character => ({ ...withoutNameClash(character), name: trimmedName }));
}

/**
 * Replace a character's aliases. Clears the reused-name flag (withoutNameClash).
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} characterId
 * @param {string[]} aliases - As typed; trimmed, blanks and repeats dropped
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function setCharacterAliases(ledger, characterId, aliases) {
    const cleanAliases = cleanAliasList(aliases);
    const error = findNameConflict(ledger, characterId, cleanAliases);
    if (error) return { ledger: null, error };

    return replaceCharacter(ledger, characterId, character => ({ ...withoutNameClash(character), aliases: cleanAliases }));
}

/**
 * Keep a flagged character's name, for a relative or a deliberate choice:
 * the reused-name flag goes, the name and aliases stay.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} characterId
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function keepCharacterName(ledger, characterId) {
    return replaceCharacter(ledger, characterId, character => withoutNameClash(character));
}

/**
 * Merge one character record into another, for one person the ledger holds
 * twice (a codename and a civilian name). The other record's name and
 * aliases become aliases of the main record; an unnamed main record takes
 * the other's name instead, as it would when the story names it. Every
 * reference to the other record points at the main record: fact holders
 * and `toldBy`, also on retracted facts, the scene, the scene history and
 * the relations of other records. The details merge per kind: a kind only
 * one of the two records has set by the player keeps that record's history,
 * any other kind the main record's; a relation between the two records
 * would be one to itself and goes first. A fact that ends up with two holder entries for one
 * character keeps one (rankHolderEntry). Moved entries keep `at` and
 * `messageId`, so they roll back with their messages as before. The other
 * record goes, its reused-name flag with it; the main record's flag goes
 * when no other record has any of its flagged names any more.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} mainId - The record that stays
 * @param {string} otherId - The record that merges into it and goes
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function mergeCharacters(ledger, mainId, otherId) {
    if (mainId === otherId) return { ledger: null, error: 'A character cannot be merged into themselves.' };
    const mainCharacter = findCharacter(ledger, mainId);
    const otherCharacter = findCharacter(ledger, otherId);
    if (!mainCharacter || !otherCharacter) return { ledger: null, error: 'This character is no longer in the ledger.' };

    const isUnnamedMain = !mainCharacter.name.trim();
    const name = isUnnamedMain ? otherCharacter.name.trim() : mainCharacter.name;
    const aliases = cleanAliasList([...mainCharacter.aliases, otherCharacter.name, ...otherCharacter.aliases])
        .filter(alias => alias.toLowerCase() !== name.trim().toLowerCase());
    const charactersWithoutOther = ledger.characters.filter(character => character.id !== otherId);
    const nameError = findNameConflict({ ...ledger, characters: charactersWithoutOther }, mainId, [name, ...aliases].filter(Boolean));
    if (nameError) return { ledger: null, error: nameError };

    const details = mergeDetails(mainCharacter, otherCharacter);
    const { details: mainDetails, ...mainWithoutDetails } = mainCharacter;
    const mergedMain = { ...mainWithoutDetails, name, aliases };
    if (Object.keys(details).length > 0) mergedMain.details = details;
    if (!mergedMain.name.trim() && !mergedMain.details?.relation) {
        return { ledger: null, error: 'An unnamed relative needs a relation. Give them a name first.' };
    }

    const characters = charactersWithoutOther.map(character => {
        if (character.id === mainId) return mergedMain;
        return withRelationsRepointed(character, otherId, mainId);
    });

    // An unnamed relative of each record ("Anvil's mother", "Kendra Osei's
    // mother") would now be two records with one display name.
    const changedUnnamedCharacters = characters.filter(character => !character.name.trim() && !ledger.characters.includes(character));
    for (const unnamedCharacter of changedUnnamedCharacters) {
        const displayName = characterDisplayName({ characters }, unnamedCharacter);
        const characterWithName = characters.find(character => character !== unnamedCharacter
            && characterDisplayName({ characters }, character).toLowerCase() === displayName.toLowerCase());
        if (characterWithName) return { ledger: null, error: `${displayName} would be in the ledger twice: merge those two first.` };
    }

    if (mergedMain.nameClash && listCharactersWithNames({ characters }, mergedMain.nameClash.names, mainId).length === 0) {
        const mainIndex = characters.indexOf(mergedMain);
        characters[mainIndex] = withoutNameClash(mergedMain);
    }

    const repointId = characterId => characterId === otherId ? mainId : characterId;
    const mergedLedger = withCharacterReferencesChanged(
        { ...ledger, characters },
        holders => mergeHolderEntries(holders, otherId, mainId),
        present => [...new Set(present.map(repointId))],
    );
    return { ledger: mergedLedger, error: null };
}

/**
 * The ledger with the character references outside the records changed:
 * the holder entries of every fact, also of retracted facts, by
 * `changeHolders`, and who is present in the scene and every scene of the
 * scene history by `changePresent`. Facts and retractions keep their order.
 * @param {object} ledger - Left untouched
 * @param {function(object[]): object[]} changeHolders - Gets a fact's holder entries, returns new ones
 * @param {function(string[]): string[]} changePresent - Gets a scene's character ids, returns new ones
 * @returns {object} A new ledger
 */
function withCharacterReferencesChanged(ledger, changeHolders, changePresent) {
    const changeFact = fact => ({ ...fact, holders: changeHolders(fact.holders) });
    const changedLedger = {
        ...ledger,
        facts: ledger.facts.map(changeFact),
        scene: { ...ledger.scene, present: changePresent(ledger.scene.present) },
    };
    // Ledgers from before the scene history or the first retraction have none: none is added.
    if (ledger.sceneHistory) {
        changedLedger.sceneHistory = ledger.sceneHistory.map(scene => ({ ...scene, present: changePresent(scene.present) }));
    }
    if (ledger.retractedFacts) {
        changedLedger.retractedFacts = ledger.retractedFacts.map(retraction => ({ ...retraction, fact: changeFact(retraction.fact) }));
    }
    return changedLedger;
}

/**
 * Delete a character record, for one the extraction invented or the player
 * no longer wants tracked. Every reference to them goes: their holder
 * entries, also on retracted facts; a holder they told reads as witnessed;
 * they leave the scene and the scene history; relation entries of other
 * records that relate to them go, and a kind left empty with them. A fact
 * only they held goes with them, a public one aside (everyone knows it);
 * a fact that had no holder before stays as it was. A retracted fact left
 * with no holder goes too: it has nothing to come back as. Refused while
 * an unnamed relative is called after them ("Marcus Vale's mother"): the
 * relative would lose their name. `removed` names what goes beyond the
 * record, so the popup can state it before the player confirms.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} characterId
 * @returns {{ ledger: object|null, error: string|null, removed?: {
 *     facts: {id: string, text: string}[], retractedFacts: {id: string, text: string}[], holderEntries: number,
 *     relations: {characterId: string, kind: string}[] } }}
 *     `holderEntries` counts their entries on the facts that stay; `relations` lists each
 *     relation entry of another record to them that goes, by that record and the kinship word
 */
export function deleteCharacter(ledger, characterId) {
    const storedCharacter = findCharacter(ledger, characterId);
    if (!storedCharacter) return { ledger: null, error: 'This character is no longer in the ledger.' };

    const relatesToDeleted = entry => entry.value.of === characterId;
    const unnamedRelative = ledger.characters.find(character => !character.name.trim()
        && (character.details?.relation || []).some(relatesToDeleted));
    if (unnamedRelative) {
        const name = characterDisplayName(ledger, storedCharacter);
        return {
            ledger: null,
            error: `${characterDisplayName(ledger, unnamedRelative)} is known only as ${name}'s relative: give them a name or another relation first.`,
        };
    }

    const characters = ledger.characters
        .filter(character => character.id !== characterId)
        .map(character => withoutRelationsTo(character, characterId));
    const changedLedger = withCharacterReferencesChanged(
        { ...ledger, characters },
        holders => withoutHolderEntriesOf(holders, characterId),
        present => present.filter(presentId => presentId !== characterId),
    );

    const removed = { facts: [], retractedFacts: [], holderEntries: 0, relations: [] };
    for (const character of ledger.characters) {
        for (const entry of character.details?.relation || []) {
            if (character.id !== characterId && relatesToDeleted(entry)) {
                removed.relations.push({ characterId: character.id, kind: entry.value.kind });
            }
        }
    }
    const isOnlyTheirs = (storedFact, changedFact) => changedFact.holders.length === 0
        && storedFact.holders.length > 0 && !storedFact.public;
    changedLedger.facts = changedLedger.facts.filter((changedFact, index) => {
        const storedFact = ledger.facts[index];
        if (isOnlyTheirs(storedFact, changedFact)) {
            removed.facts.push({ id: storedFact.id, text: storedFact.text });
            return false;
        }
        removed.holderEntries += storedFact.holders.filter(holder => holder.characterId === characterId).length;
        return true;
    });
    if (changedLedger.retractedFacts) {
        changedLedger.retractedFacts = changedLedger.retractedFacts.filter((changedRetraction, index) => {
            const storedFact = ledger.retractedFacts[index].fact;
            if (changedRetraction.fact.holders.length === 0 && storedFact.holders.length > 0) {
                removed.retractedFacts.push({ id: storedFact.id, text: storedFact.text });
                return false;
            }
            removed.holderEntries += storedFact.holders.filter(holder => holder.characterId === characterId).length;
            return true;
        });
    }
    return { ledger: changedLedger, error: null, removed };
}

/**
 * A character without the relation entries that relate to `characterId`;
 * the relation kind goes when none is left, `details` when it is empty.
 * The record itself when it has none.
 * @param {object} character
 * @param {string} characterId
 * @returns {object}
 */
function withoutRelationsTo(character, characterId) {
    const relationEntries = character.details?.relation;
    if (!relationEntries?.some(entry => entry.value.of === characterId)) return character;

    const details = { ...character.details };
    const keptEntries = relationEntries.filter(entry => entry.value.of !== characterId);
    if (keptEntries.length > 0) {
        details.relation = keptEntries;
    } else {
        delete details.relation;
    }
    const { details: storedDetails, ...characterWithoutDetails } = character;
    if (Object.keys(details).length === 0) return characterWithoutDetails;
    return { ...characterWithoutDetails, details };
}

/**
 * A fact's holder entries without those of `characterId`; an entry they
 * told reads as witnessed, keeping its `at` and `messageId`.
 * @param {object[]} holders
 * @param {string} characterId
 * @returns {object[]}
 */
function withoutHolderEntriesOf(holders, characterId) {
    return holders
        .filter(holder => holder.characterId !== characterId)
        .map(holder => holder.toldBy === characterId
            ? { ...holder, how: HOLDER_HOW.witnessed, toldBy: null }
            : holder);
}

/**
 * The details of a merged record: per kind the history of the record that
 * has the kind set by the player (isDetailLocked) when only one of the two
 * has, else the main record's, or the other's where the main record knows
 * nothing of that kind; entries unchanged. A relation entry between the two
 * records would relate the merged record to itself and is left out first,
 * so it locks nothing and the other's relation can fill the kind.
 * @param {object} mainCharacter
 * @param {object} otherCharacter
 * @returns {object} The details; empty when neither record has any
 */
function mergeDetails(mainCharacter, otherCharacter) {
    const relatesToEither = entry => entry.value.of === mainCharacter.id || entry.value.of === otherCharacter.id;
    const detailsWithoutSelfRelation = character => {
        const details = { ...character.details };
        if (details.relation) {
            const relationEntries = details.relation.filter(entry => !relatesToEither(entry));
            if (relationEntries.length > 0) {
                details.relation = relationEntries;
            } else {
                delete details.relation;
            }
        }
        return details;
    };
    const mainDetails = detailsWithoutSelfRelation(mainCharacter);
    const otherDetails = detailsWithoutSelfRelation(otherCharacter);
    const details = { ...otherDetails, ...mainDetails };
    for (const kind of Object.keys(otherDetails)) {
        const isLockedOnOther = isDetailLocked({ details: otherDetails }, kind);
        const isLockedOnMain = isDetailLocked({ details: mainDetails }, kind);
        if (isLockedOnOther && !isLockedOnMain) details[kind] = otherDetails[kind];
    }
    return details;
}

/**
 * A character whose relation entries to `fromId` relate to `toId` instead;
 * the record itself when it has none.
 * @param {object} character
 * @param {string} fromId
 * @param {string} toId
 * @returns {object}
 */
function withRelationsRepointed(character, fromId, toId) {
    const relationEntries = character.details?.relation;
    if (!relationEntries?.some(entry => entry.value.of === fromId)) return character;
    const repointedEntries = relationEntries.map(entry => entry.value.of === fromId
        ? { ...entry, value: { ...entry.value, of: toId } }
        : entry);
    return { ...character, details: { ...character.details, relation: repointedEntries } };
}

/**
 * A fact's holder entries with `fromId` replaced by `toId`, as holder and as
 * teller, and one entry per character: the best by rankHolderEntry, of
 * equals the one `toId` had already, in the order the entries had. An entry
 * now told by its own holder (the other record told the main one) reads as
 * witnessed: the person knew it. Each entry keeps its `at` and `messageId`.
 * @param {object[]} holders
 * @param {string} fromId
 * @param {string} toId
 * @returns {object[]} New entry objects
 */
function mergeHolderEntries(holders, fromId, toId) {
    const movedFromOther = new Set();
    const movedHolders = holders.map(holder => {
        const movedHolder = { ...holder };
        if (movedHolder.characterId === fromId) {
            movedHolder.characterId = toId;
            movedFromOther.add(movedHolder);
        }
        if (movedHolder.toldBy === fromId) movedHolder.toldBy = toId;
        if (movedHolder.how === HOLDER_HOW.told && movedHolder.toldBy === movedHolder.characterId) {
            movedHolder.how = HOLDER_HOW.witnessed;
            movedHolder.toldBy = null;
        }
        return movedHolder;
    });
    const bestHolders = new Map();
    for (const holder of movedHolders) {
        const bestHolder = bestHolders.get(holder.characterId);
        const isBetter = !bestHolder
            || rankHolderEntry(holder) < rankHolderEntry(bestHolder)
            || (rankHolderEntry(holder) === rankHolderEntry(bestHolder) && movedFromOther.has(bestHolder) && !movedFromOther.has(holder));
        if (isBetter) bestHolders.set(holder.characterId, holder);
    }
    return movedHolders.filter(holder => bestHolders.get(holder.characterId) === holder);
}

/**
 * Which of two holder entries of one character a merge keeps, lower first:
 * an entry without a message (`at: null`, the player's) before any other,
 * else the earliest message.
 * @param {object} holder
 * @returns {number}
 */
function rankHolderEntry(holder) {
    return holder.at === null ? -1 : holder.at;
}

/**
 * A character record without its reused-name flag: saving the character in
 * the popup is the player's decision about the name, so the flag goes.
 * Detection runs only when a record is added, so it never comes back.
 * @param {object} character
 * @returns {object} A copy without `nameClash`
 */
function withoutNameClash(character) {
    const { nameClash, ...characterWithoutFlag } = character;
    return characterWithoutFlag;
}

/**
 * The ledger with one character replaced by what `changeCharacter` makes of it.
 * @param {object} ledger
 * @param {string} characterId
 * @param {function(object): object} changeCharacter - Gets the stored character, returns the new one
 * @returns {{ ledger: object|null, error: string|null }}
 */
function replaceCharacter(ledger, characterId, changeCharacter) {
    const storedCharacter = findCharacter(ledger, characterId);
    if (!storedCharacter) return { ledger: null, error: 'This character is no longer in the ledger.' };

    const changedCharacter = changeCharacter(storedCharacter);
    const characters = ledger.characters.map(character => character.id === characterId ? changedCharacter : character);
    return { ledger: { ...ledger, characters }, error: null };
}

function findCharacter(ledger, characterId) {
    return ledger.characters.find(character => character.id === characterId) || null;
}

/**
 * Save the character details the player typed into a character's editor.
 * Only a field the player changed does anything, so saving one detail locks
 * no other. A field counts as changed when it differs from the value it
 * showed when the popup was drawn (isSameDetailValue: letter case aside),
 * not from the ledger's current value: a field left as shown writes nothing,
 * even when an extraction or a rollback changed its detail meanwhile. A
 * field changed to a value writes a player entry
 * (`{ value, at: null, by: 'user' }`) at the end of the kind's history,
 * in place of an earlier player entry; the kind is then locked against the
 * extraction. A field the player emptied removes the player entry, which
 * unlocks the kind, and the extraction's entries under it count again. An
 * emptied field of a kind only the story set changes nothing: the story's
 * entries go only with their messages. A kind left with no entry is
 * unknown and leaves `details`, and a record without any leaves it too.
 * A relation that gives an unnamed relative the display name of another
 * record is refused, as in addUnnamedRelative.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} characterId
 * @param {object} typedDetails - Per kind of DETAIL_KINDS the field as typed: text,
 *     for a relation `{ kind, of }` (a kinship word and a character id); a kind
 *     missing here is left as it is
 * @param {object} shownDetails - Per kind the field as the popup drew it, in the same form
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function saveCharacterDetails(ledger, characterId, typedDetails, shownDetails) {
    const storedCharacter = findCharacter(ledger, characterId);
    if (!storedCharacter) return { ledger: null, error: 'This character is no longer in the ledger.' };

    const details = { ...storedCharacter.details };
    for (const kind of DETAIL_KINDS) {
        if (typedDetails[kind] === undefined) continue;
        const typed = readTypedDetail(ledger, characterId, kind, typedDetails[kind]);
        if (typed.error) return { ledger: null, error: typed.error };

        const shownValue = readTypedDetail(ledger, characterId, kind, shownDetails[kind]).value;
        if (isSameDetailValue(kind, typed.value, shownValue)) continue;

        const history = details[kind] || [];

        const storyEntries = history.filter(entry => entry.by !== 'user');
        if (typed.value === null) {
            // An emptied field: only the player's own entry can go.
            if (storyEntries.length === history.length) continue;
            if (storyEntries.length) {
                details[kind] = storyEntries;
            } else {
                delete details[kind];
            }
            continue;
        }
        details[kind] = [...storyEntries, { value: typed.value, at: null, by: 'user' }];
    }

    // An unnamed relative is known by its relation: it keeps one until it has a name.
    if (!storedCharacter.name.trim() && !details.relation) {
        return { ledger: null, error: 'An unnamed relative needs a relation. Give them a name first.' };
    }
    if (!storedCharacter.name.trim() && details.relation !== storedCharacter.details?.relation) {
        const displayName = characterDisplayName(ledger, { ...storedCharacter, details });
        const characterWithName = ledger.characters.find(character => character.id !== characterId
            && characterDisplayName(ledger, character).toLowerCase() === displayName.toLowerCase());
        if (characterWithName) return { ledger: null, error: `${displayName} is already in the ledger.` };
    }

    return replaceCharacter(ledger, characterId, character => {
        const { details: storedDetails, ...characterWithoutDetails } = character;
        if (Object.keys(details).length === 0) return characterWithoutDetails;
        return { ...characterWithoutDetails, details };
    });
}

/**
 * Lock a character detail at the value the story set, for one the player
 * agrees with and wants kept: a player entry (`{ value, at: null, by: 'user' }`)
 * with the current value goes at the end of the kind's history. The
 * value does not change, but the kind is now locked against the extraction
 * (isDetailLocked), and the value survives a rollback of the story's entry.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} characterId
 * @param {string} kind - One of DETAIL_KINDS
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function lockCharacterDetail(ledger, characterId, kind) {
    if (!DETAIL_KINDS.includes(kind)) return { ledger: null, error: `There is no character detail "${kind}".` };
    const storedCharacter = findCharacter(ledger, characterId);
    if (!storedCharacter) return { ledger: null, error: 'This character is no longer in the ledger.' };
    const name = characterDisplayName(ledger, storedCharacter);
    const history = storedCharacter.details?.[kind] || [];
    if (history.length === 0) return { ledger: null, error: `The story has not set ${name}'s ${kind}.` };
    if (isDetailLocked(storedCharacter, kind)) return { ledger: null, error: `${name}'s ${kind} is already set by the player.` };

    const currentValue = history[history.length - 1].value;
    const value = kind === 'relation' ? { ...currentValue } : currentValue;
    return replaceCharacter(ledger, characterId, character => ({
        ...character,
        details: { ...character.details, [kind]: [...history, { value, at: null, by: 'user' }] },
    }));
}

/**
 * One field of the details editor as a detail value: trimmed text, for a
 * relation `{ kind, of }`, null for an empty field, or the error for the player.
 * @param {object} ledger
 * @param {string} characterId - The character the detail is for
 * @param {string} kind - One of DETAIL_KINDS
 * @param {string|{kind: string, of: string}} typedValue
 * @returns {{ value: string|object|null, error: string|null }}
 */
function readTypedDetail(ledger, characterId, kind, typedValue) {
    if (kind === 'relation') {
        const kinship = String(typedValue?.kind || '').trim();
        const relatedId = String(typedValue?.of || '').trim();
        if (!kinship && !relatedId) return { value: null, error: null };
        if (!kinship || !relatedId) return { value: null, error: 'A relation needs a kinship word and another character.' };
        if (relatedId === characterId || !findCharacter(ledger, relatedId)) {
            return { value: null, error: 'A relation needs another character.' };
        }
        return { value: { kind: kinship, of: relatedId }, error: null };
    }

    const text = String(typedValue || '').trim();
    if (!text) return { value: null, error: null };
    if (kind === 'status' && !DETAIL_STATUS_VALUES.includes(text)) return { value: null, error: 'A status is alive or dead.' };
    return { value: text, error: null };
}

/**
 * Add a fact the player entered by hand. Its holders are user-entered, so no
 * rollback removes them. Holder ids that name no character are ignored.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {{ id: string, text: string, holderIds: string[] }} fact
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function addFact(ledger, { id, text, holderIds }) {
    const trimmedText = String(text || '').trim();
    if (!trimmedText) return { ledger: null, error: 'A fact needs a text.' };

    const knownHolderIds = [...new Set(holderIds)].filter(characterId => findCharacter(ledger, characterId));
    const newFact = {
        id,
        text: trimmedText,
        public: false,
        holders: knownHolderIds.map(characterId => buildUserHolder(characterId)),
    };

    return { ledger: { ...ledger, facts: [...ledger.facts, newFact] }, error: null };
}

/**
 * Correct a fact's text. The holders stay as they are: how each one learned
 * it is still true of the corrected fact.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} factId
 * @param {string} text
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function editFactText(ledger, factId, text) {
    const trimmedText = String(text || '').trim();
    if (!trimmedText) return { ledger: null, error: 'A fact needs a text.' };

    return replaceFact(ledger, factId, fact => ({ ...fact, text: trimmedText }));
}

/**
 * Remove a fact with all its holders.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} factId
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function deleteFact(ledger, factId) {
    const facts = ledger.facts.filter(fact => fact.id !== factId);
    return { ledger: { ...ledger, facts }, error: null };
}

/**
 * Take back a retraction the player disagrees with ("still true"): the
 * fact returns to the facts with its holders as they were, each keeping
 * `at` and `messageId`, so it rolls back with its messages as before. A
 * fact entered meanwhile under its id gives it a free id instead, as a
 * rollback of the correction would (keepOnlyHolders). Of two retractions
 * of one fact id, the later one is restored.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} factId - The retracted fact's id
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function restoreRetractedFact(ledger, factId) {
    const retractedFacts = ledger.retractedFacts || [];
    const retraction = retractedFacts.findLast(candidate => candidate.fact.id === factId);
    if (!retraction) return { ledger: null, error: 'This fact is no longer retracted.' };

    const restoredFact = { ...retraction.fact, holders: retraction.fact.holders.map(holder => ({ ...holder })) };
    if (ledger.facts.some(fact => fact.id === restoredFact.id)) restoredFact.id = nextLedgerId('f', ledger.facts);
    return {
        ledger: {
            ...ledger,
            facts: [...ledger.facts, restoredFact],
            retractedFacts: retractedFacts.filter(candidate => candidate !== retraction),
        },
        error: null,
    };
}

/**
 * Retract a fact by hand ("Not true"), as an out-of-character correction
 * would: the fact leaves the facts and goes into the retracted facts whole,
 * holders as they were, so "Still true" (restoreRetractedFact) puts it back.
 * The retraction has no message (`at: null`), the player's own, so no
 * rollback takes it back; its holders still go with their messages, and
 * with none left the retraction goes, as any retraction's.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} factId
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function retractFact(ledger, factId) {
    const storedFact = ledger.facts.find(fact => fact.id === factId);
    if (!storedFact) return { ledger: null, error: 'This fact is no longer in the ledger.' };

    return {
        ledger: {
            ...ledger,
            facts: ledger.facts.filter(fact => fact !== storedFact),
            retractedFacts: [...(ledger.retractedFacts || []), { at: null, fact: storedFact }],
        },
        error: null,
    };
}

/**
 * Make a relative the story named an unnamed relative again ("Not their
 * name" on the new name): the name goes, the id, aliases, details and
 * relation stay, and the display name is the relation again ("Kendra Osei's
 * mother"). The reused-name flag goes with the name. Refused for a record
 * without a relation, which would have no name at all, and when another
 * record already has that display name, as in addUnnamedRelative.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} characterId
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function unnameCharacter(ledger, characterId) {
    const storedCharacter = findCharacter(ledger, characterId);
    if (!storedCharacter) return { ledger: null, error: 'This character is no longer in the ledger.' };
    if (!storedCharacter.details?.relation?.length) {
        return { ledger: null, error: `Only a relative can go back to being unnamed: ${characterDisplayName(ledger, storedCharacter)} has no relation.` };
    }

    const unnamedCharacter = { ...withoutNameClash(storedCharacter), name: '' };
    const displayName = characterDisplayName(ledger, unnamedCharacter);
    const characterWithName = ledger.characters.find(character => character.id !== characterId
        && characterDisplayName(ledger, character).toLowerCase() === displayName.toLowerCase());
    if (characterWithName) return { ledger: null, error: `${displayName} is already in the ledger.` };

    return replaceCharacter(ledger, characterId, () => unnamedCharacter);
}

/**
 * Mark a fact public (known to everyone, e.g. a broadcast) or take that back.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} factId
 * @param {boolean} isPublic
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function setFactPublic(ledger, factId, isPublic) {
    return replaceFact(ledger, factId, fact => ({ ...fact, public: isPublic }));
}

/**
 * Give a character a fact as a user-entered holder. A character who already
 * holds the fact keeps the entry they have: it records how they learned it.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} factId
 * @param {string} characterId
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function addFactHolder(ledger, factId, characterId) {
    if (!findCharacter(ledger, characterId)) return { ledger: null, error: 'This character is no longer in the ledger.' };

    return replaceFact(ledger, factId, fact => {
        const alreadyHolds = fact.holders.some(holder => holder.characterId === characterId);
        if (alreadyHolds) return fact;
        return { ...fact, holders: [...fact.holders, buildUserHolder(characterId)] };
    });
}

/**
 * Take a fact away from a character: every holder entry of theirs goes. The
 * fact stays, even with no holder left.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} factId
 * @param {string} characterId
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function removeFactHolder(ledger, factId, characterId) {
    return replaceFact(ledger, factId, fact => ({
        ...fact,
        holders: fact.holders.filter(holder => holder.characterId !== characterId),
    }));
}

/**
 * Move a fact's holder from one character to another in one step, for an
 * entry the extraction gave the wrong person. Every entry of `fromId` on
 * the fact becomes `toId`'s and keeps `how`, `toldBy`, `at` and
 * `messageId`, so it still rolls back with its message. When `toId`
 * already holds the fact, the moved entries go and `toId`'s own entry
 * stays: it records how they learned it. Other holders told by `fromId`
 * keep `toldBy: fromId`: who told them did not change. A moved entry told
 * by `toId` itself reads as witnessed, as in a merge (mergeHolderEntries).
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} factId
 * @param {string} fromId - The character who holds the fact now
 * @param {string} toId - The character who gets the entry
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function moveFactHolder(ledger, factId, fromId, toId) {
    if (fromId === toId) return { ledger: null, error: 'A holder cannot be moved to themselves.' };
    if (!findCharacter(ledger, toId)) return { ledger: null, error: 'This character is no longer in the ledger.' };
    const storedFact = ledger.facts.find(fact => fact.id === factId);
    if (!storedFact) return { ledger: null, error: 'This fact is no longer in the ledger.' };
    if (!storedFact.holders.some(holder => holder.characterId === fromId)) {
        return { ledger: null, error: `${characterName(ledger, fromId)} does not hold this fact.` };
    }

    return replaceFact(ledger, factId, fact => {
        const targetHolds = fact.holders.some(holder => holder.characterId === toId);
        const holders = [];
        for (const holder of fact.holders) {
            if (holder.characterId !== fromId) {
                holders.push(holder);
                continue;
            }
            if (targetHolds) continue;
            const movedHolder = { ...holder, characterId: toId };
            if (movedHolder.how === HOLDER_HOW.told && movedHolder.toldBy === toId) {
                movedHolder.how = HOLDER_HOW.witnessed;
                movedHolder.toldBy = null;
            }
            holders.push(movedHolder);
        }
        return { ...fact, holders };
    });
}

/**
 * The ledger with one fact replaced by what `changeFact` makes of it.
 * @param {object} ledger
 * @param {string} factId
 * @param {function(object): object} changeFact - Gets the stored fact, returns the new one
 * @returns {{ ledger: object|null, error: string|null }}
 */
function replaceFact(ledger, factId, changeFact) {
    const storedFact = ledger.facts.find(fact => fact.id === factId);
    if (!storedFact) return { ledger: null, error: 'This fact is no longer in the ledger.' };

    const changedFact = changeFact(storedFact);
    const facts = ledger.facts.map(fact => fact.id === factId ? changedFact : fact);
    return { ledger: { ...ledger, facts }, error: null };
}

/** A holder entry the player entered: no source message, so it survives every rollback. */
function buildUserHolder(characterId) {
    return { characterId, how: HOLDER_HOW.user, toldBy: null, at: null };
}

// ─── Reviewed marks ─────────────────────────────────────────────────────────
//
// Pure, like the ledger edits: the player marks a change item of the update
// log as reviewed, by its item key (listChangeItems). A rollback that removes
// the item drops its mark (ledger.js, dropReviewedMarksOfGoneItems).

/**
 * Mark a change item as reviewed. A mark it has already stays one.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} itemKey - The item's key, from listChangeItems
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function markChangeItemReviewed(ledger, itemKey) {
    const isListed = (ledger.updateLog || []).some(record =>
        listChangeItems(record).some(item => item.key === itemKey));
    if (!isListed) return { ledger: null, error: 'This change is no longer in the update log.' };

    const reviewedMarks = ledger.reviewedMarks || [];
    if (reviewedMarks.includes(itemKey)) return { ledger, error: null };
    return { ledger: { ...ledger, reviewedMarks: [...reviewedMarks, itemKey] }, error: null };
}

/**
 * Take a change item's reviewed mark back.
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} itemKey - The item's key, from listChangeItems
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function unmarkChangeItemReviewed(ledger, itemKey) {
    const reviewedMarks = (ledger.reviewedMarks || []).filter(key => key !== itemKey);
    return { ledger: { ...ledger, reviewedMarks }, error: null };
}
