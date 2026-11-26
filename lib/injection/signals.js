/**
 * @file Parse and handle ARC_SIGNAL patterns in AI messages
 * @module injection/signals
 */

import { chat, chat_metadata, saveMetadata } from '/script.js';
import { getArcById, updateArc } from '../planning/storage.js';
import { arcTier, ensureChatState, isKnowledgeTrackerEnabled } from '../core/settings.js';
import { completeBeats } from '../planning/beat-completion.js';
import { activateFirstPendingBeat } from '../planning/arc-edit.js';

/**
 * Regex to match [ARC_SIGNAL:arcId:itemId:VERB], bare or wrapped in an HTML
 * comment. COMPLETE marks a beat, PLANTED a foreshadowing clue, FIRED a
 * trigger. The directive asks for the comment form (ST's renderer hides it
 * even while streaming); the bare form stays accepted for old messages.
 */
const SIGNAL_PATTERN = /(?:<!--\s*)?\[ARC_SIGNAL:([^:]+):([^:]+):(COMPLETE|PLANTED|FIRED)\](?:\s*-->)?/g;

/**
 * @typedef {object} ParsedSignal
 * @property {string} arcId
 * @property {string} beatId - The beat, clue or trigger id
 * @property {'COMPLETE'|'PLANTED'|'FIRED'} verb
 * @property {string} fullMatch
 */

/**
 * Parse ARC_SIGNAL patterns from a message
 * @param {string} messageText
 * @returns {ParsedSignal[]}
 */
export function parseSignals(messageText) {
    if (!messageText) return [];

    const signals = [];
    let match;
    const regex = new RegExp(SIGNAL_PATTERN.source, 'g');
    while ((match = regex.exec(messageText)) !== null) {
        signals.push({
            arcId: match[1],
            beatId: match[2],
            verb: match[3],
            fullMatch: match[0],
        });
    }
    return signals;
}

/**
 * Strip ARC_SIGNAL patterns from a message's displayed text.
 * @param {number} messageIndex
 */
export function stripSignalsFromMessage(messageIndex) {
    if (!chat || !chat[messageIndex]) return;

    const msg = chat[messageIndex];
    const original = msg.mes || '';
    const cleaned = original.replace(SIGNAL_PATTERN, '');

    if (cleaned !== original) {
        // The removed marker leaves its surrounding newlines behind; without
        // the trim every tracked message starts with a blank line.
        msg.mes = cleaned.trim();
        const messageBlock = $(`#chat .mes[mesid="${messageIndex}"] .mes_text`);
        if (messageBlock.length) {
            const cleanedHtml = messageBlock.html().replace(SIGNAL_PATTERN, '');
            messageBlock.html(cleanedHtml);
        }
    }
}

/**
 * Process signals: queue clue and trigger marks (see flushPendingMarks) and
 * complete the beats the COMPLETE markers name, through the rules both
 * recognition paths share (completeBeats in planning/beat-completion.js),
 * with the carrying message as the fulfilling one.
 * @param {ParsedSignal[]} signals
 * @param {object[]} activeArcs
 * @param {number} messageIndex - Chat index of the message that carried the signals
 * @returns {{ updated: boolean, completedBeats: string[] }}
 */
export async function processSignalResults(signals, activeArcs, messageIndex) {
    let marksQueued = false;
    const completions = [];

    for (const signal of signals) {
        if (!MARKED_ITEMS[signal.verb]) {
            completions.push({ arcId: signal.arcId, beatId: signal.beatId, at: messageIndex });
            continue;
        }

        const arc = activeArcs.find(candidate => candidate.id.startsWith(signal.arcId));
        if (!arc) {
            console.warn(`[Story Arc] Signal referenced unknown arc: ${signal.arcId}`);
            continue;
        }
        if (queueMark(arc, signal, messageIndex)) marksQueued = true;
    }

    const { updated: beatsCompleted, completedBeats } = await completeBeats(completions, activeArcs);
    return { updated: marksQueued || beatsCompleted, completedBeats };
}

/** List and flag a PLANTED or FIRED marker sets, by verb */
const MARKED_ITEMS = {
    PLANTED: { list: 'foreshadowing', flag: 'planted' },
    FIRED: { list: 'triggers', flag: 'fired' },
};

/**
 * Queue a PLANTED or FIRED mark. The flag is not set here: a marked item
 * leaves the plan and the plant check, and every changed byte of the prompt
 * costs a full cache miss (architecture.md, "No injected text may change per
 * message"). flushPendingMarks applies the queue together with a change that
 * happens anyway. Unlike a beat, any number of items may be marked in one
 * message: a clue moves no pace. While the knowledge tracker is on, a clue
 * already queued and not yet confirmed moves to the newer claim's message.
 * Does not save: the caller of processSignalResults saves (`saveMetadata`).
 * @param {object} arc
 * @param {ParsedSignal} signal - A PLANTED or FIRED signal
 * @param {number} messageIndex
 * @returns {boolean} True when a mark was queued
 */
function queueMark(arc, signal, messageIndex) {
    const { list, flag } = MARKED_ITEMS[signal.verb];
    const item = (arc[list] || []).find(candidate => candidate.id === signal.beatId);
    if (!item) {
        console.warn(`[Story Arc] ${signal.verb} signal referenced unknown item: ${signal.beatId}`);
        return false;
    }
    if (item[flag]) return false;

    ensureChatState();
    const queue = chat_metadata.story_arc.pendingMarks ||= [];
    const queuedMark = queue.find(mark => mark.arcId === arc.id && mark.list === list && mark.id === item.id);
    // While the tracker checks claims, one not yet confirmed moves to the
    // newer claim, so a check that drops the older one cannot take the later,
    // perhaps real, plant with it (settleClaimedClues matches by message).
    // With the tracker off a claim counts as written, and the first one stands.
    const isUncheckedClaim = queuedMark && list === 'foreshadowing' && queuedMark.confirmed !== true && isKnowledgeTrackerEnabled();
    if (isUncheckedClaim && queuedMark.at < messageIndex) {
        queuedMark.at = messageIndex;
        return true;
    }
    if (queuedMark) return false;

    queue.push({ arcId: arc.id, list, flag, id: item.id, at: messageIndex });
    console.log(`[Story Arc] Queued ${flag}: "${item.id}" in "${arc.title}"`);
    return true;
}

/**
 * Messages a queued mark may wait for a prompt change that happens anyway.
 * ponytail: one fixed window; make it per tier if episodes need their clues
 * retired faster than a beat completion brings.
 */
export const MARK_FLUSH_WINDOW = 20;

/**
 * Apply the queued marks when the prompt changes anyway — a beat completed in
 * this message — or when the oldest has waited MARK_FLUSH_WINDOW messages.
 * Until then the item stays in the plan and in the plant check, so a repeated
 * marker for it is simply ignored.
 *
 * While the knowledge tracker is on, a PLANTED mark is applied only once the
 * extraction found the clue in its message (`confirmed`, settleClaimedClues;
 * ADR-0005 amendment 2026-11-26): the narrator claims clues it never wrote,
 * and a planted clue leaves the plan for good. An unconfirmed one waits for
 * that check and counts for neither the window nor a flush. With the
 * tracker off nothing checks a claim, so it counts as written. A FIRED mark
 * is applied as before. An applied mark records its message on the item
 * (`plantedAt`, `firedAt`).
 * @param {number} messageIndex - Chat index of the message just received
 * @param {boolean} promptChangesAnyway - A beat completed in this message
 * @returns {Promise<boolean>} True when marks were applied
 */
export async function flushPendingMarks(messageIndex, promptChangesAnyway) {
    const queue = chat_metadata.story_arc?.pendingMarks;
    if (!queue?.length) return false;
    const claimsAreChecked = isKnowledgeTrackerEnabled();
    const isReady = mark => mark.list !== 'foreshadowing' || mark.confirmed === true || !claimsAreChecked;
    const readyMarks = queue.filter(isReady);
    if (readyMarks.length === 0) return false;
    if (!promptChangesAnyway) {
        const oldestMarkAge = messageIndex - readyMarks[0].at;
        if (oldestMarkAge < MARK_FLUSH_WINDOW) return false;
    }

    for (const mark of readyMarks) {
        const arc = getArcById(mark.arcId);
        const item = arc?.[mark.list]?.find(candidate => candidate.id === mark.id);
        if (item) {
            item[mark.flag] = true;
            item[`${mark.flag}At`] = mark.at;
        } else {
            console.warn(`[Story Arc] Dropped queued mark: arc "${mark.arcId}" or item "${mark.id}" no longer exists`);
        }
    }
    console.log(`[Story Arc] Applied ${readyMarks.length} queued mark(s)`);
    chat_metadata.story_arc.pendingMarks = queue.filter(mark => !isReady(mark));
    await saveMetadata();
    return true;
}

/**
 * The PLANTED claims the knowledge extraction checks: the queued clue marks
 * of the messages it reads, confirmed ones too, so a re-extraction of an
 * edited or swiped message checks its claims against the new text. Each
 * gets the ref the extraction reports it by, `<first 8 characters of the
 * arc id>:<clue id>`, the marker's own form. A mark whose arc or clue is
 * gone is left out; the flush drops it.
 * @param {number} fromIndex - First message the extraction reads
 * @param {number} lastReadIndex - Last message it reads
 * @returns {{ref: string, arcId: string, id: string, at: number, clue: string}[]}
 */
export function listClaimedClues(fromIndex, lastReadIndex) {
    const queue = chat_metadata.story_arc?.pendingMarks || [];
    const claimedClues = [];
    for (const mark of queue) {
        if (mark.list !== 'foreshadowing' || mark.at < fromIndex || mark.at > lastReadIndex) continue;
        const clue = getArcById(mark.arcId)?.foreshadowing?.find(candidate => candidate.id === mark.id);
        if (!clue) continue;
        claimedClues.push({ ref: `${mark.arcId.slice(0, 8)}:${mark.id}`, arcId: mark.arcId, id: mark.id, at: mark.at, clue: clue.clue });
    }
    return claimedClues;
}

/**
 * Settle the PLANTED claims an applied extraction answer checked
 * (listClaimedClues): a claim whose clue the answer found is `confirmed`
 * and waits for the flush; one it did not find is dropped, and the clue
 * stays in the plan for the narrator to plant again. With `readFrom` (a
 * reply update), an unconfirmed claim of a message before it is dropped
 * too: no later update reads that message (the tracker was switched on
 * after it, or the first update read only the latest exchange).
 * Does not save: the caller saves.
 * @param {{ref: string, arcId: string, id: string, at: number}[]} checkedClues - The claims the extraction was shown, matched by message too
 * @param {string[]} confirmedRefs - The refs among them the answer found
 * @param {number} [readFrom] - First message a reply update read
 * @returns {{confirmed: number, dropped: number}}
 */
export function settleClaimedClues(checkedClues, confirmedRefs, readFrom) {
    const queue = chat_metadata.story_arc?.pendingMarks;
    if (!queue?.length) return { confirmed: 0, dropped: 0 };
    const isMarkOf = (mark, claim) => mark.list === 'foreshadowing' && mark.arcId === claim.arcId && mark.id === claim.id && mark.at === claim.at;
    let confirmed = 0;
    const remainingMarks = [];
    for (const mark of queue) {
        const claim = checkedClues.find(candidate => isMarkOf(mark, candidate));
        if (claim && confirmedRefs.includes(claim.ref)) {
            mark.confirmed = true;
            confirmed++;
            remainingMarks.push(mark);
            continue;
        }
        if (claim) {
            console.log(`[Story Arc] Clue "${mark.id}" not found in message #${mark.at}; its PLANTED claim is dropped`);
            continue;
        }
        const isPastEveryCheck = readFrom !== undefined && mark.list === 'foreshadowing' && mark.confirmed !== true && mark.at < readFrom;
        if (isPastEveryCheck) {
            console.log(`[Story Arc] Clue "${mark.id}" claimed at message #${mark.at}, which no update reads; its PLANTED claim is dropped`);
            continue;
        }
        remainingMarks.push(mark);
    }
    const dropped = queue.length - remainingMarks.length;
    chat_metadata.story_arc.pendingMarks = remainingMarks;
    return { confirmed, dropped };
}

/**
 * Scrub arc-internal identifiers (arc, beat, secret, clue and trigger ids)
 * from a message.
 * The directive asks the model to keep plan internals out of its output, but
 * only this scrub guarantees it: identifiers that leak into journals or
 * state-tracking blocks would otherwise persist into chat history and steer
 * later generations. Runs after signal parsing — it would destroy markers.
 * @param {number} messageIndex
 * @param {object[]} arcs - Arcs whose identifiers to remove
 */
export function scrubArcInternals(messageIndex, arcs) {
    if (!chat || !chat[messageIndex] || !arcs?.length) return;

    const ids = arcInternalIds(arcs);

    const msg = chat[messageIndex];
    let cleaned = msg.mes || '';
    for (const id of ids) {
        cleaned = cleaned.split(id).join('…');
    }

    if (cleaned !== msg.mes) {
        console.log('[Story Arc] Scrubbed leaked arc identifiers from message', messageIndex);
        msg.mes = cleaned;
        const messageBlock = $(`#chat .mes[mesid="${messageIndex}"] .mes_text`);
        if (messageBlock.length) {
            let html = messageBlock.html();
            for (const id of ids) {
                html = html.split(id).join('…');
            }
            messageBlock.html(html);
        }
    }
}

/**
 * The identifiers of the given arcs that can be recognised in prose: arc ids
 * (full and the 8-character marker form) and every item id with an
 * underscore. The harvester uses the same list to keep messages that name
 * plan internals out of the planner's input.
 * @param {object[]} arcs
 * @returns {string[]}
 */
export function arcInternalIds(arcs) {
    const ids = [];
    for (const arc of arcs) {
        // Only distinctive tokens: an id that is a plain English word cannot
        // be told apart from prose — and is unrecognizable as an id anyway.
        // A narrator's OOC analysis once printed a secret id beside the
        // secret's content (Paragon chat, 2026-10-30).
        const items = [...(arc.beats || []), ...(arc.secrets || []), ...(arc.foreshadowing || []), ...(arc.triggers || [])];
        const distinctiveIds = items.map(item => item.id).filter(id => id?.includes('_'));
        ids.push(...distinctiveIds);
        if (arc.id) {
            const markerArcId = arc.id.slice(0, 8);
            ids.push(arc.id, markerArcId);
        }
    }
    return ids;
}

/**
 * Promote the next pending beat in every episode that currently has none
 * active; activate every pending milestone in acts and sagas.
 *
 * Called on the user's turn, not on beat completion: the gap between a
 * completed scene beat and the next one is where the story breathes, and the
 * model must not learn what comes next until the player has reacted. It
 * cannot stall — the next user message always promotes. Doubles as a repair
 * for arcs left stalled by an earlier version.
 *
 * Milestones have no such gap and no promotion: every open one stays active,
 * so recognition sees them all, and the current one is derived as the first
 * open one in order (currentMilestone, ADR-0010). Its pressure is the only
 * one the narrator gets, so the next one presses as soon as the current one
 * completes or is skipped. Validation already activates them; this only
 * repairs an act or saga that arrived with pending milestones (a re-plan
 * merge, an old build).
 * @param {object[]} arcs - Active arcs
 * @returns {Promise<boolean>} True when at least one beat was promoted
 */
export async function promoteNextBeats(arcs) {
    let promoted = false;

    for (const arc of arcs) {
        if (arcTier(arc) !== 'episode') {
            const pendingMilestones = arc.beats.filter(milestone => milestone.status === 'pending');
            if (!pendingMilestones.length) continue;
            for (const milestone of pendingMilestones) milestone.status = 'active';
            promoted = true;
            console.log(`[Story Arc] ${pendingMilestones.length} milestone(s) now active in "${arc.title}"`);
            await updateArc(arc.id, { beats: arc.beats });
            continue;
        }

        const promotedArc = activateFirstPendingBeat(arc);
        if (promotedArc === arc) continue;

        // A copy comes back only when a pending beat was made active, and it
        // is then the episode's one active beat (activateFirstPendingBeat).
        const next = promotedArc.beats.find(beat => beat.status === 'active');
        // The caller reads the promotion off the arc it passed in.
        arc.beats = promotedArc.beats;
        promoted = true;
        console.log(`[Story Arc] Beat now active: "${next.intention}" in "${arc.title}"`);
        await updateArc(arc.id, { beats: arc.beats });
    }

    return promoted;
}

/**
 * Drop a queued mark, so a hand toggle in the Arc Manager is not undone by
 * the next flush.
 * Does not save: the caller saves (`saveMetadata`, via its `updateArc`).
 * @param {string} arcId
 * @param {string} list - 'foreshadowing' or 'triggers'
 * @param {string} itemId
 */
export function dropPendingMark(arcId, list, itemId) {
    const queue = chat_metadata.story_arc?.pendingMarks;
    if (!queue?.length) return;
    const remainingMarks = queue.filter(mark => !(mark.arcId === arcId && mark.list === list && mark.id === itemId));
    chat_metadata.story_arc.pendingMarks = remainingMarks;
}

/**
 * Drop the queued marks of every message from `firstGoneIndex` on: the user
 * deleted or regenerated the reply they came from, so the story no longer
 * shows what they report. Left queued, such a mark closed a trigger later
 * although its reply had been swiped away (Paragon chat, 2026-10-31).
 * Deleting a message in the middle of the chat shifts later indices; marks
 * after it then stay queued, as before.
 * Does not save: the caller saves.
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {boolean} True when at least one mark was dropped
 */
export function dropPendingMarksFrom(firstGoneIndex) {
    const queue = chat_metadata.story_arc?.pendingMarks;
    if (!queue?.length) return false;
    const remainingMarks = queue.filter(mark => mark.at < firstGoneIndex);
    if (remainingMarks.length === queue.length) return false;
    console.log(`[Story Arc] Dropped ${queue.length - remainingMarks.length} queued mark(s) of removed message(s) from #${firstGoneIndex}`);
    chat_metadata.story_arc.pendingMarks = remainingMarks;
    return true;
}

/**
 * Drop the queued marks of the messages the player took out as rejected
 * (knowledge/rejection.js): the story no longer shows what they report.
 * Marks already applied stay, as after a deletion.
 * Does not save: the caller saves.
 * @param {Set<number>} rejectedIndices - The indices of the rejected messages
 * @returns {boolean} True when at least one mark was dropped
 */
export function dropPendingMarksAt(rejectedIndices) {
    const queue = chat_metadata.story_arc?.pendingMarks;
    if (!queue?.length) return false;
    const remainingMarks = queue.filter(mark => !rejectedIndices.has(mark.at));
    if (remainingMarks.length === queue.length) return false;
    console.log(`[Story Arc] Dropped ${queue.length - remainingMarks.length} queued mark(s) of rejected message(s)`);
    chat_metadata.story_arc.pendingMarks = remainingMarks;
    return true;
}
