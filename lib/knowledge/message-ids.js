/**
 * Story Arc - Message ids
 *
 * Story Arc's own stable id on a chat message, in its `extra`. The knowledge
 * ledger and the beat completions name their message by it, so they follow
 * the message wherever later deletions move it, and go with it.
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
