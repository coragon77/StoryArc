/**
 * @file The knowledge tracker: who knows what (ADR-0007). The whole process
 * in the order it runs: extraction, applying an extraction answer, dropping
 * from message N on, building the knowledge block.
 * @module knowledge/ledger
 */

import { callLlm, fillTemplate, loadTemplate } from '../planning/generator.js';
import { parseLlmJson } from '../planning/validation.js';

// ─── Extraction ───

/**
 * Ask the LLM who learned what in the messages from `fromIndex` on. The call
 * goes through the arc generation connection profile and the transport the
 * plan check uses. A failed call or an unreadable answer returns null, and
 * the caller changes nothing: the next update covers the same messages again.
 * @param {object} ledger - The chat's knowledge ledger
 * @param {object[]} chatMessages - ST's chat array (`name`, `is_user`, `mes`, `is_system`)
 * @param {number} fromIndex - First message the extraction reads
 * @param {string} personaName - The player's persona name
 * @returns {Promise<{present: string[], newCharacters: object[], learned: object[]}|null>}
 */
export async function extractKnowledge(ledger, chatMessages, fromIndex, personaName) {
    try {
        const template = await loadTemplate('extract-knowledge.txt');
        const prompt = fillTemplate(template, buildKnowledgeExtractionVariables(ledger, chatMessages, fromIndex, personaName));
        const response = await callLlm(prompt);
        const answer = parseKnowledgeExtractionAnswer(response);
        if (!answer) {
            console.warn('[Story Arc] Knowledge extraction answered no readable JSON; the ledger stays as it is');
        }
        return answer;
    } catch (err) {
        console.warn('[Story Arc] Knowledge extraction failed; the ledger stays as it is:', err);
        return null;
    }
}

/**
 * Template variables for extract-knowledge.txt: the persona's name, the
 * ledger's characters with their aliases, the facts by id with their holders
 * (or "public"), and the messages from `fromIndex` on, each with its index.
 * Hidden (system) messages are not story and are left out.
 * @param {object} ledger
 * @param {object[]} chatMessages - ST's chat array
 * @param {number} fromIndex
 * @param {string} personaName
 * @returns {Record<string, string>}
 */
export function buildKnowledgeExtractionVariables(ledger, chatMessages, fromIndex, personaName) {
    const characterLines = ledger.characters.map(character => {
        const aliasNote = character.aliases.length ? ` (also: ${character.aliases.join(', ')})` : '';
        return `- ${character.name}${aliasNote}`;
    });

    const characterNames = new Map(ledger.characters.map(character => [character.id, character.name]));
    const factLines = ledger.facts.map(fact => {
        if (fact.public) return `- [${fact.id}] ${fact.text} (public)`;
        const holderNames = fact.holders
            .map(holder => characterNames.get(holder.characterId))
            .filter(Boolean);
        const holderNote = holderNames.length ? `known to: ${holderNames.join(', ')}` : 'known to no one';
        return `- [${fact.id}] ${fact.text} (${holderNote})`;
    });

    const messageLines = [];
    for (let index = fromIndex; index < chatMessages.length; index++) {
        const message = chatMessages[index];
        if (!message || message.is_system) continue;
        messageLines.push(`[${index}] ${message.name}: ${message.mes || ''}`);
    }

    return {
        PERSONA: personaName || '(no persona)',
        CHARACTERS: characterLines.join('\n') || '(none)',
        FACTS: factLines.join('\n') || '(none)',
        MESSAGES: messageLines.join('\n\n'),
    };
}

/** How a character can learn a fact on-screen, as the extraction reports it. */
const EXTRACTION_HOW_VALUES = ['witnessed', 'told'];

/**
 * Read the extraction's answer text into the shape applying an answer takes:
 *
 *     { present: [name],
 *       newCharacters: [{ name, aliases: [name] }],
 *       learned: [{ factId | text, public, who: [name], how: 'witnessed' | 'told',
 *                   toldBy: name | null, at: messageIndex }] }
 *
 * The answer is taken whole or not at all: unreadable JSON, a missing key or
 * a value of the wrong type gives null, so a half-understood answer never
 * reaches the ledger. Keys outside the shape are dropped. Names and fact ids
 * are not checked against the ledger here; applying the answer ignores
 * unknown ones.
 * @param {string} responseText - The LLM's answer
 * @returns {{present: string[], newCharacters: object[], learned: object[]}|null}
 */
export function parseKnowledgeExtractionAnswer(responseText) {
    const parsed = parseLlmJson(responseText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!isListOfNames(parsed.present)) return null;
    if (!Array.isArray(parsed.newCharacters) || !Array.isArray(parsed.learned)) return null;

    const newCharacters = [];
    for (const character of parsed.newCharacters) {
        if (!isName(character?.name) || !isListOfNames(character.aliases)) return null;
        newCharacters.push({ name: character.name, aliases: character.aliases });
    }

    const learned = [];
    for (const item of parsed.learned) {
        if (!item || typeof item !== 'object') return null;
        if (typeof item.public !== 'boolean') return null;
        if (!isListOfNames(item.who)) return null;
        if (!EXTRACTION_HOW_VALUES.includes(item.how)) return null;
        if (item.toldBy !== null && !isName(item.toldBy)) return null;
        if (!Number.isInteger(item.at)) return null;

        // A known fact is named by its id, a new one by its text.
        if (item.factId !== undefined && !isName(item.factId)) return null;
        let fact = null;
        if (isName(item.factId)) {
            fact = { factId: item.factId };
        } else if (isName(item.text)) {
            fact = { text: item.text };
        } else {
            return null;
        }

        learned.push({
            ...fact,
            public: item.public,
            who: item.who,
            how: item.how,
            toldBy: item.toldBy,
            at: item.at,
        });
    }

    return { present: parsed.present, newCharacters, learned };
}

/** A non-blank string: a character name, a fact id or a fact text. */
function isName(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function isListOfNames(value) {
    return Array.isArray(value) && value.every(isName);
}
