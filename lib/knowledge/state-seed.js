/**
 * The standing state seed (design 2026-11-17, Part A): a character with a
 * long history and no standing state yet gets their first style, manner and
 * stances from one background call over the facts the ledger holds for
 * them. Runs after a reply's knowledge update, at most one seed per update,
 * so a scene with five new long-history characters seeds over five replies.
 * Nothing waits for the player: the result goes straight into the ledger,
 * where the Knowledge popup shows and edits it like any detail.
 */
import { chat_metadata, saveMetadata } from '/script.js';
import { getKnowledgeLedger, isStandingStateEnabled, trackerConnectionProfile } from '../core/settings.js';
import { HOLDER_HOW, STATE_KINDS } from '../core/constants.js';
import { fetchLorebookEntries } from '../context/harvester.js';
import { callLlm, fillTemplate, loadTemplate } from '../planning/generator.js';
import { parseLlmJson } from '../planning/validation.js';
import { characterAppearanceTexts, characterDetailTexts, characterDisplayName, characterName, findCharacterId, isKnowledgeUpdateRunning, isNamedInText, listFactsHeldBy, listNameWordCarriers, noteSeedCallRunning } from './ledger.js';

/** A present character holding at least this many facts, and no state of any kind, is seeded. */
export const STATE_SEED_MIN_FACTS = 40;

/** Characters of fact text the seed reads, newest first (about 6k tokens). */
const STATE_SEED_FACT_BUDGET = 24000;

/** Characters of lorebook text the seed reads. */
const STATE_SEED_LOREBOOK_BUDGET = 6000;

/** How many other characters a seeded stance may be toward: those sharing the most facts. */
const STATE_SEED_STANCE_CANDIDATES = 6;

/** A failed seed is tried again this often per character in one chat session. */
const STATE_SEED_TRIES = 3;

/** Failed seed calls per ledger object (one per loaded chat) and character id. */
const failedSeedsByLedger = new WeakMap();

/** True while a seed call is out, so a second one never overlaps it. */
let seedRunning = false;

/**
 * After a reply's knowledge update: seed the standing state of the first
 * present character who needs it (listCharactersToSeed), one per call. A
 * failed or unreadable answer stores nothing; the character is tried again
 * after a later update, at most STATE_SEED_TRIES times per chat session. An
 * answer that comes back after the chat changed, or after the character got
 * a state meanwhile, is not applied. No seed starts while a reply's
 * extraction is out, and no extraction while the seed is
 * (noteSeedCallRunning): the tracker's profile serves one call at a time.
 * @returns {Promise<boolean>} Whether the ledger changed and was saved
 */
export async function seedStandingStateAfterUpdate() {
    if (!isStandingStateEnabled() || isKnowledgeUpdateRunning() || seedRunning) return false;
    const ledger = getKnowledgeLedger();
    const failedSeeds = failedSeedsByLedger.get(ledger) || new Map();
    failedSeedsByLedger.set(ledger, failedSeeds);
    const character = listCharactersToSeed(ledger).find(candidate => (failedSeeds.get(candidate.id) || 0) < STATE_SEED_TRIES);
    if (!character) return false;

    const chatStateBefore = chat_metadata.story_arc;
    seedRunning = true;
    noteSeedCallRunning(true);
    let seededState;
    try {
        const lorebookEntries = await fetchLorebookEntries();
        const template = await loadTemplate('seed-state.txt');
        const prompt = fillTemplate(template, buildSeedVariables(ledger, character, lorebookEntries));
        const purpose = `the standing state of ${characterDisplayName(ledger, character)}`;
        const response = await callLlm(prompt, { profileId: trackerConnectionProfile(), template: 'seed-state.txt', purpose });
        seededState = parseSeedAnswer(response);
    } catch (err) {
        console.warn(`[Story Arc] Standing state seed for ${character.name} failed:`, err);
        seededState = null;
    } finally {
        seedRunning = false;
        noteSeedCallRunning(false);
    }
    if (!seededState) {
        failedSeeds.set(character.id, (failedSeeds.get(character.id) || 0) + 1);
        return false;
    }

    if (chat_metadata.story_arc !== chatStateBefore) return false;
    const ledgerNow = getKnowledgeLedger();
    const characterNow = ledgerNow.characters.find(candidate => candidate.id === character.id);
    if (!characterNow || hasStandingState(characterNow)) return false;
    if (!applySeededState(ledgerNow, characterNow, seededState)) {
        // An empty answer counts as a try, so a character the facts say
        // nothing lasting about is not asked again after every reply.
        failedSeeds.set(character.id, (failedSeeds.get(character.id) || 0) + 1);
        return false;
    }
    await saveMetadata();
    console.log(`[Story Arc] Standing state seeded for ${characterNow.name}`);
    return true;
}

/**
 * The present characters whose standing state is to be seeded: a named
 * character holding at least STATE_SEED_MIN_FACTS facts (not as a planned
 * holder) and no style, manner or stance entry at all, in the scene's order.
 * A character with fewer facts gets their whole fact list in the knowledge
 * block instead.
 * @param {object} ledger
 * @returns {object[]}
 */
export function listCharactersToSeed(ledger) {
    const presentCharacters = ledger.characters.filter(character => ledger.scene.present.includes(character.id));
    return presentCharacters.filter(character => {
        if (!character.name.trim() || hasStandingState(character)) return false;
        return listFactsHeldBy(ledger.facts, character.id).length >= STATE_SEED_MIN_FACTS;
    });
}

/**
 * Whether a character has any standing state entry, of any kind and source.
 * @param {object} character
 * @returns {boolean}
 */
function hasStandingState(character) {
    return STATE_KINDS.some(kind => (character.details?.[kind] || []).length > 0);
}

/**
 * Template variables for seed-state.txt: the character with their known
 * details and appearance, the other characters a stance may be toward (those
 * sharing the most facts with them), the always-on lorebook entries that name
 * them (selectLorebookTexts) and their facts newest first, each cut at its
 * budget.
 * @param {object} ledger
 * @param {object} character
 * @param {object[]} lorebookEntries - From fetchLorebookEntries
 * @returns {Record<string, string>}
 */
export function buildSeedVariables(ledger, character, lorebookEntries) {
    const knownTexts = { ...characterDetailTexts(ledger, character), ...characterAppearanceTexts(ledger, character) };
    const detailNotes = Object.entries(knownTexts).map(([kind, detailText]) => `${kind}: ${detailText}`);
    const aliasNote = character.aliases.length ? ` (also: ${character.aliases.join(', ')})` : '';
    const characterLine = `${characterDisplayName(ledger, character)}${aliasNote}${detailNotes.length ? ` — ${detailNotes.join('; ')}` : ''}`;

    const heldFacts = listFactsHeldBy(ledger.facts, character.id);
    const sharedCounts = new Map();
    for (const fact of heldFacts) {
        for (const holder of fact.holders) {
            if (holder.characterId === character.id || holder.how === HOLDER_HOW.plan) continue;
            sharedCounts.set(holder.characterId, (sharedCounts.get(holder.characterId) || 0) + 1);
        }
    }
    const otherNames = [...sharedCounts]
        .filter(([otherId]) => ledger.characters.some(other => other.id === otherId && other.name.trim()))
        .sort((first, second) => second[1] - first[1])
        .slice(0, STATE_SEED_STANCE_CANDIDATES)
        .map(([otherId]) => `- ${characterName(ledger, otherId)}`);

    const lorebookTexts = selectLorebookTexts(ledger, character, lorebookEntries);

    const factLines = [];
    let factCharacters = 0;
    for (const fact of heldFacts) {
        const factLine = `- ${fact.text}`;
        if (factCharacters + factLine.length > STATE_SEED_FACT_BUDGET) break;
        factLines.push(factLine);
        factCharacters += factLine.length + 1;
    }

    return {
        CHARACTER: characterLine,
        OTHERS: otherNames.join('\n') || '(none)',
        LOREBOOK: lorebookTexts.join('\n\n') || '(none)',
        FACTS: factLines.join('\n') || '(none)',
    };
}

/**
 * The parts of the always-on lorebook entries the seed reads about one
 * character, most telling first, while they fit STATE_SEED_LOREBOOK_BUDGET:
 * 1. an entry its title names them by ("Vera's Wardrobe"), whole;
 * 2. a paragraph that opens with their name or an alias: their own line of
 *    a cast entry ("* **Vera Lin (Fletchette):** …");
 * 3. any other paragraph that names them, in lorebook order.
 * A paragraph is a block between blank lines or a list item. Names count as
 * whole words (isNamedInText). A part too long for what is left is skipped,
 * not the ones after it.
 * @param {object} ledger
 * @param {object} character
 * @param {object[]} lorebookEntries - From fetchLorebookEntries
 * @returns {string[]} Each part with its entry's title in brackets
 */
function selectLorebookTexts(ledger, character, lorebookEntries) {
    const nameWordCarriers = listNameWordCarriers(ledger.characters);
    const names = text => isNamedInText(ledger, character, text, nameWordCarriers);
    // Their own line opens with their name, list and bold marks aside.
    const ownNames = [character.name, ...character.aliases].map(name => name.trim().toLowerCase()).filter(Boolean);
    const startsWithOwnName = paragraph => {
        const opening = paragraph.replace(/^[\s*#>_-]+/, '').toLowerCase();
        return ownNames.some(name => opening.startsWith(name));
    };
    const ownEntries = [];
    const ownParagraphs = [];
    const mentioningParagraphs = [];
    for (const entry of lorebookEntries) {
        if (!entry.constant || entry.disable) continue;
        const title = entry.comment || 'entry';
        const content = String(entry.content || '');
        if (names(title)) {
            ownEntries.push(`[${title}]\n${content}`);
            continue;
        }
        if (!names(content)) continue;
        for (const paragraph of content.split(/\n\s*\n|\n(?=\s*[*-] )/)) {
            if (!names(paragraph)) continue;
            const part = `[${title}]\n${paragraph.trim()}`;
            if (startsWithOwnName(paragraph)) {
                ownParagraphs.push(part);
            } else {
                mentioningParagraphs.push(part);
            }
        }
    }

    const lorebookTexts = [];
    let lorebookCharacters = 0;
    for (const part of [...ownEntries, ...ownParagraphs, ...mentioningParagraphs]) {
        if (lorebookCharacters + part.length > STATE_SEED_LOREBOOK_BUDGET) continue;
        lorebookTexts.push(part);
        lorebookCharacters += part.length + 2;
    }
    return lorebookTexts;
}

/**
 * Read the seed's answer: `{ style, manner, stances: [{ toward, text }] }`,
 * strings trimmed, empty ones left out.
 * @param {string} responseText
 * @returns {{style: string, manner: string, stances: {toward: string, text: string}[]}|null} Null for no readable object
 */
export function parseSeedAnswer(responseText) {
    const parsed = parseLlmJson(responseText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const textOf = value => (typeof value === 'string' ? value.trim() : '');
    const stanceItems = Array.isArray(parsed.stances) ? parsed.stances : [];
    const stances = stanceItems
        .map(item => ({ toward: textOf(item?.toward), text: textOf(item?.text) }))
        .filter(stance => stance.toward && stance.text);
    return { style: textOf(parsed.style), manner: textOf(parsed.manner), stances };
}

/**
 * Store a seed answer as seed entries `{ value, at: null, by: 'seed' }`:
 * like the record entry an unnamed relative is created with, it survives
 * every rollback and locks nothing, so a swipe of the reply after which it
 * ran does not take it away (and call the seed again), and a later turning
 * point appends after it. A stance toward a name the ledger does not know,
 * or toward the character themselves, is left out.
 * @param {object} ledger
 * @param {object} character - Changed in place
 * @param {{style: string, manner: string, stances: {toward: string, text: string}[]}} seededState
 * @returns {boolean} Whether anything was stored
 */
export function applySeededState(ledger, character, seededState) {
    const details = { ...character.details };
    if (seededState.style) details.style = [{ value: seededState.style, at: null, by: 'seed' }];
    if (seededState.manner) details.manner = [{ value: seededState.manner, at: null, by: 'seed' }];
    const stanceEntries = [];
    for (const stance of seededState.stances) {
        const otherId = findCharacterId(ledger.characters, stance.toward);
        if (!otherId || otherId === character.id) continue;
        if (stanceEntries.some(entry => entry.value.of === otherId)) continue;
        stanceEntries.push({ value: { text: stance.text, of: otherId }, at: null, by: 'seed' });
    }
    if (stanceEntries.length > 0) details.stance = stanceEntries;
    if (!details.style && !details.manner && !details.stance) return false;
    character.details = details;
    return true;
}
