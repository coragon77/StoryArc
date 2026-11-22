/**
 * Story Arc - Rejected spans
 *
 * The take-out of a span the player rejected (design
 * docs/plans/2026-11-22-rejected-replies-design.md, ADR-0007 amendment):
 * the story reply he rejected, and around it his out-of-character
 * exchange with the narrator, leave every reader of the chat and the
 * knowledge ledger, and the new version that replaces them is read again.
 * The knowledge extraction recognises the rewrite request
 * (resolveRewrites in ledger.js); the notice and the dialog are in
 * ui/rejection-popup.js. One process, in the order it runs.
 */

import { chat, chat_metadata, saveMetadata } from '/script.js';
import { hideChatMessageRange } from '/scripts/chats.js';
import { isEnabled, isKnowledgeTrackerEnabled, beatRecognitionPath, getKnowledgeLedger } from '../core/settings.js';
import { dropPendingMarksAt } from '../injection/signals.js';
import { reopenCompletionsAt } from '../planning/beat-completion.js';
import {
    READ_TEXT_HASH_KEY, dropKnowledgeOfRejectedMessages, dropReviewedMarksOfGoneItems, isKnowledgeUpdateRunning,
    isNamedInText, isReextractionRetryRunning, isReextractionRunning, isSeedCallRunning, listNameWordCarriers, presentChangeItemKeys,
    recordKnowledgeUpdate, reextractKnowledgeOfMessage, removePendingReextraction, withoutTaggedElements,
} from './ledger.js';
import { REJECTED_KEY, isMarkedOutOfCharacter, isRejectedMessage, messageIdOf } from './message-ids.js';
import { deleteCharacter } from '../ui/knowledge-popup.js';

// ─── The proposal ───

/**
 * Whether a chat message is a story reply of the narrator: not the
 * player's, not marked out of character (isMarkedOutOfCharacter), and not
 * taken out as rejected. A hidden message can be one: the summary
 * extension hides most of a long chat, so hidden never means rejected.
 * @param {object} chatMessage
 * @returns {boolean}
 */
function isNarratorStoryReply(chatMessage) {
    return Boolean(chatMessage) && !chatMessage.is_user && !isRejectedMessage(chatMessage) && !isMarkedOutOfCharacter(chatMessage.mes);
}

/**
 * The span a recognised rewrite request proposes to take out: from the
 * latest narrator story reply before the request (the reply it is about)
 * to the message before the new version, the player's out-of-character
 * lines and the narrator's reports included. Without such a reply before
 * the request, the span starts at the request.
 * @param {object[]} chatMessages - ST's chat array
 * @param {number} requestIndex - The player's rewrite request
 * @param {number} newVersionIndex - The new version
 * @returns {{start: number, end: number}}
 */
export function proposeRejectedSpan(chatMessages, requestIndex, newVersionIndex) {
    let start = requestIndex;
    for (let index = requestIndex - 1; index >= 0; index--) {
        if (!isNarratorStoryReply(chatMessages[index])) continue;
        start = index;
        break;
    }
    return { start, end: newVersionIndex - 1 };
}

/**
 * The messages of a proposed span that start ticked: its story, never its
 * out-of-character exchange. The player's lines and the narrator's reports
 * are the correction, both sides of it, and stay with the narrator; only
 * the rejected story goes (owner ruling 2026-11-22: "If I tick the parts
 * you said, I'll remove the parts why the LLMS explained what it does and
 * it has to guess what made my answers appear").
 * @param {object[]} chatMessages - ST's chat array
 * @param {{start: number, end: number}} span
 * @returns {number[]}
 */
export function proposeTickedIndices(chatMessages, span) {
    const tickedIndices = [];
    for (let index = span.start; index <= span.end; index++) {
        const chatMessage = chatMessages[index];
        if (!chatMessage || isMarkedOutOfCharacter(chatMessage.mes)) continue;
        tickedIndices.push(index);
    }
    return tickedIndices;
}

/**
 * The span the menu entry proposes from the message the player chose: from
 * it to the message before the new version, or to the chat's last message
 * when no new version follows (a reply rejected and never rewritten).
 * @param {object[]} chatMessages - ST's chat array
 * @param {number} startIndex - The message the player chose
 * @returns {{start: number, end: number}}
 */
export function proposeSpanFromMessage(chatMessages, startIndex) {
    const newVersionIndex = findNewVersionAfter(chatMessages, startIndex, new Set());
    const end = newVersionIndex === null ? chatMessages.length - 1 : newVersionIndex - 1;
    return { start: startIndex, end };
}

/**
 * The new version that replaces a span: the first narrator story reply
 * after `afterIndex` that is not ticked. It is never a rejected message, so
 * the dialog finds it from the final ticks.
 * @param {object[]} chatMessages - ST's chat array
 * @param {number} afterIndex - The last ticked message
 * @param {Set<number>} tickedIndices
 * @returns {number|null}
 */
export function findNewVersionAfter(chatMessages, afterIndex, tickedIndices) {
    for (let index = afterIndex + 1; index < chatMessages.length; index++) {
        if (tickedIndices.has(index)) continue;
        if (isNarratorStoryReply(chatMessages[index])) return index;
    }
    return null;
}

// ─── The take-out ───

/**
 * True while a take-out runs, its re-read included, so a second take-out
 * starts none: the re-read's answer was read against the ledger before it.
 */
let takeOutRunning = false;

/**
 * Take out the ticked messages as rejected, in the design's order:
 * 1. mark and hide each one (REJECTED_KEY, is_system), so no update starting now reads it;
 * 2. drop what the knowledge ledger learned at them and at the out-of-character
 *    messages among them (dropKnowledgeOfRejectedMessages; see listForgottenIndices);
 * 3. drop the characters who exist only there (dropCharactersOnlyInRejected);
 * 4. reopen the beats they completed and drop their queued marks;
 * 5. hide them through SillyTavern, which shows it on screen and saves the chat with its metadata;
 * 6. read the new version again against the cleaned ledger, when an update had read it
 *    (otherwise the next update reads it, and the rejected messages are hidden by then);
 * 7. record it in the update log and save.
 * Steps 1-4 run without an await, so no update starts between them.
 * Refused while a reply update, a re-extraction (an edit, a swipe switch,
 * a retry), a standing state seed or another take-out is out: its answer was read against the
 * ledger before the take-out and would apply to the cleaned one. With the tracker off, only the marks, the beats and the
 * hide happen; there is no ledger to clean.
 * The re-read (step 6) is not awaited by the result: `reread` resolves
 * when it is done, and until then no other take-out starts. Its call failing leaves the new version pending, and
 * its read-text hash is removed so the retry after the next reply update
 * (updateKnowledgeAfterEdit) counts its text as changed.
 * @param {number[]} tickedIndices - The messages to take out
 * @returns {Promise<{error: string}|{taken: number, factsDropped: number, charactersDropped: number, beatsReopened: number, newVersionIndex: number|null, reread: Promise<object>}>}
 */
export async function takeOutRejectedSpan(tickedIndices) {
    if (!isEnabled()) return { error: 'Story Arc is off.' };
    const sortedIndices = [...new Set(tickedIndices)].filter(index => chat[index]).sort((first, second) => first - second);
    if (sortedIndices.length === 0) return { error: 'No message is ticked.' };
    const callOut = isKnowledgeUpdateRunning() || isReextractionRetryRunning() || isReextractionRunning() || isSeedCallRunning();
    if (takeOutRunning || callOut) {
        return { error: 'Story Arc is still reading the latest reply; try again in a moment.' };
    }
    const rejectedIndices = new Set(sortedIndices);
    const newVersionIndex = findNewVersionAfter(chat, sortedIndices.at(-1), rejectedIndices);
    const forgottenIndices = listForgottenIndices(chat, sortedIndices, newVersionIndex);
    const trackerOn = isKnowledgeTrackerEnabled();

    takeOutRunning = true;
    let reread = Promise.resolve(null);
    try {
        // 1. Mark and hide, all at once: an update that starts during the
        // awaits below skips hidden messages.
        for (const index of sortedIndices) {
            const chatMessage = chat[index];
            if (!chatMessage.extra || typeof chatMessage.extra !== 'object') chatMessage.extra = {};
            chatMessage.extra[REJECTED_KEY] = true;
            chatMessage.is_system = true;
        }

        // 2. and 3. The ledger.
        let dropped = { factsDropped: [], holdersDropped: 0, detailsDropped: 0 };
        let charactersDropped = [];
        const ledgerBefore = getKnowledgeLedger();
        const readsNewVersion = newVersionIndex !== null && ledgerBefore.lastUpdatedAt !== null && ledgerBefore.lastUpdatedAt >= newVersionIndex;
        if (trackerOn) {
            const ledger = ledgerBefore;
            const changeItemKeysBefore = presentChangeItemKeys(ledger);
            dropped = dropKnowledgeOfRejectedMessages(ledger, forgottenIndices);
            // A character the kept exchange names is still in front of the
            // narrator, and a deleted record does not come back.
            const keptExchangeIndices = [...forgottenIndices].filter(index => !rejectedIndices.has(index));
            charactersDropped = dropCharactersOnlyInRejected(ledger, rejectedIndices, chat, keptExchangeIndices);
            // The deleted characters' change items are gone too.
            dropReviewedMarksOfGoneItems(ledger, changeItemKeysBefore);
            for (const index of sortedIndices) {
                const messageId = messageIdOf(chat[index]);
                if (messageId) removePendingReextraction(ledger, messageId);
            }
        }

        // 4. Beats and marks. The new version's completions reopen only
        // while the extraction recognises beats: otherwise nothing would
        // complete them again.
        const reopenedBeats = sortedIndices.flatMap(index => reopenCompletionsAt(index));
        const rereads = trackerOn && readsNewVersion;
        if (rereads && beatRecognitionPath() === 'extraction') reopenedBeats.push(...reopenCompletionsAt(newVersionIndex));
        dropPendingMarksAt(rejectedIndices);

        // 5. Through ST, for the message blocks on screen; each run of
        // adjacent messages at once, and each hide saves the chat.
        for (const [runStart, runEnd] of adjacentRuns(sortedIndices)) {
            await hideChatMessageRange(runStart, runEnd, false);
        }

        // 7. Record and save, before the re-read's own record.
        if (trackerOn) {
            recordKnowledgeUpdate(getKnowledgeLedger(), {
                kind: 'rejected',
                from: sortedIndices[0],
                to: sortedIndices.at(-1),
                messageIds: sortedIndices.map(index => messageIdOf(chat[index]) ?? null),
                factsDropped: dropped.factsDropped,
                holdersDropped: dropped.holdersDropped,
                detailsDropped: dropped.detailsDropped,
                charactersDropped,
                beatsReopened: reopenedBeats.length,
            });
        }
        await saveMetadata();
        console.log(`[Story Arc] Took out messages #${sortedIndices[0]}–#${sortedIndices.at(-1)} as rejected`);

        // 6. Read the new version again. The last message is offered every
        // active beat, as after an edit; an older one only the beats this
        // take-out reopened.
        if (rereads) {
            const isLastMessage = newVersionIndex === chat.length - 1;
            const offeredBeats = isLastMessage ? undefined : reopenedBeats;
            reread = rereadNewVersion(newVersionIndex, offeredBeats);
        }
        return {
            taken: sortedIndices.length,
            factsDropped: dropped.factsDropped.length,
            charactersDropped: charactersDropped.length,
            beatsReopened: reopenedBeats.length,
            newVersionIndex,
            reread,
        };
    } finally {
        reread.finally(() => { takeOutRunning = false; }).catch(() => {});
    }
}

/**
 * The messages whose knowledge a take-out forgets: the ticked ones, and
 * every message marked out of character between the first ticked one and
 * the new version (the chat's end when there is none), which stays shown.
 * The tracker records a scene and a meeting at the narrator's report too,
 * with the rejected reply's cast (Aegis 425 and 427: DeLuca); left alone,
 * the exchange that stays would keep the rejected story's meetings. The
 * player's rulings and corrections stated there stay, as for every take-out.
 * @param {object[]} chatMessages - ST's chat array
 * @param {number[]} sortedIndices - The ticked messages, in order
 * @param {number|null} newVersionIndex
 * @returns {Set<number>}
 */
function listForgottenIndices(chatMessages, sortedIndices, newVersionIndex) {
    const forgottenIndices = new Set(sortedIndices);
    const lastIndex = newVersionIndex === null ? chatMessages.length - 1 : newVersionIndex - 1;
    for (let index = sortedIndices[0]; index <= lastIndex; index++) {
        if (isMarkedOutOfCharacter(chatMessages[index]?.mes)) forgottenIndices.add(index);
    }
    return forgottenIndices;
}

/**
 * Sorted indices as runs of adjacent ones: [3, 4, 5, 8] gives [[3, 5], [8, 8]].
 * @param {number[]} sortedIndices
 * @returns {number[][]}
 */
function adjacentRuns(sortedIndices) {
    const runs = [];
    for (const index of sortedIndices) {
        const lastRun = runs.at(-1);
        if (lastRun && lastRun[1] === index - 1) {
            lastRun[1] = index;
            continue;
        }
        runs.push([index, index]);
    }
    return runs;
}

/**
 * Drop the characters who exist only in the rejected span: a record the
 * update log lists as new in an update that read one of the span's
 * messages, with nothing left that names them after the drop: no holder
 * entry (as holder or teller), detail, meeting, scene or scene history
 * entry, no relation or stance of another record toward them, and no
 * message outside the span, within that update's messages, that names
 * them (isNamedInText). A character the update log no longer shows stays,
 * and so does one whose update's messages cannot be found again
 * (currentRangeOf).
 * Deleted through the Knowledge popup's delete edit (deleteCharacter), so
 * no reference is left behind. Until now a record was never rolled back;
 * the take-out is the exception (ADR-0007 amendment).
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * A message of the out-of-character exchange the take-out leaves shown
 * (`keptExchangeIndices`) that names them keeps them too.
 * @param {Set<number>} rejectedIndices
 * @param {object[]} chatMessages - ST's chat array
 * @param {number[]} [keptExchangeIndices] - Shown messages of the exchange whose knowledge the take-out forgets
 * @returns {string[]} The ids of the characters dropped
 */
export function dropCharactersOnlyInRejected(ledger, rejectedIndices, chatMessages, keptExchangeIndices = []) {
    const candidates = new Map();
    for (const record of ledger.updateLog || []) {
        if (record.kind !== 'update' && record.kind !== 'reextract') continue;
        const newCharacterIds = record.items?.characters || [];
        if (newCharacterIds.length === 0) continue;
        const range = currentRangeOf(record, chatMessages);
        if (!range) continue;
        let readsSpan = false;
        for (let index = range.from; index <= range.to; index++) {
            if (rejectedIndices.has(index)) readsSpan = true;
        }
        if (!readsSpan) continue;
        for (const characterId of newCharacterIds) candidates.set(characterId, range);
    }

    const nameWordCarriers = listNameWordCarriers(ledger.characters);
    const droppedIds = [];
    for (const [characterId, range] of candidates) {
        const character = ledger.characters.find(candidate => candidate.id === characterId);
        if (!character || isNamedInLedger(ledger, characterId)) continue;
        let namedOutsideSpan = false;
        const readIndices = [];
        for (let index = range.from; index <= range.to; index++) readIndices.push(index);
        for (const index of [...readIndices, ...keptExchangeIndices]) {
            if (rejectedIndices.has(index) || !chatMessages[index]) continue;
            const storyText = withoutTaggedElements(chatMessages[index].mes || '');
            if (isNamedInText(ledger, character, storyText, nameWordCarriers)) namedOutsideSpan = true;
        }
        if (namedOutsideSpan) continue;

        const deleted = deleteCharacter(ledger, characterId);
        if (deleted.error) continue;
        ledger.characters = deleted.ledger.characters;
        ledger.facts = deleted.ledger.facts;
        ledger.scene = deleted.ledger.scene;
        if (deleted.ledger.sceneHistory !== undefined) ledger.sceneHistory = deleted.ledger.sceneHistory;
        if (deleted.ledger.meetings !== undefined) ledger.meetings = deleted.ledger.meetings;
        if (deleted.ledger.retractedFacts !== undefined) ledger.retractedFacts = deleted.ledger.retractedFacts;
        droppedIds.push(characterId);
    }
    if (droppedIds.length > 0) console.log(`[Story Arc] Dropped ${droppedIds.length} character(s) known only from rejected messages`);
    return droppedIds;
}

/**
 * The messages an update record read, at their current indices: found by
 * the message id of its last message, since a deletion meanwhile moves
 * every later index while the record keeps the old ones. A record without
 * a message id keeps its stored indices; one whose message is gone gives null.
 * @param {{from: number, to: number, messageId?: string|null}} record
 * @param {object[]} chatMessages - ST's chat array
 * @returns {{from: number, to: number}|null}
 */
function currentRangeOf(record, chatMessages) {
    if (!record.messageId) return { from: record.from, to: record.to };
    const toIndex = chatMessages.findIndex(chatMessage => messageIdOf(chatMessage) === record.messageId);
    if (toIndex === -1) return null;
    return { from: toIndex - (record.to - record.from), to: toIndex };
}

/**
 * Whether anything left in the ledger names a character: a holder entry
 * of theirs or one they told, a detail entry of their own, a relation or
 * stance of another record toward them, a meeting, the scene or a scene
 * history entry.
 * @param {object} ledger
 * @param {string} characterId
 * @returns {boolean}
 */
function isNamedInLedger(ledger, characterId) {
    const retractedFacts = (ledger.retractedFacts || []).map(retraction => retraction.fact);
    for (const fact of [...ledger.facts, ...retractedFacts]) {
        if (fact.holders.some(holder => holder.characterId === characterId || holder.toldBy === characterId)) return true;
    }
    for (const character of ledger.characters) {
        for (const history of Object.values(character.details || {})) {
            if (character.id === characterId && history.length > 0) return true;
            if (history.some(entry => entry.value?.of === characterId)) return true;
        }
    }
    const scenes = [ledger.scene, ...(ledger.sceneHistory || []), ...(ledger.meetings || [])];
    return scenes.some(scene => (scene?.present || []).includes(characterId));
}

/**
 * Read the new version again (reextractKnowledgeOfMessage), offering it
 * `offeredBeats` (all active ones when undefined). When the call fails, the
 * re-extraction leaves the message pending; its read-text hash goes, so the
 * retry after the next reply update counts its text as changed and calls.
 * @param {number} newVersionIndex
 * @param {{arcId: string, beatId: string}[]|undefined} offeredBeats
 * @returns {Promise<object>} The re-extraction's KnowledgeUpdateResult
 */
async function rereadNewVersion(newVersionIndex, offeredBeats) {
    const newVersion = chat[newVersionIndex];
    const chatStateBefore = chat_metadata.story_arc;
    const reread = await reextractKnowledgeOfMessage(newVersionIndex, offeredBeats);
    const messageId = messageIdOf(newVersion);
    const isPending = chat_metadata.story_arc === chatStateBefore
        && (getKnowledgeLedger().pendingReextractions || []).some(entry => entry.messageId === messageId);
    if (isPending && newVersion.extra) {
        delete newVersion.extra[READ_TEXT_HASH_KEY];
        await saveMetadata();
    }
    return reread;
}

/**
 * Drop the rejected mark of every message the player showed again in
 * SillyTavern (ST fires no event for it): it is story again, and a later
 * hide, by the summary extension for one, must not reject it again. Run on
 * every received message and on every chat load.
 * Saves only when a mark went.
 * @returns {Promise<boolean>} True when a mark was dropped
 */
export async function clearMarksOfShownMessages() {
    let cleared = false;
    for (const chatMessage of chat) {
        if (chatMessage?.extra?.[REJECTED_KEY] !== true || chatMessage.is_system) continue;
        delete chatMessage.extra[REJECTED_KEY];
        cleared = true;
    }
    if (cleared) await saveMetadata();
    return cleared;
}
