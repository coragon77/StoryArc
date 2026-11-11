/**
 * Rename characters across a SillyTavern chat file and its lorebook: every string in
 * every message (text, swipes, extras), the chat metadata (Story Arc's ledger and arcs,
 * Summaryception's summaries, …) and every string of the lorebook (keys included).
 *
 * Usage:
 *   node scripts/rename-characters.mjs <renames.json> <chat.jsonl> [<lorebook.json> ...]          (dry run)
 *   node scripts/rename-characters.mjs <renames.json> <chat.jsonl> [<lorebook.json> ...] --commit
 *
 * renames.json: [{ "from": "Vance-Hall", "to": "Hall" }, ...], applied in order, case
 * sensitive, whole words only (no letter, digit or hyphen on either side).
 *
 * After the replacement the ledger is tidied: aliases deduplicated (ignoring case) and
 * an alias equal to its record's name dropped; a renamed record's nameClash keeps only
 * the names another character still has, and goes when none is left. Names and aliases
 * must stay unique across records (ignoring case), or nothing is written.
 *
 * --commit backs every file up next to itself (<file>.pre-rename-<stamp>.bak) and gives
 * the chat a new integrity slug, so a browser tab still holding the old chat cannot save
 * over the renamed file without ST asking first.
 *
 * Limits:
 * - Only the files given change: other chats and branches of the character, the
 *   character card's own lorebook and other lorebooks keep the old names.
 * - Case matters: an all-caps spelling needs its own entry. The dry run lists the
 *   spellings it left alone ("NOT replaced") so they can be added.
 * - A name that is also an ordinary word ("Hall") changes in ordinary text too, wherever
 *   the case matches; read the dry run's examples before committing such a rename.
 * - Switch ST to another chat before --commit, and reload ST afterwards.
 * - Lorebooks are written back with ST's 4-space indentation.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { listCharactersWithNames, listTakenNames, foldName } from '../lib/knowledge/names.js';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const [renamesPath, chatPath, ...lorebookPaths] = args.filter(arg => arg !== '--commit');
if (!renamesPath || !chatPath) {
    console.error('usage: node scripts/rename-characters.mjs <renames.json> <chat.jsonl> [<lorebook.json> ...] [--commit]');
    process.exit(2);
}

const renames = JSON.parse(fs.readFileSync(renamesPath, 'utf8')).map(rename => ({
    ...rename,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegExp(rename.from)}(?![\\p{L}\\p{N}-])`, 'gu'),
    loosePattern: new RegExp(escapeRegExp(rename.from), 'giu'),
}));

/** Per rename and place: replacements made, and the first excerpt. */
const counts = new Map(renames.map(rename => [rename.from, {}]));
const examples = new Map();

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace in one string, counting under `place`. */
function renameInString(text, place) {
    let result = text;
    for (const rename of renames) {
        const placeCounts = counts.get(rename.from);
        const matches = result.match(rename.pattern);

        // Spellings the whole-word pattern leaves alone (other case, glued to a word),
        // counted before the replacement so a new name containing the old one is no hit
        const looseCount = result.match(rename.loosePattern)?.length ?? 0;
        const skippedCount = looseCount - (matches?.length ?? 0);
        if (skippedCount > 0) {
            const skippedPlace = `${place} (NOT replaced: other case or glued)`;
            placeCounts[skippedPlace] = (placeCounts[skippedPlace] ?? 0) + skippedCount;
        }

        if (matches) {
            placeCounts[place] = (placeCounts[place] ?? 0) + matches.length;
            if (!examples.has(rename.from)) {
                const at = result.search(rename.pattern);
                examples.set(rename.from, `${place}: …${result.slice(Math.max(0, at - 90), at + rename.from.length + 60).replace(/\s+/g, ' ')}…`);
            }
            result = result.replace(rename.pattern, rename.to);
        }
    }
    return result;
}

/** Walk any JSON value, renaming every string (object keys stay). */
function renameInValue(value, place) {
    if (typeof value === 'string') return renameInString(value, place);
    if (Array.isArray(value)) return value.map(item => renameInValue(item, place));
    if (value && typeof value === 'object') {
        const renamed = {};
        for (const [key, item] of Object.entries(value)) renamed[key] = renameInValue(item, place);
        return renamed;
    }
    return value;
}

// ─── The chat ───

const chatLines = fs.readFileSync(chatPath, 'utf8').split('\n');
const header = JSON.parse(chatLines[0]);
const ledgerBefore = structuredClone(header.chat_metadata?.story_arc?.knowledge ?? { characters: [] });
const renamedHeader = renameInValue(header, 'chat metadata');

const renamedLines = [JSON.stringify(renamedHeader)];
for (const line of chatLines.slice(1)) {
    if (!line) { renamedLines.push(line); continue; }
    const message = JSON.parse(line);
    const renamedMessage = {};
    for (const [key, item] of Object.entries(message)) {
        const place = key === 'mes' ? 'message text' : key === 'swipes' ? 'swipes' : 'message extras';
        renamedMessage[key] = renameInValue(item, place);
    }
    const renamedLine = JSON.stringify(renamedMessage);
    renamedLines.push(renamedLine === JSON.stringify(message) ? line : renamedLine);
}

// ─── The ledger tidy-up ───

const ledger = renamedHeader.chat_metadata?.story_arc?.knowledge;
const ledgerChanges = [];
const problems = [];
if (ledger) {
    const recordsBefore = new Map(ledgerBefore.characters.map(character => [character.id, character]));
    for (const character of ledger.characters) {
        const before = recordsBefore.get(character.id);
        // Names and aliases compare ignoring case only, as the Knowledge popup compares them
        const seen = new Set([String(character.name ?? '').toLowerCase()]);
        const aliases = [];
        for (const alias of character.aliases ?? []) {
            const foldedAlias = alias.toLowerCase();
            if (seen.has(foldedAlias)) continue;
            seen.add(foldedAlias);
            aliases.push(alias);
        }
        character.aliases = aliases;

        const changed = JSON.stringify([before?.name, before?.aliases]) !== JSON.stringify([character.name, character.aliases]);
        if (!changed) continue;
        let clashNote = '';
        if (character.nameClash) {
            // A name stays flagged only while the record still has it and another record has it too
            const ownNames = listTakenNames({ characters: [character] });
            const stillShared = character.nameClash.names.filter(name => ownNames.has(foldName(name))
                && listCharactersWithNames(ledger, [name], character.id).length > 0);
            if (stillShared.length === 0) {
                delete character.nameClash;
                clashNote = ' — name check cleared';
            } else {
                character.nameClash.names = stillShared;
                clashNote = ` — name check keeps ${stillShared.join(', ')}`;
            }
        }
        ledgerChanges.push(`${character.id}: ${JSON.stringify(before?.name)} ${JSON.stringify(before?.aliases)} → ${JSON.stringify(character.name)} ${JSON.stringify(character.aliases)}${clashNote}`);
    }

    const owners = new Map();
    for (const character of ledger.characters) {
        for (const spelling of [character.name, ...(character.aliases ?? [])]) {
            const folded = String(spelling ?? '').toLowerCase();
            if (!folded) continue;
            if (owners.has(folded) && owners.get(folded) !== character.id) {
                problems.push(`"${spelling}" is held by ${owners.get(folded)} and ${character.id}`);
            }
            owners.set(folded, character.id);
        }
    }
}

// ─── The lorebooks ───

const lorebookResults = lorebookPaths.map(path => {
    const raw = fs.readFileSync(path, 'utf8');
    const renamed = JSON.stringify(renameInValue(JSON.parse(raw), `lorebook ${path.split('/').pop()}`), null, 4);
    return { path, raw, renamed };
});

// ─── Report ───

console.log(commit ? '=== COMMIT ===' : '=== DRY RUN (nothing written) ===');
for (const rename of renames) {
    console.log(`\n${rename.from} → ${rename.to}`);
    const placeCounts = counts.get(rename.from);
    if (Object.keys(placeCounts).length === 0) console.log('    no match');
    for (const [place, count] of Object.entries(placeCounts)) console.log(`    ${place}: ${count}`);
    if (examples.has(rename.from)) console.log(`    e.g. ${examples.get(rename.from)}`);
}
console.log('\nLedger records changed:');
for (const change of ledgerChanges) console.log(`    ${change}`);
if (problems.length) {
    console.log('\nPROBLEMS (nothing written):');
    for (const problem of problems) console.log(`    ${problem}`);
    process.exit(1);
}
if (!commit) process.exit(0);

// ─── Write ───

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
// A chat without an integrity slug is not checked by ST on save: leave it without one
if (renamedHeader.chat_metadata?.integrity) {
    renamedHeader.chat_metadata.integrity = crypto.randomUUID();
}
// Serialized again here: the ledger tidy-up changed the header after the first pass
renamedLines[0] = JSON.stringify(renamedHeader);
for (const { path, raw } of [{ path: chatPath, raw: chatLines.join('\n') }, ...lorebookResults]) {
    fs.writeFileSync(`${path}.pre-rename-${stamp}.bak`, raw);
}
writeAtomically(chatPath, renamedLines.join('\n'));
for (const { path, renamed } of lorebookResults) writeAtomically(path, renamed);
console.log(`\nWritten. Backups: *.pre-rename-${stamp}.bak; chat integrity ${renamedHeader.chat_metadata?.integrity ?? '(none)'}`);

function writeAtomically(path, text) {
    fs.writeFileSync(`${path}.tmp-rename`, text);
    fs.renameSync(`${path}.tmp-rename`, path);
}
