/**
 * @file Beat completion by recognition, and its rollback
 * @module planning/beat-completion
 *
 * A beat completes when the story is recognised to have fulfilled it: today
 * by the narrator's in-prompt ARC_SIGNAL marker (injection/signals.js), and
 * by the knowledge extraction (knowledge/ledger.js). Both go through
 * completeBeats, so the rules are the same. Each completion records the
 * message it happened in (`beat.completion`), so that a swipe, a deletion or
 * a branch that ends before that message reopens the beat again
 * (reopenCompletionsFrom). The Arc Manager's hand toggle records nothing:
 * a completion by hand stays until it is reverted by hand.
 */

import { chat } from '/script.js';
import { arcMessageStart, arcTier } from '../core/settings.js';
import { selectNonOptionalBeats } from '../injection/pacing.js';
import { assignCoveredMessageIds, messageIdOf } from '../knowledge/message-ids.js';
import { completeBeat } from './arc-edit.js';
import { getArcs, updateArc } from './storage.js';

/**
 * @typedef {object} BeatCompletion
 * @property {string} arcId - The arc's id, or its leading part (the marker's 8 characters)
 * @property {string} beatId
 * @property {number} [at] - Chat index of the message that fulfilled the beat
 */

/**
 * Complete the recognised beats. Rules:
 * - the arc must be found among `arcs` and active, the beat must exist and
 *   be active; a pending, locked or unknown beat is a hallucinated id or a
 *   stale report and is ignored;
 * - one completion per arc per message (`at`): an eager scene that claims
 *   two beats at once burns the arc's pace, the second claim waits for its
 *   own message. Per arc, not global — independent arcs may each advance.
 *   In list order, so the first claim wins;
 * - lastFulfilledAt becomes `at`, so the stall count (isStalled) restarts
 *   from the fulfilling message; locked beats whose prerequisites are now
 *   all completed become pending; an arc with no non-optional beat left
 *   completes.
 * No promotion here: the arc is deliberately left without an active beat
 * until the next user message (promoteNextBeats in injection/signals.js),
 * otherwise the AI's own aftermath prose chains straight into the next
 * objective and the player never gets a turn between developments.
 *
 * A completion with an `at` records it on the beat (`beat.completion`): the
 * message's index and its Story Arc message id, which the message gets here
 * if it has none yet (a chat with the knowledge tracker off has no
 * extraction that would give it one), and what reopening the beat has to
 * undo. Saves through updateArc.
 * @param {BeatCompletion[]} completions
 * @param {object[]} arcs - The arcs the completions may name, as stored
 * @returns {Promise<{ updated: boolean, completedBeats: string[] }>}
 */
export async function completeBeats(completions, arcs) {
    let updated = false;
    const completedBeats = [];
    const arcMessagesAdvanced = new Set();

    for (const completion of completions) {
        const arc = arcs.find(candidate => candidate.id.startsWith(completion.arcId));
        if (!arc) {
            console.warn(`[Story Arc] Completion referenced unknown arc: ${completion.arcId}`);
            continue;
        }
        if (arc.status !== 'active') {
            console.warn(`[Story Arc] Completion for ${arc.status} arc ignored: ${completion.arcId}`);
            continue;
        }

        const beat = arc.beats.find(candidate => candidate.id === completion.beatId);
        if (!beat) {
            console.warn(`[Story Arc] Completion referenced unknown beat: ${completion.beatId}`);
            continue;
        }

        const arcMessage = `${arc.id}@${completion.at}`;
        if (arcMessagesAdvanced.has(arcMessage)) {
            console.warn(`[Story Arc] Second completion in one message ignored: ${completion.beatId}`);
            continue;
        }

        if (beat.status !== 'active') {
            console.warn(`[Story Arc] Completion for ${beat.status} beat ignored: ${completion.beatId}`);
            continue;
        }

        const lastFulfilledBefore = arc.lastFulfilledAt;
        const updatedBeats = completeBeat(arc.beats, beat.id);
        const unlocked = [];
        for (const [index, updatedBeat] of updatedBeats.entries()) {
            if (arc.beats[index].status === 'locked' && updatedBeat.status === 'pending') {
                unlocked.push(updatedBeat.id);
                console.log(`[Story Arc] Beat unlocked: "${updatedBeat.intention}"`);
            }
        }
        arc.beats = updatedBeats;
        arc.lastFulfilledAt = completion.at;
        arcMessagesAdvanced.add(arcMessage);
        completedBeats.push(beat.id);
        updated = true;
        console.log(`[Story Arc] Beat completed: "${beat.intention}" in "${arc.title}"`);

        const remaining = selectNonOptionalBeats(arc.beats).filter(nonOptionalBeat => nonOptionalBeat.status !== 'completed');
        const arcCompleted = remaining.length === 0;
        if (arcCompleted) {
            arc.status = 'completed';
            console.log(`[Story Arc] Arc completed: "${arc.title}"`);
        }

        if (Number.isInteger(completion.at)) {
            const completedBeat = arc.beats.find(candidate => candidate.id === beat.id);
            completedBeat.completion = completionRecord(completion.at, unlocked, arcCompleted, lastFulfilledBefore);
        }

        await updateArc(arc.id, { beats: arc.beats, status: arc.status, lastFulfilledAt: arc.lastFulfilledAt });
    }

    return { updated, completedBeats };
}

/**
 * What a recognised completion stores on its beat: the message it happened
 * in, by index and by Story Arc message id (`at`, `messageId`, as the
 * knowledge ledger names its messages), and what reopening the beat undoes:
 * the beats it unlocked, whether it completed the arc, and the arc's
 * lastFulfilledAt before it. A hidden message gets no message id, so the
 * record names it by index only.
 * @param {number} at - Chat index of the fulfilling message
 * @param {string[]} unlocked - Ids of the beats this completion unlocked
 * @param {boolean} arcCompleted - This completion completed the arc
 * @param {number|undefined} lastFulfilledBefore - The arc's lastFulfilledAt before it
 * @returns {object}
 */
function completionRecord(at, unlocked, arcCompleted, lastFulfilledBefore) {
    const record = { at, unlocked, arcCompleted, lastFulfilledBefore };
    const messageId = assignCoveredMessageIds(chat, at, at).get(at);
    if (messageId) record.messageId = messageId;
    return record;
}

// ─── Rollback ───

/**
 * Reopen every recorded completion whose message is gone: the user swiped
 * or deleted it (a regeneration deletes the last reply), or loaded a branch
 * that ends before it. Same identification as the knowledge ledger's
 * rollback (rollBackKnowledgeFrom): a completion that names its message by
 * message id follows that message — it moves to the message's new index
 * while the message is in the chat, and is reopened when the message is
 * gone; then every completion at `firstGoneIndex` or later is reopened.
 * A completion without a record (before the records, or by hand in the Arc
 * Manager) is never touched.
 *
 * Reopening a beat (reopenCompletion) undoes what its completion did; the
 * arc's lastFulfilledAt goes back to the latest remaining one (see
 * restoreLastFulfilledAt).
 *
 * Synchronous, so a handler runs it before anything it awaits: on a swipe
 * that generates a new reply, ST awaits MESSAGE_SWIPED before it generates,
 * so the new reply's prompt shows the reopened beat and the reply may
 * complete it again.
 * Does not save: the caller saves, and only when this returns true.
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {boolean} True when any completion was reopened or moved
 */
export function reopenCompletionsFrom(firstGoneIndex) {
    const arcs = getArcs();
    const indexOfMessageId = new Map();
    chat.forEach((chatMessage, index) => {
        const messageId = messageIdOf(chatMessage);
        if (messageId && !indexOfMessageId.has(messageId)) indexOfMessageId.set(messageId, index);
    });
    let changed = false;

    for (const arc of arcs) {
        const goneBeats = [];
        for (const beat of arc.beats || []) {
            const completion = beat.completion;
            if (!completion) continue;

            let isGone = false;
            if (completion.messageId !== undefined) {
                const index = indexOfMessageId.get(completion.messageId);
                if (index === undefined) {
                    isGone = true;
                } else if (index !== completion.at) {
                    completion.at = index;
                    changed = true;
                }
            }
            if (completion.at >= firstGoneIndex) isGone = true;
            if (isGone) goneBeats.push(beat);
        }
        if (goneBeats.length === 0) continue;

        // Latest first, so each reopening undoes a state its completion left.
        goneBeats.sort((first, second) => second.completion.at - first.completion.at);
        const earliestGone = goneBeats[goneBeats.length - 1].completion;
        for (const beat of goneBeats) reopenCompletion(arc, beat);
        restoreLastFulfilledAt(arc, earliestGone);
        changed = true;
    }
    return changed;
}

/**
 * Undo one recorded completion: the beat is active again; in an episode a
 * later beat promoted meanwhile goes back to pending (one scene beat is
 * active at a time); then a beat it unlocked that is pending is locked
 * again, so an unlocked scene beat promoted meanwhile ends up locked too;
 * and an arc it completed is active again. A beat set back by hand in the
 * Arc Manager since only loses its stale record.
 * @param {object} arc - The stored arc, changed in place
 * @param {object} beat - A beat of the arc with a completion record
 */
function reopenCompletion(arc, beat) {
    const completion = beat.completion;
    delete beat.completion;
    if (beat.status !== 'completed') return;

    beat.status = 'active';
    console.log(`[Story Arc] Beat reopened: "${beat.intention}" in "${arc.title}"`);

    if (arcTier(arc) === 'episode') {
        const laterBeats = arc.beats.slice(arc.beats.indexOf(beat) + 1);
        for (const laterBeat of laterBeats) {
            if (laterBeat.status === 'active') laterBeat.status = 'pending';
        }
    }

    for (const unlockedId of completion.unlocked || []) {
        const unlockedBeat = arc.beats.find(candidate => candidate.id === unlockedId);
        if (unlockedBeat?.status === 'pending') unlockedBeat.status = 'locked';
    }

    if (completion.arcCompleted && arc.status === 'completed') {
        arc.status = 'active';
        console.log(`[Story Arc] Arc active again: "${arc.title}"`);
    }
}

/**
 * Set the arc's lastFulfilledAt after reopening completions: the latest
 * remaining recorded completion, or the value the arc had before the
 * earliest reopened one, whichever is later. That value covers what has no
 * record: messageStart, a completion from before the records or by hand.
 * Without one (an arc from before lastFulfilledAt) it is messageStart.
 * @param {object} arc - The stored arc, changed in place
 * @param {object} earliestGone - The record of the earliest reopened completion
 */
function restoreLastFulfilledAt(arc, earliestGone) {
    const lastFulfilledBefore = typeof earliestGone.lastFulfilledBefore === 'number'
        ? earliestGone.lastFulfilledBefore
        : arcMessageStart(arc);
    const remainingAts = arc.beats
        .filter(beat => beat.completion)
        .map(beat => beat.completion.at);
    arc.lastFulfilledAt = Math.max(lastFulfilledBefore, ...remainingAts);
}

