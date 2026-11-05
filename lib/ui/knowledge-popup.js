/**
 * @file Knowledge popup — view and correct the knowledge ledger by hand
 * @module ui/knowledge-popup
 *
 * Opened from the Arc Manager and the wand menu (ADR-0007). Lists the
 * ledger's characters (add, rename, aliases, character details, merge into another) and facts with their holders
 * (add, edit text, delete, add or remove a holder, mark public). The edit
 * functions of #66 (move a holder, delete a character, restore a retracted
 * fact, lock a detail) have no control until the redesign (#65). The content
 * sits behind closed spoiler toggles, because it shows who holds the arcs'
 * secrets. Only the "Names to check" section sits above them: a name is
 * never a spoiler. Every holder entry created here is user-entered
 * (`how: 'user'`, `at: null`), which survives every rollback; so is every
 * detail entry (`by: 'user'`, `at: null`), which also locks its kind against
 * the extraction.
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { chat, saveMetadata } from '/script.js';
import { getKnowledgeLedger, isCharacterDetailsEnabled } from '../core/settings.js';
import { DETAIL_KINDS, DETAIL_STATUS_VALUES, HOLDER_HOW } from '../core/constants.js';
import { characterDisplayName, characterName, currentDetailText, isDetailLocked, isSameDetailValue, nextLedgerId } from '../knowledge/ledger.js';
import { listCharactersWithNames } from '../knowledge/names.js';
import { messageIdOf } from '../knowledge/message-ids.js';
import { buildSpoilerGroup } from './spoiler-group.js';
import { updateKnowledgeStatus } from './knowledge-status.js';

/**
 * Show the knowledge popup for the current chat.
 */
export async function showKnowledgePopup() {
    const html = buildKnowledgeContent(getKnowledgeLedger(), chat, isCharacterDetailsEnabled());

    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    const popupPromise = popup.show();

    // Small delay for DOM render (same as the arc manager)
    await delay(50);
    wireKnowledgeEvents(popup);

    await popupPromise;

    // Cleanup — leaving these bound fires them again from the next popup
    $(document).off('.storyArcKnowledge');
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/** How a holder learned a fact, as the popup shows it */
const HOW_LABELS = {
    [HOLDER_HOW.witnessed]: 'witnessed',
    [HOLDER_HOW.told]: 'told',
    [HOLDER_HOW.user]: 'entered by you',
    [HOLDER_HOW.plan]: 'planned',
};

/**
 * The popup body: the characters flagged for a reused name first, outside
 * the spoiler groups, then characters and facts, each in a spoiler group
 * that starts closed, because the ledger shows who holds the arcs' secrets.
 * Without `withDetails` the character rows show no details and no details
 * editor, and the form for an unnamed relative is left out.
 * @param {object} ledger - The knowledge ledger
 * @param {object[]} [chatMessages] - ST's chat array, to find a flag's message by its message id
 * @param {boolean} [withDetails] - Whether character details are switched on (isCharacterDetailsEnabled)
 * @returns {string} HTML string
 */
export function buildKnowledgeContent(ledger, chatMessages = [], withDetails = true) {
    let html = `<div class="story-arc-knowledge" id="story-arc-knowledge">`;
    html += `<div class="story-arc-section-header"><i class="fa-solid fa-user-secret"></i> Who Knows What</div>`;

    html += buildNamesToCheck(ledger, chatMessages);

    const characterRowsHtml = ledger.characters.map(character => buildCharacterRow(ledger, character, withDetails)).join('');
    const charactersBodyHtml = `
        <ul class="story-arc-knowledge-list">${characterRowsHtml}</ul>
        ${buildAddCharacterForm()}
        ${withDetails ? buildAddRelativeForm(ledger) : ''}`;
    html += buildSpoilerGroup(
        'story-arc-knowledge-characters',
        `Characters (${ledger.characters.length})`,
        'Spoiler — the characters the ledger tracks.',
        charactersBodyHtml,
    );

    const factRowsHtml = ledger.facts.map(fact => buildFactRow(ledger, fact)).join('');
    const factsBodyHtml = `
        <ul class="story-arc-knowledge-list">${factRowsHtml}</ul>
        ${buildAddFactForm(ledger)}`;
    html += buildSpoilerGroup(
        'story-arc-knowledge-facts',
        `Facts (${ledger.facts.length})`,
        'Spoiler — these show who knows the arcs\' secrets.',
        factsBodyHtml,
    );

    html += `
        <div class="story-arc-wizard-footer">
            <div class="story-arc-btn" id="story-arc-knowledge-close">Close</div>
        </div>
    </div>`;

    return html;
}

/**
 * The "Names to check" section: each character the extraction added with a
 * name another character has, the names they share with who has them now,
 * and the message the character was named in. Names and message numbers
 * only, never a fact. '' when nothing is flagged.
 * @param {object} ledger
 * @param {object[]} chatMessages
 * @returns {string} HTML string
 */
function buildNamesToCheck(ledger, chatMessages) {
    const flaggedCharacters = ledger.characters.filter(character => character.nameClash);
    if (flaggedCharacters.length === 0) return '';

    const rowsHtml = flaggedCharacters.map(character => buildNameCheckRow(ledger, character, chatMessages)).join('');
    return `
    <div class="story-arc-knowledge-names" id="story-arc-knowledge-names">
        <div class="story-arc-knowledge-names-heading"><i class="fa-solid fa-triangle-exclamation"></i> Names to check</div>
        <div class="story-arc-muted">Rename here first, then edit the chat text, so that re-reading the edited message does not add the new name as a second character.</div>
        <ul class="story-arc-knowledge-list">${rowsHtml}</ul>
    </div>`;
}

function buildNameCheckRow(ledger, character, chatMessages) {
    const messageIndex = findNameClashMessage(character.nameClash, chatMessages);
    const nameLines = [];
    for (const sharedName of character.nameClash.names) {
        const otherNames = listCharactersWithNames(ledger, [sharedName], character.id)
            .map(otherCharacter => characterDisplayName(ledger, otherCharacter));
        if (otherNames.length === 0) continue;
        nameLines.push(`"${escapeHtml(sharedName)}" is also a name of ${escapeHtml(joinNames(otherNames))}.`);
    }

    const characterIdAttribute = escapeHtml(character.id);
    const nameHtml = `<span class="story-arc-knowledge-text">${escapeHtml(characterDisplayName(ledger, character))}</span>`;
    const messageHtml = `<span class="story-arc-muted">named in message #${escapeHtml(String(messageIndex))}</span>`;

    if (nameLines.length === 0) {
        return `
    <li class="story-arc-knowledge-item" data-character-id="${characterIdAttribute}">
        ${nameHtml}
        ${messageHtml}
        <div class="story-arc-knowledge-names-clash">No other character has this name any more: the clash is gone.</div>
        <div class="story-arc-knowledge-editor-actions">
            <div class="story-arc-btn story-arc-name-keep-btn">Not a clash</div>
        </div>
    </li>`;
    }

    const nameLinesHtml = nameLines.map(line => `<div class="story-arc-knowledge-names-clash">${line}</div>`).join('');
    return `
    <li class="story-arc-knowledge-item" data-character-id="${characterIdAttribute}">
        ${nameHtml}
        ${messageHtml}
        ${nameLinesHtml}
        <div class="story-arc-knowledge-editor-actions">
            <div class="story-arc-btn story-arc-name-rename-btn"><i class="fa-solid fa-pen"></i> Rename</div>
            <div class="story-arc-btn story-arc-name-keep-btn">Keep the name</div>
        </div>
        ${buildCharacterEditor(character)}
    </li>`;
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

/** "A", "A and B", "A, B and C" */
function joinNames(names) {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * One character's row in the Characters list: the display name, the
 * reused-name marker, the aliases and the known details, with the name and
 * details editors the edit button opens; the details and their editor only
 * `withDetails`.
 * @param {object} ledger
 * @param {object} character
 * @param {boolean} withDetails - Whether character details are switched on
 * @returns {string} HTML string
 */
function buildCharacterRow(ledger, character, withDetails) {
    const aliasesText = character.aliases.length > 0
        ? `<span class="story-arc-muted">also: ${escapeHtml(character.aliases.join(', '))}</span>`
        : '';
    const nameClashMarker = character.nameClash
        ? `<span class="story-arc-plan-chip story-arc-name-clash-chip" title="Shares a name with another character: see Names to check">name to check</span>`
        : '';

    return `
    <li class="story-arc-knowledge-item" data-character-id="${escapeHtml(character.id)}">
        <span class="story-arc-knowledge-text">${escapeHtml(characterDisplayName(ledger, character))}</span>
        ${nameClashMarker}
        ${aliasesText}
        ${withDetails ? buildDetailsSummary(ledger, character) : ''}
        <div class="story-arc-knowledge-edit-btn" title="Edit character"><i class="fa-solid fa-pen"></i></div>
        ${buildCharacterEditor(character)}
        ${withDetails ? buildDetailsEditor(ledger, character) : ''}
        ${buildMergeEditor(ledger, character)}
    </li>`;
}

/**
 * The "Merge into…" part of a character row, opened with the name editor:
 * the other records sorted by display name, so a ledger of a hundred
 * characters stays searchable by typing, and the button that merges this
 * record into the chosen one (mergeCharacters). '' while no other record exists.
 * @param {object} ledger
 * @param {object} character
 * @returns {string} HTML string
 */
function buildMergeEditor(ledger, character) {
    const otherCharacters = ledger.characters
        .filter(otherCharacter => otherCharacter.id !== character.id)
        .map(otherCharacter => ({ id: otherCharacter.id, displayName: characterDisplayName(ledger, otherCharacter) }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (otherCharacters.length === 0) return '';

    const optionsHtml = otherCharacters
        .map(otherCharacter => `<option value="${escapeHtml(otherCharacter.id)}">${escapeHtml(otherCharacter.displayName)}</option>`)
        .join('');
    return `
        <div class="story-arc-knowledge-editor">
            <label>Merge into <small>(the same person under another name: this record's names become aliases of the chosen one, its knowledge and details move there, and this record goes)</small></label>
            <div class="story-arc-knowledge-editor-actions">
                <select class="text_pole story-arc-merge-target">${optionsHtml}</select>
                <div class="story-arc-btn story-arc-btn-danger story-arc-merge-btn"><i class="fa-solid fa-code-merge"></i> Merge</div>
            </div>
        </div>`;
}

/**
 * The details editor of a character row, opened with the name editor: one
 * field per kind, filled with the current detail. Each field keeps the value
 * it shows in `data-shown-value`, so saving (saveCharacterDetails) changes
 * only the fields the player changed, even when the ledger changed while
 * the popup was open: a changed field locks its kind, an emptied one
 * unlocks it.
 * @param {object} ledger
 * @param {object} character
 * @returns {string} HTML string
 */
function buildDetailsEditor(ledger, character) {
    const currentValue = kind => {
        const history = character.details?.[kind] || [];
        return history.length ? history[history.length - 1].value : null;
    };
    const textField = (kind, label) => `
            <label>${label}</label>
            <input type="text" class="text_pole story-arc-detail-input" data-detail-kind="${kind}" value="${escapeHtml(currentValue(kind) || '')}" data-shown-value="${escapeHtml(currentValue(kind) || '')}">`;

    const relation = currentValue('relation') || { kind: '', of: '' };
    const otherCharacters = ledger.characters.filter(otherCharacter => otherCharacter.id !== character.id);
    const relatedOptionsHtml = [
        `<option value=""${relation.of ? '' : ' selected'}>nobody</option>`,
        ...otherCharacters.map(otherCharacter => {
            const selected = otherCharacter.id === relation.of ? ' selected' : '';
            return `<option value="${escapeHtml(otherCharacter.id)}"${selected}>${escapeHtml(characterDisplayName(ledger, otherCharacter))}</option>`;
        }),
    ].join('');

    const status = currentValue('status') || '';
    const statusOptionsHtml = ['', ...DETAIL_STATUS_VALUES].map(statusValue => {
        const selected = statusValue === status ? ' selected' : '';
        return `<option value="${statusValue}"${selected}>${statusValue || 'unknown'}</option>`;
    }).join('');

    return `
        <div class="story-arc-knowledge-editor">
            <label>Details <small>(a detail you change here is locked: the story no longer changes it; empty it to unlock)</small></label>
            ${textField('gender', 'Gender')}
            ${textField('age', 'Age')}
            ${textField('role', 'Role <small>(job or place in the world, and where it puts them)</small>')}
            <label>Relation <small>(kinship word, and to whom)</small></label>
            <div class="story-arc-knowledge-editor-actions">
                <input type="text" class="text_pole story-arc-detail-relation-kind" value="${escapeHtml(relation.kind)}" data-shown-value="${escapeHtml(relation.kind)}">
                <select class="text_pole story-arc-detail-relation-of" data-shown-value="${escapeHtml(relation.of)}">${relatedOptionsHtml}</select>
            </div>
            <label>Status</label>
            <select class="text_pole story-arc-detail-status" data-shown-value="${escapeHtml(status)}">${statusOptionsHtml}</select>
            <div class="story-arc-knowledge-editor-actions">
                <div class="story-arc-btn story-arc-details-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save details</div>
            </div>
        </div>`;
}

/**
 * A character's known details, each labelled by its kind, in DETAIL_KINDS
 * order; a detail the player set says so, because the extraction leaves it
 * alone. '' with no detail known.
 * @param {object} ledger
 * @param {object} character
 * @returns {string} HTML string
 */
function buildDetailsSummary(ledger, character) {
    const detailTexts = [];
    for (const kind of DETAIL_KINDS) {
        const detailText = currentDetailText(ledger, character, kind);
        if (detailText === null) continue;
        const lockNote = isDetailLocked(character, kind) ? ' (set by you)' : '';
        detailTexts.push(`${kind}: ${detailText}${lockNote}`);
    }
    if (detailTexts.length === 0) return '';
    return `<div class="story-arc-muted story-arc-knowledge-details">${escapeHtml(detailTexts.join('; '))}</div>`;
}

/** The name and aliases editor of a character row, opened by its edit or Rename button. */
function buildCharacterEditor(character) {
    return `
        <div class="story-arc-knowledge-editor">
            <label>Name</label>
            <input type="text" class="text_pole story-arc-knowledge-name-input" value="${escapeHtml(character.name)}" placeholder="No name yet">
            <label>Aliases <small>(comma-separated)</small></label>
            <input type="text" class="text_pole story-arc-knowledge-aliases-input" value="${escapeHtml(character.aliases.join(', '))}">
            <div class="story-arc-knowledge-editor-actions">
                <div class="story-arc-btn story-arc-character-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save</div>
                <div class="story-arc-btn story-arc-knowledge-cancel-btn">Cancel</div>
            </div>
        </div>`;
}

function buildAddCharacterForm() {
    return `
    <div class="story-arc-knowledge-add">
        <label>New character</label>
        <input type="text" class="text_pole story-arc-new-character-name" placeholder="Name">
        <input type="text" class="text_pole story-arc-new-character-aliases" placeholder="Aliases, comma-separated">
        <div class="story-arc-btn story-arc-character-add-btn"><i class="fa-solid fa-plus"></i> Add character</div>
    </div>`;
}

/**
 * The form for an unnamed relative ("Kendra Osei's mother"): a kinship word
 * and the character they are related to. '' while the ledger has no
 * character to relate to.
 * @param {object} ledger
 * @returns {string} HTML string
 */
function buildAddRelativeForm(ledger) {
    if (ledger.characters.length === 0) return '';
    const relatedOptionsHtml = ledger.characters
        .map(character => `<option value="${escapeHtml(character.id)}">${escapeHtml(characterDisplayName(ledger, character))}</option>`)
        .join('');
    return `
    <div class="story-arc-knowledge-add">
        <label>New unnamed relative <small>(a recurring relative the story has not named yet)</small></label>
        <div class="story-arc-knowledge-editor-actions">
            <input type="text" class="text_pole story-arc-new-relative-kind" placeholder="Kinship word, e.g. mother">
            <select class="text_pole story-arc-new-relative-of">${relatedOptionsHtml}</select>
        </div>
        <div class="story-arc-btn story-arc-relative-add-btn"><i class="fa-solid fa-plus"></i> Add unnamed relative</div>
    </div>`;
}

function buildFactRow(ledger, fact) {
    const publicChip = fact.public ? `<span class="story-arc-plan-chip">public</span>` : '';

    const holderChipsHtml = fact.holders.map(holder => {
        const howLabel = holder.how === HOLDER_HOW.told && holder.toldBy
            ? `told by ${characterName(ledger, holder.toldBy)}`
            : (HOW_LABELS[holder.how] || holder.how);
        return `
        <span class="story-arc-knowledge-holder">
            ${escapeHtml(characterName(ledger, holder.characterId))} (${escapeHtml(howLabel)})
            <span class="story-arc-holder-remove-btn" data-character-id="${escapeHtml(holder.characterId)}" title="Remove holder">×</span>
        </span>`;
    }).join('');

    const holderIds = new Set(fact.holders.map(holder => holder.characterId));
    const nonHolders = ledger.characters.filter(character => !holderIds.has(character.id));
    const nonHolderOptionsHtml = nonHolders
        .map(character => `<option value="${escapeHtml(character.id)}">${escapeHtml(characterDisplayName(ledger, character))}</option>`)
        .join('');
    const addHolderHtml = nonHolders.length > 0 ? `
            <label>Add holder</label>
            <div class="story-arc-knowledge-editor-actions">
                <select class="text_pole story-arc-holder-select">${nonHolderOptionsHtml}</select>
                <div class="story-arc-btn story-arc-holder-add-btn"><i class="fa-solid fa-plus"></i> Add</div>
            </div>` : '';

    return `
    <li class="story-arc-knowledge-item" data-fact-id="${escapeHtml(fact.id)}">
        <span class="story-arc-knowledge-text">${escapeHtml(fact.text)}</span>
        ${publicChip}
        ${holderChipsHtml}
        <div class="story-arc-knowledge-edit-btn" title="Edit fact"><i class="fa-solid fa-pen"></i></div>
        <div class="story-arc-knowledge-editor">
            <label>Fact</label>
            <textarea class="story-arc-textarea story-arc-fact-text-input" rows="2">${escapeHtml(fact.text)}</textarea>
            <label class="checkbox_label">
                <input type="checkbox" class="story-arc-fact-public-input" ${fact.public ? 'checked' : ''}>
                <span>Public (everyone knows it)</span>
            </label>
            ${addHolderHtml}
            <div class="story-arc-knowledge-editor-actions">
                <div class="story-arc-btn story-arc-fact-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save</div>
                <div class="story-arc-btn story-arc-knowledge-cancel-btn">Cancel</div>
                <div class="story-arc-btn story-arc-btn-danger story-arc-fact-delete-btn"><i class="fa-solid fa-trash"></i> Delete</div>
            </div>
        </div>
    </li>`;
}

function buildAddFactForm(ledger) {
    const holderCheckboxesHtml = ledger.characters.map(character => `
        <label class="checkbox_label">
            <input type="checkbox" class="story-arc-new-fact-holder" value="${escapeHtml(character.id)}">
            <span>${escapeHtml(characterDisplayName(ledger, character))}</span>
        </label>`).join('');

    return `
    <div class="story-arc-knowledge-add">
        <label>New fact</label>
        <textarea class="story-arc-textarea story-arc-new-fact-text" rows="2" placeholder="What is known"></textarea>
        <label>Known to</label>
        <div class="story-arc-knowledge-holder-choices">${holderCheckboxesHtml}</div>
        <div class="story-arc-btn story-arc-fact-add-btn"><i class="fa-solid fa-plus"></i> Add fact</div>
    </div>`;
}

// ─── Event Wiring ───────────────────────────────────────────────────────────

function wireKnowledgeEvents(popup) {
    const $doc = $(document);
    $doc.off('.storyArcKnowledge');

    // Spoiler toggles
    $doc.on('click.storyArcKnowledge', '#story-arc-knowledge .story-arc-spoiler-toggle', function () {
        const $toggle = $(this);
        const targetId = $toggle.data('spoiler-target');
        if (targetId) {
            $toggle.toggleClass('open');
            $(`#${targetId}`).toggleClass('open');
        }
    });

    // Character or fact editor: open / close
    $doc.on('click.storyArcKnowledge', '.story-arc-knowledge-edit-btn, .story-arc-name-rename-btn, .story-arc-knowledge-cancel-btn', function () {
        const $item = $(this).closest('.story-arc-knowledge-item');
        $item.toggleClass('editing');
        $item.find('.story-arc-fact-delete-btn').removeClass('armed').html('<i class="fa-solid fa-trash"></i> Delete');
        disarmMergeButton($item);
    });

    // Character: add
    $doc.on('click.storyArcKnowledge', '.story-arc-character-add-btn', async function () {
        const $form = $(this).closest('.story-arc-knowledge-add');
        const storedLedger = getKnowledgeLedger();
        const character = {
            id: nextLedgerId('c', storedLedger.characters),
            name: String($form.find('.story-arc-new-character-name').val()),
            aliases: splitAliases($form.find('.story-arc-new-character-aliases').val()),
        };
        await saveLedgerEdit(addCharacter(storedLedger, character));
    });

    // Character: add an unnamed relative
    $doc.on('click.storyArcKnowledge', '.story-arc-relative-add-btn', async function () {
        const $form = $(this).closest('.story-arc-knowledge-add');
        const storedLedger = getKnowledgeLedger();
        const relative = {
            id: nextLedgerId('c', storedLedger.characters),
            kind: String($form.find('.story-arc-new-relative-kind').val()),
            of: String($form.find('.story-arc-new-relative-of').val()),
        };
        await saveLedgerEdit(addUnnamedRelative(storedLedger, relative));
    });

    // Character: save name and aliases
    $doc.on('click.storyArcKnowledge', '.story-arc-character-save-btn', async function () {
        const $item = $(this).closest('.story-arc-knowledge-item');
        const characterId = String($item.data('character-id'));
        const name = String($item.find('.story-arc-knowledge-name-input').val());
        const aliases = splitAliases($item.find('.story-arc-knowledge-aliases-input').val());

        const renamed = renameCharacter(getKnowledgeLedger(), characterId, name);
        if (renamed.error) {
            toastr.warning(renamed.error);
            return;
        }
        await saveLedgerEdit(setCharacterAliases(renamed.ledger, characterId, aliases));
    });

    // Character: save the details
    $doc.on('click.storyArcKnowledge', '.story-arc-details-save-btn', async function () {
        const $item = $(this).closest('.story-arc-knowledge-item');
        const characterId = String($item.data('character-id'));
        const $relationKind = $item.find('.story-arc-detail-relation-kind');
        const $relationOf = $item.find('.story-arc-detail-relation-of');
        const $status = $item.find('.story-arc-detail-status');
        const typedDetails = {
            relation: { kind: String($relationKind.val()), of: String($relationOf.val()) },
            status: String($status.val()),
        };
        const shownDetails = {
            relation: { kind: String($relationKind.attr('data-shown-value')), of: String($relationOf.attr('data-shown-value')) },
            status: String($status.attr('data-shown-value')),
        };
        $item.find('.story-arc-detail-input').each((index, element) => {
            typedDetails[element.dataset.detailKind] = String(element.value);
            shownDetails[element.dataset.detailKind] = String(element.dataset.shownValue);
        });
        await saveLedgerEdit(saveCharacterDetails(getKnowledgeLedger(), characterId, typedDetails, shownDetails));
    });

    // Character: keep a flagged name (or clear a flag whose clash is gone)
    $doc.on('click.storyArcKnowledge', '.story-arc-name-keep-btn', async function () {
        const characterId = String($(this).closest('.story-arc-knowledge-item').data('character-id'));
        await saveLedgerEdit(keepCharacterName(getKnowledgeLedger(), characterId));
    });

    // Character: merge into another — the first click arms the button, the
    // second merges; choosing another record disarms it
    $doc.on('change.storyArcKnowledge', '.story-arc-merge-target', function () {
        disarmMergeButton($(this).closest('.story-arc-knowledge-item'));
    });
    $doc.on('click.storyArcKnowledge', '.story-arc-merge-btn', async function () {
        const $button = $(this);
        const $item = $button.closest('.story-arc-knowledge-item');
        const $target = $item.find('.story-arc-merge-target');
        if (!$button.hasClass('armed')) {
            const targetName = $target.find('option:selected').text();
            $button.addClass('armed').html(`<i class="fa-solid fa-code-merge"></i> Really merge into ${escapeHtml(targetName)}?`);
            return;
        }
        // Disarmed before the save, so a quick second click cannot merge again.
        disarmMergeButton($item);
        const otherId = String($item.data('character-id'));
        const mainId = String($target.val());
        await saveLedgerEdit(mergeCharacters(getKnowledgeLedger(), mainId, otherId));
    });

    // Fact: add
    $doc.on('click.storyArcKnowledge', '.story-arc-fact-add-btn', async function () {
        const $form = $(this).closest('.story-arc-knowledge-add');
        const storedLedger = getKnowledgeLedger();
        const fact = {
            id: nextLedgerId('f', storedLedger.facts),
            text: String($form.find('.story-arc-new-fact-text').val()),
            holderIds: $form.find('.story-arc-new-fact-holder:checked').map((index, element) => element.value).get(),
        };
        await saveLedgerEdit(addFact(storedLedger, fact));
    });

    // Fact: save text and public flag
    $doc.on('click.storyArcKnowledge', '.story-arc-fact-save-btn', async function () {
        const $item = $(this).closest('.story-arc-knowledge-item');
        const factId = String($item.data('fact-id'));
        const text = String($item.find('.story-arc-fact-text-input').val());
        const isPublic = $item.find('.story-arc-fact-public-input').is(':checked');

        const edited = editFactText(getKnowledgeLedger(), factId, text);
        if (edited.error) {
            toastr.warning(edited.error);
            return;
        }
        await saveLedgerEdit(setFactPublic(edited.ledger, factId, isPublic));
    });

    // Fact: delete — the first click arms the button, the second deletes
    $doc.on('click.storyArcKnowledge', '.story-arc-fact-delete-btn', async function () {
        const $button = $(this);
        if (!$button.hasClass('armed')) {
            $button.addClass('armed').html('<i class="fa-solid fa-trash"></i> Really delete?');
            return;
        }
        const factId = String($button.closest('.story-arc-knowledge-item').data('fact-id'));
        await saveLedgerEdit(deleteFact(getKnowledgeLedger(), factId));
    });

    // Fact: add a holder
    $doc.on('click.storyArcKnowledge', '.story-arc-holder-add-btn', async function () {
        const $item = $(this).closest('.story-arc-knowledge-item');
        const factId = String($item.data('fact-id'));
        const characterId = String($item.find('.story-arc-holder-select').val());
        await saveLedgerEdit(addFactHolder(getKnowledgeLedger(), factId, characterId));
    });

    // Fact: remove a holder
    $doc.on('click.storyArcKnowledge', '.story-arc-holder-remove-btn', async function () {
        const factId = String($(this).closest('.story-arc-knowledge-item').data('fact-id'));
        const characterId = String($(this).data('character-id'));
        await saveLedgerEdit(removeFactHolder(getKnowledgeLedger(), factId, characterId));
    });

    // Close
    $doc.on('click.storyArcKnowledge', '#story-arc-knowledge-close', () => {
        if (typeof popup?.complete === 'function') {
            popup.complete(0);
        }
    });
}

/** Put an armed Merge button of this character back to its unarmed label */
function disarmMergeButton($item) {
    $item.find('.story-arc-merge-btn').removeClass('armed').html('<i class="fa-solid fa-code-merge"></i> Merge');
}

/** The aliases typed into a comma-separated field */
function splitAliases(text) {
    return String(text || '').split(',');
}

/**
 * Store the result of a ledger edit and redraw the popup, or show why the
 * edit was refused. The edited lists are copied onto the stored ledger rather
 * than replacing it, because another module (the extraction) may hold that
 * object across an await; it then keeps writing into the stored ledger.
 * @param {{ ledger: object|null, error: string|null }} result
 */
export async function saveLedgerEdit({ ledger, error }) {
    if (error) {
        toastr.warning(error);
        return;
    }

    const storedLedger = getKnowledgeLedger();
    storedLedger.characters = ledger.characters;
    storedLedger.facts = ledger.facts;
    // A merge also changes the scenes and the retracted facts; a ledger
    // without them (an old one) leaves the stored ones alone.
    if (ledger.scene !== undefined) storedLedger.scene = ledger.scene;
    if (ledger.sceneHistory !== undefined) storedLedger.sceneHistory = ledger.sceneHistory;
    if (ledger.retractedFacts !== undefined) storedLedger.retractedFacts = ledger.retractedFacts;
    await saveMetadata();
    refreshKnowledgePopup();
    // The status line counts the flagged characters; an edit here may clear one.
    updateKnowledgeStatus();
}

function refreshKnowledgePopup() {
    const $knowledge = $('#story-arc-knowledge');
    if (!$knowledge.length) return;

    // Keep open spoilers open; a rebuild would close them after every edit.
    const openSpoilerIds = $knowledge.find('.story-arc-spoiler-content.open').map((index, element) => element.id).get();

    $knowledge.replaceWith(buildKnowledgeContent(getKnowledgeLedger(), chat, isCharacterDetailsEnabled()));

    for (const id of openSpoilerIds) {
        $(`#${id}`).addClass('open');
        $(`.story-arc-spoiler-toggle[data-spoiler-target="${id}"]`).addClass('open');
    }
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
