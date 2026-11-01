/**
 * Story Arc - Knowledge ledger
 *
 * The knowledge tracker's process (ADR-0007): which character knows which
 * fact, and how they learned it. The ledger lives at
 * chat_metadata.story_arc.knowledge; its shape is documented at
 * createEmptyKnowledgeLedger in lib/core/constants.js.
 */

import { chat, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '/script.js';
import { KNOWLEDGE_PROMPT_KEY } from '../core/constants.js';
import { isEnabled, isKnowledgeTrackerEnabled, getKnowledgeLedger } from '../core/settings.js';
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

        // A known fact is named by its id, a new one by its text. A null on
        // the key not used means "not this one", not a wrong type.
        if (item.factId !== undefined && item.factId !== null && !isName(item.factId)) return null;
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
 * The knowledge popup (ui/knowledge-popup.js) uses it for hand-entered entries.
 * @param {string} prefix - 'c' for characters, 'f' for facts
 * @param {Array} entries - The list the id is for
 * @returns {string}
 */
export function nextLedgerId(prefix, entries) {
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

// ─── Build the knowledge block ───

/** Most lines one character's "Knows", "Does not know" or "Has told" list prints */
export const KNOWLEDGE_LIST_CAP = 5;

const KNOWLEDGE_BLOCK_HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character speaks and acts only from their own list. '
    + 'Knowledge moves between characters only on-screen.]';

/**
 * Build the knowledge block the narrator sees: for the characters in the
 * scene and the characters the latest messages talk about, what each one
 * knows, does not know and (talked about only) has told.
 *
 * Public facts are never printed, because everyone knows them. A holder
 * entry from the plan (how 'plan') is never printed, and a fact held only
 * through the plan is printed nowhere: a secret's text stays in the SECRETS
 * block, which gates it by phase.
 *
 * @param {object} ledger - The knowledge ledger (createEmptyKnowledgeLedger shape)
 * @param {object[]} messages - The chat messages; the latest user message and
 *     the latest reply among them decide who is talked about
 * @returns {string} The block text, or '' when no covered character has a line
 */
export function buildKnowledgeBlock(ledger, messages) {
    if (!ledger || ledger.characters.length === 0) return '';

    const presentCharacters = ledger.characters.filter(character => ledger.scene.present.includes(character.id));
    const latestText = latestUserMessageAndReplyText(messages);
    const talkedAboutCharacters = ledger.characters.filter(character =>
        !ledger.scene.present.includes(character.id) && isNamedInText(character, latestText));
    const coveredIds = [...presentCharacters, ...talkedAboutCharacters].map(character => character.id);

    // Public facts and facts held only through the plan get no line anywhere.
    const printableFacts = ledger.facts.filter(fact =>
        !fact.public && fact.holders.some(holder => holder.how !== 'plan'));

    const sections = [];
    for (const character of presentCharacters) {
        const lines = knowledgeLinesForCharacter(ledger, character, printableFacts, coveredIds, false);
        if (lines.length === 0) continue;
        sections.push([`${character.name.toUpperCase()} (present)`, ...lines].join('\n'));
    }
    for (const character of talkedAboutCharacters) {
        const lines = knowledgeLinesForCharacter(ledger, character, printableFacts, coveredIds, true);
        if (lines.length === 0) continue;
        sections.push([`${character.name.toUpperCase()} (talked about, not present)`, ...lines].join('\n'));
    }
    if (sections.length === 0) return '';

    return [KNOWLEDGE_BLOCK_HEADER, ...sections].join('\n\n');
}

/**
 * The text of the latest user message and the latest reply, joined.
 * Hidden (system) messages are skipped.
 * @param {object[]} messages
 * @returns {string}
 */
function latestUserMessageAndReplyText(messages) {
    let latestUserText = null;
    let latestReplyText = null;
    for (let index = messages.length - 1; index >= 0; index--) {
        const chatMessage = messages[index];
        if (chatMessage.is_system) continue;
        if (chatMessage.is_user && latestUserText === null) latestUserText = chatMessage.mes || '';
        if (!chatMessage.is_user && latestReplyText === null) latestReplyText = chatMessage.mes || '';
        if (latestUserText !== null && latestReplyText !== null) break;
    }
    return `${latestUserText || ''}\n${latestReplyText || ''}`;
}

/**
 * Whether the character's name or one of its aliases appears in the text as
 * a whole word, ignoring case.
 * @param {object} character - A ledger character { id, name, aliases }
 * @param {string} text
 * @returns {boolean}
 */
function isNamedInText(character, text) {
    const names = [character.name, ...(character.aliases || [])].filter(name => name && name.trim());
    return names.some(name => {
        const escapedName = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedName}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
    });
}

/**
 * The "Knows", "Does not know" and (talked about only) "Has told" lines of
 * one character, each list newest first and capped.
 * @param {object} ledger
 * @param {object} character
 * @param {object[]} printableFacts - Facts that may get a line at all
 * @param {string[]} coveredIds - Ids of every character the block covers
 * @param {boolean} isTalkedAbout - Whether the character is talked about, not present
 * @returns {string[]}
 */
function knowledgeLinesForCharacter(ledger, character, printableFacts, coveredIds, isTalkedAbout) {
    const knownEntries = [];
    const unknownEntries = [];
    const toldEntries = [];

    for (const fact of printableFacts) {
        const ownHolder = fact.holders.find(holder => holder.characterId === character.id);
        if (ownHolder && ownHolder.how !== 'plan') {
            knownEntries.push({ at: ownHolder.at, line: knowsLine(ledger, fact, ownHolder) });
        }

        const heldByAnotherCoveredCharacter = fact.holders.some(holder =>
            holder.how !== 'plan' && holder.characterId !== character.id && coveredIds.includes(holder.characterId));
        if (!ownHolder && heldByAnotherCoveredCharacter) {
            unknownEntries.push({ at: newestHolderAt(fact.holders), line: `- Does not know: ${fact.text}` });
        }

        const toldHolders = fact.holders.filter(holder => holder.how === 'told' && holder.toldBy === character.id);
        if (isTalkedAbout && toldHolders.length > 0) {
            const toldNames = toldHolders.map(holder => characterName(ledger, holder.characterId));
            toldEntries.push({
                at: newestHolderAt(toldHolders),
                line: `- Has told only ${joinNames(toldNames)}: ${fact.text}`,
            });
        }
    }

    return [
        ...newestCapped(knownEntries),
        ...newestCapped(unknownEntries),
        ...newestCapped(toldEntries),
    ];
}

/**
 * The "Knows" line of one fact, saying who told the character when they were told.
 * @param {object} ledger
 * @param {object} fact
 * @param {object} holder - The character's own holder entry
 * @returns {string}
 */
function knowsLine(ledger, fact, holder) {
    if (holder.how === 'told' && holder.toldBy) {
        return `- Knows (told by ${characterName(ledger, holder.toldBy)}): ${fact.text}`;
    }
    return `- Knows: ${fact.text}`;
}

/**
 * The message index of the newest holder entry. An entry the user made
 * (at null) counts as newest: a correction must reach the narrator first.
 * @param {object[]} holders
 * @returns {number}
 */
function newestHolderAt(holders) {
    let newestAt = -1;
    for (const holder of holders) {
        if (holder.how === 'plan') continue;
        const holderAt = holder.at === null || holder.at === undefined ? Infinity : holder.at;
        if (holderAt > newestAt) newestAt = holderAt;
    }
    return newestAt;
}

/**
 * The lines of a list, newest first, at most KNOWLEDGE_LIST_CAP of them.
 * An entry made by the user (at null) counts as newest.
 * @param {{at: number|null, line: string}[]} entries
 * @returns {string[]}
 */
function newestCapped(entries) {
    const entriesNewestFirst = entries
        .map(entry => ({ ...entry, at: entry.at === null || entry.at === undefined ? Infinity : entry.at }))
        .sort((first, second) => second.at - first.at);
    return entriesNewestFirst.slice(0, KNOWLEDGE_LIST_CAP).map(entry => entry.line);
}

/**
 * @param {object} ledger
 * @param {string} characterId
 * @returns {string} The character's name, or the id when the ledger has no such character
 */
function characterName(ledger, characterId) {
    const character = ledger.characters.find(candidate => candidate.id === characterId);
    return character ? character.name : characterId;
}

/**
 * "Ellie", "Ellie and Noor", "Ellie, Noor and Dougal".
 * @param {string[]} names
 * @returns {string}
 */
function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ─── Inject the knowledge block ───

/**
 * Before each generation: set the knowledge block under its own prompt key,
 * in-chat at depth 1 with the system role, so it sits right above the
 * newest message. The key is always set, empty while Story Arc or the
 * tracker is off or the block has nothing to show, so no stale block
 * lingers from an earlier generation.
 */
export function injectKnowledgeBlock() {
    const trackerOn = isEnabled() && isKnowledgeTrackerEnabled();
    const block = trackerOn ? buildKnowledgeBlock(getKnowledgeLedger(), chat) : '';
    setExtensionPrompt(
        KNOWLEDGE_PROMPT_KEY,
        block,
        extension_prompt_types.IN_CHAT,
        1,
        false,
        extension_prompt_roles.SYSTEM,
    );
}
