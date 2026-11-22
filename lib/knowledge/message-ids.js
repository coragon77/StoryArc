/**
 * Story Arc - Message ids and marks
 *
 * Story Arc's own stable id on a chat message, in its `extra`. The knowledge
 * ledger and the beat completions name their message by it, so they follow
 * the message wherever later deletions move it, and go with it. Also the
 * rejected mark a take-out sets, and the out-of-character test the
 * rewrite check and the take-out's proposal share.
 */

import { uuidv4 } from '/scripts/utils.js';

/** The key of Story Arc's message id in a chat message's `extra`. */
export const MESSAGE_ID_KEY = 'story_arc_message_id';

/**
 * Give every message the extraction read Story Arc's message id, a stable
 * id in the message's `extra`, unless it carries one already: the id stays
 * with the message wherever later deletions move it. Hidden (system)
 * messages are not read and get none; a re-extraction reads a hidden
 * message an update read as a shown copy that shares its `extra`
 * (chatShowingMessage in ledger.js). This is Story Arc's own protocol data
 * on the message (GOALS.md); ST saves it with the chat, and saveMetadata
 * saves the whole chat.
 * @param {object[]} chatMessages - ST's chat array, its messages changed in place
 * @param {number} fromIndex - The first covered message
 * @param {number} lastIndex - The last covered message
 * @returns {Map<number, string>} Each covered message's index and message id
 */
export function assignCoveredMessageIds(chatMessages, fromIndex, lastIndex) {
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

/**
 * The Story Arc message id a chat message carries, if any.
 * @param {object} chatMessage
 * @returns {string|undefined}
 */
export function messageIdOf(chatMessage) {
    return chatMessage?.extra?.[MESSAGE_ID_KEY];
}

/**
 * The key of the marker in a chat message's `extra` that its Story Arc
 * message id was created by the appearance search (giveMessageId).
 */
export const SEARCH_ID_KEY = 'story_arc_message_id_by_search';

/**
 * Give one chat message Story Arc's message id, hidden (system) or not,
 * unless it carries one already. The appearance search's accepted finding
 * names its source message by it, and that message is usually hidden. A
 * new id is marked as the search's (SEARCH_ID_KEY); an id the message
 * already had stays as it is, without the marker.
 * @param {object} chatMessage - A message of ST's chat array, changed in place
 * @returns {string} Its message id
 */
export function giveMessageId(chatMessage) {
    if (!chatMessage.extra || typeof chatMessage.extra !== 'object') chatMessage.extra = {};
    if (!chatMessage.extra[MESSAGE_ID_KEY]) {
        chatMessage.extra[MESSAGE_ID_KEY] = uuidv4();
        chatMessage.extra[SEARCH_ID_KEY] = true;
    }
    return chatMessage.extra[MESSAGE_ID_KEY];
}

/**
 * Whether a chat message's Story Arc message id was created by the
 * appearance search. The knowledge ledger treats a message id as evidence
 * that an update read the message, except an id the appearance search
 * created (showsUpdateRead in ledger.js). The marker never needs clearing:
 * an update that reads the message later records its read-text hash, which
 * counts first.
 * @param {object} chatMessage
 * @returns {boolean}
 */
export function isIdFromSearch(chatMessage) {
    return chatMessage?.extra?.[SEARCH_ID_KEY] === true;
}

/**
 * The key of the mark in a chat message's `extra` that the player took the
 * message out as rejected (knowledge/rejection.js). Story Arc protocol data
 * on the message, like the message id.
 */
export const REJECTED_KEY = 'story_arc_rejected';

/**
 * Whether a chat message is rejected: marked by a take-out and still
 * hidden. A rejected message the player unhid in SillyTavern is part of the
 * story again for every reader; only what it taught stays gone. The readers
 * that read hidden messages on purpose (the planner's chat window, the
 * appearance search) skip a rejected one.
 * @param {object} chatMessage
 * @returns {boolean}
 */
export function isRejectedMessage(chatMessage) {
    return Boolean(chatMessage?.is_system) && chatMessage?.extra?.[REJECTED_KEY] === true;
}

/** How an out-of-character message starts, ignoring case: "[OOC", "(OOC", "OOC:" or "((". */
const OUT_OF_CHARACTER_START = /^(?:\[\s*ooc|\(\s*ooc|ooc\s*:|\(\()/i;

/**
 * Whether a message's text is marked out of character: its trimmed text
 * starts with an OOC marker. Code tells the narrator's reports from story
 * by it only to shape what a take-out proposes, which the player sees and
 * can change; the knowledge extraction judges out-of-character lines itself.
 * @param {string} text - A message's text
 * @returns {boolean}
 */
export function isMarkedOutOfCharacter(text) {
    return OUT_OF_CHARACTER_START.test(String(text || '').trim());
}

/**
 * The key of the mark in a chat message's `extra` that the player was
 * offered to take out what this new version replaces, so a later
 * extraction of the same message (an edit, a swipe switch) offers it once.
 */
export const REWRITE_OFFERED_KEY = 'story_arc_rewrite_offered';
