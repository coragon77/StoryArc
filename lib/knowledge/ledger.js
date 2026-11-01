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
import { uuidv4 } from '/scripts/utils.js';
import { HOLDER_HOW, KNOWLEDGE_PROMPT_KEY } from '../core/constants.js';
import { isEnabled, isKnowledgeTrackerEnabled, getKnowledgeLedger, getKnowledgeTrackerSettings, secretHolders } from '../core/settings.js';
import { calculatePhase, shouldShowSecret } from '../injection/pacing.js';
import { getActiveArcs } from '../planning/storage.js';
import { callLlm, fillTemplate, loadTemplate } from '../planning/generator.js';
import { parseLlmJson } from '../planning/validation.js';

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

    if (!applyExtractionAnswer(ledgerNow, answer, fromIndex, replyIndex, chat)) return false;
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
 * @returns {Promise<{present: string[], newCharacters: object[], learned: object[], revealedSecrets: object[], retracted: object[]}|null>}
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
 *       revealedSecrets: [{ secretId: ref, text, heardBy: [name], at: messageIndex }],
 *       retracted: [{ factId, at: messageIndex }] }
 *
 * The answer is taken whole or not at all: unreadable JSON, a missing key or
 * a value of the wrong type gives null, so a half-understood answer never
 * reaches the ledger. A missing revealedSecrets or retracted list reads as
 * empty, because the model may leave out a list it has nothing for. A
 * retracted item names a ledger fact an out-of-character correction took
 * back, and the message of the correction. Keys outside the shape
 * are dropped. Names and fact ids are not checked against the ledger here;
 * applying the answer ignores unknown ones. A revealed secret's id is the ref
 * the input listed it under; resolveRevealedSecrets turns it into the secret.
 * @param {string} responseText - The LLM's answer
 * @returns {{present: string[], newCharacters: object[], learned: object[], revealedSecrets: object[], retracted: object[]}|null}
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

    const retracted = [];
    const retractedItems = parsed.retracted === undefined ? [] : parsed.retracted;
    if (!Array.isArray(retractedItems)) return null;
    for (const item of retractedItems) {
        if (!isName(item?.factId) || !Number.isInteger(item.at)) return null;
        retracted.push({ factId: item.factId, at: item.at });
    }

    return { present: parsed.present, newCharacters, learned, revealedSecrets, retracted };
}

function isListOfNames(value) {
    return Array.isArray(value) && value.every(isName);
}

/** A non-blank string: a character name, a fact id or a fact text. */
function isName(value) {
    return typeof value === 'string' && value.trim() !== '';
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

// ─── Apply an extraction answer ───

/**
 * Apply a parsed extraction answer to the ledger, in place.
 *
 * Answer shape:
 *
 *     present: [name]
 *     newCharacters: [{ name, aliases: [name] }]
 *     learned: [{ factId | text, public, who: [name], how: 'witnessed' | 'told',
 *                 toldBy: name | null, at: messageIndex }]
 *     revealedSecrets: [{ arcId, secretId, text, holders: [name], heardBy: [name], at: messageIndex }]   // resolved, see resolveRevealedSecrets
 *     retracted: [{ factId, at: messageIndex }]   // optional
 *
 * New characters are added first, so the rest of the answer can name them.
 * Names are matched case-insensitively against names and aliases. A learned
 * item with a known fact id adds holders to that fact; one with text adds
 * holders to the fact with the same text (findFactWithSameText), in the
 * ledger or created earlier in the answer, and creates a fact only for new text. The teller of a told item becomes a witnessed holder too, unless
 * they hold it already. Names that are neither known nor new, and unknown
 * fact ids, are ignored. A revealed secret creates the fact linked to it, or extends the
 * one already linked, with the characters who heard it as witnessed holders
 * and its planned holders as plan holders, all at the message of the reveal.
 * A retracted fact leaves the facts for the ledger's retractedFacts, with
 * the message of the correction, unless the user entered a holder for it;
 * unknown fact ids are ignored.
 * An item's `at` outside the messages the call covered falls back to the
 * last of them, so a rollback of the covered messages always takes it back.
 * `present` replaces the scene, the scene it replaces goes into the scene
 * history, and lastUpdatedAt becomes the last covered message.
 *
 * Given the chat, every covered message gets Story Arc's message id, unless
 * it carries one already (assignCoveredMessageIds), and each holder entry,
 * the scene and lastUpdatedAt name their message by that id next to its
 * index (`messageId`, `lastUpdatedMessageId`), so a deletion of earlier
 * messages moves them instead of dropping them (followMessagesById).
 *
 * Does not save: the caller saves, and only when this returns true.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {object} answer - The parsed extraction answer
 * @param {number} fromIndex - The first message the answer covers
 * @param {number} messageIndex - The last message the answer covers
 * @param {object[]} [chatMessages] - ST's chat array, whose covered messages get a message id
 * @returns {boolean} True when anything in the ledger changed
 */
export function applyExtractionAnswer(ledger, answer, fromIndex, messageIndex, chatMessages) {
    const { characters, facts } = ledger;
    let changed = false;
    const messageIds = chatMessages ? assignCoveredMessageIds(chatMessages, fromIndex, messageIndex) : new Map();

    const newCharacters = Array.isArray(answer.newCharacters) ? answer.newCharacters : [];
    for (const newCharacter of newCharacters) {
        const name = String(newCharacter?.name || '').trim();
        if (!name || findCharacterId(characters, name)) continue;
        const aliases = Array.isArray(newCharacter.aliases)
            ? newCharacter.aliases.map(alias => String(alias || '').trim()).filter(Boolean)
            : [];
        characters.push({ id: nextLedgerId('c', characters), name, aliases });
        changed = true;
    }

    const learned = Array.isArray(answer.learned) ? answer.learned : [];
    for (const item of learned) {
        const holderIds = findCharacterIds(characters, item?.who);
        if (holderIds.length === 0) continue;

        let fact;
        if (item.factId) {
            fact = facts.find(candidate => candidate.id === item.factId);
            if (!fact) continue;
        } else {
            const text = String(item.text || '').trim();
            if (!text) continue;
            fact = findFactWithSameText(facts, text);
            if (!fact) {
                fact = { id: nextLedgerId('f', facts), text, public: item.public === true, holders: [] };
                facts.push(fact);
            }
        }

        const how = item.how === HOLDER_HOW.told ? HOLDER_HOW.told : HOLDER_HOW.witnessed;
        const toldBy = how === HOLDER_HOW.told ? findCharacterId(characters, item.toldBy) : null;
        const at = atInsideCoveredMessages(item.at, fromIndex, messageIndex);
        // Whoever tells a fact knows it. The extraction leaves out characters
        // who already know, so the teller may be in no holder entry yet; how
        // they learned it is not on-screen, so it counts as witnessed.
        if (toldBy && addHolderUnlessHeld(fact, { characterId: toldBy, how: HOLDER_HOW.witnessed, toldBy: null, at })) {
            changed = true;
        }
        for (const characterId of holderIds) {
            if (addHolderUnlessHeld(fact, { characterId, how, toldBy, at })) changed = true;
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
        const holderIds = findCharacterIds(characters, item.heardBy);
        if (holderIds.length === 0) continue;

        let fact = facts.find(candidate =>
            candidate.secret?.arcId === item.arcId && candidate.secret?.secretId === item.secretId);
        if (!fact) {
            fact = { id: nextLedgerId('f', facts), text, public: false, secret: { arcId: item.arcId, secretId: item.secretId }, holders: [] };
            facts.push(fact);
        }
        const at = atInsideCoveredMessages(item.at, fromIndex, messageIndex);
        for (const characterId of holderIds) {
            if (addHolderUnlessHeld(fact, { characterId, how: HOLDER_HOW.witnessed, toldBy: null, at })) changed = true;
        }
        // The planned holders knew it all along. Without an entry the block
        // would tell the narrator they do not know their own secret. They
        // enter at the reveal, so a rollback of it takes them back too.
        for (const characterId of findCharacterIds(characters, item.holders)) {
            if (addHolderUnlessHeld(fact, { characterId, how: HOLDER_HOW.plan, toldBy: null, at })) changed = true;
        }
    }

    // An out-of-character correction takes a fact back: the player rejected
    // it, or the narrator admitted inventing it. It leaves the ledger with
    // all its holders, after the items above, because the correction is the
    // later word. The fact is kept with the message of the correction, so a
    // rollback of that message brings it back (keepOnlyHolders). A fact the
    // user entered a holder for stays: a hand correction wins.
    const retracted = Array.isArray(answer.retracted) ? answer.retracted : [];
    for (const item of retracted) {
        const fact = facts.find(candidate => candidate.id === item?.factId);
        if (!fact) continue;
        if (fact.holders.some(holder => holder.at === null)) continue;
        const at = atInsideCoveredMessages(item.at, fromIndex, messageIndex);
        facts.splice(facts.indexOf(fact), 1);
        ledger.retractedFacts = [...(ledger.retractedFacts || []), { at, fact }];
        changed = true;
    }

    // Every holder entry and retraction from a covered message names it by
    // its message id. At this point an entry's index is still right, so an entry
    // at a covered index came from that very message.
    const nameByMessageId = entry => {
        const messageId = messageIds.get(entry.at);
        if (!messageId || entry.messageId === messageId) return;
        entry.messageId = messageId;
        changed = true;
    };
    for (const fact of facts) fact.holders.forEach(nameByMessageId);
    for (const retraction of ledger.retractedFacts || []) {
        nameByMessageId(retraction);
        retraction.fact.holders.forEach(nameByMessageId);
    }

    const present = findCharacterIds(characters, answer.present);
    const sceneChanged = ledger.scene.at !== messageIndex || ledger.scene.present.join() !== present.join();
    if (sceneChanged) {
        keepSceneInHistory(ledger, messageIndex);
        ledger.scene = { at: messageIndex, present };
        changed = true;
    }
    if (ledger.lastUpdatedAt !== messageIndex) {
        ledger.lastUpdatedAt = messageIndex;
        // The message id of an earlier message no longer names the last covered one.
        delete ledger.lastUpdatedMessageId;
        changed = true;
    }
    const lastMessageId = messageIds.get(messageIndex);
    if (lastMessageId && ledger.scene.messageId !== lastMessageId) {
        ledger.scene.messageId = lastMessageId;
        changed = true;
    }
    if (lastMessageId && ledger.lastUpdatedMessageId !== lastMessageId) {
        ledger.lastUpdatedMessageId = lastMessageId;
        changed = true;
    }
    return changed;
}

/** The key of Story Arc's message id in a chat message's `extra`. */
const MESSAGE_ID_KEY = 'story_arc_message_id';

/**
 * Give every message the extraction read Story Arc's message id, a stable
 * id in the message's `extra`, unless it carries one already: the id stays
 * with the message wherever later deletions move it. Hidden (system)
 * messages are not read and get none. This is Story Arc's own protocol data
 * on the message (GOALS.md); ST saves it with the chat, and saveMetadata
 * saves the whole chat.
 * @param {object[]} chatMessages - ST's chat array, its messages changed in place
 * @param {number} fromIndex - The first covered message
 * @param {number} lastIndex - The last covered message
 * @returns {Map<number, string>} Each covered message's index and message id
 */
function assignCoveredMessageIds(chatMessages, fromIndex, lastIndex) {
    const messageIds = new Map();
    for (let index = fromIndex; index <= lastIndex; index++) {
        const chatMessage = chatMessages[index];
        if (!chatMessage || chatMessage.is_system) continue;
        if (!chatMessage.extra || typeof chatMessage.extra !== 'object') chatMessage.extra = {};
        if (!chatMessage.extra[MESSAGE_ID_KEY]) chatMessage.extra[MESSAGE_ID_KEY] = uuidv4();
        messageIds.set(index, chatMessage.extra[MESSAGE_ID_KEY]);
    }
    return messageIds;
}

/** How many earlier scenes the ledger keeps for a rollback to go back to. */
const KNOWLEDGE_SCENE_HISTORY_CAP = 10;

/**
 * Before a later message's scene replaces the ledger's scene, keep the
 * current one in the scene history, so a rollback of the later message can
 * go back to it (dropKnowledgeFrom). A scene from the same or a later
 * message, as when an edit re-extracts a message, is not kept, nor is the
 * empty scene before the first update. The history keeps the newest
 * KNOWLEDGE_SCENE_HISTORY_CAP scenes; a ledger from before the history gets one.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {number} messageIndex - The message the new scene comes from
 */
function keepSceneInHistory(ledger, messageIndex) {
    const currentScene = ledger.scene;
    if (currentScene.at === null || currentScene.at >= messageIndex) return;
    const sceneHistory = [...(ledger.sceneHistory || []), currentScene];
    ledger.sceneHistory = sceneHistory.slice(-KNOWLEDGE_SCENE_HISTORY_CAP);
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

/**
 * The ids of the characters a list of names refers to, each once, in the
 * order of the names. Unknown names are left out.
 * @param {Array} characters - The ledger's characters
 * @param {string[]|undefined} names - Names as the extraction wrote them
 * @returns {string[]}
 */
function findCharacterIds(characters, names) {
    const characterIds = [];
    for (const name of Array.isArray(names) ? names : []) {
        const characterId = findCharacterId(characters, name);
        if (characterId && !characterIds.includes(characterId)) characterIds.push(characterId);
    }
    return characterIds;
}

/**
 * The fact whose text says the same as a learned item's text: equal after
 * ignoring case, runs of whitespace and a trailing full stop. One answer
 * often writes the same fact twice (the actor's own item next to the item of
 * those who were told), and two facts with one text would tell the narrator
 * a character both knows and does not know it. Facts created earlier in the
 * same answer are in the list already.
 * @param {object[]} facts - The ledger's facts
 * @param {string} text - The learned item's text
 * @returns {object|undefined}
 */
function findFactWithSameText(facts, text) {
    const wanted = normalisedFactText(text);
    return facts.find(candidate => normalisedFactText(candidate.text) === wanted);
}

/**
 * A fact text for comparison: lower case, whitespace collapsed, no trailing full stop.
 * @param {string} text
 * @returns {string}
 */
function normalisedFactText(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '').trimEnd();
}

/**
 * The message index an answer item gives, when it lies inside the messages
 * the call covered; otherwise the last of them. An index before them would
 * escape the rollback of the message it really came from, and the edit of a
 * message drops only the entries named by that message's id.
 * @param {*} at - The item's index as the extraction wrote it
 * @param {number} fromIndex - The first message the call covered
 * @param {number} lastIndex - The last message the call covered
 * @returns {number}
 */
function atInsideCoveredMessages(at, fromIndex, lastIndex) {
    return Number.isInteger(at) && at >= fromIndex && at <= lastIndex ? at : lastIndex;
}

/**
 * Add a holder entry to a fact, unless the character holds it already:
 * their first entry records how they learned it.
 * @param {object} fact
 * @param {object} holder - { characterId, how, toldBy, at }
 * @returns {boolean} True when the entry was added
 */
function addHolderUnlessHeld(fact, holder) {
    if (fact.holders.some(existing => existing.characterId === holder.characterId)) return false;
    fact.holders.push(holder);
    return true;
}

// ─── Roll back after a delete, a swipe, an edit or a branch load ───

/**
 * Take back what the stored ledger learned from messages that are gone, and
 * save when that changed anything. Runs after messages were deleted (also
 * the last reply before a regeneration; ST passes only the new chat length,
 * even when the deleted messages lay in the middle) and on chat load with
 * the chat's length, because ST copies the chat metadata whole when it
 * branches. Runs while the tracker is off too: the knowledge of text that is
 * gone must not come back when it is switched on.
 *
 * An entry that names its message by message id follows that message: it stays,
 * at the message's new index, while the message is in the chat, and goes
 * with it (followMessagesById). An entry from before the message ids keeps
 * the index rule: it goes when its index is `firstGoneIndex` or later.
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {Promise<boolean>} True when the ledger changed and was saved
 */
export async function rollBackKnowledgeFrom(firstGoneIndex) {
    const ledger = getKnowledgeLedger();
    const followed = followMessagesById(ledger, chat);
    const dropped = dropKnowledgeFrom(ledger, firstGoneIndex);
    const changed = followed || dropped;
    if (changed) await saveMetadata();
    return changed;
}

/**
 * Bring every ledger entry that names its message by message id up to date
 * with the chat: a holder entry, the scene or a scene in the scene history whose
 * message is still in the chat gets that message's index; one whose message
 * is gone is removed, as are the facts this leaves without holders. A scene
 * whose message is gone goes back to the latest earlier scene that remains.
 *
 * lastUpdatedAt follows its message too. When that message is gone, the
 * ledger covers up to the latest message that still carries a message id:
 * Story Arc gives one to exactly the messages an update read, so that is
 * the last read message left. With none left, the index rule of dropKnowledgeFrom decides.
 *
 * Entries without a message id (ledgers from before the ids, the user's own)
 * stay as they are. Does not save.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {object[]} chatMessages - ST's chat array as it is now
 * @returns {boolean} True when anything in the ledger changed
 */
function followMessagesById(ledger, chatMessages) {
    const indexOfMessageId = new Map();
    chatMessages.forEach((chatMessage, index) => {
        const messageId = messageIdOf(chatMessage);
        if (messageId && !indexOfMessageId.has(messageId)) indexOfMessageId.set(messageId, index);
    });
    let changed = false;

    const isGone = entry => entry.messageId !== undefined && !indexOfMessageId.has(entry.messageId);
    const moveToMessage = entry => {
        if (entry.messageId === undefined) return;
        const index = indexOfMessageId.get(entry.messageId);
        if (entry.at === index) return;
        entry.at = index;
        changed = true;
    };

    // A retraction whose correcting message is gone gives its fact back first;
    // a retracted fact that stays retracted keeps the holders of messages
    // that remain (keepOnlyHolders).
    if (keepOnlyHolders(ledger, entry => !isGone(entry))) changed = true;
    for (const fact of ledger.facts) fact.holders.forEach(moveToMessage);
    for (const retraction of ledger.retractedFacts || []) {
        moveToMessage(retraction);
        retraction.fact.holders.forEach(moveToMessage);
    }

    // A ledger from before the scene history has none and gets none here.
    const sceneHistory = ledger.sceneHistory || [];
    const remainingScenes = sceneHistory.filter(scene => !isGone(scene));
    remainingScenes.forEach(moveToMessage);
    if (isGone(ledger.scene)) {
        ledger.scene = remainingScenes.pop() || { at: null, present: [] };
        changed = true;
    } else {
        moveToMessage(ledger.scene);
    }
    if (ledger.sceneHistory && remainingScenes.length !== sceneHistory.length) {
        ledger.sceneHistory = remainingScenes;
        changed = true;
    }

    if (ledger.lastUpdatedMessageId !== undefined) {
        const lastUpdatedIndex = indexOfMessageId.get(ledger.lastUpdatedMessageId);
        if (lastUpdatedIndex === undefined) {
            const latestWithId = latestMessageWithId(chatMessages);
            if (latestWithId) {
                ledger.lastUpdatedAt = latestWithId.index;
                ledger.lastUpdatedMessageId = latestWithId.messageId;
            } else {
                delete ledger.lastUpdatedMessageId;
            }
            changed = true;
        } else if (ledger.lastUpdatedAt !== lastUpdatedIndex) {
            ledger.lastUpdatedAt = lastUpdatedIndex;
            changed = true;
        }
    }
    return changed;
}

/**
 * The Story Arc message id a chat message carries, if any.
 * @param {object} chatMessage
 * @returns {string|undefined}
 */
function messageIdOf(chatMessage) {
    return chatMessage?.extra?.[MESSAGE_ID_KEY];
}

/**
 * The last message in the chat that carries a Story Arc message id.
 * @param {object[]} chatMessages
 * @returns {{index: number, messageId: string}|null}
 */
function latestMessageWithId(chatMessages) {
    for (let index = chatMessages.length - 1; index >= 0; index--) {
        const messageId = messageIdOf(chatMessages[index]);
        if (messageId) return { index, messageId };
    }
    return null;
}

/**
 * Take back what the ledger learned from message `firstGoneIndex` on: the
 * user regenerated, swiped or deleted the messages it came from, or loaded a
 * branch that ends before them. Removes every holder entry learned at that
 * message or later, and every fact this leaves without holders. A holder
 * entered by the user (`at: null`) is never removed, so its fact stays.
 * A fact a correction at that message or later retracted comes back.
 * A scene from a dropped message goes back to the latest earlier scene in
 * the scene history; later ones leave the history.
 * Same pattern as dropPendingMarksFrom for the queued marks.
 * Does not save: the caller saves, and only when this returns true.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {boolean} True when anything in the ledger changed
 */
export function dropKnowledgeFrom(ledger, firstGoneIndex) {
    let changed = keepOnlyHolders(ledger, holder => holder.at === null || holder.at < firstGoneIndex);

    // The scene came from a dropped message: it goes back to the latest scene
    // recorded before that message. Without one, nobody is known to be present.
    // A ledger from before the scene history has none.
    const sceneHistory = ledger.sceneHistory || [];
    const earlierScenes = sceneHistory.filter(scene => scene.at < firstGoneIndex);
    if (reachesMessage(ledger.scene.at, firstGoneIndex)) {
        ledger.scene = earlierScenes.pop() || { at: null, present: [] };
        changed = true;
    }
    if (earlierScenes.length !== sceneHistory.length) {
        ledger.sceneHistory = earlierScenes;
        changed = true;
    }

    // The ledger now covers only the messages before firstGoneIndex, so the
    // next update reads from there on.
    // Its message id named the message it moves away from.
    if (reachesMessage(ledger.lastUpdatedAt, firstGoneIndex)) {
        const lastKeptIndex = firstGoneIndex - 1;
        ledger.lastUpdatedAt = lastKeptIndex >= 0 ? lastKeptIndex : null;
        delete ledger.lastUpdatedMessageId;
        changed = true;
    }

    if (changed) {
        console.log(`[Story Arc] Dropped knowledge learned from message #${firstGoneIndex} on`);
    }
    return changed;
}

/**
 * Keep only the holder entries `isKept` accepts, and drop every fact this
 * leaves without holders: only the dropped entries taught it, so the story
 * no longer contains it.
 *
 * A retraction `isKept` does not accept (its `at` is the correcting message)
 * is taken back first: its fact returns to the facts, under a free id when a
 * fact entered meanwhile took its own, and then loses the dropped holder
 * entries like any other fact. A fact that stays retracted loses them too,
 * and its retraction goes when no holder entry is left.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {function(object): boolean} isKept - Gets a holder entry or a retraction, both with `at`
 * @returns {boolean} True when any holder entry or retraction was dropped
 */
function keepOnlyHolders(ledger, isKept) {
    let changed = false;
    // A ledger from before retractions has none.
    const retractedFacts = ledger.retractedFacts || [];
    const keptRetractions = retractedFacts.filter(isKept);
    if (keptRetractions.length !== retractedFacts.length) {
        for (const retraction of retractedFacts) {
            if (keptRetractions.includes(retraction)) continue;
            const fact = retraction.fact;
            if (ledger.facts.some(candidate => candidate.id === fact.id)) fact.id = nextLedgerId('f', ledger.facts);
            ledger.facts.push(fact);
        }
        changed = true;
    }
    // A fact that stays retracted loses the dropped holder entries too, so
    // it comes back right if its correction goes later; with none left it
    // has nothing to come back as, and its retraction goes.
    const remainingRetractions = [];
    for (const retraction of keptRetractions) {
        const remainingHolders = retraction.fact.holders.filter(isKept);
        if (remainingHolders.length !== retraction.fact.holders.length) {
            retraction.fact.holders = remainingHolders;
            changed = true;
        }
        if (remainingHolders.length > 0) remainingRetractions.push(retraction);
    }
    if (remainingRetractions.length !== retractedFacts.length) ledger.retractedFacts = remainingRetractions;

    const remainingFacts = [];
    for (const fact of ledger.facts) {
        const remainingHolders = fact.holders.filter(isKept);
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

/**
 * Whether a message index the ledger stores (lastUpdatedAt, the scene's
 * `at`) reaches the given message: it is that message or a later one.
 * Null, before any update, reaches no message.
 * @param {number|null} storedIndex
 * @param {number} messageIndex
 * @returns {boolean}
 */
function reachesMessage(storedIndex, messageIndex) {
    return storedIndex !== null && storedIndex >= messageIndex;
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
 *
 * The shown swipe loses Story Arc's message id, which ST may have brought back
 * from the swipe's own `extra`, and so does every swipe's `extra` in
 * `swipe_info`, where ST keeps the id of a swipe it swiped away from:
 * the ledger holds nothing of this message any more, and only a message an
 * update read carries one, so a later deletion or a branch from one of
 * these swipes finds the last read message (followMessagesById).
 * The extraction that reads the swipe gives it a new one. lastUpdatedAt
 * names the message before it by that message's id.
 * @param {number} messageIndex - Index of the swiped message
 * @returns {Promise<boolean>} True when the ledger changed and was saved
 */
export async function updateKnowledgeAfterSwipe(messageIndex) {
    const ledger = getKnowledgeLedger();
    const wasRead = reachesMessage(ledger.lastUpdatedAt, messageIndex);
    const dropped = dropKnowledgeFrom(ledger, messageIndex);
    const message = chat[messageIndex];
    if (message?.extra) delete message.extra[MESSAGE_ID_KEY];
    if (Array.isArray(message?.swipe_info)) {
        for (const swipeInfo of message.swipe_info) {
            if (swipeInfo?.extra) delete swipeInfo.extra[MESSAGE_ID_KEY];
        }
    }
    const lastReadMessageId = ledger.lastUpdatedAt === null ? undefined : messageIdOf(chat[ledger.lastUpdatedAt]);
    if (dropped && lastReadMessageId) ledger.lastUpdatedMessageId = lastReadMessageId;
    if (dropped) await saveMetadata();

    // ST sets swipe_id to the slot the generation will fill, one past the
    // swipes that exist, before it fires the event.
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
 * the ledger already reaches past the message, lastUpdatedAt, the scene
 * and the scene history stay as they are.
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
    const readBefore = reachesMessage(lastUpdatedAtBefore, messageIndex);
    const readNow = reachesMessage(lastUpdatedAtNow, messageIndex);
    const coverageMoved = readBefore ? !readNow : lastUpdatedAtNow !== lastUpdatedAtBefore;
    if (coverageMoved) {
        console.log(`[Story Arc] The knowledge ledger moved over message #${messageIndex} during its extraction; the answer is not applied`);
        return false;
    }

    const sceneNow = ledgerNow.scene;
    const sceneHistoryNow = ledgerNow.sceneHistory;
    const lastUpdatedMessageIdNow = ledgerNow.lastUpdatedMessageId;
    applyExtractionAnswer(ledgerNow, answer, messageIndex, messageIndex, chat);
    if (readNow && lastUpdatedAtNow > messageIndex) {
        ledgerNow.lastUpdatedAt = lastUpdatedAtNow;
        if (lastUpdatedMessageIdNow !== undefined) {
            ledgerNow.lastUpdatedMessageId = lastUpdatedMessageIdNow;
        } else {
            delete ledgerNow.lastUpdatedMessageId;
        }
        ledgerNow.scene = sceneNow;
        // A ledger from before the scene history stays without one.
        if (sceneHistoryNow) {
            ledgerNow.sceneHistory = sceneHistoryNow;
        } else {
            delete ledgerNow.sceneHistory;
        }
    }
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
    const wasRead = reachesMessage(ledger.lastUpdatedAt, messageIndex);
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
 * re-extraction of the message sets again. A fact a correction in this
 * message retracted comes back; the re-extraction may retract it again.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {number} messageIndex
 * @returns {boolean} True when anything in the ledger changed
 */
function dropKnowledgeLearnedAt(ledger, messageIndex) {
    return keepOnlyHolders(ledger, holder => holder.at !== messageIndex);
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

// ─── Build the knowledge block ───

/** Most lines the "Everyone knows" list or one character's "Knows" or "Has told" list prints */
export const KNOWLEDGE_LIST_CAP = 5;

const KNOWLEDGE_BLOCK_HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character knows only their own list, what everyone knows, and what happened in front of them on-screen. '
    + 'Rumors, teammates, news reports and "someone told me" carry nothing that is not on a character\'s list. '
    + 'A character not listed here knows only what everyone knows.]';

/**
 * Build the knowledge block the narrator sees: what everyone knows (the
 * public facts), then for the characters in the scene and the characters
 * the latest messages talk about, what each one knows and (talked about
 * only) has told. The block states only what characters know, never what
 * they do not: a "does not know" line would put the secret in front of the
 * narrator once per bystander.
 *
 * A holder entry of a planned holder (how 'plan') is never printed, and a
 * fact held only by planned holders is printed nowhere: a secret's text
 * stays in the SECRETS block, which gates it by phase.
 *
 * @param {object} ledger - The knowledge ledger (createEmptyKnowledgeLedger shape)
 * @param {object[]} messages - The chat messages; the latest user message and
 *     the latest reply among them decide who is talked about
 * @returns {string} The block text, or '' when there is no public fact and
 *     no covered character has a line
 */
export function buildKnowledgeBlock(ledger, messages) {
    if (!ledger) return '';

    const presentCharacters = ledger.characters.filter(character => ledger.scene.present.includes(character.id));
    const latestText = latestUserMessageAndReplyText(messages);
    const talkedAboutCharacters = ledger.characters.filter(character =>
        !ledger.scene.present.includes(character.id) && isNamedInText(character, latestText));

    const sections = [];
    const publicFacts = ledger.facts.filter(fact => fact.public);
    if (publicFacts.length > 0) {
        const publicEntries = publicFacts.map(fact => ({ at: newestHolderAt(fact.holders), line: `- ${fact.text}` }));
        sections.push(['EVERYONE KNOWS', ...newestCapped(publicEntries)].join('\n'));
    }

    // Facts held only by planned holders get no line anywhere.
    const printableFacts = ledger.facts.filter(fact =>
        !fact.public && fact.holders.some(holder => holder.how !== HOLDER_HOW.plan));

    for (const character of presentCharacters) {
        const lines = knowledgeLinesForCharacter(ledger, character, printableFacts, false);
        if (lines.length === 0) continue;
        sections.push([`${character.name.toUpperCase()} (present)`, ...lines].join('\n'));
    }
    for (const character of talkedAboutCharacters) {
        const lines = knowledgeLinesForCharacter(ledger, character, printableFacts, true);
        if (lines.length === 0) continue;
        sections.push([`${character.name.toUpperCase()} (talked about, not present)`, ...lines].join('\n'));
    }
    if (sections.length === 0) return '';

    return [KNOWLEDGE_BLOCK_HEADER, ...sections].join('\n\n');
}

/**
 * The story text of the latest user message and the latest reply, joined.
 * Hidden (system) messages are skipped, and tagged elements are taken out:
 * presets append status blocks (`<svt>…</svt>`, `<trk>…</trk>`) to replies
 * whose lines name characters who are nowhere in the story text.
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
    return withoutTaggedElements(`${latestUserText || ''}\n${latestReplyText || ''}`);
}

/** HTML inline formatting tags: story text, so only their markup goes */
const INLINE_FORMATTING_TAG = /<\/?(?:i|b|em|strong|u|s|del|ins|mark|small|sub|sup|span|font|q|code)(?:\s[^>]*)?>/gi;

/**
 * The text with every tagged element (`<tag …>…</tag>`) removed, nested
 * ones included, such as a preset's status block. Inline formatting tags
 * (`<i>`, `<b>`, `<span>` …) lose only their markup, because what they
 * wrap is story text. Each pass removes the elements whose content holds
 * no tag of their own name, so a tag nested in one of the same name goes
 * first and its parent in a later pass. A tag that is never closed stays.
 * @param {string} text
 * @returns {string}
 */
function withoutTaggedElements(text) {
    const taggedElement = /<([A-Za-z][\w:-]*)(?:\s[^>]*)?>(?:(?!<\/?\1[\s>/])[\s\S])*?<\/\1\s*>/g;
    let remainingText = text.replace(INLINE_FORMATTING_TAG, '');
    let previousText;
    do {
        previousText = remainingText;
        remainingText = remainingText.replace(taggedElement, ' ');
    } while (remainingText !== previousText);
    return remainingText;
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
 * The "Knows" and (talked about only) "Has told" lines of one character,
 * each list newest first and capped.
 * @param {object} ledger
 * @param {object} character
 * @param {object[]} printableFacts - Facts that may get a line at all
 * @param {boolean} isTalkedAbout - Whether the character is talked about, not present
 * @returns {string[]}
 */
function knowledgeLinesForCharacter(ledger, character, printableFacts, isTalkedAbout) {
    const knownEntries = [];
    const toldEntries = [];

    for (const fact of printableFacts) {
        const ownHolder = fact.holders.find(holder => holder.characterId === character.id);
        if (ownHolder && ownHolder.how !== HOLDER_HOW.plan) {
            knownEntries.push({ at: ownHolder.at, line: knowsLine(ledger, fact, ownHolder) });
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
        ...newestCapped(toldEntries),
    ];
}

/**
 * The "Knows" line of one fact, saying who told the character when they were
 * told, and who else holds the fact, planned holders left out.
 * @param {object} ledger
 * @param {object} fact
 * @param {object} holder - The character's own holder entry
 * @returns {string}
 */
function knowsLine(ledger, fact, holder) {
    const otherHolderNames = fact.holders
        .filter(otherHolder => otherHolder.how !== HOLDER_HOW.plan && otherHolder.characterId !== holder.characterId)
        .map(otherHolder => characterName(ledger, otherHolder.characterId));
    const sharedWith = otherHolderNames.length > 0
        ? `(shared only with ${joinNames(otherHolderNames)})`
        : '(known only to them)';
    if (holder.how === HOLDER_HOW.told && holder.toldBy) {
        return `- Knows (told by ${characterName(ledger, holder.toldBy)}): ${fact.text} ${sharedWith}`;
    }
    return `- Knows: ${fact.text} ${sharedWith}`;
}

/**
 * A character's name, for the knowledge block and the Knowledge popup.
 * @param {object} ledger
 * @param {string} characterId
 * @returns {string} The character's name, or the id when the ledger has no such character
 */
export function characterName(ledger, characterId) {
    const character = ledger.characters.find(candidate => candidate.id === characterId);
    return character ? character.name : characterId;
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
 * "Ellie", "Ellie and Noor", "Ellie, Noor and Dougal".
 * @param {string[]} names
 * @returns {string}
 */
function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
