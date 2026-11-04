/**
 * Story Arc - Taken names
 *
 * Every first name, surname and codename the knowledge ledger's characters
 * already use, derived in code from each character's name and aliases, and
 * the block that tells the narrator not to give them to a new character.
 * A module of its own, against the house default, because a second file
 * really calls it: the reused-name flag and the planner with its plan check
 * use the same derivation, and the generator cannot import ledger.js
 * without a cycle.
 */

/**
 * Words that stand in front of a name without being one: honorifics, ranks,
 * offices and kinship words, in their folded form (see foldName). A word
 * ending in a period counts as a title too. The set bans nothing; it only
 * keeps "Dr" and "Uncle" out of the taken names. Words that are also common
 * given names ("Don") stay out of it.
 */
const TITLE_WORDS = new Set([
    'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'doctor', 'prof', 'professor',
    'sir', 'dame', 'lady', 'lord', 'madam', 'madame', 'senor', 'senora', 'senorita',
    'judge', 'commissioner', 'director', 'captain', 'capt', 'lieutenant', 'lt',
    'sergeant', 'sgt', 'staff', 'officer', 'detective', 'agent', 'liaison',
    'commander', 'major', 'colonel', 'general', 'chief',
    'uncle', 'aunt', 'auntie', 'grandma', 'grandpa',
]);

/** Leading articles, folded: "The Architect" gives Architect. */
const ARTICLE_WORDS = new Set(['the']);

/**
 * Particles of a surname, dropped only when written in lowercase
 * ("de", "van", "al-"); a capitalised "Van" or "Al" is a name.
 */
const LOWERCASE_PARTICLES = new Set([
    'al', 'el', 'bin', 'ibn', 'da', 'das', 'de', 'del', 'della', 'der', 'den',
    'di', 'dos', 'du', 'la', 'le', 'ten', 'ter', 'van', 'von', 'y',
]);

const BLOCK_HEADER = '[NAMES ALREADY IN THIS STORY — first names, surnames and codenames of characters who have appeared. '
    + 'A new character gets none of these names, as a first name or as a surname, unless the new character is related to the character who has it. '
    + 'Characters already in the story keep their names.]';

// ─── The block ───

/**
 * Build the taken-names block the narrator sees: the rule in one header
 * sentence, then every taken name on one line, comma-separated, sorted by
 * the folded form. A hyphenated surname prints only its parts. The text
 * depends only on the set of names, not on the order of the records, the
 * facts or the scene.
 * @param {object} ledger - The knowledge ledger (createEmptyKnowledgeLedger shape)
 * @returns {string} The block text, or '' when the ledger has no name
 */
export function buildTakenNamesBlock(ledger) {
    const printedNames = printTakenNames(ledger);
    if (printedNames.length === 0) return '';
    return `${BLOCK_HEADER}\n${printedNames.join(', ')}`;
}

/**
 * The taken names as a prompt prints them: sorted by the folded form, a
 * hyphenated surname by its parts only. The narrator's block and the
 * planner's cast block list them the same way.
 * @param {object|null|undefined} ledger - The knowledge ledger, or any
 *   object whose `characters` hold `{ name, aliases }`
 * @returns {string[]} The printed spellings
 */
export function printTakenNames(ledger) {
    const takenNames = listTakenNames(ledger);
    return [...takenNames.entries()]
        .filter(([foldedName]) => !foldedName.includes('-'))
        .sort(([foldedA], [foldedB]) => compareCodeUnits(foldedA, foldedB))
        .map(([, spelling]) => spelling);
}

/**
 * Compare two strings by their UTF-16 code units, so the order never
 * depends on the browser's locale (unlike localeCompare).
 */
function compareCodeUnits(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

// ─── The derivation ───

/**
 * Every name the ledger's characters already use: the words of each
 * character's name and of each of its aliases (see nameWords), keyed by
 * their folded form (see foldName). A hyphenated word is taken whole and by
 * each of its parts. The spelling kept is the one of the first record in
 * ledger order that has the name, its name before its aliases.
 * @param {object|null|undefined} ledger - The knowledge ledger
 * @returns {Map<string, string>} Folded form → printed spelling
 */
export function listTakenNames(ledger) {
    const takenNames = new Map();
    for (const character of ledger?.characters ?? []) {
        const recordNames = [character.name, ...(character.aliases ?? [])];
        for (const recordName of recordNames) {
            for (const word of nameWords(recordName)) {
                const hyphenParts = word.split('-').filter(part => part !== '' && !isLowercaseParticle(part));
                const takenWords = hyphenParts.length > 1 ? [word, ...hyphenParts] : hyphenParts;
                for (const takenWord of takenWords) {
                    const foldedName = foldName(takenWord);
                    if (!takenNames.has(foldedName)) takenNames.set(foldedName, takenWord);
                }
            }
        }
    }
    return takenNames;
}

/**
 * The characters who have one of the given names now, by the same
 * derivation and folded comparison as listTakenNames, in ledger order.
 * The reused-name flag stores the shared names and looks up who has them
 * when it is shown, since those characters may have been renamed since.
 * @param {object} ledger - The knowledge ledger
 * @param {string[]} names - Names as a character's nameClash stores them
 * @param {string} exceptCharacterId - The flagged character, never listed
 * @returns {object[]} The character records
 */
export function listCharactersWithNames(ledger, names, exceptCharacterId) {
    const wantedNames = names.map(name => foldName(name));
    return (ledger?.characters ?? []).filter(character => {
        if (character.id === exceptCharacterId) return false;
        const characterNames = listTakenNames({ characters: [character] });
        return wantedNames.some(wantedName => characterNames.has(wantedName));
    });
}

/**
 * The name words of one name or alias: split at whitespace, enclosing
 * punctuation removed; words without a letter, lowercase particles and
 * leading articles dropped; leading titles dropped while more than one word
 * is left, so the last word always stays. A name of several words with no
 * capitalised word is a description ("the night-shift tech") and gives no
 * words. No word is classified as a first name or a surname.
 * @param {string} name - A character's name or alias as the ledger holds it
 * @returns {string[]} The words in the order of the name
 */
export function nameWords(name) {
    const letterWords = String(name ?? '')
        .split(/\s+/)
        .map(word => word.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.]+$/u, ''))
        .filter(word => /\p{L}/u.test(word));

    // An alias such as "the night-shift tech" describes a character, it does
    // not name one: several words and none capitalised add no name. A single
    // lowercase word ("zoe") still counts.
    if (letterWords.length > 1 && !letterWords.some(word => /(^|-)\p{Lu}/u.test(word))) return [];

    const words = letterWords.filter(word => !isLowercaseParticle(word));

    while (words.length > 1 && isTitleOrArticle(words[0])) {
        words.shift();
    }

    return words
        .map(word => word.replace(/\.+$/, ''))
        .filter(word => word !== '');
}

/** A word ending in a period, a word of TITLE_WORDS, or a leading article. */
function isTitleOrArticle(word) {
    if (word.endsWith('.')) return true;
    const foldedWord = foldName(word);
    return TITLE_WORDS.has(foldedWord) || ARTICLE_WORDS.has(foldedWord);
}

/** "de", "van", "al-": a particle of LOWERCASE_PARTICLES, written in lowercase. */
function isLowercaseParticle(word) {
    const bareWord = word.replace(/-+$/, '');
    return bareWord === bareWord.toLowerCase() && LOWERCASE_PARTICLES.has(bareWord);
}

/**
 * The comparison form of a name: lowercase with diacritics removed, so
 * Matías and Matias are one name. Locale-independent.
 * @param {string} name - One name word
 * @returns {string} The folded form
 */
export function foldName(name) {
    return String(name ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
