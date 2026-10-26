/**
 * @file Chat history extraction and truncation
 * @module context/chat-history
 */

import { chat } from '/script.js';

/**
 * Extract recent chat messages, truncated to a max count.
 * @param {number} [maxMessages=50] - Maximum messages to return
 * @returns {{ role: string, name: string, content: string }[]}
 */
export function getRecentChat(maxMessages = 50) {
    if (!chat || !chat.length) return [];

    const recent = chat.slice(-maxMessages);
    const recentChat = recent.map(msg => ({
        role: msg.is_user ? 'user' : 'assistant',
        name: msg.name || (msg.is_user ? 'User' : 'Character'),
        content: msg.mes || '',
    }));
    return recentChat;
}

/**
 * Estimate token count using chars/4 heuristic
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}
