/**
 * Story Arc - Knowledge ledger
 *
 * The knowledge tracker's process (ADR-0007): which character knows which
 * fact, and how they learned it. The ledger lives at
 * chat_metadata.story_arc.knowledge; its shape is documented at
 * createEmptyKnowledgeLedger in lib/core/constants.js.
 */

import { chat, chat_metadata, saveMetadata, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '/script.js';
import { getContext } from '/scripts/extensions.js';
import { HOLDER_HOW, KNOWLEDGE_PROMPT_KEY } from '../core/constants.js';
import { isEnabled, isKnowledgeTrackerEnabled, getKnowledgeLedger, getKnowledgeTrackerSettings, secretHolders } from '../core/settings.js';
import { calculatePhase, shouldShowSecret } from '../injection/pacing.js';
import { getActiveArcs } from '../planning/storage.js';
import { callLlm, fillTemplate, loadTemplate } from '../planning/generator.js';
import { parseLlmJson } from '../planning/validation.js';

// ─── Extraction ───

/**
 * Ask the LLM who learned what in the messages from `fromIndex` on. The call
 * goes through the arc generation connection profile and the transport the
 * plan check uses. A failed call or an unreadable answer returns null, and
 * the caller changes nothing: the next update covers the same messages again.
 * The input also lists the active arcs' shown secrets; the answer's revealed
 * secrets come back resolved to those secrets, ready to apply.
 * @param {object} ledger - The chat's knowledge ledger
 * @param {object[]} chatMessages - ST's chat array (`name`, `is_user`, `mes`, `is_system`)
 * @param {number} fromIndex - First message the extraction reads
 * @param {string} personaName - The player's persona name
 * @returns {Promise<{present: string[], newCharacters: object[], learned: object[], revealedSecrets: object[]}|null>}
 */
export async function extractKnowledge(ledger, chatMessages, fromIndex, personaName) {
    try {
        const template = await loadTemplate('extract-knowledge.txt');
        const shownSecrets = listShownSecrets(getActiveArcs());
        const prompt = fillTemplate(template, buildKnowledgeExtractionVariables(ledger, chatMessages, fromIndex, personaName, shownSecrets));
        const response = await callLlm(prompt);
        const answer = parseKnowledgeExtractionAnswer(response);
        if (!answer) {
            console.warn('[Story Arc] Knowledge extraction answered no readable JSON; the ledger stays as it is');
            return null;
        }
        return { ...answer, revealedSecrets: resolveRevealedSecrets(answer.revealedSecrets, shownSecrets) };
    } catch (err) {
        console.warn('[Story Arc] Knowledge extraction failed; the ledger stays as it is:', err);
        return null;
    }
}

/**
 * The secrets of the active arcs that the current phase shows, so the
 * extraction can recognise one coming out on-screen. The gate is the phase
 * gate of the SECRETS block (shouldShowSecret). A secret the plan check has
 * already marked disclosed is listed too: the plan check reads the same reply
 * and may mark it before the extraction runs, and characters can hear a
 * disclosed secret later still.
 *
 * Secret ids are unique only within an arc, so each listed secret gets a
 * `ref` unique in this call: its id, or its id with `_2`, `_3`, … when an
 * earlier listed secret already took that id.
 * @param {object[]} arcs - The chat's arcs; only active ones count
 * @returns {{ref: string, arcId: string, secretId: string, text: string, holders: string[]}[]}
 */
export function listShownSecrets(arcs) {
    const shown = [];
    const usedRefs = new Set();
    for (const arc of arcs) {
        if (arc.status !== 'active') continue;
        const { phase } = calculatePhase(arc);
        for (const secret of arc.secrets || []) {
            if (!shouldShowSecret(secret.revealPhase, phase)) continue;
            let ref = secret.id;
            for (let suffix = 2; usedRefs.has(ref); suffix++) ref = `${secret.id}_${suffix}`;
            usedRefs.add(ref);
            shown.push({ ref, arcId: arc.id, secretId: secret.id, text: secret.content, holders: secretHolders(secret) });
        }
    }
    return shown;
}

/**
 * Template variables for extract-knowledge.txt: the persona's name, the
 * ledger's characters with their aliases, the facts by id with their holders
 * (or "public"), the shown secrets by ref with their planned holders, and
 * the messages from `fromIndex` on, each with its index. Hidden (system)
 * messages are not story and are left out.
 * @param {object} ledger
 * @param {object[]} chatMessages - ST's chat array
 * @param {number} fromIndex
 * @param {string} personaName
 * @param {object[]} [shownSecrets] - From listShownSecrets
 * @returns {Record<string, string>}
 */
export function buildKnowledgeExtractionVariables(ledger, chatMessages, fromIndex, personaName, shownSecrets = []) {
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

    const secretLines = shownSecrets.map(secret => {
        const holderNote = secret.holders.length ? `planned holders: ${secret.holders.join(', ')}` : 'no planned holders';
        return `- [${secret.ref}] ${secret.text} (${holderNote})`;
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
        SECRETS: secretLines.join('\n') || '(none)',
        MESSAGES: messageLines.join('\n\n'),
    };
}

/** How a character can learn a fact on-screen, as the extraction reports it. */
const EXTRACTION_HOW_VALUES = [HOLDER_HOW.witnessed, HOLDER_HOW.told];

/**
 * Read the extraction's answer text into the shape applying an answer takes:
 *
 *     { present: [name],
 *       newCharacters: [{ name, aliases: [name] }],
 *       learned: [{ factId | text, public, who: [name], how: 'witnessed' | 'told',
 *                   toldBy: name | null, at: messageIndex }],
 *       revealedSecrets: [{ secretId: ref, text, heardBy: [name], at: messageIndex }] }
 *
 * The answer is taken whole or not at all: unreadable JSON, a missing key or
 * a value of the wrong type gives null, so a half-understood answer never
 * reaches the ledger. A missing revealedSecrets list reads as empty, because
 * the model may leave out a list it has nothing for. Keys outside the shape
 * are dropped. Names and fact ids are not checked against the ledger here;
 * applying the answer ignores unknown ones. A revealed secret's id is the ref
 * the input listed it under; resolveRevealedSecrets turns it into the secret.
 * @param {string} responseText - The LLM's answer
 * @returns {{present: string[], newCharacters: object[], learned: object[], revealedSecrets: object[]}|null}
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

    const revealedSecrets = [];
    const revealedItems = parsed.revealedSecrets === undefined ? [] : parsed.revealedSecrets;
    if (!Array.isArray(revealedItems)) return null;
    for (const item of revealedItems) {
        if (!isName(item?.secretId) || !isName(item.text) || !isListOfNames(item.heardBy)) return null;
        if (!Number.isInteger(item.at)) return null;
        revealedSecrets.push({ secretId: item.secretId, text: item.text, heardBy: item.heardBy, at: item.at });
    }

    return { present: parsed.present, newCharacters, learned, revealedSecrets };
}

/**
 * Turn the revealed secrets of a parsed answer from the refs the input listed
 * them under into the secrets themselves, the shape applying an answer takes:
 * `{ arcId, secretId, text, holders, heardBy, at }`, holders being the
 * planned ones. The text is the answer's: what the characters heard
 * on-screen. The secret's own content stays out of the ledger, because it
 * may hold more than came out. A ref the input did not list (an unknown or
 * hidden secret) is dropped, so it changes nothing.
 * @param {object[]} revealedSecrets - The parsed answer's revealedSecrets
 * @param {object[]} shownSecrets - The listShownSecrets list the input was built from
 * @returns {{arcId: string, secretId: string, text: string, holders: string[], heardBy: string[], at: number}[]}
 */
export function resolveRevealedSecrets(revealedSecrets, shownSecrets) {
    const resolved = [];
    for (const item of revealedSecrets) {
        const secret = shownSecrets.find(candidate => candidate.ref === item.secretId);
        if (!secret) continue;
        resolved.push({ arcId: secret.arcId, secretId: secret.secretId, text: item.text, holders: secret.holders, heardBy: item.heardBy, at: item.at });
    }
    return resolved;
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
 *     revealedSecrets: [{ arcId, secretId, text, holders: [name], heardBy: [name], at: messageIndex }]   // resolved, see resolveRevealedSecrets
 *
 * New characters are added first, so the rest of the answer can name them.
 * Names are matched case-insensitively against names and aliases. A learned
 * item with a known fact id adds holders to that fact; one with text creates
 * a fact. The teller of a told item becomes a witnessed holder too, unless
 * they hold it already. Names that are neither known nor new, and unknown
 * fact ids, are ignored. A revealed secret creates the fact linked to it, or extends the
 * one already linked, with the characters who heard it as witnessed holders
 * and its planned holders as plan holders, all at the message of the reveal.
 * An item's `at` outside the messages the call covered falls back to the
 * last of them, so a rollback of the covered messages always takes it back.
 * `present` replaces the scene, and lastUpdatedAt becomes the last covered
 * message.
 *
 * @param {object} ledger - The current ledger; not changed
 * @param {object} answer - The parsed extraction answer
 * @param {number} fromIndex - The first message the answer covers
 * @param {number} messageIndex - The last message the answer covers
 * @returns {object} The updated ledger
 */
export function applyExtractionAnswer(ledger, answer, fromIndex, messageIndex) {
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

        const how = item.how === HOLDER_HOW.told ? HOLDER_HOW.told : HOLDER_HOW.witnessed;
        const toldBy = how === HOLDER_HOW.told ? findCharacterId(characters, item.toldBy) : null;
        const at = atInsideCoveredMessages(item.at, fromIndex, messageIndex);
        // Whoever tells a fact knows it. The extraction leaves out characters
        // who already know, so the teller may be in no holder entry yet; how
        // they learned it is not on-screen, so it counts as witnessed.
        if (toldBy && !fact.holders.some(holder => holder.characterId === toldBy)) {
            fact.holders.push({ characterId: toldBy, how: HOLDER_HOW.witnessed, toldBy: null, at });
        }
        for (const characterId of holderIds) {
            if (fact.holders.some(holder => holder.characterId === characterId)) continue;
            fact.holders.push({ characterId, how, toldBy, at });
        }
    }

    // A secret that came out on-screen becomes a fact like any other, worded
    // as the characters heard it and linked to its secret, so a later reveal
    // extends it (its first wording stays). The secret's own reveal state in
    // the arc stays with the plan check.
    const revealedSecrets = Array.isArray(answer.revealedSecrets) ? answer.revealedSecrets : [];
    for (const item of revealedSecrets) {
        const text = String(item?.text || '').trim();
        if (!text || !item.arcId || !item.secretId) continue;
        const heardBy = Array.isArray(item.heardBy) ? item.heardBy : [];
        const holderIds = [];
        for (const name of heardBy) {
            const characterId = findCharacterId(characters, name);
            if (characterId && !holderIds.includes(characterId)) holderIds.push(characterId);
        }
        if (holderIds.length === 0) continue;

        let fact = facts.find(candidate =>
            candidate.secret?.arcId === item.arcId && candidate.secret?.secretId === item.secretId);
        if (!fact) {
            fact = { id: nextLedgerId('f', facts), text, public: false, secret: { arcId: item.arcId, secretId: item.secretId }, holders: [] };
            facts.push(fact);
        }
        const at = atInsideCoveredMessages(item.at, fromIndex, messageIndex);
        for (const characterId of holderIds) {
            if (fact.holders.some(holder => holder.characterId === characterId)) continue;
            fact.holders.push({ characterId, how: HOLDER_HOW.witnessed, toldBy: null, at });
        }
        // The planned holders knew it all along. Without an entry the block
        // would tell the narrator they do not know their own secret. They
        // enter at the reveal, so a rollback of it takes them back too.
        const plannedHolders = Array.isArray(item.holders) ? item.holders : [];
        for (const name of plannedHolders) {
            const characterId = findCharacterId(characters, name);
            if (!characterId || fact.holders.some(holder => holder.characterId === characterId)) continue;
            fact.holders.push({ characterId, how: HOLDER_HOW.plan, toldBy: null, at });
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
 * The message index an answer item gives, when it lies inside the messages
 * the call covered; otherwise the last of them. An index before them would
 * escape the rollback of the message it really came from, and the edit of a
 * message drops only the entries stamped with that message.
 * @param {*} at - The item's index as the extraction wrote it
 * @param {number} fromIndex - The first message the call covered
 * @param {number} lastIndex - The last message the call covered
 * @returns {number}
 */
function atInsideCoveredMessages(at, fromIndex, lastIndex) {
    return Number.isInteger(at) && at >= fromIndex && at <= lastIndex ? at : lastIndex;
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
        !fact.public && fact.holders.some(holder => holder.how !== HOLDER_HOW.plan));

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
        if (ownHolder && ownHolder.how !== HOLDER_HOW.plan) {
            knownEntries.push({ at: ownHolder.at, line: knowsLine(ledger, fact, ownHolder) });
        }

        const heldByAnotherCoveredCharacter = fact.holders.some(holder =>
            holder.how !== HOLDER_HOW.plan && holder.characterId !== character.id && coveredIds.includes(holder.characterId));
        if (!ownHolder && heldByAnotherCoveredCharacter) {
            unknownEntries.push({ at: newestHolderAt(fact.holders), line: `- Does not know: ${fact.text}` });
        }

        const toldHolders = fact.holders.filter(holder => holder.how === HOLDER_HOW.told && holder.toldBy === character.id);
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
    if (holder.how === HOLDER_HOW.told && holder.toldBy) {
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
        if (holder.how === HOLDER_HOW.plan) continue;
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

// ─── Update after a reply ───

/** True while an extraction call is out, so a second one never overlaps it. */
let knowledgeUpdateRunning = false;

/**
 * After an AI reply, once every N replies (the tracker's update interval):
 * run the extraction over every message since the ledger's last update,
 * apply the answer and save. The caller does not wait for it, so the next
 * generation is never held up; a prompt built meanwhile uses the ledger as
 * it is.
 *
 * A failed call or an unreadable answer changes nothing and lastUpdatedAt
 * stays, so the next update reads the missed messages again. A ledger that
 * was never updated (lastUpdatedAt null) reads only the latest exchange, the
 * reply and the user message before it: a long chat's history is not
 * backfilled. While an extraction is out, a later reply starts none; its
 * messages are covered by the next update.
 * @param {number} replyIndex - Index of the reply that just arrived
 * @returns {Promise<boolean>} True when the ledger was updated and saved
 */
export async function updateKnowledgeAfterReply(replyIndex) {
    if (!isEnabled() || !isKnowledgeTrackerEnabled()) return false;
    if (knowledgeUpdateRunning) return false;

    const ledgerBefore = getKnowledgeLedger();
    const lastUpdatedAt = ledgerBefore.lastUpdatedAt;
    const interval = getKnowledgeTrackerSettings().updateInterval;
    if (lastUpdatedAt !== null && repliesSince(chat, lastUpdatedAt, replyIndex) < interval) return false;

    const fromIndex = lastUpdatedAt === null ? latestExchangeStart(chat, replyIndex) : lastUpdatedAt + 1;
    if (fromIndex > replyIndex) return false;

    // What the answer is checked against once it is back: the same chat, the
    // same reply text, and no rollback in between.
    const chatStateBefore = chat_metadata.story_arc;
    const reply = chat[replyIndex];
    const replyText = reply?.mes;

    knowledgeUpdateRunning = true;
    let answer;
    try {
        answer = await extractKnowledge(ledgerBefore, chat, fromIndex, getContext().name1);
    } finally {
        knowledgeUpdateRunning = false;
    }
    if (!answer) return false;

    if (chat_metadata.story_arc !== chatStateBefore || chat[replyIndex] !== reply || reply?.mes !== replyText) {
        console.log('[Story Arc] The chat changed during the knowledge extraction; its answer is not applied');
        return false;
    }
    // Re-read: the Knowledge popup may have edited the ledger during the call,
    // and those edits must not be lost.
    const ledgerNow = getKnowledgeLedger();
    if (ledgerNow.lastUpdatedAt !== lastUpdatedAt) {
        console.log('[Story Arc] The knowledge ledger was rolled back during the extraction; its answer is not applied');
        return false;
    }

    chat_metadata.story_arc.knowledge = applyExtractionAnswer(ledgerNow, answer, fromIndex, replyIndex);
    await saveMetadata();
    console.log(`[Story Arc] Knowledge ledger updated from messages #${fromIndex} to #${replyIndex}`);
    return true;
}

/**
 * Count the AI replies after message `afterIndex`, up to and including
 * `replyIndex`. Hidden (system) messages are not replies.
 */
function repliesSince(chatMessages, afterIndex, replyIndex) {
    let replies = 0;
    for (let index = afterIndex + 1; index <= replyIndex; index++) {
        const message = chatMessages[index];
        if (message && !message.is_user && !message.is_system) replies++;
    }
    return replies;
}

/**
 * Where the latest exchange starts: the user message right before the reply
 * (hidden messages skipped), or the reply itself when no user message
 * precedes it, as after a greeting or a continued reply.
 */
function latestExchangeStart(chatMessages, replyIndex) {
    for (let index = replyIndex - 1; index >= 0; index--) {
        const message = chatMessages[index];
        if (!message || message.is_system) continue;
        return message.is_user ? index : replyIndex;
    }
    return replyIndex;
}

// ─── Roll back after a delete, a swipe, an edit or a branch load ───

/**
 * Take back what the stored ledger learned from message `firstGoneIndex` on
 * and save when that changed anything. Runs after messages were deleted
 * (also the last reply before a regeneration: ST passes the new chat length)
 * and on chat load with the chat's length, because ST copies the chat
 * metadata whole when it branches. Runs while the tracker is off too: the
 * knowledge of text that is gone must not come back when it is switched on.
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {Promise<boolean>} True when the ledger changed and was saved
 */
export async function rollBackKnowledgeFrom(firstGoneIndex) {
    const changed = dropKnowledgeFrom(getKnowledgeLedger(), firstGoneIndex);
    if (changed) await saveMetadata();
    return changed;
}

/**
 * After the user swiped a message (ST fires MESSAGE_SWIPED with its index
 * for both kinds of swipe): drop what the ledger learned from that message
 * on. A swipe that generates a new reply needs nothing more, because the new
 * reply arrives through MESSAGE_RECEIVED and its update reads it. Switching
 * to an existing swipe re-extracts that one message, if an update had
 * already read it; otherwise the next update reads the shown swipe anyway.
 * A failed re-extraction leaves lastUpdatedAt before the message, so the
 * next update reads it again.
 * @param {number} messageIndex - Index of the swiped message
 * @returns {Promise<boolean>} True when the ledger changed and was saved
 */
export async function updateKnowledgeAfterSwipe(messageIndex) {
    const ledger = getKnowledgeLedger();
    const wasRead = ledger.lastUpdatedAt !== null && ledger.lastUpdatedAt >= messageIndex;
    const dropped = dropKnowledgeFrom(ledger, messageIndex);
    if (dropped) await saveMetadata();

    // ST sets swipe_id to the slot the generation will fill, one past the
    // swipes that exist, before it fires the event.
    const message = chat[messageIndex];
    const generatesNewSwipe = !Array.isArray(message?.swipes) || message.swipe_id >= message.swipes.length;
    if (generatesNewSwipe || !wasRead) return dropped;

    const reextracted = await reextractKnowledgeOfMessage(messageIndex);
    return reextracted || dropped;
}

/**
 * Run the extraction over exactly one message and apply its answer, for a
 * swipe switch or an edit. Makes no call while Story Arc or the tracker is
 * off, or for a hidden message.
 *
 * The answer is dropped when, during the call, the chat changed, the
 * message's text changed (another swipe or edit), or the ledger's coverage
 * moved over the message: an update that was before it now reaches past it
 * (a reply update read it meanwhile), or one that reached past it now ends
 * before it (a rollback took it back).
 *
 * The extraction of an older message does not move the ledger back: when
 * the ledger already reaches past the message, lastUpdatedAt and the scene
 * stay as they are.
 * @param {number} messageIndex
 * @returns {Promise<boolean>} True when the ledger was updated and saved
 */
async function reextractKnowledgeOfMessage(messageIndex) {
    if (!isEnabled() || !isKnowledgeTrackerEnabled()) return false;
    const message = chat[messageIndex];
    if (!message || message.is_system) return false;

    const chatStateBefore = chat_metadata.story_arc;
    const messageText = message.mes;
    const ledgerBefore = getKnowledgeLedger();
    const lastUpdatedAtBefore = ledgerBefore.lastUpdatedAt;

    // The chat up to the message, so the extraction reads that message only.
    const chatUpToMessage = chat.slice(0, messageIndex + 1);
    const answer = await extractKnowledge(ledgerBefore, chatUpToMessage, messageIndex, getContext().name1);
    if (!answer) return false;

    if (chat_metadata.story_arc !== chatStateBefore || chat[messageIndex] !== message || message.mes !== messageText) {
        console.log(`[Story Arc] Message #${messageIndex} changed during its knowledge extraction; the answer is not applied`);
        return false;
    }
    const ledgerNow = getKnowledgeLedger();
    const lastUpdatedAtNow = ledgerNow.lastUpdatedAt;
    const readBefore = lastUpdatedAtBefore !== null && lastUpdatedAtBefore >= messageIndex;
    const readNow = lastUpdatedAtNow !== null && lastUpdatedAtNow >= messageIndex;
    const coverageMoved = readBefore ? !readNow : lastUpdatedAtNow !== lastUpdatedAtBefore;
    if (coverageMoved) {
        console.log(`[Story Arc] The knowledge ledger moved over message #${messageIndex} during its extraction; the answer is not applied`);
        return false;
    }

    const updatedLedger = applyExtractionAnswer(ledgerNow, answer, messageIndex, messageIndex);
    if (readNow && lastUpdatedAtNow > messageIndex) {
        updatedLedger.lastUpdatedAt = lastUpdatedAtNow;
        updatedLedger.scene = ledgerNow.scene;
    }
    chat_metadata.story_arc.knowledge = updatedLedger;
    await saveMetadata();
    console.log(`[Story Arc] Knowledge of message #${messageIndex} extracted again`);
    return true;
}

/**
 * After the user edited a message (ST fires MESSAGE_EDITED with its index
 * once the new text is in the chat): drop only what the ledger learned at
 * that message and re-extract it, so a correction keeps everything learned
 * after it. A message no update has read yet needs nothing: the next update
 * reads its new text. While the tracker is off the ledger stays as it is,
 * because nothing could extract the new text.
 * @param {number} messageIndex - Index of the edited message
 * @returns {Promise<boolean>} True when the ledger changed and was saved
 */
export async function updateKnowledgeAfterEdit(messageIndex) {
    if (!isEnabled() || !isKnowledgeTrackerEnabled()) return false;
    const ledger = getKnowledgeLedger();
    const wasRead = ledger.lastUpdatedAt !== null && ledger.lastUpdatedAt >= messageIndex;
    if (!wasRead) return false;

    const dropped = dropKnowledgeLearnedAt(ledger, messageIndex);
    if (dropped) await saveMetadata();

    const reextracted = await reextractKnowledgeOfMessage(messageIndex);
    return reextracted || dropped;
}

/**
 * Remove every holder entry learned at exactly this message, and every fact
 * this leaves without holders. Entries from other messages, and the user's
 * own (`at: null`), stay; so do the scene and lastUpdatedAt, which the
 * re-extraction of the message sets again.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {number} messageIndex
 * @returns {boolean} True when anything in the ledger changed
 */
function dropKnowledgeLearnedAt(ledger, messageIndex) {
    let changed = false;
    const remainingFacts = [];
    for (const fact of ledger.facts) {
        const remainingHolders = fact.holders.filter(holder => holder.at !== messageIndex);
        if (remainingHolders.length === fact.holders.length) {
            remainingFacts.push(fact);
            continue;
        }
        changed = true;
        if (remainingHolders.length === 0) continue;
        fact.holders = remainingHolders;
        remainingFacts.push(fact);
    }
    ledger.facts = remainingFacts;
    return changed;
}
