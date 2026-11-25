/**
 * @file Context harvesting orchestrator
 * @module context/harvester
 *
 * Gathers all story context for arc planning:
 * character, persona, lorebooks, chat history, existing arcs, user input.
 */

import { characters, chat_metadata, getCharacterCardFieldsLazy, substituteParams, this_chid } from '/script.js';
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
    const lorebookEntries = await fetchLorebookEntries();

    // An excluded entry is never evaluated: its setvars would run for nothing.
    const filteredEntries = excludeEntryIds.size > 0
        ? lorebookEntries.filter(entry => !excludeEntryIds.has(String(entry.uid)))
        : lorebookEntries;
    const { character, persona, entries } = resolveHarvestMacros(getCharacterData(), getPersonaData(), filteredEntries);
    const lorebook = categorizeEntries(entries);

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
 * Resolve SillyTavern's macros in what the planner reads of the card, the
 * persona and the lorebook, as ST resolves them for the narrator's prompt
 * (issue #89): `{{user}}`, `{{char}}` and the rest, and with ST's macro
 * engine switched on also `{{if}}`, scoped macros and variable shorthands.
 * The card fields and the persona come from ST's own getCharacterCardFieldsLazy
 * (trimmed, the chat's scenario override, group cards), each entry goes
 * through substituteParams as in ST's world info scan. Chat messages are
 * never resolved: ST does not resolve them either.
 *
 * ST has no evaluation without side effects: setvar, incvar and their kin
 * write while a text is evaluated. In reading order, card, persona, then the
 * entries, a write in the card, the persona or a constant entry reaches the
 * texts after it, since ST evaluates those every turn. A keyword entry's
 * writes are taken back after it: the harvest reads every enabled entry,
 * also those ST would not activate this turn, and one ST never activated
 * must not decide another's `{{if}}`. Afterwards the chat's and the global
 * variables are as they were. Everything here is synchronous, so no other
 * code runs between the snapshot and the restore.
 *
 * A text whose macros throw, or that gives back no string, stays as written.
 * @param {{ name: string, description: string, personality: string, scenario: string } | null} character - As written
 * @param {{ name: string, description: string }} persona - As written
 * @param {LorebookEntry[]} entries - ST's entries, never changed
 * @returns {{ character: object|null, persona: object, entries: LorebookEntry[] }} Copies with macros resolved
 */
function resolveHarvestMacros(character, persona, entries) {
    return withVariablesRestored(() => {
        const cardFields = getCharacterCardFieldsLazy();
        const resolvedCharacter = character && {
            ...character,
            description: resolveOrKeep(() => cardFields.description, character.description),
            personality: resolveOrKeep(() => cardFields.personality, character.personality),
            scenario: resolveOrKeep(() => cardFields.scenario, character.scenario),
        };
        const resolvedPersona = { ...persona, description: resolveOrKeep(() => cardFields.persona, persona.description) };
        const resolvedEntries = entries.map(entry => {
            const content = entry.constant
                ? resolveEntryContent(entry.content)
                : withVariablesRestored(() => resolveEntryContent(entry.content));
            return { ...entry, content };
        });
        return { character: resolvedCharacter, persona: resolvedPersona, entries: resolvedEntries };
    });
}

/**
 * Run evaluate and put the chat's variables (`chat_metadata.variables`) and
 * the global ones (`extension_settings.variables.global`) back as they were,
 * in place: an extension holding the store object keeps the live one. A
 * store that did not exist is removed again.
 * @template T
 * @param {() => T} evaluate - Synchronous
 * @returns {T}
 */
function withVariablesRestored(evaluate) {
    const savedChatVariables = snapshotStore(chat_metadata, 'variables');
    const savedGlobalVariables = extension_settings.variables ? snapshotStore(extension_settings.variables, 'global') : null;
    try {
        return evaluate();
    } finally {
        restoreStore(savedChatVariables);
        if (savedGlobalVariables) restoreStore(savedGlobalVariables);
    }
}

/**
 * @param {object} owner
 * @param {string} key
 * @returns {{ owner: object, key: string, store: object|undefined, copy: object|undefined }}
 */
function snapshotStore(owner, key) {
    const store = owner[key];
    return { owner, key, store, copy: store === undefined ? undefined : structuredClone(store) };
}

/**
 * Put a store back to its snapshot on the same object, or remove it when
 * there was none.
 * @param {{ owner: object, key: string, store: object|undefined, copy: object|undefined }} saved - From snapshotStore
 */
function restoreStore(saved) {
    if (saved.store === undefined) {
        delete saved.owner[saved.key];
        return;
    }
    for (const name of Object.keys(saved.store)) {
        if (!(name in saved.copy)) delete saved.store[name];
    }
    Object.assign(saved.store, saved.copy);
    saved.owner[saved.key] = saved.store;
}

/**
 * One entry's content through substituteParams, as ST's world info scan
 * does; as written when it holds no macro.
 * @param {string} content
 * @returns {string}
 */
function resolveEntryContent(content) {
    if (typeof content !== 'string' || !content.includes('{{')) return content;
    return resolveOrKeep(() => substituteParams(content), content);
}

/**
 * The resolved text, or the text as written when resolving throws or gives
 * back no string.
 * @param {() => string} resolve
 * @param {string} written
 * @returns {string}
 */
function resolveOrKeep(resolve, written) {
    try {
        const resolved = resolve();
        if (typeof resolved === 'string') return resolved;
        console.warn('[Story Arc] Macro substitution gave no text; the text is kept as written');
    } catch (err) {
        console.warn('[Story Arc] Macros in a harvested text failed; the text is kept as written:', err?.message ?? err);
    }
    return written;
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
 * Fetch all enabled lorebook entries for the current chat, macros as
 * written: only the harvest resolves them (resolveHarvestMacros).
 * @returns {Promise<LorebookEntry[]>}
 */
export async function fetchLorebookEntries() {
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
