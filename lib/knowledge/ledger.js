/**
 * Story Arc — The knowledge process (ADR-0007): who knows what.
 *
 * The ledger at chat_metadata.story_arc.knowledge stores which character
 * knows which fact and how they learned it. This file holds the whole
 * process in the order it runs.
 */

// ─── Build the knowledge block ───

/** Most lines one character's "Knows", "Does not know" or "Has told" list prints */
export const KNOWLEDGE_LIST_CAP = 5;

const KNOWLEDGE_BLOCK_HEADER = '[WHO KNOWS WHAT — characters in this scene and characters being talked about. '
    + 'Each character speaks and acts only from their own list. '
    + 'Knowledge moves between characters only on-screen.]';

/**
 * Build the knowledge block the narrator sees: for the characters in the
 * scene and the characters the latest messages talk about, what each one
 * knows, does not know and (talked about only) has told.
 *
 * Public facts are never printed, because everyone knows them. A holder
 * entry from the plan (how 'plan') is never printed, and a fact held only
 * through the plan is printed nowhere: a secret's text stays in the SECRETS
 * block, which gates it by phase.
 *
 * @param {object} ledger - The knowledge ledger (createEmptyKnowledgeLedger shape)
 * @param {object[]} messages - The chat messages; the latest user message and
 *     the latest reply among them decide who is talked about
 * @returns {string} The block text, or '' when no covered character has a line
 */
export function buildKnowledgeBlock(ledger, messages) {
    if (!ledger || ledger.characters.length === 0) return '';

    const presentCharacters = ledger.characters.filter(character => ledger.scene.present.includes(character.id));
    const latestText = latestUserMessageAndReplyText(messages);
    const talkedAboutCharacters = ledger.characters.filter(character =>
        !ledger.scene.present.includes(character.id) && isNamedInText(character, latestText));
    const coveredIds = [...presentCharacters, ...talkedAboutCharacters].map(character => character.id);

    // Public facts and facts held only through the plan get no line anywhere.
    const printableFacts = ledger.facts.filter(fact =>
        !fact.public && fact.holders.some(holder => holder.how !== 'plan'));

    const sections = [];
    for (const character of presentCharacters) {
        const lines = knowledgeLinesForCharacter(ledger, character, printableFacts, coveredIds, false);
        if (lines.length === 0) continue;
        sections.push([`${character.name.toUpperCase()} (present)`, ...lines].join('\n'));
    }
    for (const character of talkedAboutCharacters) {
        const lines = knowledgeLinesForCharacter(ledger, character, printableFacts, coveredIds, true);
        if (lines.length === 0) continue;
        sections.push([`${character.name.toUpperCase()} (talked about, not present)`, ...lines].join('\n'));
    }
    if (sections.length === 0) return '';

    return [KNOWLEDGE_BLOCK_HEADER, ...sections].join('\n\n');
}

/**
 * The text of the latest user message and the latest reply, joined.
 * Hidden (system) messages are skipped.
 * @param {object[]} messages
 * @returns {string}
 */
function latestUserMessageAndReplyText(messages) {
    let latestUserText = null;
    let latestReplyText = null;
    for (let index = messages.length - 1; index >= 0; index--) {
        const chatMessage = messages[index];
        if (chatMessage.is_system) continue;
        if (chatMessage.is_user && latestUserText === null) latestUserText = chatMessage.mes || '';
        if (!chatMessage.is_user && latestReplyText === null) latestReplyText = chatMessage.mes || '';
        if (latestUserText !== null && latestReplyText !== null) break;
    }
    return `${latestUserText || ''}\n${latestReplyText || ''}`;
}

/**
 * Whether the character's name or one of its aliases appears in the text as
 * a whole word, ignoring case.
 * @param {object} character - A ledger character { id, name, aliases }
 * @param {string} text
 * @returns {boolean}
 */
function isNamedInText(character, text) {
    const names = [character.name, ...(character.aliases || [])].filter(name => name && name.trim());
    return names.some(name => {
        const escapedName = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedName}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
    });
}

/**
 * The "Knows", "Does not know" and (talked about only) "Has told" lines of
 * one character, each list newest first and capped.
 * @param {object} ledger
 * @param {object} character
 * @param {object[]} printableFacts - Facts that may get a line at all
 * @param {string[]} coveredIds - Ids of every character the block covers
 * @param {boolean} isTalkedAbout - Whether the character is talked about, not present
 * @returns {string[]}
 */
function knowledgeLinesForCharacter(ledger, character, printableFacts, coveredIds, isTalkedAbout) {
    const knownEntries = [];
    const unknownEntries = [];
    const toldEntries = [];

    for (const fact of printableFacts) {
        const ownHolder = fact.holders.find(holder => holder.characterId === character.id);
        if (ownHolder && ownHolder.how !== 'plan') {
            knownEntries.push({ at: ownHolder.at, line: knowsLine(ledger, fact, ownHolder) });
        }

        const heldByAnotherCoveredCharacter = fact.holders.some(holder =>
            holder.how !== 'plan' && holder.characterId !== character.id && coveredIds.includes(holder.characterId));
        if (!ownHolder && heldByAnotherCoveredCharacter) {
            unknownEntries.push({ at: newestHolderAt(fact.holders), line: `- Does not know: ${fact.text}` });
        }

        const toldHolders = fact.holders.filter(holder => holder.how === 'told' && holder.toldBy === character.id);
        if (isTalkedAbout && toldHolders.length > 0) {
            const toldNames = toldHolders.map(holder => characterName(ledger, holder.characterId));
            toldEntries.push({
                at: newestHolderAt(toldHolders),
                line: `- Has told only ${joinNames(toldNames)}: ${fact.text}`,
            });
        }
    }

    return [
        ...newestCapped(knownEntries),
        ...newestCapped(unknownEntries),
        ...newestCapped(toldEntries),
    ];
}

/**
 * The "Knows" line of one fact, saying who told the character when they were told.
 * @param {object} ledger
 * @param {object} fact
 * @param {object} holder - The character's own holder entry
 * @returns {string}
 */
function knowsLine(ledger, fact, holder) {
    if (holder.how === 'told' && holder.toldBy) {
        return `- Knows (told by ${characterName(ledger, holder.toldBy)}): ${fact.text}`;
    }
    return `- Knows: ${fact.text}`;
}

/**
 * The message index of the newest holder entry. An entry the user made
 * (at null) counts as newest: a correction must reach the narrator first.
 * @param {object[]} holders
 * @returns {number}
 */
function newestHolderAt(holders) {
    let newestAt = -1;
    for (const holder of holders) {
        if (holder.how === 'plan') continue;
        const holderAt = holder.at === null || holder.at === undefined ? Infinity : holder.at;
        if (holderAt > newestAt) newestAt = holderAt;
    }
    return newestAt;
}

/**
 * The lines of a list, newest first, at most KNOWLEDGE_LIST_CAP of them.
 * An entry made by the user (at null) counts as newest.
 * @param {{at: number|null, line: string}[]} entries
 * @returns {string[]}
 */
function newestCapped(entries) {
    const entriesNewestFirst = entries
        .map(entry => ({ ...entry, at: entry.at === null || entry.at === undefined ? Infinity : entry.at }))
        .sort((first, second) => second.at - first.at);
    return entriesNewestFirst.slice(0, KNOWLEDGE_LIST_CAP).map(entry => entry.line);
}

/**
 * @param {object} ledger
 * @param {string} characterId
 * @returns {string} The character's name, or the id when the ledger has no such character
 */
function characterName(ledger, characterId) {
    const character = ledger.characters.find(candidate => candidate.id === characterId);
    return character ? character.name : characterId;
}

/**
 * "Ellie", "Ellie and Noor", "Ellie, Noor and Dougal".
 * @param {string[]} names
 * @returns {string}
 */
function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
