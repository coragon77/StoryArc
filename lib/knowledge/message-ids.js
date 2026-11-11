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
