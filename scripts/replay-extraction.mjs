/**
 * Replay the knowledge extraction over one window of a chat file, through
 * the running SillyTavern server, and print what it reports as a rewrite
 * request, raw and after the code's checks (resolveRewrites). For testing
 * the extraction prompt on real cases before it ships (the replay gate of
 * docs/plans/2026-11-22-rejected-replies-design.md).
 *
 * Usage, from the repository root:
 *   node --import ./tests/setup.js scripts/replay-extraction.mjs <chat.jsonl> <firstIndex> <lastIndex> --data=<ST user data dir> [--url=http://127.0.0.1:8008] [--print-prompt]
 *
 * The window is read as the update after reply `lastIndex` read it: the
 * ledger cut back to the message before `firstIndex` (ledger-at-message.mjs),
 * the messages from `firstIndex - 1` to `lastIndex` shown as they were
 * (a later /hide or summary undone), nothing after `lastIndex`.
 * The prompt is this checkout's prompts/extract-knowledge.txt.
 *
 * The call goes to the tracker's connection profile as Story Arc sends it
 * (callViaProfile, ConnectionManagerRequestService): the profile's source,
 * model and secret id, the system prompt and the one user line of
 * callLlm, and the sampling of the profile's chat completion preset
 * (temperature, top_p, max tokens, reasoning effort), not streamed. The
 * server reads the API key itself; this script never sees it.
 * Read-only on the chat and the settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildKnowledgeExtractionVariables, listArcPlans, listRecognisableBeats, listShownSecrets, parseKnowledgeExtractionAnswer, resolveRewrites } from '../lib/knowledge/ledger.js';
import { fillTemplate } from '../lib/planning/generator.js';
import { ledgerAtMessage } from './ledger-at-message.mjs';

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const [chatFile, firstIndexArg, lastIndexArg] = args.filter(arg => !arg.startsWith('--'));
const dataDir = option('data');
const serverUrl = option('url') || 'http://127.0.0.1:8008';
if (!chatFile || firstIndexArg === undefined || lastIndexArg === undefined || !dataDir) {
    console.error('Usage: node --import ./tests/setup.js scripts/replay-extraction.mjs <chat.jsonl> <firstIndex> <lastIndex> --data=<ST user data dir> [--url=...] [--print-prompt]');
    process.exit(1);
}
const firstIndex = Number(firstIndexArg);
const lastIndex = Number(lastIndexArg);

const lines = fs.readFileSync(chatFile, 'utf8').trim().split('\n');
const header = JSON.parse(lines[0]);
const messages = lines.slice(1).map(line => JSON.parse(line));
const storyArc = header.chat_metadata?.story_arc;
if (!storyArc?.knowledge) {
    console.error('This chat has no knowledge ledger.');
    process.exit(1);
}

// The window as the update read it: shown, and cut after its last message.
const chatMessages = messages.slice(0, lastIndex + 1).map((message, index) =>
    (index >= firstIndex - 1 ? { ...message, is_system: false } : message));
const { ledger } = ledgerAtMessage(storyArc.knowledge, firstIndex - 1);
const activeArcs = (storyArc.arcs || []).filter(arc => arc.status === 'active');
const personaName = chatMessages.find(message => message.is_user)?.name || 'User';

const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
const trackerSettings = settings.extension_settings.story_arc.knowledgeTracker;
const profile = settings.extension_settings.connectionManager.profiles.find(candidate => candidate.id === trackerSettings.connectionProfile);
if (!profile) {
    console.error('The tracker has no connection profile of its own; this script replays only through one.');
    process.exit(1);
}
const preset = JSON.parse(fs.readFileSync(path.join(dataDir, 'OpenAI Settings', `${profile.preset}.json`), 'utf8'));

const withDetails = trackerSettings.characterDetails === true;
const variables = buildKnowledgeExtractionVariables(ledger, chatMessages, firstIndex, personaName,
    listShownSecrets(activeArcs), listRecognisableBeats(activeArcs), listArcPlans(activeArcs),
    withDetails, withDetails && trackerSettings.appearance === true, withDetails && trackerSettings.standingState === true);
const template = fs.readFileSync(new URL('../prompts/extract-knowledge.txt', import.meta.url), 'utf8');
const prompt = fillTemplate(template, variables);
if (args.includes('--print-prompt')) {
    console.log(prompt);
    process.exit(0);
}

const csrfResponse = await fetch(`${serverUrl}/csrf-token`);
const { token } = await csrfResponse.json();
const cookie = (csrfResponse.headers.getSetCookie?.() || []).map(entry => entry.split(';')[0]).join('; ');
const body = {
    stream: false,
    messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Follow the instructions above and produce the requested output now.' },
    ],
    model: profile.model,
    chat_completion_source: profile.api,
    secret_id: profile['secret-id'],
    custom_prompt_post_processing: profile['prompt-post-processing'],
    use_sysprompt: true,
    max_tokens: preset.openai_max_tokens,
    temperature: preset.temperature,
    top_p: preset.top_p,
    reasoning_effort: preset.reasoning_effort,
};
console.error(`Window #${firstIndex}–#${lastIndex}: prompt ${prompt.length} chars, ${profile.api} ${profile.model}`);
const response = await fetch(`${serverUrl}/api/backends/chat-completions/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, Cookie: cookie },
    body: JSON.stringify(body),
});
if (!response.ok) {
    console.error(`The server answered ${response.status}: ${(await response.text()).slice(0, 500)}`);
    process.exit(1);
}
const data = await response.json();
const answerText = data?.choices?.[0]?.message?.content ?? '';
const answer = parseKnowledgeExtractionAnswer(answerText);
if (!answer) {
    console.log(JSON.stringify({ window: [firstIndex, lastIndex], readable: false, answerStart: answerText.slice(0, 300) }));
    process.exit(0);
}
const checked = resolveRewrites(answer.rewrites, chatMessages, firstIndex, lastIndex);
console.log(JSON.stringify({ window: [firstIndex, lastIndex], rewrites: answer.rewrites, checked }));
