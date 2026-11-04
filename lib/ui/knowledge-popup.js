/**
 * @file Knowledge popup — view and correct the knowledge ledger by hand
 * @module ui/knowledge-popup
 *
 * Opened from the Arc Manager and the wand menu (ADR-0007). Lists the
 * ledger's characters (add, rename, aliases) and facts with their holders
 * (add, edit text, delete, add or remove a holder, mark public). The content
 * sits behind closed spoiler toggles, because it shows who holds the arcs'
 * secrets. Every holder entry created here is user-entered
 * (`how: 'user'`, `at: null`), which survives every rollback.
 */

import { Popup, POPUP_TYPE } from '/scripts/popup.js';
import { delay, escapeHtml } from '/scripts/utils.js';
import { saveMetadata } from '/script.js';
import { getKnowledgeLedger } from '../core/settings.js';
import { HOLDER_HOW } from '../core/constants.js';
import { characterName, nextLedgerId } from '../knowledge/ledger.js';
import { buildSpoilerGroup } from './spoiler-group.js';

/**
 * Show the knowledge popup for the current chat.
 */
export async function showKnowledgePopup() {
    const html = buildKnowledgeContent(getKnowledgeLedger());

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
 * The popup body: characters and facts, each in a spoiler group that starts
 * closed, because the ledger shows who holds the arcs' secrets.
 * @param {object} ledger - The knowledge ledger
 * @returns {string} HTML string
 */
export function buildKnowledgeContent(ledger) {
    let html = `<div class="story-arc-knowledge" id="story-arc-knowledge">`;
    html += `<div class="story-arc-section-header"><i class="fa-solid fa-user-secret"></i> Who Knows What</div>`;

    const characterRowsHtml = ledger.characters.map(character => buildCharacterRow(character)).join('');
    const charactersBodyHtml = `
        <ul class="story-arc-knowledge-list">${characterRowsHtml}</ul>
        ${buildAddCharacterForm()}`;
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

function buildCharacterRow(character) {
    const aliasesText = character.aliases.length > 0
        ? `<span class="story-arc-muted">also: ${escapeHtml(character.aliases.join(', '))}</span>`
        : '';

    return `
    <li class="story-arc-knowledge-item" data-character-id="${escapeHtml(character.id)}">
        <span class="story-arc-knowledge-text">${escapeHtml(character.name)}</span>
        ${aliasesText}
        <div class="story-arc-knowledge-edit-btn" title="Edit character"><i class="fa-solid fa-pen"></i></div>
        <div class="story-arc-knowledge-editor">
            <label>Name</label>
            <input type="text" class="text_pole story-arc-knowledge-name-input" value="${escapeHtml(character.name)}">
            <label>Aliases <small>(comma-separated)</small></label>
            <input type="text" class="text_pole story-arc-knowledge-aliases-input" value="${escapeHtml(character.aliases.join(', '))}">
            <div class="story-arc-knowledge-editor-actions">
                <div class="story-arc-btn story-arc-character-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save</div>
                <div class="story-arc-btn story-arc-knowledge-cancel-btn">Cancel</div>
            </div>
        </div>
    </li>`;
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
        .map(character => `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)}</option>`)
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
            <span>${escapeHtml(character.name)}</span>
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
    $doc.on('click.storyArcKnowledge', '.story-arc-knowledge-edit-btn, .story-arc-knowledge-cancel-btn', function () {
        const $item = $(this).closest('.story-arc-knowledge-item');
        $item.toggleClass('editing');
        $item.find('.story-arc-fact-delete-btn').removeClass('armed').html('<i class="fa-solid fa-trash"></i> Delete');
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
async function saveLedgerEdit({ ledger, error }) {
    if (error) {
        toastr.warning(error);
        return;
    }

    const storedLedger = getKnowledgeLedger();
    storedLedger.characters = ledger.characters;
    storedLedger.facts = ledger.facts;
    await saveMetadata();
    refreshKnowledgePopup();
}

function refreshKnowledgePopup() {
    const $knowledge = $('#story-arc-knowledge');
    if (!$knowledge.length) return;

    // Keep open spoilers open; a rebuild would close them after every edit.
    const openSpoilerIds = $knowledge.find('.story-arc-spoiler-content.open').map((index, element) => element.id).get();

    $knowledge.replaceWith(buildKnowledgeContent(getKnowledgeLedger()));

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
        if (characterWithName) return `"${name}" is already a name of ${characterWithName.name}.`;
    }
    return null;
}

/**
 * Rename a character. The id stays, so their facts stay theirs. Clears
 * the reused-name flag (withoutNameClash).
 * @param {object} ledger - The knowledge ledger, left untouched
 * @param {string} characterId
 * @param {string} name
 * @returns {{ ledger: object|null, error: string|null }}
 */
export function renameCharacter(ledger, characterId, name) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return { ledger: null, error: 'A character needs a name.' };

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
