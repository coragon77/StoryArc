/**
 * @file Parse and handle ARC_SIGNAL patterns in AI messages
 * @module injection/signals
 */

import { chat } from '/script.js';
import { getArcById, updateArc } from '../planning/storage.js';

/** Regex to match [ARC_SIGNAL:arcId:beatId:COMPLETE] */
const SIGNAL_PATTERN = /\[ARC_SIGNAL:([^:]+):([^:]+):COMPLETE\]/g;

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
    const cleaned = original.replace(SIGNAL_PATTERN, '').trimEnd();

    if (cleaned !== original) {
        msg.mes = cleaned;
        const messageBlock = $(`#chat .mes[mesid="${messageIndex}"] .mes_text`);
        if (messageBlock.length) {
            messageBlock.html(messageBlock.html().replace(SIGNAL_PATTERN, ''));
        }
    }
}

/**
 * Process signals: find matching arcs/beats, update status, unlock gated beats.
 * @param {ParsedSignal[]} signals
 * @param {object[]} activeArcs
 * @returns {{ updated: boolean, completedBeats: string[] }}
 */
export async function processSignalResults(signals, activeArcs) {
    let updated = false;
    const completedBeats = [];

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

        // Accept pending beats too — stories often fulfill the next beat in
        // the same scene as the active one. Only locked/completed are refused.
        if (beat.status !== 'active' && beat.status !== 'pending') {
            console.warn(`[Story Arc] Signal for ${beat.status} beat ignored: ${signal.beatId}`);
            continue;
        }

        beat.status = 'completed';
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

        // Keep exactly one beat in play: without this promotion the arc
        // stalls after its first completed beat (no (NOW) beat, no markers
        // in the signal directive, tracking dead).
        if (!arc.beats.some(b => b.status === 'active')) {
            const next = arc.beats.find(b => b.status === 'pending');
            if (next) {
                next.status = 'active';
                console.log(`[Story Arc] Beat now active: "${next.intention}"`);
            }
        }

        const remaining = arc.beats.filter(b => !b.optional && b.status !== 'completed');
        if (remaining.length === 0) {
            arc.status = 'completed';
            console.log(`[Story Arc] Arc completed: "${arc.title}"`);
        }

        await updateArc(arc.id, { beats: arc.beats, status: arc.status });
    }

    return { updated, completedBeats };
}
