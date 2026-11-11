/**
 * Story Arc - Appearance search
 *
 * The per-character search for how a character looks (GLOSSARY: Appearance
 * search), started from the character's sheet in the Knowledge popup. It
 * reads the definitions written before the story (the persona, the card,
 * the chat's lorebooks) and finds the passages of the whole chat locally,
 * hidden messages included, sends them in one call, reads the answer into
 * one finding per appearance kind and keeps the findings the player is
 * offered. Accepting a finding is the popup's edit (acceptAppearanceFinding
 * in ui/knowledge-popup.js).
 */

import { getContext } from '/scripts/extensions.js';
import { APPEARANCE_KINDS } from '../core/constants.js';
import { fetchLorebookEntries } from '../context/harvester.js';
import { callLlm, fillTemplate, loadTemplate } from '../planning/generator.js';
import { parseLlmJson } from '../planning/validation.js';
import {
    characterDisplayName, currentDetailText, isAppearanceRefinement, isDetailLocked, isSameDetailValue,
    isSharedNameWord, listNameWordCarriers, withoutTaggedElements,
} from './ledger.js';

/** The passages one search sends: at most this many characters, as `[#at] text` lines. */
const APPEARANCE_PASSAGES_MAX_CHARS = 6000;

/**
 * The search for one character: the definitions that name them
 * (findDefinitions) and the passages of the whole chat that say how they
 * look, one call over both, the answer read into one finding per kind, and
 * the findings the player is offered (listOfferedFindings). Without a
 * definition or a passage there is no call. The character's names are its
 * name and aliases, a shared name word left out (isSharedNameWord);
 * everyone else's names are the other ledger characters' names and aliases
 * and the persona, to tell whose feature a sentence describes.
 * @param {object} ledger - The chat's knowledge ledger
 * @param {string} characterId - The character searched for
 * @param {object[]} chatMessages - ST's chat array, hidden messages included
 * @param {string} personaName - The player's persona name
 * @returns {Promise<{findings: {kind: string, value: string, at: number|null, sources: (string|number)[], passage: string}[], sourceCount: number}|{error: string}>}
 *   The offered findings in APPEARANCE_KINDS order and how many definitions
 *   and passages were read, or a short message for the popup. A finding
 *   lists every text it uses in `sources` (parseAppearanceAnswer); its `at`
 *   is the newest message among them, or null when it uses only
 *   definitions.
 */
export async function searchAppearance(ledger, characterId, chatMessages, personaName) {
    const character = ledger.characters.find(candidate => candidate.id === characterId);
    if (!character) return { error: 'This character is not in the ledger.' };

    const nameWordCarriers = listNameWordCarriers(ledger.characters);
    const ownNames = [characterDisplayName(ledger, character), ...(character.aliases || [])]
        .filter(name => name && name.trim() && !isSharedNameWord(name, character.id, nameWordCarriers));
    // An unnamed relative is also named through any name of the other character
    // ("Kendra's mother" for "Kendra Osei's mother"), as isNamedInText in ledger.js has it
    const relationHistory = character.details?.relation || [];
    if (!character.name.trim() && relationHistory.length > 0) {
        const relation = relationHistory[relationHistory.length - 1].value;
        const relatedCharacter = ledger.characters.find(candidate => candidate.id === relation.of);
        const relatedNames = relatedCharacter ? [relatedCharacter.name, ...(relatedCharacter.aliases || [])] : [];
        for (const relatedName of relatedNames) {
            if (relatedName.trim()) ownNames.push(`${relatedName.trim()}'s ${relation.kind}`);
        }
    }
    const otherCharacters = ledger.characters.filter(candidate => candidate.id !== characterId);
    const otherNames = [...otherCharacters.flatMap(other => [other.name, ...(other.aliases || [])]), personaName];
    const definitions = findDefinitions(readDefinitionTexts(personaName), await fetchLorebookEntries(), ownNames, otherNames);
    const passages = findAppearancePassages(chatMessages, ownNames, otherNames, APPEARANCE_PASSAGES_MAX_CHARS);
    const sourceCount = definitions.length + passages.length;
    if (sourceCount === 0) return { findings: [], sourceCount: 0 };

    let response;
    try {
        const template = await loadTemplate('find-appearance.txt');
        const prompt = fillTemplate(template, buildAppearanceSearchVariables(ledger, character, definitions, passages));
        response = await callLlm(prompt);
    } catch (err) {
        console.warn('[Story Arc] Appearance search call failed:', err);
        return { error: 'The appearance search failed. Try again later.' };
    }
    const findings = parseAppearanceAnswer(response, definitions, passages);
    if (findings === null) {
        console.warn('[Story Arc] Appearance search answered no readable JSON:', response);
        return { error: 'The appearance search gave an unreadable answer. Try again.' };
    }
    return { findings: listOfferedFindings(character, findings), sourceCount };
}

/** A persona or card text the search sends: at most this many characters. */
const DEFINITION_MAX_CHARS = 3000;

/** The lorebook text one search sends: at most this many characters. */
const LOREBOOK_MAX_CHARS = 3000;

/** A lorebook entry about the character up to this size is sent whole: it is their sheet. */
const LOREBOOK_ENTRY_WHOLE_MAX_CHARS = 1500;

/**
 * The persona and the cards of this chat, as the search reads them from
 * SillyTavern: the persona's name and description, and the card characters
 * of the chat (the group's members, or the one character) with their
 * descriptions. Cards elsewhere on the server are left out: another story
 * may have a card of the same name.
 * @param {string} personaName - The player's persona name
 * @returns {{persona: {name: string, description: string}, cards: {name: string, description: string}[]}}
 */
function readDefinitionTexts(personaName) {
    const context = getContext();
    const allCharacters = context.characters || [];
    let chatCharacters = [];
    if (context.groupId) {
        const group = (context.groups || []).find(candidate => candidate.id === context.groupId);
        const memberAvatars = group?.members || [];
        chatCharacters = allCharacters.filter(candidate => memberAvatars.includes(candidate.avatar));
    } else if (allCharacters[context.characterId]) {
        chatCharacters = [allCharacters[context.characterId]];
    }
    return {
        persona: { name: personaName || '', description: context.powerUserSettings?.persona_description || '' },
        cards: chatCharacters.map(card => ({ name: card.name || '', description: card.description || '' })),
    };
}

/**
 * The definitions that may say how the character looks, as the call gets
 * them, each with its label for the answer and its source for the player:
 * - the persona's description, when the persona is the character (its name
 *   is one of the character's names), labelled "persona";
 * - a card's description, when the card character is the character,
 *   labelled "card";
 * - lorebook text that names the character, labelled "lore 1", "lore 2", …:
 *   an entry whose keys or comment name them and that is short enough is
 *   their sheet and goes whole; from every other entry that names them, the
 *   sentences the chat search would keep (findAppearancePassages). The
 *   entries go in the lorebook's order, whole sheets first, within
 *   LOREBOOK_MAX_CHARS.
 *
 * `{{user}}` in every text becomes the persona's name and `{{char}}` in a
 * card description the card's name, and every text is one line, its line
 * breaks as " / ".
 * @param {{persona: {name: string, description: string}, cards: {name: string, description: string}[]}} definitionTexts - From readDefinitionTexts
 * @param {{world: string, comment: string, content: string, key: string[]}[]} lorebookEntries - The chat's enabled entries (fetchLorebookEntries)
 * @param {string[]} names - The character's names
 * @param {string[]} otherNames - Everyone else's names
 * @returns {{label: string, source: string, text: string}[]}
 */
export function findDefinitions(definitionTexts, lorebookEntries, names, otherNames) {
    const ownNames = new Set(names.filter(Boolean).map(foldNameText).filter(Boolean));
    if (ownNames.size === 0) return [];
    const personaName = definitionTexts.persona.name;
    // In a chat with one card, {{char}} outside the card is that card's character too; a group has no one {{char}}
    const chatCardName = definitionTexts.cards.length === 1 ? definitionTexts.cards[0].name : '';
    const oneLine = text => String(text).trim().replace(/\s*\n\s*/g, ' / ');
    // Function replacers, so a name with "$" is inserted as written
    const withNames = (text, cardName) => String(text)
        .replace(/\{\{user\}\}/gi, () => personaName)
        .replace(/\{\{char\}\}/gi, () => cardName || '{{char}}');
    // A persona or card named by the first name alone ("Amy" for "Amy Chen"), or the other way round, is the character too
    const firstWord = name => name.split(/\s+/)[0];
    const isCharacterNamed = rawName => {
        const name = foldNameText(rawName || '');
        if (!name) return false;
        if (ownNames.has(name) || ownNames.has(firstWord(name))) return true;
        return [...ownNames].some(ownName => firstWord(ownName) === name);
    };

    const definitions = [];
    // The persona's or card's own name names the character in the lorebook too ({{char}} becomes it)
    const lorebookNames = [...names];
    const persona = definitionTexts.persona;
    if (persona.description.trim() && isCharacterNamed(persona.name)) {
        const text = oneLine(withNames(persona.description, chatCardName)).slice(0, DEFINITION_MAX_CHARS);
        definitions.push({ label: 'persona', source: 'persona', text });
        lorebookNames.push(persona.name);
    }
    const card = definitionTexts.cards.find(candidate => candidate.description.trim() && isCharacterNamed(candidate.name));
    if (card) {
        const text = oneLine(withNames(card.description, card.name)).slice(0, DEFINITION_MAX_CHARS);
        definitions.push({ label: 'card', source: 'card', text });
        lorebookNames.push(card.name);
    }

    const lorebookOwnNames = new Set(lorebookNames.filter(Boolean).map(foldNameText).filter(Boolean));
    const namingTest = namesPattern([...lorebookOwnNames], 'iu');
    const sheets = [];
    const mentions = [];
    for (const entry of lorebookEntries) {
        const content = withNames(String(entry.content || ''), chatCardName);
        const source = `lorebook: ${entry.world || 'unnamed'} / ${entry.comment || 'unnamed entry'}`;
        const isAboutCharacter = [entry.comment, ...(entry.key || [])].some(text => namingTest.test(withNames(String(text || ''), chatCardName)));
        if (isAboutCharacter && content.trim() && content.length <= LOREBOOK_ENTRY_WHOLE_MAX_CHARS) {
            sheets.push({ source, text: oneLine(content) });
            continue;
        }
        if (!namingTest.test(content)) continue;
        const entryPassages = findAppearancePassages([{ mes: content }], lorebookNames, otherNames, LOREBOOK_MAX_CHARS);
        if (entryPassages.length > 0) mentions.push({ source, text: entryPassages.map(passage => passage.text).join(' … ') });
    }
    let usedChars = 0;
    let loreNumber = 0;
    for (const loreText of [...sheets, ...mentions]) {
        if (usedChars + loreText.text.length > LOREBOOK_MAX_CHARS) continue;
        usedChars += loreText.text.length;
        loreNumber++;
        definitions.push({ label: `lore ${loreNumber}`, source: loreText.source, text: loreText.text });
    }
    return definitions;
}

/**
 * The passages of the whole chat that say how a person looks: a sentence
 * that names them (or that sentence with the pronoun sentence right after
 * it) with a lasting feature, a describing word next to it, and nobody else
 * named closer to the feature ("Priya's dark braid", "five-two to Ellie's
 * five-five"). An ethnicity needs no describing word. A sentence is in one
 * passage at most, so no text takes the budget twice. Hidden messages count:
 * a summary extension hides almost all of a long chat, and the
 * introductions are there. A message's tagged elements (a preset's status
 * block, `<trk>` and the like) are left out (withoutTaggedElements): they
 * list everyone's clothes and the director's ideas, not the story.
 *
 * The newest passages win, since looks change, at most
 * PASSAGES_PER_FEATURE for each feature group, so one repeated "dark eyes"
 * cannot fill the budget. The budget counts each passage as the `[#at] text`
 * line the call gets. They are returned oldest first, as the story told them.
 * @param {object[]} chatMessages - ST's chat array (`mes`)
 * @param {string[]} names - The person's names and aliases
 * @param {string[]} otherNames - Everyone else's names, to tell whose feature it is
 * @param {number} maxChars - The budget
 * @returns {{at: number, text: string}[]}
 */
export function findAppearancePassages(chatMessages, names, otherNames, maxChars) {
    const ownNames = new Set(names.filter(Boolean).map(foldNameText).filter(Boolean));
    if (ownNames.size === 0) return [];
    const patterns = buildNamePatterns(ownNames, otherNames);

    const candidates = [];
    chatMessages.forEach((chatMessage, index) => {
        if (!chatMessage) return;
        const sentences = splitSentences(storyText(chatMessage.mes));
        let takenWithPreviousIndex = -1;
        sentences.forEach((sentence, sentenceIndex) => {
            // A sentence the previous passage took along is not a passage again,
            // so no text is sent or counted twice
            if (sentenceIndex === takenWithPreviousIndex) return;
            if (!patterns.ownTest.test(sentence)) return;
            const nextSentence = sentences[sentenceIndex + 1];
            const takesNextSentence = Boolean(nextSentence) && PRONOUN_SENTENCE.test(nextSentence);
            if (takesNextSentence) takenWithPreviousIndex = sentenceIndex + 1;
            const passage = takesNextSentence ? `${sentence} ${nextSentence}` : sentence;
            // A pronoun sentence that names the person counts as naming them too
            const namingText = takesNextSentence && patterns.ownTest.test(nextSentence) ? passage : sentence;
            const featureGroups = describedFeatureGroups(passage, namingText, ownNames, patterns);
            if (featureGroups.size > 0) candidates.push({ at: index, text: passage, featureGroups });
        });
    });

    const keptTexts = new Set();
    const keptPerGroup = new Map();
    const kept = [];
    let usedChars = 0;
    for (const candidate of candidates.reverse()) {
        if (keptTexts.has(candidate.text)) continue;
        const groupsWithRoom = [...candidate.featureGroups].filter(group => (keptPerGroup.get(group) || 0) < PASSAGES_PER_FEATURE);
        if (groupsWithRoom.length === 0) continue;
        const lineLength = `[#${candidate.at}] ${candidate.text}`.length;
        if (usedChars + lineLength > maxChars) continue;
        keptTexts.add(candidate.text);
        for (const group of candidate.featureGroups) keptPerGroup.set(group, (keptPerGroup.get(group) || 0) + 1);
        usedChars += lineLength;
        kept.push({ at: candidate.at, text: candidate.text });
    }
    return kept.reverse();
}

/** At most this many passages per feature group (FEATURE_GROUPS, height and ethnicity). */
const PASSAGES_PER_FEATURE = 3;

/** First words that are no name of their own: articles and titles. */
const NOT_A_NAME = /^(?:the|a|an|dr|mr|mrs|ms|miss|sir|lady|lord|captain|officer|detective|agent|professor|coach|senator|commodore|mayor|judge)\.?$/i;

/**
 * The regexes that find the person's names and everyone else's. The person's
 * match in any case ("PRIYA MEHTA" on a photo caption). Other people's names
 * match as stored, case and all, so an alias like "the night-shift tech"
 * never makes every "The" a person. Another person's first name counts on
 * its own when it is capitalised and not a title ("Sofia" of "Sofia Vega").
 * @param {Set<string>} ownNames - The person's names, folded (foldNameText)
 * @param {string[]} otherNames - Everyone else's names
 * @returns {{ownTest: RegExp, own: RegExp, others: RegExp|null}}
 */
function buildNamePatterns(ownNames, otherNames) {
    const others = new Set();
    for (const rawName of otherNames) {
        const otherName = String(rawName || '').trim();
        if (!otherName) continue;
        if (!ownNames.has(foldNameText(otherName))) others.add(otherName);
        const firstWord = otherName.split(/\s+/)[0];
        const isOwnFirstWord = ownNames.has(foldNameText(firstWord));
        if (firstWord !== otherName && /^\p{Lu}/u.test(firstWord) && !NOT_A_NAME.test(firstWord) && !isOwnFirstWord) {
            others.add(firstWord);
        }
    }
    return {
        ownTest: namesPattern([...ownNames], 'iu'),
        own: namesPattern([...ownNames], 'giu'),
        others: others.size > 0 ? namesPattern([...others], 'gu') : null,
    };
}

/**
 * A name as the search compares it: trimmed, lower case, a curly apostrophe
 * made straight ("D’Arcy" is "d'arcy").
 * @param {string} name
 * @returns {string}
 */
function foldNameText(name) {
    return String(name).trim().toLowerCase().replace(/’/g, '\'');
}

/**
 * A regex that finds any of the names as whole words, the longest first. An
 * apostrophe matches a straight or a curly one, as isNamedInText in
 * ledger.js has it.
 * @param {string[]} names
 * @param {string} flags - Must include u
 * @returns {RegExp}
 */
function namesPattern(names, flags) {
    const longestFirst = [...names].sort((first, second) => second.length - first.length);
    const alternatives = longestFirst.map(name => escapeRegExp(name).replace(/['’]/g, '[\'’]'));
    return new RegExp(`(?<![\\p{L}])(?:${alternatives.join('|')})(?![\\p{L}])`, flags);
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A message's story text on one line: its tagged elements removed
 * (withoutTaggedElements), any tag left over too.
 * @param {string} text - A message's `mes`
 * @returns {string}
 */
function storyText(text) {
    return withoutTaggedElements(String(text ?? '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Split a text into sentences, and on `;` and `•` too, so a list of people
 * ("Ellie: black bob; Priya: dark curls") is cut per person.
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
    return text.split(/(?<=[.!?…]["'”’)\]*]?)\s+|\s*[;•]\s*/).filter(Boolean);
}

/** A sentence that starts with a pronoun: it goes on about the person just named. */
const PRONOUN_SENTENCE = /^["'“]?(?:she|he|they|her|his|their)\b/i;

/** Lasting features, each in its group. A height counts as build. */
const FEATURE_GROUPS = {
    hair: 'hair|curls|braids?|ponytail|bob|bangs|fringe|locks|dreadlocks|topknot',
    eyes: 'eyes|irises',
    skin: 'skin|complexion|freckles',
    marks: 'glasses|spectacles|scars?|tattoos?|birthmarks?|piercings?',
    beard: 'beard|stubble|moustache|mustache',
    build: 'build|frame',
};
const FEATURE = new RegExp(`\\b(?:${Object.entries(FEATURE_GROUPS).map(([group, words]) => `(?<${group}>${words})`).join('|')})\\b`, 'giu');

/** Words that describe a feature: colours, lengths, styles, sizes. */
const DESCRIBING_WORD = /\b(?:black|brown|dark|blonde?|golden|red|auburn|ginger|copper|chestnut|grey|gray|silver|white|blue|green|hazel|amber|violet|pale|fair|tan|tanned|olive|bronze|ebony|freckled|long|short|cropped|shoulder-length|chin-length|waist-length|curly|wavy|straight|glossy|thick|petite|small|slim|slender|lean|athletic|muscular|stocky|curvy|broad|jagged|faded|thin)\b/iu;

/** Someone's, right before glasses: "her glasses", "Priya's round glasses". */
const WORN_BY = /(?:\b(?:her|his|their)|\p{Lu}[\p{L}-]*['’]s)\s+(?:[\p{L}-]+\s+){0,3}$/u;

/** A body height: "five-two", "5'2". It describes on its own. */
const HEIGHT = /\b(?:four|five|six|seven)-(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven)\b|\b[4-7]['’]\s?\d{1,2}\b/giu;

/**
 * Words that name an ethnicity, which needs no describing word: a compound
 * ("Indian-American"), descent, heritage, ethnicity, a birthplace.
 */
const ETHNICITY = /\b\p{Lu}\p{L}+-(?:American|British|Canadian|Australian)\b|\b(?:[Dd]escent|[Hh]eritage|[Ee]thnicity|[Bb]orn in)\b/gu;

/**
 * A short list of common demonyms. One counts only in the sentence that
 * names the person, not in the pronoun sentence after it, because "Indian"
 * or "Korean" is more often the food or the film than the person.
 */
const DEMONYM = /\b(?:Indian|Pakistani|Bangladeshi|Chinese|Korean|Japanese|Filipino|Filipina|Vietnamese|Thai|Mexican|Puerto Rican|Cuban|Brazilian|Nigerian|Ghanaian|Kenyan|Ethiopian|Somali|Jamaican|Haitian|Irish|Italian|Greek|Polish|Russian|Arab|Persian|Iranian|Turkish|Native American|Latina|Latino)\b/gu;

/**
 * The feature groups a passage describes for the person: a height; an
 * ethnicity word; or a feature with a describing word next to it. Whose
 * feature it is: a name with 's right before it ("Ellie's blue eyes"), else
 * the passage's subject, the first person it names ("Sofia lowered her hand
 * from Priya's shoulder, her dark eyes …" is Sofia's). A passage that starts
 * with a pronoun has no known subject.
 * @param {string} passage - The naming sentence, maybe with the pronoun sentence after it
 * @param {string} namingSentence - The start of the passage that names the person: its first sentence, or both
 * @param {Set<string>} ownNames - The person's names, folded (foldNameText)
 * @param {{own: RegExp, others: RegExp|null}} patterns - From buildNamePatterns
 * @returns {Set<string>}
 */
function describedFeatureGroups(passage, namingSentence, ownNames, patterns) {
    const ownNameWords = new Set([...ownNames].flatMap(name => name.split(/\s+/)));
    const ownSpans = [...passage.matchAll(patterns.own)].map(match => ({ start: match.index, end: match.index + match[0].length }));
    const otherSpans = patterns.others
        ? [...passage.matchAll(patterns.others)].map(match => ({ start: match.index, end: match.index + match[0].length }))
        : [];
    const firstOwn = ownSpans[0];
    const firstOther = otherSpans[0];
    // At the same place, the person's longer name holds the other one: "Kendra's mother" holds "Kendra"
    const ownComesFirst = firstOwn && (!firstOther || firstOwn.start < firstOther.start
        || (firstOwn.start === firstOther.start && firstOwn.end >= firstOther.end));
    const personIsSubject = !PRONOUN_SENTENCE.test(passage) && Boolean(ownComesFirst);
    const belongsToPerson = at => {
        const textBefore = passage.slice(Math.max(0, at - 40), at);
        const possessive = textBefore.match(/['’]s\s+(?:[\p{L}-]+\s+){0,3}$/u);
        if (!possessive) return personIsSubject;
        const possessiveAt = at - textBefore.length + possessive.index;
        if (ownSpans.some(span => span.end === possessiveAt)) return true;
        if (otherSpans.some(span => span.end === possessiveAt)) return false;
        // The 's inside the person's own name ("Kendra's mother") is no possessor
        if (ownSpans.some(span => span.start < possessiveAt && span.end > possessiveAt)) return personIsSubject;
        const possessor = textBefore.slice(0, possessive.index).match(/[\p{L}-]+$/u)?.[0] || '';
        if (ownNameWords.has(foldNameText(possessor))) return true;
        // Someone the ledger does not know ("Stern's hand"); "it's" is no one
        return /^\p{Lu}/u.test(possessor) ? false : personIsSubject;
    };

    const featureGroups = new Set();
    for (const match of passage.matchAll(HEIGHT)) {
        if (belongsToPerson(match.index)) featureGroups.add('build');
    }
    for (const match of passage.matchAll(ETHNICITY)) {
        if (belongsToPerson(match.index)) featureGroups.add('ethnicity');
    }
    for (const match of passage.matchAll(DEMONYM)) {
        if (match.index < namingSentence.length && belongsToPerson(match.index)) featureGroups.add('ethnicity');
    }
    for (const match of passage.matchAll(FEATURE)) {
        const group = Object.keys(FEATURE_GROUPS).find(key => match.groups[key]);
        if (featureGroups.has(group) || !belongsToPerson(match.index)) continue;
        const textBefore = passage.slice(Math.max(0, match.index - 30), match.index).split(/[,:;—]/).at(-1);
        // "two rocks glasses" are on the bar: glasses count only when worn
        if (/^(?:glasses|spectacles)$/i.test(match[0]) && !WORN_BY.test(textBefore)) continue;
        const matchEnd = match.index + match[0].length;
        const textAfter = passage.slice(matchEnd, matchEnd + 15).split(/[,.;—]/)[0];
        if (DESCRIBING_WORD.test(`${textBefore} ${textAfter}`)) featureGroups.add(group);
    }
    return featureGroups;
}

/**
 * The placeholders of find-appearance.txt: the character's display name and
 * aliases, the appearance kinds the ledger knows for them, the definitions
 * as `[label] text` lines and the passages as `[#at] text` lines.
 * @param {object} ledger
 * @param {object} character - A ledger character
 * @param {{label: string, source: string, text: string}[]} definitions - From findDefinitions
 * @param {{at: number, text: string}[]} passages - From findAppearancePassages
 * @returns {Record<string, string>}
 */
function buildAppearanceSearchVariables(ledger, character, definitions, passages) {
    const knownLines = [];
    for (const kind of APPEARANCE_KINDS) {
        const value = currentDetailText(ledger, character, kind);
        if (value !== null) knownLines.push(`- ${kind}: ${value}`);
    }
    const aliases = character.aliases || [];
    return {
        CHARACTER: characterDisplayName(ledger, character),
        ALIASES: aliases.length > 0 ? aliases.join(', ') : '(none)',
        KNOWN_APPEARANCE: knownLines.join('\n') || '(none)',
        DEFINITIONS: definitions.map(definition => `[${definition.label}] ${definition.text}`).join('\n') || '(none)',
        PASSAGES: passages.map(passage => `[#${passage.at}] ${passage.text}`).join('\n') || '(none)',
    };
}

/**
 * Read the search's answer, `{ "appearance": [{ kind, value, sources }] }`,
 * into findings in APPEARANCE_KINDS order. `sources` lists every text the
 * value uses: a sent passage's message index (a number or digits) or a sent
 * definition's label (folded: "[Lore 2]" reads as "lore 2"); an answer with
 * a single `at` in place of `sources` reads as `sources: [at]`. Unlike the
 * extraction, a bad item does not cost the answer, since the player reviews
 * every finding: a source that was not sent is left out, and an item with a
 * kind outside APPEARANCE_KINDS, an empty value or no sent source is
 * dropped. One finding per kind, the first.
 *
 * A finding's `at` is the newest message it uses, or null when all its
 * sources are definitions; its `sources` are the definitions' sources
 * ("persona", "card", "lorebook: <book> / <entry>") in the order sent, then
 * the message indexes, oldest first. Its passage is the texts it uses in
 * that order, joined with " … "; two passages of one message both go in,
 * since the answer cannot say which it used.
 * @param {string} responseText - The LLM's answer
 * @param {{label: string, source: string, text: string}[]} definitions - The definitions sent
 * @param {{at: number, text: string}[]} passages - The passages sent
 * @returns {{kind: string, value: string, at: number|null, sources: (string|number)[], passage: string}[]|null} Null when the answer is unreadable
 */
function parseAppearanceAnswer(responseText, definitions, passages) {
    const parsed = parseLlmJson(responseText);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.appearance)) return null;

    // A label as the answer may write it: "lore 2", "[Lore 2]", "lore2"
    const foldLabel = label => String(label).toLowerCase().replace(/[[\]\s]/g, '');
    const passageTextAt = new Map();
    for (const passage of passages) {
        const earlierText = passageTextAt.get(passage.at);
        passageTextAt.set(passage.at, earlierText ? `${earlierText} … ${passage.text}` : passage.text);
    }
    const findingByKind = new Map();
    for (const item of parsed.appearance) {
        if (!item || typeof item !== 'object') continue;
        if (!APPEARANCE_KINDS.includes(item.kind) || findingByKind.has(item.kind)) continue;
        if (typeof item.value !== 'string' || !item.value.trim()) continue;
        const namedSources = Array.isArray(item.sources) ? item.sources : [item.at];
        const foldedNames = namedSources.filter(name => typeof name === 'string').map(foldLabel);
        const usedDefinitions = definitions.filter(definition => foldedNames.includes(foldLabel(definition.label)));
        // A message index, as a number or as digits, maybe as the prompt marks it ("[#2825]"):
        // null or "" must not read as message 0
        const messageIndexes = namedSources
            .map(name => (typeof name === 'string' ? name.trim().replace(/^\[?#?(\d+)\]?$/, '$1') : name))
            .filter(name => Number.isInteger(name) || (typeof name === 'string' && /^\d+$/.test(name)))
            .map(Number);
        const usedMessageIndexes = [...new Set(messageIndexes)].filter(at => passageTextAt.has(at)).sort((first, second) => first - second);
        if (usedDefinitions.length === 0 && usedMessageIndexes.length === 0) continue;

        const texts = [...usedDefinitions.map(definition => definition.text), ...usedMessageIndexes.map(at => passageTextAt.get(at))];
        findingByKind.set(item.kind, {
            kind: item.kind,
            value: item.value.trim(),
            at: usedMessageIndexes.length > 0 ? usedMessageIndexes[usedMessageIndexes.length - 1] : null,
            sources: [...usedDefinitions.map(definition => definition.source), ...usedMessageIndexes],
            passage: texts.join(' … '),
        });
    }
    return APPEARANCE_KINDS.filter(kind => findingByKind.has(kind)).map(kind => findingByKind.get(kind));
}

/**
 * Which findings the player is offered for a character. A locked kind
 * (isDetailLocked) never is. Otherwise a kind is offered when the ledger
 * does not know it yet; when the finding's message is newer than the kind's
 * current entry and its value differs (isSameDetailValue); or when it
 * refines the current value (isAppearanceRefinement), even from an older
 * message, the case of a vague value the extraction set late and the full
 * description far back in the chat. A definition (a finding with
 * `at: null`, a current entry `by: 'record'`) was written before the story,
 * so it counts as older than every message: the chat wins over it, and it
 * fills in what the chat never states or refines it. A current record entry
 * accepted over story entries (as a refinement) counts as the newest of
 * them, so their older values are not offered back. Any other current entry
 * without a message (`at: null`) counts as newer than every finding.
 * @param {object} character - A ledger character
 * @param {{kind: string, value: string, at: number|null}[]} findings
 * @returns {{kind: string, value: string, at: number|null}[]} The offered ones, in the order given
 */
export function listOfferedFindings(character, findings) {
    return findings.filter(finding => {
        if (isDetailLocked(character, finding.kind)) return false;
        const history = character.details?.[finding.kind] || [];
        if (history.length === 0) return true;
        const current = history[history.length - 1];
        const findingAt = finding.at === null ? -1 : finding.at;
        let currentAt = current.at;
        if (current.at === null && current.by !== 'record') currentAt = Infinity;
        if (current.at === null && current.by === 'record') {
            // A definition accepted over story values (a refinement) stands for the newest of them,
            // so those older values are not offered back
            const storyAts = history.filter(entry => entry.at !== null && entry.at !== undefined).map(entry => entry.at);
            currentAt = storyAts.length > 0 ? Math.max(...storyAts) : -1;
        }
        if (findingAt > currentAt && !isSameDetailValue(finding.kind, current.value, finding.value)) return true;
        return isAppearanceRefinement(finding.kind, current.value, finding.value);
    });
}
