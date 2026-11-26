/**
 * @file Prompt edits: the player's own wording of Story Arc's prompts
 * @module planning/prompt-edits
 *
 * An edit is stored globally in extension_settings.story_arc.promptOverrides,
 * keyed by template file name, as `{ text, builtInHash }`: `builtInHash` is
 * SillyTavern's string hash of the built-in text when the edit was saved, so
 * a Story Arc update that changes the built-in text shows as "changed".
 * loadTemplate (generator.js) sends the stored edit in place of the built-in
 * text; describePrompts describes all seven prompts for the Prompts popup.
 */

import { saveSettingsDebounced } from '/script.js';
import { getStringHash } from '/scripts/utils.js';
import { extension_settings } from '/scripts/extensions.js';
import { MODULE_NAME } from '../core/constants.js';

/**
 * The seven prompts Story Arc sends, in the order the Prompts popup lists
 * them: four when it plans an arc, three for the knowledge tracker. `name`
 * is the template file name, the key of an edit.
 */
export const PROMPT_CATALOG = [
    { name: 'analyze-context.txt', displayName: 'Story analysis', group: 'planning', runs: 'First step of planning and re-planning', profile: 'generation profile' },
    { name: 'ask-questions.txt', displayName: 'Questions for you', group: 'planning', runs: 'After the analysis, before the outline', profile: 'generation profile' },
    { name: 'generate-arc.txt', displayName: 'Arc outline', group: 'planning', runs: 'Writes the plan: premise, beats, secrets, clues', profile: 'generation profile' },
    { name: 'check-plan.txt', displayName: 'Plan check', group: 'planning', runs: 'Reads the finished plan for give-aways and names', profile: 'generation profile' },
    { name: 'extract-knowledge.txt', displayName: 'Knowledge update', group: 'tracker', runs: 'After every reply: who learned what, beats, clue claims', profile: 'tracker profile' },
    { name: 'find-appearance.txt', displayName: 'Appearance search', group: 'tracker', runs: 'When you search a character\'s looks', profile: 'tracker profile' },
    { name: 'seed-state.txt', displayName: 'Standing state seed', group: 'tracker', runs: 'Once per long-history character', profile: 'tracker profile' },
];

/**
 * Describe all seven prompts for the Prompts popup and the drawer: per
 * prompt its state, the text Story Arc sends and its placeholders, read
 * from the built-in text, checked against that text; and the number of
 * edited prompts. Pure: the texts and the edits come in as arguments.
 * State is 'built-in' (no edit), 'edited', or 'changed' (edited, and the
 * built-in text's hash differs from the one stored with the edit).
 * @param {Record<string, string>} builtInTexts - Built-in text per template name
 * @param {Record<string, {text: string, builtInHash: number}>} storedEdits - The stored edits (promptOverrides)
 * @returns {{prompts: Array<object>, editedCount: number}}
 */
export function describePrompts(builtInTexts, storedEdits) {
    const prompts = PROMPT_CATALOG.map(entry => {
        const builtIn = builtInTexts[entry.name];
        const promptEdit = storedEdits?.[entry.name];
        let state = 'built-in';
        if (promptEdit && promptEdit.builtInHash === getStringHash(builtIn)) {
            state = 'edited';
        } else if (promptEdit) {
            state = 'changed';
        }
        const text = promptEdit ? promptEdit.text : builtIn;
        return { ...entry, state, text, builtIn, ...checkPromptPlaceholders(builtIn, text) };
    });
    const editedCount = prompts.filter(prompt => prompt.state !== 'built-in').length;
    return { prompts, editedCount };
}

/**
 * Check a prompt's text against the placeholders its built-in text holds:
 * missing ones (in the built-in text, not in this text) and unknown ones
 * (in this text, not in the built-in text). describePrompts checks the
 * stored edit with it, the Prompts popup the draft while the player types.
 * @param {string} builtInText - The built-in text, the source of the placeholders a prompt needs
 * @param {string} text - The text to check
 * @returns {{placeholders: string[], missing: string[], unknown: string[]}}
 */
export function checkPromptPlaceholders(builtInText, text) {
    const placeholders = placeholdersIn(builtInText);
    const usedPlaceholders = placeholdersIn(text);
    return {
        placeholders,
        missing: placeholders.filter(name => !usedPlaceholders.includes(name)),
        unknown: usedPlaceholders.filter(name => !placeholders.includes(name)),
    };
}

/**
 * The placeholder names in a template (`{{NAME}}`, as fillTemplate fills
 * them), without braces, each once, in order of first use.
 * @param {string} text
 * @returns {string[]}
 */
function placeholdersIn(text) {
    const names = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]);
    return [...new Set(names)];
}

/**
 * The player's stored edit of one prompt, as loadTemplate (generator.js)
 * sends it. Reads only: creates no settings.
 * @param {string} name - Template file name
 * @returns {{text: string, builtInHash: number}|null} The edit, or null for none
 */
export function readPromptEdit(name) {
    return extension_settings[MODULE_NAME]?.promptOverrides?.[name] ?? null;
}

/**
 * The stored edits, created on first use in the global settings.
 * @returns {Record<string, {text: string, builtInHash: number}>}
 */
function storedPromptEdits() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    const settings = extension_settings[MODULE_NAME];
    if (!settings.promptOverrides) {
        settings.promptOverrides = {};
    }
    return settings.promptOverrides;
}

/**
 * Save the player's edit of a prompt: from the next call on, Story Arc sends it.
 * @param {string} name - Template file name, e.g. 'extract-knowledge.txt'
 * @param {string} text - The edited template text
 * @param {string} builtInText - The built-in text the edit was made against
 */
export function savePromptEdit(name, text, builtInText) {
    storedPromptEdits()[name] = { text, builtInHash: getStringHash(builtInText) };
    saveSettingsDebounced();
}

/**
 * Keep the player's edit after the built-in text changed: the edit stays,
 * and the current built-in text's hash is stored, so the prompt reads as
 * edited until the built-in text changes again.
 * @param {string} name - Template file name
 * @param {string} builtInText - The current built-in text
 */
export function keepPromptEdit(name, builtInText) {
    const promptEdit = storedPromptEdits()[name];
    if (!promptEdit) return;
    promptEdit.builtInHash = getStringHash(builtInText);
    saveSettingsDebounced();
}

/**
 * Reset a prompt to its built-in text: the edit is deleted.
 * @param {string} name - Template file name
 */
export function resetPromptEdit(name) {
    delete storedPromptEdits()[name];
    saveSettingsDebounced();
}

/**
 * Put a prompt's stored edit back as it was, hash included: the Prompts
 * popup's Undo after Save or Reset. Null leaves the prompt built-in.
 * @param {string} name - Template file name
 * @param {{text: string, builtInHash: number}|null} storedEdit - The edit as it was stored, or null for none
 */
export function restorePromptEdit(name, storedEdit) {
    if (storedEdit) {
        storedPromptEdits()[name] = { ...storedEdit };
    } else {
        delete storedPromptEdits()[name];
    }
    saveSettingsDebounced();
}
