/**
 * @file Context harvesting orchestrator
 * @module context/harvester
 *
 * Gathers all story context for arc planning:
 * character, persona, lorebooks, chat history, existing arcs, user input.
 */

import { characters, chat_metadata, substituteParams, this_chid } from '/script.js';
import { extension_settings, getContext } from '/scripts/extensions.js';
import { getSortedEntries } from '/scripts/world-info.js';
import { getRecentChat, estimateTokens } from './chat-history.js';
import { getActiveArcs, getArcs } from '../planning/storage.js';
import { arcInternalIds } from '../injection/signals.js';
import { INJECTION_HEADER } from '../core/constants.js';
import { isEnabled, isKnowledgeTrackerEnabled, isCharacterDetailsEnabled, getKnowledgeLedger } from '../core/settings.js';
import { characterDetailTexts } from '../knowledge/ledger.js';

/**
 * @typedef {object} HarvestedContext
 * @property {object|null} character - Character card data
 * @property {object} persona - User persona data
 * @property {{ constants: object[], arcSummaries: object[], recent: object[] }} lorebook
 * @property {object[]} chatHistory - Recent messages
 * @property {object[]} existingArcs - Currently active arc plans
 * @property {{ name: string, aliases: string[], details: Record<string, string> }[]} cast - The
 *   knowledge ledger's characters with their current details, in ledger order, while
 *   Story Arc and the knowledge tracker are on; empty otherwise
 * @property {number} estimatedTokens - Rough token estimate of all context
 */

/**
 * Harvest all available context for arc planning.
 * @param {number} [chatDepth=50] - How many recent messages to include
 * @param {Set<string>} [excludeEntryIds] - Lorebook entry UIDs to exclude
 * @returns {Promise<HarvestedContext>}
 */
export async function harvestContext(chatDepth = 50, excludeEntryIds = new Set()) {
    const lorebookEntries = await fetchRawLorebookEntries();

    // An excluded entry is never evaluated: its setvars would run for nothing.
    const filteredEntries = excludeEntryIds.size > 0
        ? lorebookEntries.filter(entry => !excludeEntryIds.has(String(entry.uid)))
        : lorebookEntries;
    const rawCharacter = getCharacterData();
    const rawPersona = getPersonaData();

    // One pass in reading order, card, persona, lorebook, so a setvar in an
    // earlier text reaches a getvar or {{if}} in a later one.
    const cardTexts = rawCharacter ? [rawCharacter.description, rawCharacter.personality, rawCharacter.scenario] : [];
    const resolved = resolveMacros([...cardTexts, rawPersona.description, ...filteredEntries.map(entry => entry.content)]);
    const character = rawCharacter && { ...rawCharacter, description: resolved[0], personality: resolved[1], scenario: resolved[2] };
    const persona = { ...rawPersona, description: resolved[cardTexts.length] };
    const entryTexts = resolved.slice(cardTexts.length + 1);
    const lorebook = categorizeEntries(filteredEntries.map((entry, index) => ({ ...entry, content: entryTexts[index] })));

    const chatHistory = selectStoryMessages(getRecentChat(chatDepth), getArcs());

    const existingArcs = getActiveArcs();
    const cast = harvestCast();

    const castText = cast.map(member => [member.name, ...member.aliases].join(' ')).join('\n');
    const characterText = character ? `${character.description}\n${character.personality}\n${character.scenario}` : '';
    const parts = [
        characterText,
        persona.description,
        ...lorebook.constants.map(entry => entry.content),
        ...lorebook.arcSummaries.map(entry => entry.content),
        ...lorebook.recent.map(entry => entry.content),
        ...chatHistory.map(message => message.content),
    ];
    if (castText) parts.push(castText);
    const totalText = parts.join('\n');
    const estimatedTokens = estimateTokens(totalText);

    return {
        character,
        persona,
        lorebook,
        chatHistory,
        existingArcs,
        cast,
        estimatedTokens,
    };
}

/**
 * Resolve SillyTavern's macros in texts as ST does when it builds a prompt
 * (issue #89): `{{user}}`, `{{char}}` and the rest, and with ST's macro
 * engine switched on also `{{if}}`, scoped macros and variable shorthands.
 * substituteParams picks the engine the user has chosen.
 *
 * ST has no evaluation without side effects: setvar, incvar and their kin
 * write while a text is evaluated, so a setvar in an earlier text reaches a
 * getvar in a later one. Afterwards the chat's variables
 * (`chat_metadata.variables`) and the global ones
 * (`extension_settings.variables`) are put back as they were: the harvest
 * reads every enabled lorebook entry, also those ST would not activate this
 * turn, and its evaluation is no turn of the story. substituteParams is
 * synchronous, so no other code runs between the snapshot and the restore.
 *
 * A text whose macros throw, or that gives back no string, stays as written.
 * Chat messages are never passed here: ST does not resolve them either.
 * @param {string[]} texts - In the order ST would read them
 * @returns {string[]} The resolved texts, one per text given
 */
export function resolveMacros(texts) {
    const savedChatVariables = snapshotProperty(chat_metadata, 'variables');
    const savedGlobalVariables = snapshotProperty(extension_settings, 'variables');
    try {
        return texts.map(resolveMacroText);
    } finally {
        restoreProperty(chat_metadata, 'variables', savedChatVariables);
        restoreProperty(extension_settings, 'variables', savedGlobalVariables);
    }
}

/**
 * One text through substituteParams; the text as written when it has no
 * macro or its macros fail.
 * @param {string} text
 * @returns {string}
 */
function resolveMacroText(text) {
    if (typeof text !== 'string' || !text.includes('{{')) return text;
    try {
        const result = substituteParams(text);
        if (typeof result === 'string') return result;
        console.warn('[Story Arc] Macro substitution gave no text; the text is kept as written');
    } catch (err) {
        console.warn('[Story Arc] Macros in a harvested text failed; the text is kept as written:', err?.message ?? err);
    }
    return text;
}

/**
 * @param {object} owner
 * @param {string} key
 * @returns {{ present: boolean, value?: any }} A deep copy of owner[key], if it has one
 */
function snapshotProperty(owner, key) {
    return key in owner ? { present: true, value: structuredClone(owner[key]) } : { present: false };
}

/**
 * Put owner[key] back to a snapshot: the copy, or no key at all.
 * @param {object} owner
 * @param {string} key
 * @param {{ present: boolean, value?: any }} saved - From snapshotProperty
 */
function restoreProperty(owner, key, saved) {
    if (saved.present) owner[key] = saved.value;
    else delete owner[key];
}

/**
 * The cast the planner sees: the knowledge ledger's characters with their
 * aliases and their current character details, in ledger order. Only while
 * Story Arc and the knowledge tracker are on; with the tracker off the
 * planner's prompts stay as they were (ADR-0007). The details are each
 * known kind's current value as text, a relation with the other
 * character's name (characterDetailTexts), in DETAIL_KINDS order, never
 * an appearance kind: the planner sees no appearance. While
 * character details are off they are empty, as in the knowledge block:
 * the details the ledger still holds are no longer kept up to date. The
 * plan check holds the plan to them (ADR-0009 amendment).
 * @returns {{ name: string, aliases: string[], details: Record<string, string> }[]}
 */
function harvestCast() {
    if (!isEnabled() || !isKnowledgeTrackerEnabled()) return [];
    const ledger = getKnowledgeLedger();
    const withDetails = isCharacterDetailsEnabled();
    const ledgerCharacters = ledger.characters ?? [];
    // An unnamed relative has no name for a plan to use or to avoid.
    const namedCharacters = ledgerCharacters.filter(character => String(character.name ?? '').trim());
    return namedCharacters.map(character => ({
        name: character.name,
        aliases: [...(character.aliases ?? [])],
        details: withDetails ? characterDetailTexts(ledger, character) : {},
    }));
}

/**
 * Drop the messages that carry plan internals instead of story: any message
 * naming an id of a stored arc (of any status), quoting the injection header
 * or holding a signal marker. A narrator's OOC analysis that printed a secret
 * beside its id was read by the planner as story fact, and the secret came
 * back as a milestone pressure (Paragon chat, 2026-10-30). Other OOC messages
 * stay: the user's own direction belongs in the planner's input.
 * @param {{ role: string, name: string, content: string }[]} messages
 * @param {object[]} arcs - Every stored arc of the chat
 * @returns {{ role: string, name: string, content: string }[]}
 */
function selectStoryMessages(messages, arcs) {
    const planMarkers = [...arcInternalIds(arcs), INJECTION_HEADER, 'ARC_SIGNAL'];
    return messages.filter(message => !planMarkers.some(marker => message.content.includes(marker)));
}

/*
 * Lorebook / World Info adapter.
 *
 * Fetches the world info entries ST itself would scan for the current chat:
 * chat lorebook, persona lore, character lore and global books, via ST's
 * getSortedEntries(). getContext() exposes no worldInfo, and the HTTP
 * /api/worldinfo endpoints need a CSRF token and return every book on
 * the server rather than the ones bound to this chat.
 */

/**
 * @typedef {object} LorebookEntry
 * @property {number} uid - Entry id, unique within its book
 * @property {string} comment - Display name / label
 * @property {string} content - The lorebook entry text
 * @property {string[]} key - Trigger keywords
 * @property {boolean} constant - Always active (not keyword-triggered)
 * @property {boolean} disable - Entry is disabled
 * @property {number} order - Sort order
 * @property {string} world - Which lorebook this came from
 */

/**
 * Fetch all enabled lorebook entries for the current chat, their macros
 * resolved (resolveMacros), for the readers other than the harvest (the
 * standing state seed, the appearance search). Copies: ST's entries are
 * never changed.
 * @returns {Promise<LorebookEntry[]>}
 */
export async function fetchLorebookEntries() {
    const entries = await fetchRawLorebookEntries();
    const texts = resolveMacros(entries.map(entry => entry.content));
    return entries.map((entry, index) => ({ ...entry, content: texts[index] }));
}

/**
 * Fetch all enabled lorebook entries for the current chat as ST holds them,
 * macros unresolved. The harvest resolves them together with the card and
 * the persona.
 * @returns {Promise<LorebookEntry[]>}
 */
async function fetchRawLorebookEntries() {
    try {
        const sortedEntries = await getSortedEntries();
        return filterAndSort(sortedEntries);
    } catch (err) {
        console.error('[Story Arc] Lorebook fetch failed:', err);
        return [];
    }
}

/**
 * Filter out disabled entries and sort by order
 * @param {LorebookEntry[]} entries
 * @returns {LorebookEntry[]}
 */
export function filterAndSort(entries) {
    return entries
        .filter(entry => !entry.disable)
        .sort((firstEntry, secondEntry) => (firstEntry.order || 100) - (secondEntry.order || 100));
}

/**
 * Categorize lorebook entries into constants, arc summaries, and recent memories.
 * @param {LorebookEntry[]} entries - Filtered, sorted entries
 * @returns {{ constants: LorebookEntry[], arcSummaries: LorebookEntry[], recent: LorebookEntry[] }}
 */
export function categorizeEntries(entries) {
    const constants = [];
    const arcSummaries = [];
    const recent = [];

    for (const entry of entries) {
        if (entry.constant) {
            constants.push(entry);
        } else if (/\[ARC\s/i.test(entry.comment || '')) {
            arcSummaries.push(entry);
        } else {
            recent.push(entry);
        }
    }

    return { constants, arcSummaries, recent };
}

/**
 * Get current character card data
 * @returns {{ name: string, description: string, personality: string, scenario: string } | null}
 */
function getCharacterData() {
    if (this_chid === undefined || this_chid === null) {
        console.warn('[Story Arc] No character selected');
        return null;
    }
    const char = characters[this_chid];
    if (!char) return null;

    return {
        name: char.name || '',
        description: char.description || '',
        personality: char.personality || '',
        scenario: char.scenario || '',
    };
}

/**
 * Get user persona name and description. The active persona's description
 * lives in the power-user settings; ST's context has no persona field.
 * @returns {{ name: string, description: string }}
 */
function getPersonaData() {
    const context = getContext();
    return {
        name: context.name1 || 'User',
        description: context.powerUserSettings?.persona_description || '',
    };
}
