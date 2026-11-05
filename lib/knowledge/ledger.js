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
import { MESSAGE_ID_KEY, assignCoveredMessageIds, messageIdOf } from './message-ids.js';
import { DETAIL_KINDS, DETAIL_STATUS_VALUES, HOLDER_HOW, KNOWLEDGE_PROMPT_KEY, NAMES_PROMPT_KEY } from '../core/constants.js';
import { buildTakenNamesBlock, listTakenNames } from './names.js';
import { isEnabled, isKnowledgeTrackerEnabled, isCharacterDetailsEnabled, beatRecognitionPath, getKnowledgeLedger, getKnowledgeTrackerSettings, secretHolders } from '../core/settings.js';
import { calculatePhase, shouldShowSecret } from '../injection/pacing.js';
import { flushPendingMarks } from '../injection/signals.js';
import { completeBeats, reopenCompletionsAt, removeRulingsAt } from '../planning/beat-completion.js';
import { getActiveArcs } from '../planning/storage.js';
import { callLlm, fillTemplate, loadTemplate } from '../planning/generator.js';
import { parseLlmJson } from '../planning/validation.js';

// ─── Update after a reply ───

/** True while an extraction call is out, so a second one never overlaps it. */
let knowledgeUpdateRunning = false;

/**
 * After an AI reply, once every N replies (the tracker's update interval):
 * run the extraction over every message since the ledger's last update,
 * apply the answer to the ledger, complete the beats it reports fulfilled,
 * and save. The caller does not wait for it, so the next
 * generation is never held up; a prompt built meanwhile uses the ledger as
 * it is.
 *
 * A failed call or an unreadable answer changes nothing but the update log
 * (a skipped record, saved) and lastUpdatedAt stays, so the next update
 * reads the missed messages again. A ledger that
 * was never updated (lastUpdatedAt null) reads only the latest exchange, the
 * reply and the user message before it: a long chat's history is not
 * backfilled. While an extraction is out, a later reply starts none; its
 * messages are covered by the next update.
 * @param {number} replyIndex - Index of the reply that just arrived
 * @returns {Promise<KnowledgeUpdateResult>} ledgerChanged when the ledger was
 *     updated and saved, beatsChanged when beats completed
 */
export async function updateKnowledgeAfterReply(replyIndex) {
    if (!isEnabled() || !isKnowledgeTrackerEnabled()) return NOTHING_CHANGED;
    if (knowledgeUpdateRunning) return NOTHING_CHANGED;

    const ledgerBefore = getKnowledgeLedger();
    const lastUpdatedAt = ledgerBefore.lastUpdatedAt;
    const interval = getKnowledgeTrackerSettings().updateInterval;
    if (lastUpdatedAt !== null && repliesSince(chat, lastUpdatedAt, replyIndex) < interval) return NOTHING_CHANGED;

    const fromIndex = lastUpdatedAt === null ? latestExchangeStart(chat, replyIndex) : lastUpdatedAt + 1;
    if (fromIndex > replyIndex) return NOTHING_CHANGED;

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
    if (!answer) {
        await recordSkippedUpdate(ledgerBefore, chatStateBefore, fromIndex, replyIndex, 'no answer');
        return NOTHING_CHANGED;
    }

    if (chat_metadata.story_arc !== chatStateBefore || chat[replyIndex] !== reply || reply?.mes !== replyText) {
        console.log('[Story Arc] The chat changed during the knowledge extraction; its answer is not applied');
        await recordSkippedUpdate(ledgerBefore, chatStateBefore, fromIndex, replyIndex, 'chat changed');
        return NOTHING_CHANGED;
    }
    // Re-read: the Knowledge popup may have edited the ledger during the call,
    // and those edits must not be lost.
    const ledgerNow = getKnowledgeLedger();
    if (ledgerNow.lastUpdatedAt !== lastUpdatedAt) {
        console.log('[Story Arc] The knowledge ledger was rolled back during the extraction; its answer is not applied');
        await recordSkippedUpdate(ledgerNow, chatStateBefore, fromIndex, replyIndex, 'ledger moved');
        return NOTHING_CHANGED;
    }

    // The update moves lastUpdatedAt on past replyIndex, so the apply always
    // changes the ledger.
    const holdingsBefore = knowledgeHoldings(ledgerNow);
    const characterIdsBefore = ledgerNow.characters.map(character => character.id);
    const detailCounts = {};
    const newNameCounts = {};
    applyExtractionAnswer(ledgerNow, answer, fromIndex, replyIndex, chat, detailCounts, newNameCounts);
    // After the apply, which gave the covered messages their message ids, so
    // each completion record names its message by id.
    const beatsCompleted = await completeFulfilledBeats(answer.fulfilled, replyIndex);
    const rulingsStored = storeRulings(answer.rulings);
    recordKnowledgeUpdate(ledgerNow, extractionRecord('update', fromIndex, replyIndex, answer, holdingsBefore, ledgerNow, beatsCompleted, rulingsStored, detailCounts, newNameCounts));
    await saveMetadata();
    console.log(`[Story Arc] Knowledge ledger updated from messages #${fromIndex} to #${replyIndex}`);
    return withFlaggedCharacters(
        { ledgerChanged: true, beatsChanged: beatsCompleted > 0 || rulingsStored > 0 },
        ledgerNow, characterIdsBefore);
}

/**
 * What an update, a swipe or an edit tells its caller: whether the
 * knowledge ledger changed (the status line), whether the progress
 * display changed (beatsChanged): beats were completed or reopened, or
 * rulings stored, and which characters it added with a taken name
 * (flaggedCharacters, for the caller's notice; present only when it
 * flagged one).
 * @typedef {{ledgerChanged: boolean, beatsChanged: boolean, flaggedCharacters?: {id: string, name: string}[]}} KnowledgeUpdateResult
 */

/** The KnowledgeUpdateResult of an update that changed nothing. */
const NOTHING_CHANGED = Object.freeze({ ledgerChanged: false, beatsChanged: false });

/**
 * The result with the characters an apply added and flagged for a taken
 * name: the records not in the ledger before it that carry a nameClash.
 * @param {KnowledgeUpdateResult} result
 * @param {object} ledger - The ledger after the apply
 * @param {string[]} characterIdsBefore - The character ids before the apply
 * @returns {KnowledgeUpdateResult}
 */
function withFlaggedCharacters(result, ledger, characterIdsBefore) {
    const flaggedCharacters = ledger.characters
        .filter(character => !characterIdsBefore.includes(character.id) && character.nameClash)
        .map(character => ({ id: character.id, name: characterDisplayName(ledger, character) }));
    if (flaggedCharacters.length === 0) return result;
    return { ...result, flaggedCharacters };
}

/**
 * Complete the beats an applied extraction answer reports fulfilled
 * (completeBeats: same rules as the in-prompt marker, one completion per arc
 * per message, no promotion). A completion changes the prompt anyway, so
 * the queued PLANTED/FIRED marks are applied with it (ADR-0005).
 * Saves through completeBeats and flushPendingMarks.
 * @param {object[]} fulfilled - The answer's fulfilled list, resolved (resolveFulfilledBeats)
 * @param {number} messageIndex - The last message the answer covers
 * @returns {Promise<number>} How many beats completed
 */
async function completeFulfilledBeats(fulfilled, messageIndex) {
    if (!Array.isArray(fulfilled) || fulfilled.length === 0) return 0;
    const { completedBeats } = await completeBeats(fulfilled, getActiveArcs());
    if (completedBeats.length > 0) await flushPendingMarks(messageIndex, true);
    return completedBeats.length;
}

/**
 * Store the resolved rulings of an applied extraction answer on the arcs
 * they contradict, one copy on each (resolveRulings). Runs after the
 * apply, which gave the covered messages their message ids, so each ruling
 * names its message by id. Skipped: a ruling whose text and chosen option
 * match an open ruling of the same arc (the player repeats a ruling; two
 * "Option one" picks against different option sets are two rulings), and one the arc
 * already holds from the same message with the same text (a re-extraction
 * reports it again). Each stored ruling gets an id unique in the arc (r1,
 * r2, …) and no answeredAt: it is open until a re-plan of the arc
 * (applyReplan). A bare pick also keeps the option it chose, as found.
 * An arc from before rulings has none and gets the list here.
 * Does not save: the update saves.
 * @param {object[]} rulings - The answer's rulings, resolved
 * @returns {number} How many rulings were stored
 */
function storeRulings(rulings) {
    let rulingsStored = 0;
    for (const ruling of rulings || []) {
        const messageId = messageIdOf(chat[ruling.at]);
        const wantedText = normalisedQuote(ruling.text);
        const wantedChose = normalisedQuote(ruling.chose ?? '');
        for (const arcId of ruling.arcIds) {
            const arc = getActiveArcs().find(candidate => candidate.id === arcId);
            if (!arc) continue;
            const arcRulings = arc.rulings || [];
            const repeatsOpenRuling = arcRulings.some(stored =>
                stored.answeredAt === undefined
                && normalisedQuote(stored.text) === wantedText
                && normalisedQuote(stored.chose ?? '') === wantedChose);
            const reportedAgain = arcRulings.some(stored =>
                (stored.at === ruling.at || (messageId && stored.messageId === messageId))
                && normalisedQuote(stored.text) === wantedText);
            if (repeatsOpenRuling || reportedAgain) continue;

            const storedRuling = { id: nextLedgerId('r', arcRulings), text: ruling.text, at: ruling.at };
            if (ruling.chose !== undefined) storedRuling.chose = ruling.chose;
            if (messageId) storedRuling.messageId = messageId;
            arc.rulings = [...arcRulings, storedRuling];
            rulingsStored++;
        }
    }
    return rulingsStored;
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
 * Ask the LLM who learned what in the messages from `fromIndex` on, and
 * which beats they fulfilled. The call goes through the arc generation
 * connection profile and the transport the plan check uses. A failed call or
 * an unreadable answer returns null, and the caller changes nothing: the
 * next update covers the same messages again.
 * The input also lists the active arcs' shown secrets; the answer's revealed
 * secrets come back resolved to those secrets, ready to apply. While the
 * extraction recognises beats (beatRecognitionPath), the input lists the beats the
 * story may fulfil (listRecognisableBeats), and the answer's fulfilled
 * beats come back resolved to beat completions, ready for
 * completeBeats. With it off the list is empty, so nothing can be fulfilled.
 * `onlyBeats` narrows the list for the re-extraction of an edited older
 * message (updateKnowledgeAfterEdit). The input also lists the plans of
 * the arcs that are not paused (listArcPlans), whatever beat recognition
 * says, and the answer's rulings come back checked against the player's
 * messages (resolveRulings), ready for storeRulings. While character
 * details are off (isCharacterDetailsEnabled) the prompt asks for no
 * details and no unnamed relatives, and the answer comes back without
 * them: no details, no new character without a name, no `wasUnnamed`.
 * @param {object} ledger - The chat's knowledge ledger
 * @param {object[]} chatMessages - ST's chat array (`name`, `is_user`, `mes`, `is_system`)
 * @param {number} fromIndex - First message the extraction reads
 * @param {string} personaName - The player's persona name
 * @param {{arcId: string, beatId: string}[]} [onlyBeats] - Offer only these active beats; all when absent
 * @returns {Promise<{present: string[], newCharacters: object[], learned: object[], revealedSecrets: object[], retracted: object[], fulfilled: object[], rulings: object[]}|null>}
 */
export async function extractKnowledge(ledger, chatMessages, fromIndex, personaName, onlyBeats) {
    try {
        const template = await loadTemplate('extract-knowledge.txt');
        const activeArcs = getActiveArcs();
        const shownSecrets = listShownSecrets(activeArcs);
        const recognisableBeats = beatRecognitionPath() === 'extraction' ? listRecognisableBeats(activeArcs, onlyBeats) : [];
        // Not behind beat recognition: a ruling is not a recognition.
        const arcPlans = listArcPlans(activeArcs);
        const withDetails = isCharacterDetailsEnabled();
        const variables = buildKnowledgeExtractionVariables(ledger, chatMessages, fromIndex, personaName, shownSecrets, recognisableBeats, arcPlans, withDetails);
        const prompt = fillTemplate(template, variables);
        // The last message the prompt lists: the read window ends there. Taken
        // before the call, because a message sent during it grows the chat.
        const lastReadIndex = chatMessages.length - 1;
        const response = await callLlm(prompt);
        const answer = parseKnowledgeExtractionAnswer(response);
        if (!answer) {
            console.warn('[Story Arc] Knowledge extraction answered no readable JSON; the ledger stays as it is');
            return null;
        }
        const fulfilledBeats = resolveFulfilledBeats(answer.fulfilled, recognisableBeats, fromIndex, lastReadIndex);
        return {
            ...answer,
            revealedSecrets: resolveRevealedSecrets(answer.revealedSecrets, shownSecrets),
            fulfilled: fulfilledBeats,
            rulings: resolveRulings(answer.rulings, arcPlans, chatMessages, fromIndex, lastReadIndex, latestShownMessageBefore(chatMessages, fromIndex)),
            newCharacters: withDetails ? answer.newCharacters : withoutUnnamedRelatives(answer.newCharacters),
            details: withDetails ? answer.details : [],
        };
    } catch (err) {
        console.warn('[Story Arc] Knowledge extraction failed; the ledger stays as it is:', err);
        return null;
    }
}

/**
 * New characters as the extraction gave them before character details: the
 * named ones only, each without `wasUnnamed`, so no unnamed relative is
 * created or named.
 * @param {object[]} newCharacters - From parseKnowledgeExtractionAnswer
 * @returns {{name: string, aliases: string[]}[]}
 */
function withoutUnnamedRelatives(newCharacters) {
    const namedCharacters = newCharacters.filter(newCharacter => newCharacter.name.trim());
    return namedCharacters.map(newCharacter => ({ name: newCharacter.name, aliases: newCharacter.aliases }));
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
 * The beats the extraction may recognise as fulfilled: the active beats of
 * every active arc that is not paused, the set the in-prompt BEAT CHECK
 * covers with the tracker off. A background arc's beats are listed: its
 * milestones stay recognisable while it is off screen. A paused arc's are
 * not (GLOSSARY.md, "Paused"). An arc without an active beat has nothing
 * to recognise and is left out.
 *
 * Each active beat gets the id the extraction reports it by,
 * `<first 8 characters of the arc id>:<beat id>`, the marker's arc id. The
 * arc's completed beats come along by fulfillment, without ids, so the
 * extraction sees how far the arc has come; they cannot be reported.
 * With `onlyBeats`, only those of the active beats are listed.
 * @param {object[]} arcs - The chat's arcs; only active ones count
 * @param {{arcId: string, beatId: string}[]} [onlyBeats] - The beats to list, arcId the full id; all active ones when absent
 * @returns {{arcId: string, title: string, active: {developmentId: string, beatId: string, intention: string}[], done: string[]}[]}
 */
export function listRecognisableBeats(arcs, onlyBeats) {
    const recognisableBeats = [];
    for (const arc of arcs) {
        if (arc.status !== 'active' || arc.focus === 'paused') continue;
        const beats = arc.beats || [];
        const activeBeats = beats.filter(beat => beat.status === 'active'
            && (!onlyBeats || onlyBeats.some(only => only.arcId === arc.id && only.beatId === beat.id)));
        if (activeBeats.length === 0) continue;
        // The marker's arc id, the first 8 characters; the entry keeps the full one.
        const arcId = arc.id.slice(0, 8);
        const activeBeatEntries = activeBeats.map(beat => ({ developmentId: `${arcId}:${beat.id}`, beatId: beat.id, intention: beat.intention }));
        const doneIntentions = beats.filter(beat => beat.status === 'completed').map(beat => beat.intention);
        recognisableBeats.push({
            arcId: arc.id,
            title: arc.title,
            active: activeBeatEntries,
            done: doneIntentions,
        });
    }
    return recognisableBeats;
}

/**
 * The plans the extraction checks the player's out-of-character lines
 * against, to notice a ruling: every active arc that is not paused, the set
 * the developments list uses (ADR-0008), with its premise and the pressure
 * of every beat that is not completed. A beat without a pressure (an arc
 * planned before the field) adds none. Pressures carry no ids: a ruling is
 * reported against the arc, never against a beat. Each arc goes by the
 * first 8 characters of its id, like its developments.
 * @param {object[]} arcs - The chat's arcs; only active, non-paused ones count
 * @returns {{arcId: string, shortArcId: string, title: string, premise: string, pressures: string[]}[]}
 */
export function listArcPlans(arcs) {
    const arcPlans = [];
    for (const arc of arcs) {
        if (arc.status !== 'active' || arc.focus === 'paused') continue;
        const openPressures = (arc.beats || [])
            .filter(beat => beat.status !== 'completed' && beat.pressure)
            .map(beat => beat.pressure);
        arcPlans.push({
            arcId: arc.id,
            shortArcId: arc.id.slice(0, 8),
            title: arc.title,
            premise: arc.premise || '',
            pressures: openPressures,
        });
    }
    return arcPlans;
}

/**
 * The parts of extract-knowledge.txt that ask for character details and
 * unnamed relatives, filled in only while character details are switched
 * on (isCharacterDetailsEnabled). Without them the prompt is the one from
 * before character details.
 */
const CHARACTERS_DETAILS_NOTE = ', and after a dash the details the ledger knows about them';

/** Task 2's unnamed-relative rules, each on a line of its own after the task. */
const UNNAMED_RELATIVES_TASK = `
- A relative of a character in the ledger or in your new characters whom the messages do not name ("her mother", "Kendra's brother") is an unnamed relative: leave "name" empty and give "relation", the kinship word ("mother", "brother", "husband"), and "of", the name of the other character. Elsewhere in your answer call them by the name the characters list would show: the other character's name, "'s" and the kinship word ("Kendra Osei's mother"). List an unnamed relative only when the messages make them a character of the story, not for a passing mention.
- The characters list marks an unnamed relative "(unnamed)". When the new messages give one of them a name on screen, list them here with that name and "wasUnnamed", the name the characters list shows for them ("Kendra Osei's mother"), and use the new name in the rest of your answer.`;

/** The newCharacters list of the answer with an unnamed relative and a named one. */
const NEW_CHARACTERS_SCHEMA_WITH_RELATIVES = `[
    { "name": "name", "aliases": ["other name"] },
    { "name": "", "aliases": [], "relation": "kinship word, only for an unnamed relative", "of": "name of the other character" },
    { "name": "the name given on screen", "aliases": [], "wasUnnamed": "the name the characters list shows for an unnamed relative" }
  ]`;

/** The newCharacters list of the answer from before character details. */
const NEW_CHARACTERS_SCHEMA = '[{ "name": "name", "aliases": ["other name"] }]';

/** Task 8 of the extraction prompt, with the blank line that follows it. */
const DETAILS_TASK = `8. DETAILS. The characters list shows the details the ledger knows about each character. For a character from the ledger, report a detail only when the ledger does not know that kind of detail for the character yet and the new messages state it, or when the new messages show it changing on screen: an event the text shows happening, such as a transfer, a new job, a death, or a dead character seen alive again. A new character from task 2 may carry details too. Write one item per detail:
- "character": the character's name from the ledger or from your new characters.
- "kind": "gender"; "age" (as exact or as vague as the text puts it: "18", "twenty-something"); "role" (the job or place in the world, plus where it puts them: "cleaner, double shifts, Oakland"); "relation" (kinship to another character in the ledger or in your new characters: "mother", "brother", "husband"); or "status" ("dead" when the text shows or states a death; "alive" only for a character the ledger lists as dead whom the text shows alive again, never for a character merely seen or mentioned).
- "value": the detail in a few words, always as a string. For a relation the kinship word only; for a status "alive" or "dead".
- "of": only for a relation, the name of the other character ("Kendra Osei" for Kendra Osei's mother).
- "change": only for a detail the ledger already knows, the on-screen event that changes it, in one short sentence ("Vera transfers to the Wards."). Leave it out for a detail the ledger does not know yet.
- "at": the index in square brackets of the message that states it, one of the new messages.
Record only what the text states. Never guess a detail from a name, a look, a trope or what would be likely. A detail the ledger already knows is not reported again unless the new messages show it changing. A different value merely stated, with no such event, is not a change: do not report it. The ledger's value stays, and the narrator stated it wrongly. Out-of-character lines set no detail.

`;

/** The details list of the answer, after the rulings list. */
const DETAILS_SCHEMA = `,
  "details": [
    { "character": "name", "kind": "gender | age | role | relation | status", "value": "the detail as a string", "of": "name, only for a relation", "change": "only for a changed detail: the on-screen event", "at": <index of the message> }
  ]`;

/**
 * Template variables for extract-knowledge.txt: the persona's name, the
 * ledger's characters with their aliases and their known character details
 * (each labelled by its kind, so the extraction can tell a restatement from
 * a first statement), the facts by id with their holders
 * (or "public"), the shown secrets by ref with their planned holders, the
 * recognisable beats per arc (active ones by id, completed ones under
 * "done" without ids), the plans of the arcs by short arc id (premise and
 * open pressures), and the messages from `fromIndex` on, each with its
 * index. Hidden (system) messages are not story and are left out. Without
 * `withDetails` the characters carry no details, the details and
 * unnamed-relative parts of the prompt stay empty, and an unnamed relative
 * keeps its display name but loses its "(unnamed)" mark.
 * @param {object} ledger
 * @param {object[]} chatMessages - ST's chat array
 * @param {number} fromIndex
 * @param {string} personaName
 * @param {object[]} [shownSecrets] - From listShownSecrets
 * @param {object[]} [recognisableBeats] - From listRecognisableBeats
 * @param {object[]} [arcPlans] - From listArcPlans
 * @param {boolean} [withDetails] - Whether character details are switched on (isCharacterDetailsEnabled)
 * @returns {Record<string, string>}
 */
export function buildKnowledgeExtractionVariables(ledger, chatMessages, fromIndex, personaName, shownSecrets = [], recognisableBeats = [], arcPlans = [], withDetails = true) {
    const characterLines = ledger.characters.map(character => {
        const aliasNote = character.aliases.length ? ` (also: ${character.aliases.join(', ')})` : '';
        const detailNotes = [];
        for (const kind of DETAIL_KINDS) {
            if (!withDetails) continue;
            const detailText = currentDetailText(ledger, character, kind);
            if (detailText !== null) detailNotes.push(`${kind}: ${detailText}`);
        }
        const detailNote = detailNotes.length ? ` — ${detailNotes.join('; ')}` : '';
        const unnamedNote = withDetails && !character.name.trim() ? ' (unnamed)' : '';
        return `- ${characterDisplayName(ledger, character)}${unnamedNote}${aliasNote}${detailNote}`;
    });

    const characterNames = new Map(ledger.characters.map(character => [character.id, characterDisplayName(ledger, character)]));
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

    const recognisableBeatBlocks = recognisableBeats.map(arcBeats => {
        const lines = [`Arc "${arcBeats.title}":`];
        for (const recognisableBeat of arcBeats.active) {
            lines.push(`- [${recognisableBeat.developmentId}] ${recognisableBeat.intention}`);
        }
        if (arcBeats.done.length) {
            lines.push('  done:');
            for (const intention of arcBeats.done) lines.push(`  - ${intention}`);
        }
        return lines.join('\n');
    });

    const arcPlanBlocks = arcPlans.map(arcPlan => {
        const lines = [`[${arcPlan.shortArcId}] "${arcPlan.title}"`, `Premise: ${arcPlan.premise || '(none)'}`];
        if (arcPlan.pressures.length) {
            lines.push('Pressures:');
            for (const pressure of arcPlan.pressures) lines.push(`- ${pressure}`);
        }
        return lines.join('\n');
    });

    // Already read: there only so a bare pick in the new messages can be
    // read against the narrator's options it answers.
    const contextIndex = latestShownMessageBefore(chatMessages, fromIndex);
    const contextMessage = chatMessages[contextIndex];
    const contextLine = contextMessage ? `[${contextIndex}] ${contextMessage.name}: ${contextMessage.mes || ''}` : '(none)';

    const messageLines = [];
    for (let index = fromIndex; index < chatMessages.length; index++) {
        const message = chatMessages[index];
        if (!message || message.is_system) continue;
        messageLines.push(`[${index}] ${message.name}: ${message.mes || ''}`);
    }

    return {
        CHARACTERS_DETAILS_NOTE: withDetails ? CHARACTERS_DETAILS_NOTE : '',
        UNNAMED_RELATIVES_TASK: withDetails ? UNNAMED_RELATIVES_TASK : '',
        NEW_CHARACTERS_SCHEMA: withDetails ? NEW_CHARACTERS_SCHEMA_WITH_RELATIVES : NEW_CHARACTERS_SCHEMA,
        DETAILS_TASK: withDetails ? DETAILS_TASK : '',
        DETAILS_SCHEMA: withDetails ? DETAILS_SCHEMA : '',
        PERSONA: personaName || '(no persona)',
        CHARACTERS: characterLines.join('\n') || '(none)',
        FACTS: factLines.join('\n') || '(none)',
        SECRETS: secretLines.join('\n') || '(none)',
        // The prompt calls beats developments, and the answer reports them by developmentId.
        DEVELOPMENTS: recognisableBeatBlocks.join('\n\n') || '(none)',
        PLANS: arcPlanBlocks.join('\n\n') || '(none)',
        CONTEXT_MESSAGE: contextLine,
        MESSAGES: messageLines.join('\n\n'),
    };
}

/**
 * The current value of one kind of a character's details, as text: the last
 * entry of its history. A relation reads "<other character>'s <kinship>"
 * ("Kendra Osei's mother"), built like an unnamed relative's display name
 * (relationText).
 * @param {object} ledger
 * @param {object} character - A ledger character
 * @param {string} kind - One of DETAIL_KINDS
 * @returns {string|null} The text, or null while the kind is unknown
 */
export function currentDetailText(ledger, character, kind) {
    const history = character.details?.[kind];
    if (!Array.isArray(history) || history.length === 0) return null;
    const value = history[history.length - 1].value;
    if (kind === 'relation') return relationText(ledger, value);
    return value;
}

/**
 * Whether the player set this kind of a character's details in the
 * Knowledge popup: its history holds a player entry (`by: 'user'`). The
 * extraction skips a locked kind; clearing the player's value unlocks it.
 * @param {object} character - A ledger character
 * @param {string} kind - One of DETAIL_KINDS
 * @returns {boolean}
 */
export function isDetailLocked(character, kind) {
    const history = character.details?.[kind] || [];
    return history.some(entry => entry.by === 'user');
}

/**
 * The context message of an extraction: the latest message before
 * `fromIndex` that is not hidden (system). The extraction reads it as
 * already read, for the options a ruling picks from.
 * @param {object[]} chatMessages - ST's chat array
 * @param {number} fromIndex - First message the extraction reads
 * @returns {number} Its index, or -1 when there is none
 */
function latestShownMessageBefore(chatMessages, fromIndex) {
    for (let index = fromIndex - 1; index >= 0; index--) {
        const message = chatMessages[index];
        if (message && !message.is_system) return index;
    }
    return -1;
}

/** How a character can learn a fact on-screen, as the extraction reports it. */
const EXTRACTION_HOW_VALUES = [HOLDER_HOW.witnessed, HOLDER_HOW.told];

/**
 * Read the extraction's answer text into the shape applying an answer takes:
 *
 *     { present: [name],
 *       newCharacters: [{ name, aliases: [name], wasUnnamed?: display name }
 *                       | { name: '', aliases: [name], relation: { kind, of: name } }],
 *       newNames: [{ character: name, name }],
 *       learned: [{ factId | text, public, who: [name], how: 'witnessed' | 'told',
 *                   toldBy: name | null, at: messageIndex }],
 *       revealedSecrets: [{ secretId: ref, text, heardBy: [name], at: messageIndex }],
 *       retracted: [{ factId, at: messageIndex }],
 *       fulfilled: [{ developmentId, at: messageIndex }],
 *       rulings: [{ arcs: [short arc id], quote, chose?, at: messageIndex }],
 *       details: [{ character: name, kind: DETAIL_KINDS, value, of?: name, at: messageIndex }] }
 *
 * The answer is taken whole or not at all: unreadable JSON, a missing key or
 * a value of the wrong type gives null, so a half-understood answer never
 * reaches the ledger. A missing newNames, revealedSecrets, retracted or details list reads as
 * empty, because the model may leave out a list it has nothing for. The
 * fulfilled list is the exception: missing or not a list, it reads as
 * empty, and an unreadable item in it is dropped, so a broken beat report
 * never costs the knowledge update. The rulings list is read the same
 * tolerant way; a ruling's chosen option, absent, null or blank, is none. A
 * retracted item names a ledger fact an out-of-character correction took
 * back, and the message of the correction. A details item is a character
 * detail the new messages state: a status is alive or dead, a relation
 * names the other character under `of`. A new character without a name is
 * an unnamed relative and needs its relation (a kinship word under
 * `relation`, the other character under `of`); a named one may carry
 * `wasUnnamed`, the display name of the unnamed relative the new messages
 * name. A newNames item names a ledger character by any of its names and
 * the new name the messages give them. Keys outside the shape
 * are dropped. Names and fact ids are not checked against the ledger here;
 * applying the answer ignores unknown ones. A revealed secret's id is the ref
 * the input listed it under; resolveRevealedSecrets turns it into the secret.
 * @param {string} responseText - The LLM's answer
 * @returns {{present: string[], newCharacters: object[], newNames: object[], learned: object[], revealedSecrets: object[], retracted: object[], fulfilled: object[], rulings: object[], details: object[]}|null}
 */
export function parseKnowledgeExtractionAnswer(responseText) {
    const parsed = parseLlmJson(responseText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!isListOfNames(parsed.present)) return null;
    if (!Array.isArray(parsed.newCharacters) || !Array.isArray(parsed.learned)) return null;

    const newCharacters = [];
    for (const character of parsed.newCharacters) {
        if (!character || typeof character !== 'object' || !isListOfNames(character.aliases)) return null;
        // An unnamed relative has no name, absent, null or blank, and is
        // known by its relation instead: a kinship word and the other character.
        if (!isName(character.name)) {
            if (character.name !== undefined && character.name !== null && typeof character.name !== 'string') return null;
            if (!isName(character.relation) || !isName(character.of)) return null;
            newCharacters.push({ name: '', aliases: character.aliases, relation: { kind: character.relation.trim(), of: character.of } });
            continue;
        }
        // A name given on screen to an unnamed relative names the record it
        // was known as (its display name).
        if (character.wasUnnamed !== undefined && character.wasUnnamed !== null && typeof character.wasUnnamed !== 'string') return null;
        const newCharacter = { name: character.name, aliases: character.aliases };
        if (isName(character.wasUnnamed)) newCharacter.wasUnnamed = character.wasUnnamed;
        newCharacters.push(newCharacter);
    }

    // A new name of a ledger character becomes an alias of its record, so
    // it is read as strictly as a new character. Answers from before the
    // list have none.
    const newNames = [];
    const newNameItems = parsed.newNames === undefined ? [] : parsed.newNames;
    if (!Array.isArray(newNameItems)) return null;
    for (const item of newNameItems) {
        if (!isName(item?.character) || !isName(item.name)) return null;
        newNames.push({ character: item.character, name: item.name });
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

    // Character details are read as strictly as the retracted list: a
    // detail is canon once recorded, so a half-understood item rejects the
    // answer. A value given as a number (an age of 17) is read as its
    // string form. A status is normalised to lower case; a relation names the
    // character it relates to under `of`. The on-screen event of a change,
    // absent, null or blank, is none.
    const details = [];
    const detailItems = parsed.details === undefined ? [] : parsed.details;
    if (!Array.isArray(detailItems)) return null;
    for (const item of detailItems) {
        if (!isName(item?.character) || !DETAIL_KINDS.includes(item.kind)) return null;
        const valueText = Number.isFinite(item.value) ? String(item.value) : item.value;
        if (!isName(valueText) || !Number.isInteger(item.at)) return null;
        let value = valueText.trim();
        if (item.kind === 'status') {
            value = value.toLowerCase();
            if (!DETAIL_STATUS_VALUES.includes(value)) return null;
        }
        const detail = { character: item.character, kind: item.kind, value };
        if (item.kind === 'relation') {
            if (!isName(item.of)) return null;
            detail.of = item.of;
        }
        if (item.change !== undefined && item.change !== null && typeof item.change !== 'string') return null;
        if (isName(item.change)) detail.change = item.change.trim();
        detail.at = item.at;
        details.push(detail);
    }

    // Beat recognition is the newer half of the answer: a missing or broken
    // fulfilled list, or a broken item, costs only the completions, never
    // the knowledge update.
    const fulfilled = [];
    const fulfilledItems = Array.isArray(parsed.fulfilled) ? parsed.fulfilled : [];
    for (const item of fulfilledItems) {
        if (!isName(item?.developmentId) || !Number.isInteger(item.at)) {
            console.warn('[Story Arc] Knowledge extraction: unreadable fulfilled item dropped');
            continue;
        }
        fulfilled.push({ developmentId: item.developmentId, at: item.at });
    }

    // Rulings are as tolerant as the fulfilled list: a broken report costs
    // only the rulings, never the knowledge update or beat recognition.
    const rulings = [];
    const rulingItems = Array.isArray(parsed.rulings) ? parsed.rulings : [];
    for (const item of rulingItems) {
        if (!isListOfNames(item?.arcs) || item.arcs.length === 0 || !isName(item.quote) || !Number.isInteger(item.at)) {
            console.warn('[Story Arc] Knowledge extraction: unreadable ruling dropped');
            continue;
        }
        // A chosen option is there only for a bare pick; absent, null or
        // blank is none. Only one that is not a string makes the item unreadable.
        const hasChose = item.chose !== undefined && item.chose !== null;
        if (hasChose && typeof item.chose !== 'string') {
            console.warn('[Story Arc] Knowledge extraction: unreadable ruling dropped');
            continue;
        }
        const ruling = { arcs: item.arcs, quote: item.quote, at: item.at };
        if (isName(item.chose)) ruling.chose = item.chose;
        rulings.push(ruling);
    }

    return { present: parsed.present, newCharacters, newNames, learned, revealedSecrets, retracted, fulfilled, rulings, details };
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

/**
 * Turn the fulfilled beats of a parsed answer into the beat
 * completions completeBeats takes: `{ arcId, beatId, at }`, arcId the full
 * id. Dropped, with a warning: an id the input did not list as an active
 * beat (unknown, done, pending or locked, or a paused arc's), and an `at`
 * outside the messages the call read. completeBeats checks the beat again
 * when it applies the completion.
 * @param {object[]} fulfilled - The parsed answer's fulfilled list
 * @param {object[]} recognisableBeats - The listRecognisableBeats list the input was built from
 * @param {number} fromIndex - First message the call read
 * @param {number} lastReadIndex - Last message the call read
 * @returns {{arcId: string, beatId: string, at: number}[]}
 */
export function resolveFulfilledBeats(fulfilled, recognisableBeats, fromIndex, lastReadIndex) {
    const resolved = [];
    for (const item of fulfilled) {
        let match = null;
        for (const arcBeats of recognisableBeats) {
            const recognisableBeat = arcBeats.active.find(candidate => candidate.developmentId === item.developmentId);
            if (!recognisableBeat) continue;
            match = { arcId: arcBeats.arcId, beatId: recognisableBeat.beatId };
            break;
        }
        if (!match) {
            console.warn(`[Story Arc] Knowledge extraction reported a development that is not an active beat: ${item.developmentId}`);
            continue;
        }
        if (item.at < fromIndex || item.at > lastReadIndex) {
            console.warn(`[Story Arc] Knowledge extraction reported a fulfillment outside the messages it read: ${item.developmentId} at #${item.at}`);
            continue;
        }
        resolved.push({ ...match, at: item.at });
    }
    return resolved;
}

/**
 * Check the rulings of a parsed answer against the chat and turn them into
 * the shape storeRulings takes: `{ arcIds, text, chose?, at }`, arcIds the
 * full ids, text the quote as it stands in the player's message, chose the
 * picked option as it stands in the narrator's message. Dropped, with a
 * warning: an `at` outside the messages the call read, a message there that
 * is hidden or not the player's, a quote that is not in that message's text
 * (compared ignoring case, with whitespace collapsed), a chosen option found
 * neither in the context message nor in a narrator message the call read
 * before the pick's message (same comparison: the options always come
 * before the pick, so a later reply, even the one being swiped, never
 * counts), and a ruling none of whose arc ids the input listed.
 * So a paraphrase never reaches the card.
 * @param {object[]} rulings - The parsed answer's rulings
 * @param {object[]} arcPlans - The listArcPlans list the input was built from
 * @param {object[]} chatMessages - The chat the input was built from
 * @param {number} fromIndex - First message the call read
 * @param {number} lastReadIndex - Last message the call read
 * @param {number} contextIndex - The context message the call read (latestShownMessageBefore), -1 for none
 * @returns {{arcIds: string[], text: string, chose?: string, at: number}[]}
 */
export function resolveRulings(rulings, arcPlans, chatMessages, fromIndex, lastReadIndex, contextIndex) {
    const resolved = [];
    for (const item of rulings || []) {
        if (item.at < fromIndex || item.at > lastReadIndex) {
            console.warn(`[Story Arc] Knowledge extraction reported a ruling outside the messages it read: #${item.at}`);
            continue;
        }
        const message = chatMessages[item.at];
        if (!message || message.is_system || !message.is_user) {
            console.warn(`[Story Arc] Knowledge extraction reported a ruling in a message that is not the player's: #${item.at}`);
            continue;
        }
        const quoteAsFound = findQuoteInText(item.quote, message.mes);
        if (quoteAsFound === null) {
            console.warn(`[Story Arc] Knowledge extraction reported a ruling whose quote is not in message #${item.at}`);
            continue;
        }
        let choseAsFound = null;
        if (item.chose !== undefined) {
            choseAsFound = findOptionInMessages(item.chose, chatMessages, fromIndex, item.at, contextIndex);
            if (choseAsFound === null) {
                console.warn(`[Story Arc] Knowledge extraction reported a pick in message #${item.at} whose option is in no message it read`);
                continue;
            }
        }
        const arcIds = [];
        for (const shortArcId of item.arcs) {
            const arcPlan = arcPlans.find(candidate => candidate.shortArcId === shortArcId);
            if (arcPlan && !arcIds.includes(arcPlan.arcId)) arcIds.push(arcPlan.arcId);
        }
        if (arcIds.length === 0) {
            console.warn(`[Story Arc] Knowledge extraction reported a ruling against no listed arc: #${item.at}`);
            continue;
        }
        const resolvedRuling = { arcIds, text: quoteAsFound, at: item.at };
        if (choseAsFound !== null) resolvedRuling.chose = choseAsFound;
        resolved.push(resolvedRuling);
    }
    return resolved;
}

/**
 * Find the option a bare pick chose: in the context message, or in a
 * narrator message (not the player's, not hidden) the call read before the
 * pick's message, compared like a quote (findQuoteInText). The options
 * always come before the pick.
 * @param {string} option - The option as the extraction wrote it
 * @param {object[]} chatMessages - The chat the input was built from
 * @param {number} fromIndex - First message the call read
 * @param {number} pickIndex - The pick's message, inside the messages the call read
 * @param {number} contextIndex - The context message, -1 for none
 * @returns {string|null} The option as it stands in the message, or null
 */
function findOptionInMessages(option, chatMessages, fromIndex, pickIndex, contextIndex) {
    const contextMessage = chatMessages[contextIndex];
    if (contextMessage) {
        const optionAsFound = findQuoteInText(option, contextMessage.mes);
        if (optionAsFound !== null) return optionAsFound;
    }
    for (let index = fromIndex; index < pickIndex; index++) {
        const message = chatMessages[index];
        if (!message || message.is_system || message.is_user) continue;
        const optionAsFound = findQuoteInText(option, message.mes);
        if (optionAsFound !== null) return optionAsFound;
    }
    return null;
}

/**
 * Find a quote in a message's text, ignoring case and collapsing runs of
 * whitespace on both sides, and return it as it stands in the text, so the
 * card shows the player's own words.
 * @param {string} quote - The quote as the extraction wrote it
 * @param {string} text - The message's text
 * @returns {string|null} The span of `text` the quote matches, or null
 */
function findQuoteInText(quote, text) {
    const wanted = normalisedQuote(quote);
    if (!wanted) return null;
    const original = String(text || '');
    // The text collapsed the same way, with the index in `original` that
    // each of its characters came from.
    let collapsed = '';
    const origins = [];
    for (let index = 0; index < original.length; index++) {
        const character = original[index];
        if (/\s/.test(character)) {
            if (collapsed.endsWith(' ')) continue;
            collapsed += ' ';
            origins.push(index);
            continue;
        }
        const lowerCase = character.toLowerCase();
        collapsed += lowerCase;
        for (let unit = 0; unit < lowerCase.length; unit++) origins.push(index);
    }
    const start = collapsed.indexOf(wanted);
    if (start === -1) return null;
    const end = origins[start + wanted.length - 1] + 1;
    return original.slice(origins[start], end);
}

/**
 * A quote for comparison: lower case, whitespace collapsed and trimmed.
 * Unlike a fact text, a trailing full stop counts.
 * @param {string} text
 * @returns {string}
 */
function normalisedQuote(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ─── Apply an extraction answer ───

/**
 * Apply a parsed extraction answer to the ledger, in place.
 *
 * Answer shape:
 *
 *     present: [name]
 *     newCharacters: [{ name, aliases: [name] }]
 *     newNames: [{ character: name, name }]   // optional
 *     learned: [{ factId | text, public, who: [name], how: 'witnessed' | 'told',
 *                 toldBy: name | null, at: messageIndex }]
 *     revealedSecrets: [{ arcId, secretId, text, holders: [name], heardBy: [name], at: messageIndex }]   // resolved, see resolveRevealedSecrets
 *     retracted: [{ factId, at: messageIndex }]   // optional
 *     details: [{ character: name, kind, value, of?: name, change?: text, at: messageIndex }]   // optional
 *
 * The answer's fulfilled beats are not the ledger's: the caller completes
 * them after this (completeFulfilledBeats), once the covered messages carry
 * their message ids.
 *
 * New names come first: a newNames item adds its name as an alias of the
 * record its `character` names (by name or alias, ignoring case), unless
 * another record has that name already (refused) or no record has the
 * character (unknown); a name the record has already changes nothing. So the
 * rest of the answer, its new characters included, finds the record under
 * the new name, and a new character listed under it is not added.
 * New characters are added next, so the rest of the answer can name them.
 * Names are matched case-insensitively against names and aliases. A new
 * character with a name taken by a character the ledger had before this
 * answer (listTakenNames: name parts and aliases, folded) is flagged:
 * its record gets `nameClash` with the shared names, the last covered
 * message and its message id. Characters added by the same answer are not
 * compared with each other. A new character with a name and `wasUnnamed`
 * names the unnamed relative of that display name instead, keeping its id
 * and details, unflagged. A new character without a name is an unnamed
 * relative: a record with an empty name and its relation as a record entry
 * `{ value: { kind, of }, at: null, by: 'record' }`, created after the named ones, only
 * when `of` is in the cast and no record has its display name yet;
 * listTakenNames skips it, so it is never flagged. A learned
 * item with a known fact id adds holders to that fact; one with text adds
 * holders to the fact with the same text (findFactWithSameText), in the
 * ledger or created earlier in the answer, and creates a fact only for new text. The teller of a told item becomes a witnessed holder too, unless
 * they hold it already. Names that are neither known nor new, and unknown
 * fact ids, are ignored. A revealed secret creates the fact linked to it, or extends the
 * one already linked, with the characters who heard it as witnessed holders
 * and its planned holders as plan holders, all at the message of the reveal.
 * A retracted fact leaves the facts for the ledger's retractedFacts, with
 * the message of the correction, unless the user entered a holder for it;
 * unknown fact ids are ignored. A details item for a kind the player locked
 * in the Knowledge popup is skipped (isDetailLocked), even with `change`.
 * Any other details item records a character detail
 * as `{ value, at }` added to the end of the kind's history, a relation's
 * value `{ kind, of }` with the other character's id: always while the kind
 * is unknown for the character (a detail set), and for a known kind only
 * when the item carries `change`, the on-screen event (a detail changed). A
 * different value without `change` is a restatement and is ignored; the
 * same value again, letter case aside, changes nothing. A relation to
 * someone outside the cast or to the character itself, and an unknown
 * character, are ignored.
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
 * @param {object} [detailCounts] - Filled in for the update log: detailsSet,
 *     detailsChanged, restatementsIgnored and detailsLocked, how many details items did each
 * @param {object} [newNameCounts] - Filled in for the update log: newNamesAdded,
 *     newNamesRefused (another record has the name) and newNamesUnknown (no
 *     record has the character's name), how many newNames items did each
 * @returns {boolean} True when anything in the ledger changed
 */
export function applyExtractionAnswer(ledger, answer, fromIndex, messageIndex, chatMessages, detailCounts = {}, newNameCounts = {}) {
    const { characters, facts } = ledger;
    let changed = false;
    const messageIds = chatMessages ? assignCoveredMessageIds(chatMessages, fromIndex, messageIndex) : new Map();

    // A new name of a character the ledger has (a codename, a first name)
    // becomes an alias of that record. It comes first, so every other list
    // of the answer, the new characters included, finds the record under
    // the new name. Names stay unique across records: a name another record
    // has is refused. Like the record, an alias never rolls back.
    newNameCounts.newNamesAdded = 0;
    newNameCounts.newNamesRefused = 0;
    newNameCounts.newNamesUnknown = 0;
    const newNames = Array.isArray(answer.newNames) ? answer.newNames : [];
    for (const item of newNames) {
        const name = String(item?.name || '').trim();
        if (!name) continue;
        const characterId = findCharacterId(characters, item.character);
        if (!characterId) {
            newNameCounts.newNamesUnknown++;
            continue;
        }
        const ownerId = findCharacterId(characters, name);
        if (ownerId === characterId) continue;
        if (ownerId) {
            newNameCounts.newNamesRefused++;
            continue;
        }
        const character = characters.find(candidate => candidate.id === characterId);
        character.aliases = [...character.aliases, name];
        newNameCounts.newNamesAdded++;
        changed = true;
    }

    // A new character is checked against the names taken before this
    // answer, so characters the answer adds together (a family) are not a reuse.
    const takenNamesBefore = listTakenNames(ledger);
    const lastCoveredMessageId = messageIds.get(messageIndex);
    const newCharacters = Array.isArray(answer.newCharacters) ? answer.newCharacters : [];
    const trimmedAliases = newCharacter => (Array.isArray(newCharacter.aliases)
        ? newCharacter.aliases.map(alias => String(alias || '').trim()).filter(Boolean)
        : []);
    // Named characters first, so an unnamed relative can relate to a
    // character the same answer adds.
    for (const newCharacter of newCharacters) {
        const name = String(newCharacter?.name || '').trim();
        if (!name || findCharacterId(characters, name)) continue;
        const aliases = trimmedAliases(newCharacter);

        // The story named an unnamed relative: the record takes the name and
        // keeps its id and details. A relative sharing the other
        // character's surname is expected, so the name is not checked
        // against the taken names.
        const unnamedId = findCharacterId(characters, newCharacter.wasUnnamed);
        const unnamedCharacter = characters.find(candidate => candidate.id === unnamedId && !candidate.name.trim());
        if (unnamedCharacter) {
            unnamedCharacter.name = name;
            const knownNames = [name, ...unnamedCharacter.aliases].map(knownName => knownName.toLowerCase());
            const addedAliases = aliases.filter(alias => !knownNames.includes(alias.toLowerCase()));
            unnamedCharacter.aliases = [...unnamedCharacter.aliases, ...addedAliases];
            changed = true;
            continue;
        }

        const character = { id: nextLedgerId('c', characters), name, aliases };
        const sharedNames = listSharedNames(character, takenNamesBefore);
        if (sharedNames.length > 0) {
            character.nameClash = { names: sharedNames, at: messageIndex };
            if (lastCoveredMessageId) character.nameClash.messageId = lastCoveredMessageId;
        }
        characters.push(character);
        changed = true;
    }

    // An unnamed relative ("Kendra Osei's mother") is a record with an empty
    // name, known by its relation. The relation is the record's identity, so
    // it is stored as a record entry (`at: null, by: 'record'`) and, like the
    // record, never rolls back; it is not the player's, so it locks nothing. A relation to someone outside
    // the cast creates nothing, nor does a display name the ledger has already.
    for (const newCharacter of newCharacters) {
        if (String(newCharacter?.name || '').trim() || !newCharacter?.relation) continue;
        const kinship = String(newCharacter.relation.kind || '').trim();
        const relatedId = findCharacterId(characters, newCharacter.relation.of);
        if (!kinship || !relatedId) continue;
        const character = {
            id: nextLedgerId('c', characters),
            name: '',
            aliases: trimmedAliases(newCharacter),
            details: { relation: [{ value: { kind: kinship, of: relatedId }, at: null, by: 'record' }] },
        };
        if (findCharacterId(characters, characterDisplayName(ledger, character))) continue;
        characters.push(character);
        changed = true;
    }

    const learned =Array.isArray(answer.learned) ? answer.learned : [];
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
        // The planned holders knew it all along. Without an entry the other
        // holders' lines would leave them out of "shared only with". They
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

    // A character detail is recorded the first time the story states it.
    // A kind the player set in the Knowledge popup is locked: the
    // extraction never touches it, not even with `change`.
    // A known detail changes only when the item names the on-screen event
    // of the change (`change`): a different value merely stated is the
    // narrator's error, not a new fact, and is ignored as a restatement.
    // The same value again changes nothing. A dead character comes back
    // alive by the same rule. Being alive is never a first statement: a
    // status starts with a death, and "alive" is recorded only as the change
    // back from "dead" (live check 2026-11-05: the extraction marked nearly
    // every character "alive" though no text said so). A relation names a
    // cast member other than the character itself.
    detailCounts.detailsSet = 0;
    detailCounts.detailsChanged = 0;
    detailCounts.restatementsIgnored = 0;
    detailCounts.detailsLocked = 0;
    const details = Array.isArray(answer.details) ? answer.details : [];
    for (const item of details) {
        if (!DETAIL_KINDS.includes(item?.kind)) continue;
        const characterId = findCharacterId(characters, item.character);
        if (!characterId) continue;
        const character = characters.find(candidate => candidate.id === characterId);
        if (isDetailLocked(character, item.kind)) {
            detailCounts.detailsLocked++;
            continue;
        }

        let value = String(item.value || '').trim();
        if (!value) continue;
        if (item.kind === 'status' && !DETAIL_STATUS_VALUES.includes(value)) continue;
        if (item.kind === 'relation') {
            const relatedId = findCharacterId(characters, item.of);
            if (!relatedId || relatedId === characterId) continue;
            value = { kind: value, of: relatedId };
        }

        const history = character.details?.[item.kind] || [];
        if (item.kind === 'status' && value === 'alive' && history.length === 0) continue;
        if (history.length > 0) {
            const currentValue = history[history.length - 1].value;
            if (isSameDetailValue(item.kind, currentValue, value)) continue;
            if (!isName(item.change)) {
                detailCounts.restatementsIgnored++;
                continue;
            }
            detailCounts.detailsChanged++;
        } else {
            detailCounts.detailsSet++;
        }
        const at = atInsideCoveredMessages(item.at, fromIndex, messageIndex);
        character.details = { ...character.details, [item.kind]: [...history, { value, at }] };
        changed = true;
    }

    // Every holder entry, retraction and detail entry from a covered message names it by
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
    for (const character of characters) {
        for (const history of Object.values(character.details || {})) history.forEach(nameByMessageId);
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

/**
 * Whether two values of one kind of character detail are the same, letter
 * case aside: a relation by its kinship word and the other character's id.
 * Null is an unknown detail, the same only as another null. The extraction
 * and the Knowledge popup compare details with this.
 * @param {string} kind - One of DETAIL_KINDS
 * @param {string|{kind: string, of: string}|null} storedValue - The current value in the ledger
 * @param {string|{kind: string, of: string}|null} answerValue - The value an answer or the player gives
 * @returns {boolean}
 */
export function isSameDetailValue(kind, storedValue, answerValue) {
    if (storedValue === null || answerValue === null) return storedValue === answerValue;
    if (kind === 'relation') {
        return storedValue.of === answerValue.of && storedValue.kind.toLowerCase() === answerValue.kind.toLowerCase();
    }
    return storedValue.toLowerCase() === answerValue.toLowerCase();
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
 * The names of a new character that are taken already, in the order of its
 * name and aliases, spelled as the taken-names block prints them. A
 * hyphenated surname shares its parts, never the whole word: the block
 * prints only the parts.
 * @param {object} character - The new character record
 * @param {Map<string, string>} takenNames - Folded form → spelling (listTakenNames)
 * @returns {string[]}
 */
function listSharedNames(character, takenNames) {
    const sharedNames = [];
    for (const foldedName of listTakenNames({ characters: [character] }).keys()) {
        if (foldedName.includes('-') || !takenNames.has(foldedName)) continue;
        sharedNames.push(takenNames.get(foldedName));
    }
    return sharedNames;
}

/**
 * Find the character a name refers to, by name or alias, ignoring case; an
 * unnamed relative by its display name (characterDisplayName).
 * @param {Array} characters - The ledger's characters
 * @param {string} name - A name as the extraction wrote it
 * @returns {string|null} The character's id, or null for an unknown name
 */
function findCharacterId(characters, name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    const character = characters.find(candidate =>
        characterDisplayName({ characters }, candidate).toLowerCase() === wanted
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
 * those who were told), and two facts with one text would print the same
 * knowledge twice with different holders. Facts created earlier in the
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

// ─── Update log ───

/** How many records the ledger's updateLog keeps, the newest. */
export const KNOWLEDGE_UPDATE_LOG_CAP = 20;

/**
 * Append a record to the ledger's updateLog, the ledger's own short history
 * of what each update, re-extraction, skip and rollback did, saved with the
 * chat. Keeps the newest KNOWLEDGE_UPDATE_LOG_CAP records, oldest first. A
 * ledger without a log (every ledger from before it) gets one here. Nothing
 * reads the log: it is there for whoever opens the chat file.
 * Does not save.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {object} record - One record, shape at createEmptyKnowledgeLedger
 */
function recordKnowledgeUpdate(ledger, record) {
    ledger.updateLog = [...(ledger.updateLog || []), record].slice(-KNOWLEDGE_UPDATE_LOG_CAP);
}

/**
 * The facts, retracted facts and holder entries a ledger holds right now, as
 * sets of the objects themselves, so holdingsChange can tell what a step
 * added or removed even when a restored fact took a new id.
 * @param {object} ledger
 * @returns {{facts: Set<object>, retractedFacts: Set<object>, holders: Set<object>}}
 */
function knowledgeHoldings(ledger) {
    const retractedFacts = (ledger.retractedFacts || []).map(retraction => retraction.fact);
    return {
        facts: new Set(ledger.facts),
        retractedFacts: new Set(retractedFacts),
        holders: new Set([...ledger.facts, ...retractedFacts].flatMap(fact => fact.holders)),
        detailEntries: new Set(ledger.characters.flatMap(detailEntriesOf)),
    };
}

/**
 * Every entry of a character's details, of every kind.
 * @param {object} character - A ledger character
 * @returns {object[]}
 */
function detailEntriesOf(character) {
    return Object.values(character.details || {}).flat();
}

/**
 * What changed between two knowledgeHoldings of the same ledger. A fact is
 * created or dropped when it is in neither the facts nor the retracted facts
 * before or after; ids are those the facts carry afterwards (before, for a
 * dropped fact). Holder counts include the entries of created and dropped facts.
 * @param {ReturnType<typeof knowledgeHoldings>} before
 * @param {ReturnType<typeof knowledgeHoldings>} after
 */
function holdingsChange(before, after) {
    const isHeld = (holdings, fact) => holdings.facts.has(fact) || holdings.retractedFacts.has(fact);
    const allFacts = holdings => [...holdings.facts, ...holdings.retractedFacts];
    const idsOf = facts => facts.map(fact => fact.id);
    return {
        factsCreated: idsOf(allFacts(after).filter(fact => !isHeld(before, fact))),
        factsDropped: idsOf(allFacts(before).filter(fact => !isHeld(after, fact))),
        factsRetracted: idsOf([...after.retractedFacts].filter(fact => !before.retractedFacts.has(fact))),
        factsRestored: idsOf([...after.facts].filter(fact => before.retractedFacts.has(fact))),
        holdersAdded: [...after.holders].filter(holder => !before.holders.has(holder)).length,
        holdersDropped: [...before.holders].filter(holder => !after.holders.has(holder)).length,
        detailsDropped: [...before.detailEntries].filter(entry => !after.detailEntries.has(entry)).length,
    };
}

/**
 * The log record of an applied extraction answer: the messages it read, the
 * message id of the last of them, how many items each list of the answer
 * had, and what the apply did. Beats go in as counts only (the resolved
 * fulfilled items, the beats completed), never their ids or texts: the plan
 * is spoiler-protected. Rulings too (the resolved ones, the ones stored),
 * never their text. Character details as counts too: the details set,
 * changed and ignored as restatements, never their values. New names as
 * counts: added as aliases, refused because another record has the name,
 * and ignored for a character the ledger does not have.
 * @param {'update'|'reextract'} kind
 * @param {number} fromIndex - First message the call read
 * @param {number} toIndex - Last message the call read
 * @param {object} answer - The parsed extraction answer
 * @param {ReturnType<typeof knowledgeHoldings>} holdingsBefore - Taken right before the apply
 * @param {object} ledger - The ledger after the apply
 * @param {number} beatsCompleted - How many beats the answer completed
 * @param {number} rulingsStored - How many rulings the answer stored (storeRulings)
 * @param {{detailsSet: number, detailsChanged: number, restatementsIgnored: number, detailsLocked: number}} detailCounts - What the apply did with the details items (applyExtractionAnswer)
 * @param {{newNamesAdded: number, newNamesRefused: number, newNamesUnknown: number}} newNameCounts - What the apply did with the newNames items (applyExtractionAnswer)
 * @returns {object}
 */
function extractionRecord(kind, fromIndex, toIndex, answer, holdingsBefore, ledger, beatsCompleted, rulingsStored, detailCounts, newNameCounts) {
    const count = list => (Array.isArray(list) ? list.length : 0);
    const change = holdingsChange(holdingsBefore, knowledgeHoldings(ledger));
    return {
        kind,
        from: fromIndex,
        to: toIndex,
        messageId: messageIdOf(chat[toIndex]) ?? null,
        answer: {
            present: count(answer.present),
            newCharacters: count(answer.newCharacters),
            learned: count(answer.learned),
            retracted: count(answer.retracted),
            revealedSecrets: count(answer.revealedSecrets),
            fulfilled: count(answer.fulfilled),
            rulings: count(answer.rulings),
        },
        factsCreated: change.factsCreated,
        holdersAdded: change.holdersAdded,
        factsRetracted: change.factsRetracted,
        beatsCompleted,
        rulingsStored,
        detailsSet: detailCounts.detailsSet,
        detailsChanged: detailCounts.detailsChanged,
        restatementsIgnored: detailCounts.restatementsIgnored,
        detailsLocked: detailCounts.detailsLocked,
        newNamesAdded: newNameCounts.newNamesAdded,
        newNamesRefused: newNameCounts.newNamesRefused,
        newNamesUnknown: newNameCounts.newNamesUnknown,
    };
}

/**
 * Record an update or re-extraction that changed nothing, and save. When
 * another chat was loaded during the call, records nothing: saving would
 * write into that chat, and the call's own chat is no longer the one saved.
 * @param {object} ledger - The ledger the call was made for
 * @param {object} chatStateBefore - chat_metadata.story_arc when the call started
 * @param {number} fromIndex
 * @param {number} toIndex
 * @param {'no answer'|'chat changed'|'ledger moved'} reason
 */
async function recordSkippedUpdate(ledger, chatStateBefore, fromIndex, toIndex, reason) {
    if (chat_metadata.story_arc !== chatStateBefore) return;
    recordKnowledgeUpdate(ledger, { kind: 'skipped', from: fromIndex, to: toIndex, reason });
    await saveMetadata();
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
 *
 * Rolls back data only: the caller sets the prompts again when it needs
 * them (onMessageDeleted in index.js).
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {Promise<boolean>} True when the ledger changed and was saved
 */
export async function rollBackKnowledgeFrom(firstGoneIndex) {
    const ledger = getKnowledgeLedger();
    // Taken before followMessagesById, so the log's rollback record names
    // what went with deleted messages too.
    const holdingsBefore = knowledgeHoldings(ledger);
    const followed = followMessagesById(ledger, chat);
    const dropped = dropKnowledgeFrom(ledger, firstGoneIndex, holdingsBefore);
    const changed = followed || dropped;
    if (changed) await saveMetadata();
    return changed;
}

/**
 * Bring every ledger entry that names its message by message id up to date
 * with the chat: a holder entry, a character detail entry, the scene or a scene in the scene history whose
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
    if (keepOnlyDetailEntries(ledger, entry => !isGone(entry))) changed = true;
    for (const fact of ledger.facts) fact.holders.forEach(moveToMessage);
    for (const character of ledger.characters) detailEntriesOf(character).forEach(moveToMessage);
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
 * Character detail entries go by the same rule (keepOnlyDetailEntries): a
 * kind falls back to its earlier value, or becomes unknown.
 * A scene from a dropped message goes back to the latest earlier scene in
 * the scene history; later ones leave the history.
 * Same pattern as dropPendingMarksFrom for the queued marks.
 * A rollback that changed anything, here or in the step the caller took
 * before (`holdingsBefore`), is recorded in the update log.
 * Does not save: the caller saves, and only when this returns true.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @param {object} [holdingsBefore] - knowledgeHoldings(ledger) from before the caller's
 *     own rollback step (followMessagesById), so the record covers both; defaults to now
 * @returns {boolean} True when anything in the ledger changed
 */
export function dropKnowledgeFrom(ledger, firstGoneIndex, holdingsBefore = knowledgeHoldings(ledger)) {
    const isKept = entry => entry.at === null || entry.at < firstGoneIndex;
    const holdersDropped = keepOnlyHolders(ledger, isKept);
    const detailsDropped = keepOnlyDetailEntries(ledger, isKept);
    let changed = holdersDropped || detailsDropped;

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
    const change = holdingsChange(holdingsBefore, knowledgeHoldings(ledger));
    const tookBack = change.factsDropped.length > 0 || change.holdersDropped > 0
        || change.factsRestored.length > 0 || change.detailsDropped > 0;
    if (changed || tookBack) {
        recordKnowledgeUpdate(ledger, {
            kind: 'rollback',
            from: firstGoneIndex,
            factsDropped: change.factsDropped,
            holdersDropped: change.holdersDropped,
            factsRestored: change.factsRestored,
            detailsDropped: change.detailsDropped,
        });
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
 * Keep only the character detail entries `isKept` accepts: the predicate
 * the holder entries go by. Each kind is a history, oldest first, so
 * dropping its newest entry restores the value before it; a kind left
 * without entries is unknown again and leaves `details`, and a character
 * left without any kind loses `details`. The character record itself
 * stays: records are never rolled back.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {function(object): boolean} isKept - Gets a detail entry, with `at` and maybe `messageId`
 * @returns {boolean} True when any detail entry was dropped
 */
function keepOnlyDetailEntries(ledger, isKept) {
    let changed = false;
    for (const character of ledger.characters) {
        if (!character.details) continue;
        const remainingDetails = {};
        for (const [kind, history] of Object.entries(character.details)) {
            const remainingHistory = history.filter(isKept);
            if (remainingHistory.length !== history.length) changed = true;
            if (remainingHistory.length > 0) remainingDetails[kind] = remainingHistory;
        }
        if (Object.keys(remainingDetails).length > 0) character.details = remainingDetails;
        else delete character.details;
    }
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
 * @returns {Promise<KnowledgeUpdateResult>} ledgerChanged when the ledger changed
 *     and was saved, beatsChanged when the re-extraction completed beats
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
    if (generatesNewSwipe || !wasRead) return { ledgerChanged: dropped, beatsChanged: false };

    const reextracted = await reextractKnowledgeOfMessage(messageIndex);
    return { ...reextracted, ledgerChanged: reextracted.ledgerChanged || dropped };
}

/**
 * Run the extraction over exactly one message and apply its answer, the
 * beats it reports fulfilled included, for a swipe switch or an edit. Makes no call while Story Arc or the tracker is
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
 * @param {{arcId: string, beatId: string}[]} [onlyBeats] - The beats the extraction may report fulfilled (extractKnowledge); all active ones when absent
 * @returns {Promise<KnowledgeUpdateResult>} ledgerChanged when the ledger was
 *     updated and saved, beatsChanged when beats completed
 */
async function reextractKnowledgeOfMessage(messageIndex, onlyBeats) {
    if (!isEnabled() || !isKnowledgeTrackerEnabled()) return NOTHING_CHANGED;
    const message = chat[messageIndex];
    if (!message || message.is_system) return NOTHING_CHANGED;

    const chatStateBefore = chat_metadata.story_arc;
    const messageText = message.mes;
    const ledgerBefore = getKnowledgeLedger();
    const lastUpdatedAtBefore = ledgerBefore.lastUpdatedAt;

    // The chat up to the message, so the extraction reads that message only.
    const chatUpToMessage = chat.slice(0, messageIndex + 1);
    const answer = await extractKnowledge(ledgerBefore, chatUpToMessage, messageIndex, getContext().name1, onlyBeats);
    if (!answer) {
        await recordSkippedUpdate(ledgerBefore, chatStateBefore, messageIndex, messageIndex, 'no answer');
        return NOTHING_CHANGED;
    }

    if (chat_metadata.story_arc !== chatStateBefore || chat[messageIndex] !== message || message.mes !== messageText) {
        console.log(`[Story Arc] Message #${messageIndex} changed during its knowledge extraction; the answer is not applied`);
        await recordSkippedUpdate(ledgerBefore, chatStateBefore, messageIndex, messageIndex, 'chat changed');
        return NOTHING_CHANGED;
    }
    const ledgerNow = getKnowledgeLedger();
    const lastUpdatedAtNow = ledgerNow.lastUpdatedAt;
    const readBefore = reachesMessage(lastUpdatedAtBefore, messageIndex);
    const readNow = reachesMessage(lastUpdatedAtNow, messageIndex);
    const coverageMoved = readBefore ? !readNow : lastUpdatedAtNow !== lastUpdatedAtBefore;
    if (coverageMoved) {
        console.log(`[Story Arc] The knowledge ledger moved over message #${messageIndex} during its extraction; the answer is not applied`);
        await recordSkippedUpdate(ledgerNow, chatStateBefore, messageIndex, messageIndex, 'ledger moved');
        return NOTHING_CHANGED;
    }

    const sceneNow = ledgerNow.scene;
    const sceneHistoryNow = ledgerNow.sceneHistory;
    const lastUpdatedMessageIdNow = ledgerNow.lastUpdatedMessageId;
    const holdingsBefore = knowledgeHoldings(ledgerNow);
    const characterIdsBefore = ledgerNow.characters.map(character => character.id);
    const detailCounts = {};
    const newNameCounts = {};
    applyExtractionAnswer(ledgerNow, answer, messageIndex, messageIndex, chat, detailCounts, newNameCounts);
    // After the apply, which gave the message its message id.
    const beatsCompleted = await completeFulfilledBeats(answer.fulfilled, messageIndex);
    const rulingsStored = storeRulings(answer.rulings);
    recordKnowledgeUpdate(ledgerNow, extractionRecord('reextract', messageIndex, messageIndex, answer, holdingsBefore, ledgerNow, beatsCompleted, rulingsStored, detailCounts, newNameCounts));
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
    return withFlaggedCharacters(
        { ledgerChanged: true, beatsChanged: beatsCompleted > 0 || rulingsStored > 0 },
        ledgerNow, characterIdsBefore);
}

/**
 * After the user edited a message (ST fires MESSAGE_EDITED with its index
 * once the new text is in the chat): drop only what the ledger learned at
 * that message and re-extract it, so a correction keeps everything learned
 * after it. A message no update has read yet needs nothing: the next update
 * reads its new text. While the tracker is off the ledger stays as it is,
 * because nothing could extract the new text.
 *
 * While the extraction recognises beats, the beats completed at that message are
 * reopened first (reopenCompletionsAt), so the re-extraction judges the
 * edited text against them; it completes them again if the new text still
 * fulfils them. The rulings stored at that message whose quote is gone
 * from the edited text are removed first too (removeRulingsAt), whatever
 * autoTrack says; a ruling whose quote is still there stays as it is,
 * answered or open, and the re-extraction does not store it again.
 *
 * The re-extraction of an older message offers only those reopened beats:
 * a beat active now may have become active long after that message, and
 * must not complete at it. With none reopened it offers none. An edit of
 * the chat's last message offers the active beats, like the update after a
 * reply.
 * @param {number} messageIndex - Index of the edited message
 * @returns {Promise<KnowledgeUpdateResult>} ledgerChanged when the ledger changed
 *     and was saved, beatsChanged when beats were reopened or completed,
 *     or rulings removed or stored
 */
export async function updateKnowledgeAfterEdit(messageIndex) {
    if (!isEnabled() || !isKnowledgeTrackerEnabled()) return NOTHING_CHANGED;
    const ledger = getKnowledgeLedger();
    const wasRead = reachesMessage(ledger.lastUpdatedAt, messageIndex);
    if (!wasRead) return NOTHING_CHANGED;

    const dropped = dropKnowledgeLearnedAt(ledger, messageIndex);
    // The re-extraction judges the edited text against an open beat. Only
    // while the extraction recognises beats: otherwise nothing would
    // complete it again.
    const reopenedBeats = beatRecognitionPath() === 'extraction' ? reopenCompletionsAt(messageIndex) : [];
    const completionsReopened = reopenedBeats.length > 0;
    // Not behind beat recognition: a ruling is not a recognition. A ruling
    // the edited text still quotes keeps its answeredAt.
    const editedText = chat[messageIndex]?.mes;
    const rulingsRemoved = removeRulingsAt(messageIndex, ruling => findQuoteInText(ruling.text, editedText) !== null);
    if (dropped || completionsReopened || rulingsRemoved) await saveMetadata();

    const isLastMessage = messageIndex === chat.length - 1;
    const reextracted = await reextractKnowledgeOfMessage(messageIndex, isLastMessage ? undefined : reopenedBeats);
    return {
        ...reextracted,
        ledgerChanged: reextracted.ledgerChanged || dropped,
        beatsChanged: reextracted.beatsChanged || completionsReopened || rulingsRemoved,
    };
}

/**
 * Remove every holder entry and character detail entry learned at exactly
 * this message, and every fact this leaves without holders. Entries from other messages, and the user's
 * own (`at: null`), stay; so do the scene and lastUpdatedAt, which the
 * re-extraction of the message sets again. A fact a correction in this
 * message retracted comes back; the re-extraction may retract it again.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {number} messageIndex
 * @returns {boolean} True when anything in the ledger changed
 */
function dropKnowledgeLearnedAt(ledger, messageIndex) {
    const isKept = entry => entry.at !== messageIndex;
    const holdersDropped = keepOnlyHolders(ledger, isKept);
    const detailsDropped = keepOnlyDetailEntries(ledger, isKept);
    return holdersDropped || detailsDropped;
}

// ─── Inject the knowledge block ───

/**
 * Before each generation: set the knowledge block and the taken-names block
 * (names.js) under their own prompt keys, in-chat at depth 1 with the
 * system role, so they sit right above the newest message, the names right
 * after the knowledge block. Both keys are always set, empty while Story
 * Arc or the tracker is off or a block has nothing to show, so no stale
 * block lingers from an earlier generation.
 */
export function injectKnowledgeBlock() {
    const trackerOn = isEnabled() && isKnowledgeTrackerEnabled();
    const ledger = trackerOn ? getKnowledgeLedger() : null;
    const block = trackerOn ? buildKnowledgeBlock(ledger, chat, isCharacterDetailsEnabled()) : '';
    setExtensionPrompt(
        KNOWLEDGE_PROMPT_KEY,
        block,
        extension_prompt_types.IN_CHAT,
        1,
        false,
        extension_prompt_roles.SYSTEM,
    );

    const takenNamesBlock = trackerOn ? buildTakenNamesBlock(ledger) : '';
    setExtensionPrompt(
        NAMES_PROMPT_KEY,
        takenNamesBlock,
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
    + 'A private fact reaches nobody off-screen: not through rumors, teammates, news reports, logs, records or their own deduction. '
    + 'A character not listed here knows only what everyone knows, plus any secret the SECRETS section names them for.]';

/** The header of a block that prints character details: one sentence more. */
const KNOWLEDGE_BLOCK_HEADER_WITH_DETAILS = `${KNOWLEDGE_BLOCK_HEADER.slice(0, -1)} `
    + 'A character keeps the details listed for them; a detail changes only when the story shows it changing.]';

/**
 * Build the knowledge block the narrator sees: what everyone knows (the
 * public facts), then for the characters in the scene and the characters
 * the latest messages talk about, what each one knows and (talked about
 * only) has told. The block states only what characters know, never what
 * they do not: a "does not know" line would put the secret in front of the
 * narrator once per bystander.
 *
 * A planned holder (how 'plan') gets no line of their own, only a name in
 * the other holders' "shared only with"; the header points them to the
 * SECRETS block. A fact held only by planned holders is printed nowhere: a
 * secret's text stays in the SECRETS block, which gates it by phase.
 *
 * A covered character's known character details are a "Details:" line
 * under the heading, and a dead character has "dead" in the heading; such
 * a character gets a section even without a knowledge line. Only a block
 * that prints a detail carries the header's details sentence, so a ledger
 * without details gives the block it gave before details existed. Without
 * `withDetails` no detail is printed, whatever the ledger holds.
 *
 * @param {object} ledger - The knowledge ledger (createEmptyKnowledgeLedger shape)
 * @param {object[]} messages - The chat messages; the latest user message and
 *     the latest reply among them decide who is talked about
 * @param {boolean} [withDetails] - Whether character details are switched on (isCharacterDetailsEnabled)
 * @returns {string} The block text, or '' when there is no public fact and
 *     no covered character has a line or a detail to print
 */
export function buildKnowledgeBlock(ledger, messages, withDetails = true) {
    if (!ledger) return '';

    const presentCharacters = ledger.characters.filter(character => ledger.scene.present.includes(character.id));
    const latestText = latestUserMessageAndReplyText(messages);
    const talkedAboutCharacters = ledger.characters.filter(character =>
        !ledger.scene.present.includes(character.id) && isNamedInText(ledger, character, latestText));

    const sections = [];
    const publicFacts = ledger.facts.filter(fact => fact.public);
    if (publicFacts.length > 0) {
        const publicEntries = publicFacts.map(fact => ({ at: newestHolderAt(fact.holders), line: `- ${fact.text}` }));
        sections.push(['EVERYONE KNOWS', ...newestCapped(publicEntries)].join('\n'));
    }

    // Facts held only by planned holders get no line anywhere.
    const printableFacts = ledger.facts.filter(fact =>
        !fact.public && fact.holders.some(holder => holder.how !== HOLDER_HOW.plan));

    // A character's section: the heading, "dead" in it for a dead
    // character, then the details line and the knowledge lines. A character
    // with details and no knowledge line still gets one.
    let anyDetailPrinted = false;
    const pushCharacterSection = (character, place, isTalkedAbout) => {
        const lines = knowledgeLinesForCharacter(ledger, character, printableFacts, isTalkedAbout);
        const detailsLine = withDetails ? detailsLineForCharacter(ledger, character) : null;
        const isDead = withDetails && currentDetailText(ledger, character, 'status') === 'dead';
        if (lines.length === 0 && detailsLine === null && !isDead) return;
        if (detailsLine !== null || isDead) anyDetailPrinted = true;
        const heading = `${characterDisplayName(ledger, character).toUpperCase()} (${isDead ? 'dead, ' : ''}${place})`;
        const detailsLines = detailsLine === null ? [] : [detailsLine];
        sections.push([heading, ...detailsLines, ...lines].join('\n'));
    };
    for (const character of presentCharacters) pushCharacterSection(character, 'present', false);
    for (const character of talkedAboutCharacters) pushCharacterSection(character, 'talked about, not present', true);
    if (sections.length === 0) return '';

    // The header names details only when the block prints some, so a ledger
    // without details keeps its block byte for byte.
    const header = anyDetailPrinted ? KNOWLEDGE_BLOCK_HEADER_WITH_DETAILS : KNOWLEDGE_BLOCK_HEADER;
    return [header, ...sections].join('\n\n');
}

/**
 * A character's details line in the knowledge block: the known details in
 * DETAIL_KINDS order, unknown kinds left out. The status is not on it: a
 * dead character is marked in the heading, and alive needs no word.
 * @param {object} ledger
 * @param {object} character
 * @returns {string|null} "- Details: female; 40s; cleaner; Kendra Osei's mother", or null with none known
 */
function detailsLineForCharacter(ledger, character) {
    const detailTexts = [];
    for (const kind of DETAIL_KINDS) {
        if (kind === 'status') continue;
        const detailText = currentDetailText(ledger, character, kind);
        if (detailText !== null) detailTexts.push(detailText);
    }
    return detailTexts.length ? `- Details: ${detailTexts.join('; ')}` : null;
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
    return `${withoutTaggedElements(latestUserText || '')}\n${withoutTaggedElements(latestReplyText || '')}`;
}

/** HTML inline tags: what they wrap is story text, so only their markup goes */
const HTML_INLINE_TAG = /<\/?(?:a|i|b|em|strong|u|s|del|ins|mark|small|sub|sup|span|font|q|code)(?:\s[^>]*)?>/gi;

/** HTML block tags: story text too, and their markup becomes a line break */
const HTML_BLOCK_TAG = /<\/?(?:p|div|br|hr|blockquote|center|h[1-6]|ul|ol|li)(?:\s[^>]*)?\/?>/gi;

/**
 * One message's text with every other tagged element (`<tag …>…</tag>`)
 * removed, nested ones included, such as a preset's status block. HTML
 * tags (`<i>`, `<a>`, `<p>` …) lose only their markup, because what they
 * wrap is story text. Each pass removes the elements whose content holds
 * no tag of their own name, so a tag nested in one of the same name goes
 * first and its parent in a later pass. Tag names match in any case. A
 * status block the reply length limit cut off has no closing tag, so an
 * opening tag still left takes the rest of the message with it.
 * @param {string} text - The text of one message
 * @returns {string}
 */
function withoutTaggedElements(text) {
    const taggedElement = /<([A-Za-z][\w:-]*)(?:\s[^>]*)?>(?:(?!<\/?\1[\s>/])[\s\S])*?<\/\1\s*>/gi;
    let remainingText = text.replace(HTML_INLINE_TAG, '').replace(HTML_BLOCK_TAG, '\n');
    let previousText;
    do {
        previousText = remainingText;
        remainingText = remainingText.replace(taggedElement, ' ');
    } while (remainingText !== previousText);
    return remainingText.replace(/<[A-Za-z][\w:-]*(?:\s[^>]*)?>[\s\S]*$/, ' ');
}

/**
 * Whether the character's display name (characterDisplayName) or one of its
 * aliases appears in the text as a whole word, ignoring case. An unnamed
 * relative also counts when the text names it through any name or alias of
 * the other character ("Kendra's mother" for "Kendra Osei's mother"). An
 * apostrophe matches a straight or a curly one (' or ’).
 * @param {object} ledger
 * @param {object} character - A ledger character { id, name, aliases }
 * @param {string} text
 * @returns {boolean}
 */
function isNamedInText(ledger, character, text) {
    const names = [characterDisplayName(ledger, character), ...(character.aliases || [])];
    const relationHistory = character.details?.relation || [];
    if (!character.name.trim() && relationHistory.length > 0) {
        const relation = relationHistory[relationHistory.length - 1].value;
        const otherCharacter = ledger.characters.find(candidate => candidate.id === relation.of);
        const otherNames = otherCharacter ? [otherCharacter.name, ...otherCharacter.aliases] : [];
        for (const otherName of otherNames) {
            if (otherName.trim()) names.push(`${otherName.trim()}'s ${relation.kind}`);
        }
    }
    return names.filter(name => name && name.trim()).some(name => {
        const escapedName = name.trim()
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/['’]/g, '[\'’]');
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
    // Planned holders count: they know the secret, and without their names
    // the line would say the character is the only one who does.
    const otherHolderNames = fact.holders
        .filter(otherHolder => otherHolder.characterId !== holder.characterId)
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
 * A character's name, for the knowledge block, the extraction input and the
 * Knowledge popup: its display name (characterDisplayName).
 * @param {object} ledger
 * @param {string} characterId
 * @returns {string} The character's name, or the id when the ledger has no such character
 */
export function characterName(ledger, characterId) {
    const character = ledger.characters.find(candidate => candidate.id === characterId);
    return character ? characterDisplayName(ledger, character) : characterId;
}

/**
 * The name a character is printed and found by. A named character's is its
 * name. An unnamed relative, a record with an empty name, is called after
 * its relation: "<other character's name>'s <kinship>" ("Kendra Osei's
 * mother", relationText). A nameless record without a relation reads
 * "unnamed character <id>".
 * @param {{characters: object[]}} ledger - The ledger, or any object with its characters
 * @param {object} character - A ledger character
 * @returns {string}
 */
export function characterDisplayName(ledger, character) {
    if (character.name.trim()) return character.name;
    const relationHistory = character.details?.relation || [];
    if (relationHistory.length === 0) return `unnamed character ${character.id}`;
    return relationText(ledger, relationHistory[relationHistory.length - 1].value);
}

/**
 * A relation as text: "<other character's name>'s <kinship>" ("Kendra Osei's
 * mother"). The other character is printed by its own name only ("unnamed
 * character <id>" without one), so two unnamed records related to each
 * other never loop. An unnamed relative's display name and its relation
 * detail are both this text.
 * @param {{characters: object[]}} ledger - The ledger, or any object with its characters
 * @param {{kind: string, of: string}} relation - A relation detail's value
 * @returns {string}
 */
function relationText(ledger, relation) {
    const otherCharacter = ledger.characters.find(candidate => candidate.id === relation.of);
    const otherName = otherCharacter?.name.trim() ? otherCharacter.name : `unnamed character ${relation.of}`;
    return `${otherName}'s ${relation.kind}`;
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
