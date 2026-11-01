/**
 * Story Arc - Knowledge ledger
 *
 * The knowledge tracker's process (ADR-0007): which character knows which
 * fact, and how they learned it. The ledger lives at
 * chat_metadata.story_arc.knowledge; its shape is documented at
 * createEmptyKnowledgeLedger in lib/core/constants.js.
 */

import { callLlm, fillTemplate, loadTemplate } from '../planning/generator.js';
import { parseLlmJson } from '../planning/validation.js';

// ─── Extraction ───

/**
 * Ask the LLM who learned what in the messages from `fromIndex` on. The call
 * goes through the arc generation connection profile and the transport the
 * plan check uses. A failed call or an unreadable answer returns null, and
 * the caller changes nothing: the next update covers the same messages again.
 * @param {object} ledger - The chat's knowledge ledger
 * @param {object[]} chatMessages - ST's chat array (`name`, `is_user`, `mes`, `is_system`)
 * @param {number} fromIndex - First message the extraction reads
 * @param {string} personaName - The player's persona name
 * @returns {Promise<{present: string[], newCharacters: object[], learned: object[]}|null>}
 */
export async function extractKnowledge(ledger, chatMessages, fromIndex, personaName) {
    try {
        const template = await loadTemplate('extract-knowledge.txt');
        const prompt = fillTemplate(template, buildKnowledgeExtractionVariables(ledger, chatMessages, fromIndex, personaName));
        const response = await callLlm(prompt);
        const answer = parseKnowledgeExtractionAnswer(response);
        if (!answer) {
            console.warn('[Story Arc] Knowledge extraction answered no readable JSON; the ledger stays as it is');
        }
        return answer;
    } catch (err) {
        console.warn('[Story Arc] Knowledge extraction failed; the ledger stays as it is:', err);
        return null;
    }
}

/**
 * Template variables for extract-knowledge.txt: the persona's name, the
 * ledger's characters with their aliases, the facts by id with their holders
 * (or "public"), and the messages from `fromIndex` on, each with its index.
 * Hidden (system) messages are not story and are left out.
 * @param {object} ledger
 * @param {object[]} chatMessages - ST's chat array
 * @param {number} fromIndex
 * @param {string} personaName
 * @returns {Record<string, string>}
 */
export function buildKnowledgeExtractionVariables(ledger, chatMessages, fromIndex, personaName) {
    const characterLines = ledger.characters.map(character => {
        const aliasNote = character.aliases.length ? ` (also: ${character.aliases.join(', ')})` : '';
        return `- ${character.name}${aliasNote}`;
    });

    const characterNames = new Map(ledger.characters.map(character => [character.id, character.name]));
    const factLines = ledger.facts.map(fact => {
        if (fact.public) return `- [${fact.id}] ${fact.text} (public)`;
        const holderNames = fact.holders
            .map(holder => characterNames.get(holder.characterId))
            .filter(Boolean);
        const holderNote = holderNames.length ? `known to: ${holderNames.join(', ')}` : 'known to no one';
        return `- [${fact.id}] ${fact.text} (${holderNote})`;
    });

    const messageLines = [];
    for (let index = fromIndex; index < chatMessages.length; index++) {
        const message = chatMessages[index];
        if (!message || message.is_system) continue;
        messageLines.push(`[${index}] ${message.name}: ${message.mes || ''}`);
    }

    return {
        PERSONA: personaName || '(no persona)',
        CHARACTERS: characterLines.join('\n') || '(none)',
        FACTS: factLines.join('\n') || '(none)',
        MESSAGES: messageLines.join('\n\n'),
    };
}

/** How a character can learn a fact on-screen, as the extraction reports it. */
const EXTRACTION_HOW_VALUES = ['witnessed', 'told'];

/**
 * Read the extraction's answer text into the shape applying an answer takes:
 *
 *     { present: [name],
 *       newCharacters: [{ name, aliases: [name] }],
 *       learned: [{ factId | text, public, who: [name], how: 'witnessed' | 'told',
 *                   toldBy: name | null, at: messageIndex }] }
 *
 * The answer is taken whole or not at all: unreadable JSON, a missing key or
 * a value of the wrong type gives null, so a half-understood answer never
 * reaches the ledger. Keys outside the shape are dropped. Names and fact ids
 * are not checked against the ledger here; applying the answer ignores
 * unknown ones.
 * @param {string} responseText - The LLM's answer
 * @returns {{present: string[], newCharacters: object[], learned: object[]}|null}
 */
export function parseKnowledgeExtractionAnswer(responseText) {
    const parsed = parseLlmJson(responseText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!isListOfNames(parsed.present)) return null;
    if (!Array.isArray(parsed.newCharacters) || !Array.isArray(parsed.learned)) return null;

    const newCharacters = [];
    for (const character of parsed.newCharacters) {
        if (!isName(character?.name) || !isListOfNames(character.aliases)) return null;
        newCharacters.push({ name: character.name, aliases: character.aliases });
    }

    const learned = [];
    for (const item of parsed.learned) {
        if (!item || typeof item !== 'object') return null;
        if (typeof item.public !== 'boolean') return null;
        if (!isListOfNames(item.who)) return null;
        if (!EXTRACTION_HOW_VALUES.includes(item.how)) return null;
        if (item.toldBy !== null && !isName(item.toldBy)) return null;
        if (!Number.isInteger(item.at)) return null;

        // A known fact is named by its id, a new one by its text.
        if (item.factId !== undefined && !isName(item.factId)) return null;
        let fact = null;
        if (isName(item.factId)) {
            fact = { factId: item.factId };
        } else if (isName(item.text)) {
            fact = { text: item.text };
        } else {
            return null;
        }

        learned.push({
            ...fact,
            public: item.public,
            who: item.who,
            how: item.how,
            toldBy: item.toldBy,
            at: item.at,
        });
    }

    return { present: parsed.present, newCharacters, learned };
}

/** A non-blank string: a character name, a fact id or a fact text. */
function isName(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function isListOfNames(value) {
    return Array.isArray(value) && value.every(isName);
}

// ─── Apply an extraction answer ───

/**
 * Apply a parsed extraction answer to the ledger and return the new ledger.
 *
 * Answer shape:
 *
 *     present: [name]
 *     newCharacters: [{ name, aliases: [name] }]
 *     learned: [{ factId | text, public, who: [name], how: 'witnessed' | 'told',
 *                 toldBy: name | null, at: messageIndex }]
 *
 * New characters are added first, so the rest of the answer can name them.
 * Names are matched case-insensitively against names and aliases. A learned
 * item with a known fact id adds holders to that fact; one with text creates
 * a fact. Names that are neither known nor new, and unknown fact ids, are
 * ignored. `present` replaces the scene, and lastUpdatedAt becomes the
 * message index.
 *
 * @param {object} ledger - The current ledger; not changed
 * @param {object} answer - The parsed extraction answer
 * @param {number} messageIndex - The last message the answer covers
 * @returns {object} The updated ledger
 */
export function applyExtractionAnswer(ledger, answer, messageIndex) {
    const characters = ledger.characters.map(character => ({ ...character, aliases: [...character.aliases] }));
    const facts = ledger.facts.map(fact => ({ ...fact, holders: [...fact.holders] }));

    const newCharacters = Array.isArray(answer.newCharacters) ? answer.newCharacters : [];
    for (const newCharacter of newCharacters) {
        const name = String(newCharacter?.name || '').trim();
        if (!name || findCharacterId(characters, name)) continue;
        const aliases = Array.isArray(newCharacter.aliases)
            ? newCharacter.aliases.map(alias => String(alias || '').trim()).filter(Boolean)
            : [];
        characters.push({ id: nextLedgerId('c', characters), name, aliases });
    }

    const learned = Array.isArray(answer.learned) ? answer.learned : [];
    for (const item of learned) {
        const who = Array.isArray(item?.who) ? item.who : [];
        const holderIds = [];
        for (const name of who) {
            const characterId = findCharacterId(characters, name);
            if (characterId && !holderIds.includes(characterId)) holderIds.push(characterId);
        }
        if (holderIds.length === 0) continue;

        let fact;
        if (item.factId) {
            fact = facts.find(candidate => candidate.id === item.factId);
            if (!fact) continue;
        } else {
            const text = String(item.text || '').trim();
            if (!text) continue;
            fact = { id: nextLedgerId('f', facts), text, public: item.public === true, holders: [] };
            facts.push(fact);
        }

        const how = item.how === 'told' ? 'told' : 'witnessed';
        const toldBy = how === 'told' ? findCharacterId(characters, item.toldBy) : null;
        // An index outside the covered messages would escape the rollback
        // from message N on, so it falls back to the answer's own index.
        const at = Number.isInteger(item.at) && item.at >= 0 && item.at <= messageIndex ? item.at : messageIndex;
        for (const characterId of holderIds) {
            if (fact.holders.some(holder => holder.characterId === characterId)) continue;
            fact.holders.push({ characterId, how, toldBy, at });
        }
    }

    const present = [];
    const presentNames = Array.isArray(answer.present) ? answer.present : [];
    for (const name of presentNames) {
        const characterId = findCharacterId(characters, name);
        if (characterId && !present.includes(characterId)) present.push(characterId);
    }

    return {
        ...ledger,
        characters,
        facts,
        scene: { at: messageIndex, present },
        lastUpdatedAt: messageIndex,
    };
}

/**
 * Find the character a name refers to, by name or alias, ignoring case.
 * @param {Array} characters - The ledger's characters
 * @param {string} name - A name as the extraction wrote it
 * @returns {string|null} The character's id, or null for an unknown name
 */
function findCharacterId(characters, name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    const character = characters.find(candidate =>
        candidate.name.toLowerCase() === wanted
        || candidate.aliases.some(alias => alias.toLowerCase() === wanted));
    return character ? character.id : null;
}

/**
 * The next free id of a ledger list: the prefix and one more than the highest
 * number in use, so a new id never collides with an entry still in the list,
 * even after a rollback dropped some. Short ids keep the extraction prompt small.
 * @param {string} prefix - 'c' for characters, 'f' for facts
 * @param {Array} entries - The list the id is for
 * @returns {string}
 */
function nextLedgerId(prefix, entries) {
    let highest = 0;
    for (const entry of entries) {
        const match = new RegExp(`^${prefix}(\\d+)$`).exec(String(entry.id));
        if (match) highest = Math.max(highest, Number(match[1]));
    }
    return `${prefix}${highest + 1}`;
}

// ─── Drop from message N ───

/**
 * Take back what the ledger learned from message `firstGoneIndex` on: the
 * user regenerated, swiped or deleted the messages it came from, or loaded a
 * branch that ends before them. Removes every holder entry learned at that
 * message or later, and every fact this leaves without holders. A holder
 * entered by the user (`at: null`) is never removed, so its fact stays.
 * Same pattern as dropPendingMarksFrom for the queued marks.
 * Does not save: the caller saves, and only when this returns true.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {boolean} True when anything in the ledger changed
 */
export function dropKnowledgeFrom(ledger, firstGoneIndex) {
    let changed = false;

    const remainingFacts = [];
    for (const fact of ledger.facts) {
        const remainingHolders = fact.holders.filter(holder => holder.at === null || holder.at < firstGoneIndex);
        if (remainingHolders.length === fact.holders.length) {
            remainingFacts.push(fact);
            continue;
        }
        changed = true;
        // Only the dropped messages taught this fact: the story no longer contains it.
        if (remainingHolders.length === 0) continue;
        fact.holders = remainingHolders;
        remainingFacts.push(fact);
    }
    ledger.facts = remainingFacts;

    // The scene came from a dropped message: nobody is known to be present.
    if (ledger.scene.at !== null && ledger.scene.at >= firstGoneIndex) {
        ledger.scene = { at: null, present: [] };
        changed = true;
    }

    // The ledger now covers only the messages before firstGoneIndex, so the
    // next update reads from there on.
    if (ledger.lastUpdatedAt !== null && ledger.lastUpdatedAt >= firstGoneIndex) {
        const lastKeptIndex = firstGoneIndex - 1;
        ledger.lastUpdatedAt = lastKeptIndex >= 0 ? lastKeptIndex : null;
        changed = true;
    }

    if (changed) {
        console.log(`[Story Arc] Dropped knowledge learned from message #${firstGoneIndex} on`);
    }
    return changed;
}
