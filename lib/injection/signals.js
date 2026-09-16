/**
 * @file Parse and handle ARC_SIGNAL patterns in AI messages
 * @module injection/signals
 */

import { chat } from '/script.js';
import { getArcById, updateArc } from '../planning/storage.js';

/**
 * Regex to match [ARC_SIGNAL:arcId:beatId:COMPLETE], bare or wrapped in an
 * HTML comment. The directive asks for the comment form (ST's renderer hides
 * it even while streaming); the bare form stays accepted for old messages.
 */
const SIGNAL_PATTERN = /(?:<!--\s*)?\[ARC_SIGNAL:([^:]+):([^:]+):COMPLETE\](?:\s*-->)?/g;

/**
 * @typedef {object} ParsedSignal
 * @property {string} arcId
 * @property {string} beatId
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
            messageBlock.html(messageBlock.html().replace(SIGNAL_PATTERN, ''));
        }
    }
}

/**
 * Scrub arc-internal identifiers (beat ids, arc ids) from a message.
 * The directive asks the model to keep plan internals out of its output, but
 * only this scrub guarantees it: identifiers that leak into journals or
 * state-tracking blocks would otherwise persist into chat history and steer
 * later generations. Runs after signal parsing — it would destroy markers.
 * @param {number} messageIndex
 * @param {object[]} arcs - Arcs whose identifiers to remove
 */
export function scrubArcInternals(messageIndex, arcs) {
    if (!chat || !chat[messageIndex] || !arcs?.length) return;

    const ids = [];
    for (const arc of arcs) {
        // Only distinctive tokens: an id that is a plain English word cannot
        // be told apart from prose — and is unrecognizable as an id anyway.
        ids.push(...(arc.beats || []).map(b => b.id).filter(id => id?.includes('_')));
        if (arc.id) ids.push(arc.id, arc.id.slice(0, 8));
    }

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
 * Process signals: find matching arcs/beats, update status, unlock gated beats.
 * @param {ParsedSignal[]} signals
 * @param {object[]} activeArcs
 * @param {number} messageIndex - Chat index of the message that carried the signals
 * @returns {{ updated: boolean, completedBeats: string[] }}
 */
export async function processSignalResults(signals, activeArcs, messageIndex) {
    let updated = false;
    const completedBeats = [];
    const arcsAlreadyAdvanced = new Set();

    for (const signal of signals) {
        const arc = activeArcs.find(a => a.id.startsWith(signal.arcId));
        if (!arc) {
            console.warn(`[Story Arc] Signal referenced unknown arc: ${signal.arcId}`);
            continue;
        }

        const beat = arc.beats.find(b => b.id === signal.beatId);
        if (!beat) {
            console.warn(`[Story Arc] Signal referenced unknown beat: ${signal.beatId}`);
            continue;
        }

        // One beat per arc per message. An eager scene that claims two beats
        // at once burns the arc's pace; the second claim waits for its own
        // message. Per arc, not global — independent arcs may each advance.
        if (arcsAlreadyAdvanced.has(arc.id)) {
            console.warn(`[Story Arc] Second completion in one message ignored: ${signal.beatId}`);
            continue;
        }

        // Active beats only. Pending beats are not shown to the model at all,
        // so a signal for one is a hallucinated id or a stale marker.
        if (beat.status !== 'active') {
            console.warn(`[Story Arc] Signal for ${beat.status} beat ignored: ${signal.beatId}`);
            continue;
        }

        beat.status = 'completed';
        // The stall count (see isStalled) restarts from the fulfilling message.
        arc.lastFulfilledAt = messageIndex;
        arcsAlreadyAdvanced.add(arc.id);
        completedBeats.push(signal.beatId);
        updated = true;
        console.log(`[Story Arc] Beat completed: "${beat.intention}" in "${arc.title}"`);

        for (const otherBeat of arc.beats) {
            if (otherBeat.status === 'locked' && otherBeat.unlockAfter.includes(signal.beatId)) {
                const allUnlocked = otherBeat.unlockAfter.every(
                    reqId => arc.beats.find(b => b.id === reqId)?.status === 'completed'
                );
                if (allUnlocked) {
                    otherBeat.status = 'pending';
                    console.log(`[Story Arc] Beat unlocked: "${otherBeat.intention}"`);
                }
            }
        }

        // No promotion here. The arc is deliberately left without an active
        // beat until the next user message (see promoteNextBeats) — otherwise
        // the AI's own aftermath prose chains straight into the next objective
        // and the player never gets a turn between developments.

        const remaining = arc.beats.filter(b => !b.optional && b.status !== 'completed');
        if (remaining.length === 0) {
            arc.status = 'completed';
            console.log(`[Story Arc] Arc completed: "${arc.title}"`);
        }

        await updateArc(arc.id, { beats: arc.beats, status: arc.status, lastFulfilledAt: arc.lastFulfilledAt });
    }

    return { updated, completedBeats };
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
 * Milestones have no such gap: all unfulfilled ones stand at once from
 * planning onward, so nothing is ever hidden and nothing waits for a turn.
 * Validation already activates them; this only repairs an act or saga that
 * arrived with pending milestones (a re-plan merge, an old build).
 * @param {object[]} arcs - Active arcs
 * @returns {Promise<boolean>} True when at least one beat was promoted
 */
export async function promoteNextBeats(arcs) {
    let promoted = false;

    for (const arc of arcs) {
        if ((arc.tier || 'episode') !== 'episode') {
            const pendingMilestones = arc.beats.filter(b => b.status === 'pending');
            if (!pendingMilestones.length) continue;
            for (const milestone of pendingMilestones) milestone.status = 'active';
            promoted = true;
            console.log(`[Story Arc] ${pendingMilestones.length} milestone(s) now active in "${arc.title}"`);
            await updateArc(arc.id, { beats: arc.beats });
            continue;
        }

        if (arc.beats.some(b => b.status === 'active')) continue;

        const next = arc.beats.find(b => b.status === 'pending');
        if (!next) continue;

        next.status = 'active';
        promoted = true;
        console.log(`[Story Arc] Beat now active: "${next.intention}" in "${arc.title}"`);
        await updateArc(arc.id, { beats: arc.beats });
    }

    return promoted;
}
