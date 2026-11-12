/**
 * @file What Story Arc sends to the narrator, and the record of the last send
 * @module injection/narrator-prompts
 *
 * One list of Story Arc's prompts, with every gate, position and depth, for
 * the two places that need it: the injection before each generation
 * (index.js, injectStoryArcPrompts) and the view of what the narrator gets
 * (ui/sent-view.js). The view shows the text the injection sets, never a
 * copy built for display (#83).
 *
 * The record of the last send ("Last sent") is read back from SillyTavern's
 * prompt registry the moment a request goes out, so it holds what was sent,
 * not what would be built now.
 */

import { chat, chat_metadata, extension_prompts, extension_prompt_types, extension_prompt_roles } from '/script.js';
import { KNOWLEDGE_PROMPT_KEY, NAMES_PROMPT_KEY } from '../core/constants.js';
import { isEnabled, isKnowledgeTrackerEnabled, isCharacterDetailsEnabled, isAppearanceEnabled, getKnowledgeLedger } from '../core/settings.js';
import { getActiveArcs } from '../planning/storage.js';
import { buildInjection, buildSignalInjection } from './builder.js';
import { STAMP_PREFIX } from './stamping.js';
import { buildKnowledgeBlock } from '../knowledge/ledger.js';
import { buildTakenNamesBlock } from '../knowledge/names.js';

export const PLAN_PROMPT_KEY = 'story_arc_plan';
export const SIGNALS_PROMPT_KEY = 'story_arc_signals';

/** Story Arc's prompt keys in the order the narrator reads them. */
const PROMPT_KEYS_IN_ORDER = [PLAN_PROMPT_KEY, KNOWLEDGE_PROMPT_KEY, NAMES_PROMPT_KEY, SIGNALS_PROMPT_KEY];

// ─── The prompts ───

/**
 * Every prompt Story Arc sets, in the order the narrator reads them, each
 * with its text and where SillyTavern puts it. A part that is off has the
 * text '': the injection sets every key on every generation, so no stale
 * text lingers after the last arc ends or a switch goes off.
 *
 * - The arc plan, in the prompt (chat completion appends it to the
 *   preset's Main prompt), while Story Arc is on and an arc is active.
 * - The knowledge block and the taken-names block, in-chat at depth 1 with
 *   the system role, right above the newest message, while the knowledge
 *   tracker is on. SillyTavern joins prompts of one depth and role into one
 *   message, keys in alphabetical order, so the names follow the knowledge.
 * - The signal directive, in-chat at depth 0, after the newest message:
 *   models ignore it when it sits far back in the system prompt.
 *
 * @returns {{key: string, text: string, position: number, depth: number, role: number}[]}
 */
export function listStoryArcPrompts() {
    const arcs = isEnabled() ? getActiveArcs() : [];
    const trackerOn = isEnabled() && isKnowledgeTrackerEnabled();
    const ledger = trackerOn ? getKnowledgeLedger() : null;

    const planText = arcs.length ? buildInjection(arcs) : '';
    const knowledgeText = trackerOn ? buildKnowledgeBlock(ledger, chat, isCharacterDetailsEnabled(), isAppearanceEnabled()) : '';
    const namesText = trackerOn ? buildTakenNamesBlock(ledger) : '';
    const signalsText = arcs.length ? buildSignalInjection(arcs) : '';

    return [
        { key: PLAN_PROMPT_KEY, text: planText, position: extension_prompt_types.IN_PROMPT, depth: 0, role: extension_prompt_roles.SYSTEM },
        { key: KNOWLEDGE_PROMPT_KEY, text: knowledgeText, position: extension_prompt_types.IN_CHAT, depth: 1, role: extension_prompt_roles.SYSTEM },
        { key: NAMES_PROMPT_KEY, text: namesText, position: extension_prompt_types.IN_CHAT, depth: 1, role: extension_prompt_roles.SYSTEM },
        { key: SIGNALS_PROMPT_KEY, text: signalsText, position: extension_prompt_types.IN_CHAT, depth: 0, role: extension_prompt_roles.SYSTEM },
    ];
}

// ─── Last sent ───

/** The type of the last generation that was not a dry run, from GENERATION_STARTED. */
let lastGenerationType = null;

/**
 * Note the type of a starting generation ('quiet', 'swipe', 'continue', …),
 * so the record of the send knows which reply it belongs to and leaves
 * quiet generations out. Dry runs (token counting) change nothing.
 * @param {string|undefined} type - GENERATION_STARTED's type argument
 * @param {boolean} dryRun - GENERATION_STARTED's dryRun argument
 */
export function noteGenerationType(type, dryRun) {
    if (dryRun) return;
    lastGenerationType = type ?? 'normal';
}

/**
 * Keep what Story Arc sent with a request that goes out now, in
 * chat_metadata.story_arc.lastSent, replacing the one before. Called at
 * CHAT_COMPLETION_PROMPT_READY for a request that is not a dry run, after
 * the stamps went on.
 *
 * Nothing is kept for a quiet generation (a summary or another extension's
 * background call through Generate), nor for a request that carries none of
 * Story Arc's texts: other extensions' generateRaw calls fire the same
 * event without GENERATION_STARTED, so the noted type would be stale for
 * them. The chat's own save after the reply writes the record.
 *
 * The texts come from SillyTavern's prompt registry, the values set for
 * this request. The stamp is the first line of the newest user message in
 * the outgoing array that carries one.
 *
 * @param {Array<{role: string, content: unknown}>} outgoingChat - The request's messages
 * @returns {boolean} Whether a record was kept
 */
export function saveLastSent(outgoingChat) {
    if (lastGenerationType === 'quiet') return false;
    if (!Array.isArray(outgoingChat) || !chat_metadata.story_arc) return false;

    const outgoingTexts = outgoingChat
        .map(entry => entry?.content)
        .filter(content => typeof content === 'string');

    const parts = [];
    for (const key of PROMPT_KEYS_IN_ORDER) {
        const registered = extension_prompts[key];
        if (!registered) continue;
        parts.push({ key, text: String(registered.value ?? ''), position: registered.position, depth: registered.depth });
    }
    const carriesStoryArcText = parts.some(part => {
        const sentText = part.text.trim();
        return sentText !== '' && outgoingTexts.some(content => content.includes(sentText));
    });
    if (!carriesStoryArcText) return false;

    const stampedEntry = outgoingChat.findLast(entry =>
        entry?.role === 'user' && typeof entry.content === 'string' && entry.content.startsWith(STAMP_PREFIX));
    const stamp = stampedEntry ? stampedEntry.content.split('\n')[0] : null;

    // A swipe or a continue writes into the newest message; any other
    // generation adds a reply after it (a regenerate deleted the old one
    // before the prompt was built). A swipe's request leaves out the reply
    // it replaces, so the newest message the narrator reads is the one
    // before it (live check, Amy chat, 2026-11-12).
    const writesIntoNewest = lastGenerationType === 'swipe' || lastGenerationType === 'continue';
    const replyIndex = writesIntoNewest ? chat.length - 1 : chat.length;
    chat_metadata.story_arc.lastSent = {
        replyIndex,
        newestMessageIndex: lastGenerationType === 'continue' ? replyIndex : replyIndex - 1,
        type: lastGenerationType ?? 'normal',
        savedAt: new Date().toISOString(),
        parts,
        stamp,
    };
    return true;
}

/**
 * Drop the record of the last send when its reply lies past the loaded
 * chat's end: SillyTavern copies the metadata whole on a branch, and the
 * branch never sent that request.
 * @param {number} chatLength - The loaded chat's length
 * @returns {boolean} Whether a record was dropped
 */
export function dropLastSentPastEnd(chatLength) {
    const lastSent = chat_metadata.story_arc?.lastSent;
    if (!lastSent || lastSent.replyIndex <= chatLength) return false;
    delete chat_metadata.story_arc.lastSent;
    return true;
}
