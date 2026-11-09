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
 * (reopenCompletionsFrom), and so does an edit of that message, before the
 * extraction reads it again (reopenCompletionsAt). The Arc Manager's hand toggle
 * (setBeatStatusByHand) records nothing: a completion by hand counts for
 * pacing like a recognised one, and stays until it is reverted by hand.
 *
 * The arc's rulings follow their message by the same rules: they go when
 * it is deleted, a branch ends before it (removeRulingsFrom) or it is edited
 * so that their quote is gone (removeRulingsAt).
 */

import { chat } from '/script.js';
import { arcMessageStart, arcTier, isBeatOpen } from '../core/settings.js';
import { selectNonOptionalBeats } from '../injection/pacing.js';
import { messageIdOf } from '../knowledge/message-ids.js';
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
 *   from the fulfilling message, unless a later completion set it already
 *   (an edited earlier message completed again); locked beats whose prerequisites are now
 *   all completed become pending; in an act or saga every earlier open
 *   milestone is skipped (skipEarlierMilestones); an arc with no open
 *   non-optional beat left completes.
 * No promotion here: the arc is deliberately left without an active beat
 * until the next user message (promoteNextBeats in injection/signals.js),
 * otherwise the AI's own aftermath prose chains straight into the next
 * pressure and the player never gets a turn between developments.
 *
 * A completion with an `at` records it on the beat (`beat.completion`): the
 * message's index, its Story Arc message id if it carries one, and what
 * reopening the beat has to undo (completionRecord), the milestones it
 * skipped among them. Saves through updateArc.
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
        const lastFulfilledBeforeRecords = lastFulfilledBeforeRecordedCompletions(arc);
        const updatedBeats = completeBeat(arc.beats, beat.id);
        const unlocked = [];
        for (const [index, updatedBeat] of updatedBeats.entries()) {
            if (arc.beats[index].status === 'locked' && updatedBeat.status === 'pending') {
                unlocked.push(updatedBeat.id);
                console.log(`[Story Arc] Beat unlocked: "${updatedBeat.intention}"`);
            }
        }
        arc.beats = updatedBeats;
        const skipped = skipEarlierMilestones(arc, beat.id);
        const laterFulfilled = Number.isInteger(completion.at) && Number.isInteger(lastFulfilledBefore) && lastFulfilledBefore > completion.at;
        if (!laterFulfilled) arc.lastFulfilledAt = completion.at;
        arcMessagesAdvanced.add(arcMessage);
        completedBeats.push(beat.id);
        updated = true;
        console.log(`[Story Arc] Beat completed: "${beat.intention}" in "${arc.title}"`);

        const remaining = selectNonOptionalBeats(arc.beats).filter(isBeatOpen);
        const arcCompleted = remaining.length === 0;
        if (arcCompleted) {
            arc.status = 'completed';
            console.log(`[Story Arc] Arc completed: "${arc.title}"`);
        }

        if (Number.isInteger(completion.at)) {
            const completedBeat = arc.beats.find(candidate => candidate.id === beat.id);
            completedBeat.completion = completionRecord(completion.at, unlocked, skipped, arcCompleted, lastFulfilledBeforeRecords);
        }

        await updateArc(arc.id, { beats: arc.beats, status: arc.status, lastFulfilledAt: arc.lastFulfilledAt });
    }

    return { updated, completedBeats };
}

/**
 * Skip every open milestone before the completed one: an arc is one plot
 * thread, and a story that fulfils a later milestone has moved past the
 * earlier ones (ADR-0010). A skipped milestone is obsolete, not failed; it
 * leaves recognition and the prompt like a completed one. The first open
 * milestone after the completed one becomes current (currentMilestone).
 * Episodes are left alone: their scene beats already run in order, one
 * active at a time. Changes the arc's beats in place.
 * @param {object} arc - The stored arc, the beat already completed
 * @param {string} beatId - The completed milestone
 * @returns {string[]} Ids of the milestones it skipped
 */
function skipEarlierMilestones(arc, beatId) {
    if (arcTier(arc) === 'episode') return [];

    const completedIndex = arc.beats.findIndex(beat => beat.id === beatId);
    const earlierOpenMilestones = arc.beats.slice(0, completedIndex).filter(isBeatOpen);
    for (const milestone of earlierOpenMilestones) {
        milestone.status = 'skipped';
        console.log(`[Story Arc] Milestone skipped, the story moved past it: "${milestone.intention}" in "${arc.title}"`);
    }
    return earlierOpenMilestones.map(milestone => milestone.id);
}

/**
 * What a recognised completion stores on its beat: the message it happened
 * in, by index and by Story Arc message id (`at`, `messageId`, as the
 * knowledge ledger names its messages), and what reopening the beat undoes:
 * the beats it unlocked, the milestones it skipped, whether it completed the arc, and the arc's
 * lastFulfilledAt from before its recorded completions
 * (lastFulfilledBeforeRecordedCompletions).
 *
 * The message id is only read, never given: the knowledge ledger relies on
 * only the messages an update read carrying one (followMessagesById). With
 * the tracker on, the extraction has given the message its id before its
 * completions are applied. With the tracker off, or for a hidden message,
 * the record names its message by index only, and the rollback has only
 * the index rule: a deletion in the middle of the chat before the
 * completing message leaves `at` one off, and a deletion of the completing
 * message itself in the middle of the chat does not reopen the beat.
 * @param {number} at - Chat index of the fulfilling message
 * @param {string[]} unlocked - Ids of the beats this completion unlocked
 * @param {string[]} skipped - Ids of the milestones this completion skipped
 * @param {boolean} arcCompleted - This completion completed the arc
 * @param {number|undefined} lastFulfilledBefore - The arc's lastFulfilledAt from before its recorded completions
 * @returns {object}
 */
function completionRecord(at, unlocked, skipped, arcCompleted, lastFulfilledBefore) {
    const record = { at, unlocked, skipped, arcCompleted, lastFulfilledBefore };
    const messageId = messageIdOf(chat[at]);
    if (messageId) record.messageId = messageId;
    return record;
}

/**
 * The arc's lastFulfilledAt from before any of its recorded completions:
 * the smallest of its lastFulfilledAt now and the value every record already
 * carries. Not simply lastFulfilledAt now: completions do not arrive in the
 * order of their messages (one extraction answer may report a later message
 * first, an edit completes an earlier message again), so lastFulfilledAt now
 * may come from a recorded completion that a rollback reopens together with
 * this one. Every record of the arc carries the same floor, so reopening any
 * set of them restores it (restoreLastFulfilledAt). Undefined for an arc
 * without lastFulfilledAt and records.
 * @param {object} arc - The stored arc, before the new completion
 * @returns {number|undefined}
 */
function lastFulfilledBeforeRecordedCompletions(arc) {
    const recordedBefore = (arc.beats || [])
        .filter(beat => beat.completion)
        .map(beat => beat.completion.lastFulfilledBefore);
    const candidates = [arc.lastFulfilledAt, ...recordedBefore].filter(value => typeof value === 'number');
    return candidates.length ? Math.min(...candidates) : undefined;
}

// ─── By hand ───

/**
 * Set a beat's status by hand, the Arc Manager's status toggle. Completing
 * unlocks the beats that waited for it (completeBeat), skips the earlier
 * open milestones of an act or saga as a recognised completion does
 * (skipEarlierMilestones), and counts for pacing
 * as a recognised completion does: lastFulfilledAt becomes the last message
 * of the chat (never earlier than messageStart, never moved back; on a
 * paused arc the last message before the pause, which the resume shifts
 * onto the resume point), so the stall nudge clears. Any other status is
 * only written: setting a beat back by hand locks nothing again, reopens
 * no milestone it skipped and leaves lastFulfilledAt where it is. Setting a
 * skipped milestone open makes it open again; the Arc Manager's undo takes
 * back a whole hand completion, its skips included.
 *
 * A status set by hand carries no completion record (a recognised one is
 * dropped), so no rollback reopens it. So that a rollback of an earlier recognised completion cannot take
 * lastFulfilledAt back below it either, the floor every record carries
 * (lastFulfilledBefore, see restoreLastFulfilledAt) is raised to it.
 * Saves through updateArc.
 * @param {string} arcId
 * @param {string} beatId
 * @param {'pending'|'active'|'completed'|'skipped'} status
 */
export async function setBeatStatusByHand(arcId, beatId, status) {
    const arc = getArcs().find(candidate => candidate.id === arcId);
    if (!arc?.beats.some(beat => beat.id === beatId)) {
        console.warn(`[Story Arc] Beat not found: ${beatId} in ${arcId}`);
        return;
    }

    if (status !== 'completed') {
        // A recognised completion's record goes too: a later rollback of its
        // message must not reopen a beat the player has set by hand since.
        const beats = arc.beats.map(beat => {
            if (beat.id !== beatId) return beat;
            const { completion, ...beatWithoutRecord } = beat;
            void completion;
            return { ...beatWithoutRecord, status };
        });
        await updateArc(arcId, { beats });
        return;
    }

    // While paused the clock stands at the last message before the pause;
    // resumeArc then shifts the stamp by the paused span, onto the resume point.
    const lastCountedMessage = arc.pausedAt != null ? Math.min(chat.length - 1, arc.pausedAt - 1) : chat.length - 1;
    const handAt = Math.max(lastCountedMessage, arcMessageStart(arc));
    const lastFulfilledAt = typeof arc.lastFulfilledAt === 'number' ? Math.max(arc.lastFulfilledAt, handAt) : handAt;
    const beats = completeBeat(arc.beats, beatId);
    skipEarlierMilestones({ ...arc, beats }, beatId);
    for (const beat of beats) {
        if (!beat.completion) continue;
        const floor = beat.completion.lastFulfilledBefore;
        beat.completion.lastFulfilledBefore = typeof floor === 'number' ? Math.max(floor, lastFulfilledAt) : lastFulfilledAt;
    }
    await updateArc(arcId, { beats, lastFulfilledAt });
}

// ─── Rollback ───

/**
 * Reopen every recorded completion whose message is gone: the user swiped
 * or deleted it (a regeneration deletes the last reply), or loaded a branch
 * that ends before it. Same identification as the knowledge ledger's
 * rollback (rollBackKnowledgeFrom): a completion that names its message by
 * message id follows that message — it moves to the message's new index
 * while the message is in the chat, and is reopened when the message is
 * gone; then every completion at `firstGoneIndex` or later is reopened. A
 * record without a message id has only the index rule (see completionRecord).
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
    const indexOfMessageId = chatIndexOfMessageIds();
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
        const goneRecords = goneBeats.map(beat => beat.completion);
        for (const beat of goneBeats) reopenCompletion(arc, beat);
        restoreLastFulfilledAt(arc, goneRecords);
        changed = true;
    }
    return changed;
}

/**
 * The chat index of every Story Arc message id in the chat, the first
 * message carrying it if two do.
 * @returns {Map<string, number>}
 */
function chatIndexOfMessageIds() {
    const indexOfMessageId = new Map();
    chat.forEach((chatMessage, index) => {
        const messageId = messageIdOf(chatMessage);
        if (messageId && !indexOfMessageId.has(messageId)) indexOfMessageId.set(messageId, index);
    });
    return indexOfMessageId;
}

/**
 * Reopen every recorded completion at exactly one message, for an edit of
 * that message: the knowledge extraction reads the edited text again and
 * completes the beat again if the text still fulfils it. A record names
 * the message by its message id when it has one, so that is matched when
 * the message carries one; otherwise, or when the record has none, its
 * index. Completions at other messages, and those without a record, stay.
 * Undoes like reopenCompletionsFrom (reopenCompletion,
 * restoreLastFulfilledAt).
 *
 * Returns the reopened beats, so the re-extraction of an older message can
 * offer only them (updateKnowledgeAfterEdit in knowledge/ledger.js).
 * Does not save: the caller saves, and only when this returns any.
 * @param {number} messageIndex - Index of the edited message
 * @returns {{arcId: string, beatId: string}[]} The reopened beats, arcId the full id
 */
export function reopenCompletionsAt(messageIndex) {
    const messageId = messageIdOf(chat[messageIndex]);
    const reopenedBeats = [];

    for (const arc of getArcs()) {
        const editedBeats = (arc.beats || []).filter(beat => {
            const completion = beat.completion;
            if (!completion) return false;
            if (messageId && completion.messageId !== undefined) return completion.messageId === messageId;
            return completion.at === messageIndex;
        });
        if (editedBeats.length === 0) continue;

        const editedRecords = editedBeats.map(beat => beat.completion);
        for (const beat of editedBeats) {
            reopenCompletion(arc, beat);
            reopenedBeats.push({ arcId: arc.id, beatId: beat.id });
        }
        restoreLastFulfilledAt(arc, editedRecords);
    }
    return reopenedBeats;
}

/**
 * Undo one recorded completion: the beat is active again; in an episode a
 * later beat promoted meanwhile goes back to pending (one scene beat is
 * active at a time); then a beat it unlocked that is pending is locked
 * again, so an unlocked scene beat promoted meanwhile ends up locked too;
 * a milestone it skipped that is still skipped is active again, so the
 * earliest of them is current again; and an arc it completed is active
 * again. A beat set back by hand in the Arc Manager since only loses its
 * stale record, and a skipped milestone set by hand since stays as set.
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

    for (const skippedId of completion.skipped || []) {
        const skippedMilestone = arc.beats.find(candidate => candidate.id === skippedId);
        if (skippedMilestone?.status === 'skipped') skippedMilestone.status = 'active';
    }

    if (completion.arcCompleted && arc.status === 'completed') {
        arc.status = 'active';
        console.log(`[Story Arc] Arc active again: "${arc.title}"`);
    }
}

/**
 * Set the arc's lastFulfilledAt after reopening completions: the latest
 * remaining recorded completion, or the value the arc had before its
 * recorded completions, whichever is later. That value covers what has no
 * record: messageStart, a completion from before the records or by hand.
 * It is the smallest lastFulfilledBefore of the reopened records, not the
 * one of the record with the smallest `at`: completions do not arrive in
 * the order of their messages (see lastFulfilledBeforeRecordedCompletions).
 * A record without one (an arc from before lastFulfilledAt) counts as
 * messageStart.
 * @param {object} arc - The stored arc, changed in place
 * @param {object[]} reopenedRecords - The records of the reopened completions
 */
function restoreLastFulfilledAt(arc, reopenedRecords) {
    const lastFulfilledBefore = Math.min(...reopenedRecords.map(record => (
        typeof record.lastFulfilledBefore === 'number' ? record.lastFulfilledBefore : arcMessageStart(arc)
    )));
    const remainingAts = arc.beats
        .filter(beat => beat.completion)
        .map(beat => beat.completion.at);
    arc.lastFulfilledAt = Math.max(lastFulfilledBefore, ...remainingAts);
}


// ─── Rulings follow their message ───

/**
 * Remove every ruling (GLOSSARY "Ruling") whose message is gone: the user
 * deleted it, or loaded a branch that ends before it. The same rules as
 * reopenCompletionsFrom: a ruling that names its message by message id
 * follows that message — it moves to the message's new index while the
 * message is in the chat, and is removed when the message is gone; then
 * every ruling at `firstGoneIndex` or later is removed. A ruling without a
 * message id has only the index rule. Open and answered rulings alike.
 *
 * Not on a swipe: a swipe replaces the narrator's reply, never the player's
 * message a ruling quotes, and the options a stored pick (`chose`) answers
 * always come before the pick.
 *
 * Rulings are stored by the knowledge extraction (storeRulings in
 * knowledge/ledger.js); their rollback sits here, next to the completions'.
 * Does not save: the caller saves, and only when this returns true.
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {boolean} True when any ruling was removed or moved
 */
export function removeRulingsFrom(firstGoneIndex) {
    const indexOfMessageId = chatIndexOfMessageIds();
    let changed = false;

    for (const arc of getArcs()) {
        if (!arc.rulings?.length) continue;

        const keptRulings = [];
        for (const ruling of arc.rulings) {
            let isGone = false;
            if (ruling.messageId !== undefined) {
                const index = indexOfMessageId.get(ruling.messageId);
                if (index === undefined) {
                    isGone = true;
                } else if (index !== ruling.at) {
                    ruling.at = index;
                    changed = true;
                }
            }
            if (ruling.at >= firstGoneIndex) isGone = true;
            if (isGone) {
                console.log(`[Story Arc] Ruling removed with its message: ${ruling.id} in "${arc.title}"`);
                continue;
            }
            keptRulings.push(ruling);
        }
        if (keptRulings.length === arc.rulings.length) continue;

        arc.rulings = keptRulings;
        changed = true;
    }
    return changed;
}

/**
 * Remove the rulings at exactly one message that the edited text no longer
 * states, for an edit of that message, before the knowledge extraction
 * reads it again. A ruling whose quote is still found in the edited text
 * stays as it is, with its answeredAt, chose and at, so a typo fixed
 * elsewhere in the message neither reopens an answered ruling nor loses
 * it; the re-extraction's repeat check then skips it (storeRulings). A
 * ruling whose quote is gone is removed. Matched like reopenCompletionsAt:
 * by message id when the message and the ruling carry one, otherwise by
 * index. Open and answered rulings alike.
 * The quote check comes from the caller (findQuoteInText in
 * knowledge/ledger.js), which this file cannot import without a cycle.
 * Does not save: the caller saves, and only when this returns true.
 * @param {number} messageIndex - Index of the edited message
 * @param {(ruling: object) => boolean} isStillStated - True when the edited text still holds the ruling's quote
 * @returns {boolean} True when any ruling was removed
 */
export function removeRulingsAt(messageIndex, isStillStated) {
    const messageId = messageIdOf(chat[messageIndex]);
    let changed = false;

    for (const arc of getArcs()) {
        if (!arc.rulings?.length) continue;

        const keptRulings = arc.rulings.filter(ruling => {
            const isAtEditedMessage = messageId && ruling.messageId !== undefined
                ? ruling.messageId === messageId
                : ruling.at === messageIndex;
            return !isAtEditedMessage || isStillStated(ruling);
        });
        if (keptRulings.length === arc.rulings.length) continue;

        console.log(`[Story Arc] Rulings edited out of message #${messageIndex} removed in "${arc.title}"`);
        arc.rulings = keptRulings;
        changed = true;
    }
    return changed;
}
