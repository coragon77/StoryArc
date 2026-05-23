/**
 * @file Character card and persona extraction
 * @module context/character
 */

import { characters, this_chid } from '/script.js';
import { getContext } from '/scripts/extensions.js';

/**
 * Get current character card data
 * @returns {{ name: string, description: string, personality: string, scenario: string } | null}
 */
export function getCharacterData() {
    if (this_chid === undefined || this_chid === null) {
        console.warn('[Story Arc] No character selected');
        return null;
    }
    const char = characters[this_chid];
    if (!char) return null;

    return {
        name: char.name || '',
        description: char.description || '',
        personality: char.personality || '',
        scenario: char.scenario || '',
    };
}

/**
 * Get user persona name and description
 * @returns {{ name: string, description: string }}
 */
export function getPersonaData() {
    const context = getContext();
    return {
        name: context.name1 || 'User',
        description: context.persona || '',
    };
}
