/**
 * @file Per-message arc counters stamped onto the outgoing prompt
 * @module injection/stamping
 *
 * The model needs an exact "how far into this arc are we" number on every
 * generation, but the provider's prompt cache is a strict byte-prefix match:
 * any byte that changes at a position it occupied last turn drops cache reads
 * to zero. A single counter line near the generation point is therefore the
 * worst possible shape — it changes every message.
 *
 * The fix is to give every message its own counter, derived purely from that
 * message's own chat index and the arc's fixed metadata. Message 67 reads
 * "message 67 of ~80" this turn, next turn, and forever, so old positions keep
 * their bytes and only the newly appended tail is new — while the newest
 * message still carries the current number.
 *
 * The stamps live in the outgoing messages array only. Stored chat and the
 * displayed UI are never touched.
 */

import { chat } from '/script.js';
import { INJECTION_HEADER } from '../core/constants.js';
import { arcMessageStart } from '../core/settings.js';
import { selectPacingClock } from './clock.js';

/**
 * Stamp the outgoing prompt's user messages with their arc counters, in place.
 *
 * Only user messages are stamped: half the tokens for the same pacing signal,
 * and stamping the model's own past replies invites it to imitate the format
 * and write "[Arc: message …]" into its prose. The cost is that generations
 * following an assistant message (Continue, or generating without typing) read
 * a number a few messages behind. Accepted — the phase brake, not the exact
 * count, is what enforces pacing.
 *
 * Prompt entries are matched back to chat indices by content rather than by
 * position, because ST filters system messages out of the prompt and other
 * extensions splice their own entries in. A prompt entry that matches nothing
 * is skipped without consuming a chat index, so a foreign entry cannot shift
 * every later number. If a regex script rewrote message text for the prompt,
 * nothing matches and nothing is stamped — a no-op, never a wrong count.
 *
 * @param {Array<{role: string, content: string}>} promptChat - Outgoing messages, mutated
 * @param {object[]} arcs - Active arcs
 * @returns {number} How many messages were stamped
 */
export function stampPromptMessages(promptChat, arcs) {
    if (!Array.isArray(promptChat) || !promptChat.length) return 0;

    // ponytail: one clock only — the counter is the pacing clock and one is
    // enough. Per-arc stamps if concurrent episodes with different lengths
    // ever become normal. Note that changing focus in the arc manager can
    // change which arc that is, and therefore every historical stamp: one
    // cache miss, same as any other arc lifecycle change.
    const arc = selectPacingClock(arcs);
    if (!arc) return 0;

    // Other extensions' generateRaw calls fire the same event. Ours is the one
    // carrying the arc plan block.
    const isChatPrompt = promptChat.some(entry =>
        typeof entry?.content === 'string' && entry.content.includes(INJECTION_HEADER)
    );
    if (!isChatPrompt) return 0;

    const start = arcMessageStart(arc);
    let stamped = 0;
    let cursor = chat.length - 1;

    for (let promptIndex = promptChat.length - 1; promptIndex >= 0 && cursor >= start; promptIndex--) {
        const entry = promptChat[promptIndex];
        if (entry?.role !== 'user' || typeof entry.content !== 'string') continue;

        let probe = cursor;
        while (probe >= start && !isSameMessage(entry.content, chat[probe])) probe--;
        if (probe < start) continue;

        const stamp = buildStamp(arc, probe);
        entry.content = `${stamp}\n${entry.content}`;
        cursor = probe - 1;
        stamped++;
    }

    return stamped;
}

/**
 * Does this user prompt entry's content come from this chat message? ST may
 * prepend the speaker name and always strips carriage returns, so the stored
 * text is a suffix of the prompt text rather than equal to it. Only user
 * messages qualify: a short assistant reply can be the tail of a user message
 * ("yes" in "oh yes") and would otherwise take its number.
 * @param {string} content - Prompt entry content
 * @param {object} message - Chat message
 * @returns {boolean}
 */
function isSameMessage(content, message) {
    if (!message?.is_user) return false;
    const mes = String(message.mes ?? '').replace(/\r/g, '');
    return mes.length > 0 && content.endsWith(mes);
}

/**
 * Build the stamp for one chat position. Pure function of the index and fixed
 * arc metadata — that is what makes it byte-stable across turns.
 * @param {object} arc
 * @param {number} chatIndex - Index into ST's `chat` array
 * @returns {string} Stamp text, or '' for positions before the arc started
 */
export function buildStamp(arc, chatIndex) {
    const number = chatIndex - arcMessageStart(arc) + 1;
    if (number < 1) return '';
    return arc.estimatedLength > 0
        ? `[Arc: message ${number} of ~${arc.estimatedLength}]`
        : `[Arc: message ${number}]`;
}
