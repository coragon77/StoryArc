/**
 * Print the WHO KNOWS WHAT block the narrator got (or would get) at one
 * message of a chat, from the chat file on disk. For finding out what the
 * knowledge block told the model when a reply leaked something.
 *
 * Usage, from the repository root:
 *   node --import ./tests/setup.js scripts/rebuild-knowledge-block.mjs <chat.jsonl> [messageIndex] [--ledger-at=N] [--no-details] [--appearance] [--state]
 *
 * messageIndex is the last message the narrator saw before the reply in
 * question (the user message it answered); it defaults to the last message.
 * The ledger is cut back to the message before it, where an update after
 * every reply left it (--ledger-at=N cuts it at N instead, for a longer
 * update interval): holder entries, character details, scenes and
 * meetings from later messages are left out, and a fact
 * left with no holder goes. A ledger from before the meetings gets its
 * scenes as meetings, as its next update would. The cut is approximate:
 * retractions, merges and hand edits made later are not undone.
 */
import fs from 'node:fs';
import { buildKnowledgeBlock } from '../lib/knowledge/ledger.js';
import { ledgerAtMessage } from './ledger-at-message.mjs';

const args = process.argv.slice(2);
const withDetails = !args.includes('--no-details');
// Appearance and standing state print as with their switches on (isAppearanceEnabled, isStandingStateEnabled).
const withAppearance = withDetails && args.includes('--appearance');
const withState = withDetails && args.includes('--state');
const ledgerAtArg = args.find(arg => arg.startsWith('--ledger-at='))?.split('=')[1];
const [chatFile, messageIndexArg] = args.filter(arg => !arg.startsWith('--'));
if (!chatFile) {
    console.error('Usage: node --import ./tests/setup.js scripts/rebuild-knowledge-block.mjs <chat.jsonl> [messageIndex] [--ledger-at=N] [--no-details] [--appearance] [--state]');
    process.exit(1);
}

const lines = fs.readFileSync(chatFile, 'utf8').trim().split('\n');
const header = JSON.parse(lines[0]);
const messages = lines.slice(1).map(line => JSON.parse(line));
const messageIndex = messageIndexArg === undefined ? messages.length - 1 : Number(messageIndexArg);
const ledgerIndex = ledgerAtArg === undefined ? messageIndex - 1 : Number(ledgerAtArg);
const storedLedger = header.chat_metadata?.story_arc?.knowledge;
if (!storedLedger) {
    console.error('This chat has no knowledge ledger.');
    process.exit(1);
}

const { ledger, scene, meetingsFromScenes } = ledgerAtMessage(storedLedger, ledgerIndex);
console.error(`Block at message ${messageIndex}, ledger up to ${ledgerIndex}; scene from message ${scene.at}; ${ledger.meetings.length} meetings`
    + `${meetingsFromScenes ? ' (from the scenes: the ledger has none yet)' : ''}.`);
console.log(buildKnowledgeBlock(ledger, messages.slice(0, messageIndex + 1), withDetails, withAppearance, withState));
