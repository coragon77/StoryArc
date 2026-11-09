/**
 * @file Multi-phase LLM generation for arc plans
 * @module planning/generator
 */

import { chat, getRequestHeaders } from '/script.js';
import { delay } from '/scripts/utils.js';
import { parseLlmJson, validateArcPlan } from './validation.js';
import { readActiveArcDirectives } from './arc-preset.js';
import { mergeReplan } from './replan.js';
import { getSettings, arcWorldFacts, isBeatOpen, getKnowledgeLedger } from '../core/settings.js';
import { TIER_TABLE } from '../core/constants.js';
import { printTakenNames, listTakenNames, nameWords, foldName } from '../knowledge/names.js';

/**
 * @typedef {object} GenerationCallbacks
 * @property {(phase: string, message: string) => void} onProgress
 * @property {(charsReceived: number) => void} [onChunk] - Called while a response streams in
 * @property {() => boolean} isCancelled
 */

/**
 * @typedef {object} GenerationOptions
 * @property {'episode'|'act'|'saga'} [tier='episode'] - Tier chosen in the wizard
 * @property {object|null} [reviseArc=null] - The arc being re-planned, with title,
 *   premise, direction, genre and theme seeds as edited in the wizard; null when planning new
 * @property {string} [genre=''] - The arc's genre as written in the wizard; binding
 *   for the register in both phases, empty for none (ADR-0004)
 * @property {string} [themeSeeds=''] - The player's themes as written in the wizard;
 *   colour for the outline only, never an obligation, empty for none (ADR-0004)
 * @property {string} [analysis] - The Phase 1 analysis prepareArc already made;
 *   given, Phase 1 is skipped (the wizard's Questions step and Regenerate reuse it)
 * @property {{ question: string, answer: string }[]} [authorAnswers=[]] - The
 *   author's answers from the wizard's Questions step; binding for the outline
 *   like the direction, never sent to the narrator
 */

/**
 * Generate an arc plan using multi-phase LLM generation.
 * @param {import('../context/harvester.js').HarvestedContext} context - Harvested context
 * @param {string} userDirection - User's creative direction text
 * @param {GenerationCallbacks} [callbacks] - Progress callbacks
 * @param {GenerationOptions} [options]
 * A failure carries a stable `code` besides the message (for the console):
 *   'cancelled' (the caller cancelled), 'unparseable' (no JSON twice),
 *   'invalid' (the plan failed validation), 'failed' (anything else: the
 *   transport, the API, a thrown error).
 * @returns {Promise<{ arc: object|null, error: string|null, code?: 'cancelled'|'unparseable'|'invalid'|'failed' }>}
 */
export async function generateArc(context, userDirection, callbacks = {}, options = {}) {
    const { onProgress = () => {}, isCancelled = () => false } = callbacks;
    const { tier = 'episode' } = options;
    // A re-plan's revealed secrets include those that came out on screen
    // without the disclosed mark (markSecretsRevealedOnScreen).
    const onScreenSecretIds = options.reviseArc ? secretIdsRevealedOnScreen(options.reviseArc, getKnowledgeLedger()) : [];
    const reviseArc = options.reviseArc ? markSecretsRevealedOnScreen(options.reviseArc, onScreenSecretIds) : null;
    const genre = (options.genre || '').trim();
    const themeSeeds = (options.themeSeeds || '').trim();
    const authorAnswers = answeredAuthorAnswers(options.authorAnswers);

    try {
        // Phase 1: Analysis, unless the wizard already made it for its questions
        let analysis = options.analysis;
        if (typeof analysis !== 'string') {
            onProgress('phase1', 'Analyzing story context...');
            analysis = await runPhase1(context, reviseArc, genre, callbacks);
            if (isCancelled()) return { arc: null, error: 'Cancelled', code: 'cancelled' };
        }

        // Phase 2: Arc Outline
        const cast = context.cast ?? [];
        const phase2 = { analysis, userDirection, existingArcs: context.existingArcs, tier, reviseArc, genre, themeSeeds, authorAnswers, cast };
        onProgress('phase2', 'Generating arc outline...');
        const outlineResponse = await runPhase2(phase2, false, callbacks);
        let parsed = parseLlmJson(outlineResponse);
        if (isCancelled()) return { arc: null, error: 'Cancelled', code: 'cancelled' };

        if (!parsed) {
            // Retry once with emphasis on JSON
            onProgress('retry', 'Retrying with structured output...');
            const retryResponse = await runPhase2(phase2, true, callbacks);
            parsed = parseLlmJson(retryResponse);
            if (!parsed) {
                return { arc: null, error: 'Failed to parse LLM output as JSON after retry', code: 'unparseable' };
            }
        }

        const result = validateArcPlan(parsed, { tier });
        if (!result.valid) {
            const validationErrors = result.errors.join(', ');
            return { arc: null, error: `Validation failed: ${validationErrors}`, code: 'invalid' };
        }

        result.arc.messageStart = chat?.length || 0;
        result.arc.lastFulfilledAt = result.arc.messageStart;
        result.arc.direction = userDirection;
        // From the wizard, never from the model: validateArcPlan drops an echoed one.
        if (genre) result.arc.genre = genre;
        if (themeSeeds) result.arc.themeSeeds = themeSeeds;

        // Re-plan: the generated plan is the new road; the situation stays.
        const plannedArc = reviseArc ? mergeReplan(reviseArc, result.arc) : result.arc;
        if (isCancelled()) return { arc: null, error: 'Cancelled', code: 'cancelled' };
        // The merge has read validation's mark of an invented id; it is never stored.
        plannedArc.secrets = plannedArc.secrets.map(({ idInvented, ...secret }) => secret);

        // This run's answers, on the arc the plan check reads them from. Set
        // after the merge, which keeps the re-planned arc's own fields: its
        // earlier answers would otherwise reach the check and the stored arc.
        // A re-plan always sets the list, empty when every answer was cleared:
        // updateArc merges, so an absent field would keep the stored answers.
        if (reviseArc || authorAnswers.length) plannedArc.authorAnswers = authorAnswers;

        // Phase 3: the plan check runs on the merged arc, so it sees every
        // secret with its disclosure and the ids the plan will be stored with.
        // Only a re-plan has a story in which a secret can have come out, and
        // only one of the re-planned arc's own secrets, worded as it was
        // while the story was played: the planner may have rewritten it.
        const story = reviseArc ? { analysis, chatHistory: context.chatHistory } : null;
        const earlierSecrets = reviseArc ? reviseArc.secrets : [];
        // The renames never touch the author's words: the direction, the
        // rulings, and on a re-plan the title and premise the wizard passed in.
        const names = { cast, replanPremise: reviseArc?.premise || '', replanTitle: reviseArc?.title || '' };
        const checkedArc = await runPlanCheck(plannedArc, story, earlierSecrets, names, callbacks, onScreenSecretIds);
        return { arc: checkedArc, error: null };

    } catch (err) {
        console.error('[Story Arc] Generation failed:', err);
        return { arc: null, error: String(err?.message ?? err), code: 'failed' };
    }
}

/**
 * Phase 1: Analyze story state
 * @param {object|null} reviseArc - Arc marked [BEING RE-PLANNED] in the existing-arcs list,
 *   with its rulings (as the wizard passes them) listed under it
 * @param {string} genre - The arc's genre, '' for none
 */
async function runPhase1(context, reviseArc, genre, callbacks) {
    const template = await loadTemplate('analyze-context.txt');
    const analysisVariables = {
        CHARACTER_DESCRIPTION: formatCharacter(context.character),
        PERSONA: formatPersona(context.persona),
        LOREBOOK_CONSTANTS: formatEntries(context.lorebook.constants),
        LOREBOOK_HISTORY: formatEntries(context.lorebook.arcSummaries),
        LOREBOOK_RECENT: formatEntries(context.lorebook.recent),
        CHAT_HISTORY: formatChat(context.chatHistory),
        EXISTING_ARCS: formatExistingArcs(context.existingArcs, reviseArc?.id, reviseArc?.rulings),
        GENRE_BLOCK: formatGenreBlock(genre, 'analysis'),
    };
    const prompt = fillTemplate(template, analysisVariables);

    const analysis = await callLlm(prompt, callbacks);
    return analysis;
}

/**
 * The wizard's first half: Phase 1, then the question call. The analysis is
 * handed back so generateArc can plan from it (options.analysis) without
 * running Phase 1 again; given an analysis, prepareArc skips Phase 1 too
 * (Phase 1 reads only the context, the genre and the re-planned arc's
 * rulings). A failed Phase 1 throws, as in generateArc; a failed question
 * call only means no questions (askAuthorQuestions).
 * @param {import('../context/harvester.js').HarvestedContext} context
 * @param {string} userDirection
 * @param {GenerationCallbacks} [callbacks]
 * @param {GenerationOptions} [options] - tier, reviseArc, genre, themeSeeds,
 *   analysis, and authorAnswers: the answers already given, not to be asked
 *   again (default: the re-planned arc's own)
 * @returns {Promise<{ analysis: string|null, questions: { question: string, suggestions: string[] }[], cancelled?: boolean }>}
 */
export async function prepareArc(context, userDirection, callbacks = {}, options = {}) {
    const { onProgress = () => {}, isCancelled = () => false } = callbacks;
    const { tier = 'episode', reviseArc = null } = options;
    const genre = (options.genre || '').trim();
    const themeSeeds = (options.themeSeeds || '').trim();

    let analysis = options.analysis;
    if (typeof analysis !== 'string') {
        onProgress('phase1', 'Analyzing story context...');
        analysis = await runPhase1(context, reviseArc, genre, callbacks);
        if (isCancelled()) return { analysis: null, questions: [], cancelled: true };
    }

    const answered = answeredAuthorAnswers(options.authorAnswers ?? reviseArc?.authorAnswers);
    const questionInput = { analysis, userDirection, existingArcs: context.existingArcs, tier, reviseArc, genre, themeSeeds, answered };
    const questions = await askAuthorQuestions(questionInput, callbacks);
    if (isCancelled()) return { analysis: null, questions: [], cancelled: true };
    return { analysis, questions };
}

/** Most questions the wizard shows, and most suggested answers per question. */
const MAX_AUTHOR_QUESTIONS = 5;
const MAX_QUESTION_SUGGESTIONS = 4;

/**
 * The question call: before planning, ask the author what the direction
 * leaves open about their intent (how pressure works, how dark the arc is,
 * whether allies can resolve a dilemma, the inner conflict, hard lines). A
 * one-paragraph direction left the planner to its overt defaults: a plan for
 * nuanced themes came out blunt, with contracts, orders and chaperones, and
 * the intent that mattered only came out in a later conversation. A failed
 * or unreadable call, like zero questions, means planning goes straight on.
 * @param {{ analysis: string, userDirection: string, existingArcs: object[], tier: string, reviseArc: object|null, genre: string, themeSeeds: string }} input
 * @param {GenerationCallbacks} [callbacks]
 * @returns {Promise<{ question: string, suggestions: string[] }[]>}
 */
async function askAuthorQuestions(input, callbacks = {}) {
    const { onProgress = () => {} } = callbacks;
    onProgress('questions', 'Looking for what the direction leaves open...');
    try {
        const template = await loadTemplate('ask-questions.txt');
        const prompt = fillTemplate(template, buildAskQuestionsVariables(input));
        const response = await callLlm(prompt, callbacks);
        const questions = parseAuthorQuestions(response);
        console.log(`[Story Arc] Question call asked ${questions.length} question(s)`);
        return questions;
    } catch (err) {
        console.warn('[Story Arc] Question call failed; planning without questions:', err);
        onProgress('retry', `Questions failed (${err.message}) — planning without them`);
        return [];
    }
}

/**
 * Template variables for ask-questions.txt: the direction, the tier, genre
 * and themes, the Phase 1 analysis, the other running arcs by title only
 * (their premises sit behind the Arc Manager's spoiler switch, and the
 * player reads what this call writes) and the answers already given, which
 * are not to be asked again. A re-plan also gets what the player has seen
 * of the arc so far (buildSeenArcSoFar). The analysis stays: Phase 1 reads
 * no secret, trigger or clue of any arc, only titles, premises and rulings.
 * @param {{ analysis: string, userDirection: string, existingArcs: object[], tier: string, reviseArc: object|null, genre: string, themeSeeds: string, answered?: object[] }} input
 * @returns {Record<string, string>}
 */
export function buildAskQuestionsVariables(input) {
    const row = TIER_TABLE[input.tier] || TIER_TABLE.episode;
    const [minLength, maxLength] = row.lengthBand;
    const otherRunningArcs = (input.existingArcs || []).filter(arc => arc.id !== input.reviseArc?.id);
    const answered = answeredAuthorAnswers(input.answered ?? input.reviseArc?.authorAnswers);
    const arcTitles = otherRunningArcs.map(arc => `- "${arc.title}"`);
    return {
        USER_DIRECTION: input.userDirection || '(No direction given)',
        TIER: `${row.label} (roughly ${minLength}-${maxLength} messages of play)`,
        GENRE: input.genre || '(none)',
        THEMES: input.themeSeeds || '(none)',
        PHASE1_ANALYSIS: input.analysis,
        EXISTING_ARCS: arcTitles.join('\n') || '(No existing arcs)',
        ARC_SO_FAR: buildSeenArcSoFar(input.reviseArc),
        ANSWERED: answered.length ? formatAnswerPairs(answered) : '(none)',
    };
}

/**
 * The re-planned arc as the player has seen it, for the question call: the
 * player reads what that call writes, so it gets no plan text the story has
 * not shown. That is the premise, the fulfillments of completed beats, the
 * planted clues and the disclosed secrets; never an unrevealed secret, an
 * unfired trigger, an unplanted clue, an open pressure or the escalation.
 * @param {object|null} arc - The arc being re-planned, null when planning new
 * @returns {string} Prompt block, '' when planning new
 */
export function buildSeenArcSoFar(arc) {
    if (!arc) return '';

    const listOrNone = (texts) => (texts.length ? texts.map(text => `- ${text}`).join('\n') : '(none)');
    const happened = (arc.beats ?? []).filter(beat => beat.status === 'completed').map(beat => beat.intention);
    const plantedClues = (arc.foreshadowing ?? []).filter(foreshadowing => foreshadowing.planted).map(foreshadowing => foreshadowing.clue);
    const disclosedSecrets = (arc.secrets ?? []).filter(secret => secret.disclosed).map(secret => secret.content);

    return `== ARC SO FAR (what the author has seen in play) ==
Premise: ${arc.premise}

Already happened:
${listOrNone(happened)}

Clues already planted:
${listOrNone(plantedClues)}

Secrets already out in the story:
${listOrNone(disclosedSecrets)}

`;
}

/**
 * The question call's answer as the wizard's questions: at most five, each
 * with a non-blank question and at most four non-blank suggested answers,
 * all trimmed. No JSON, no list, or items of the wrong shape give fewer
 * questions or none, never an error.
 * @param {string} response - The model's raw answer
 * @returns {{ question: string, suggestions: string[] }[]}
 */
export function parseAuthorQuestions(response) {
    const parsed = parseLlmJson(response);
    if (!parsed || !Array.isArray(parsed.questions)) {
        console.warn('[Story Arc] Question call answered no question list; planning without questions');
        return [];
    }
    const questions = [];
    for (const item of parsed.questions) {
        const question = typeof item?.question === 'string' ? item.question.trim() : '';
        if (!question) continue;
        const suggestions = (Array.isArray(item.suggestions) ? item.suggestions : [])
            .filter(suggestion => typeof suggestion === 'string')
            .map(suggestion => suggestion.trim())
            .filter(Boolean)
            .slice(0, MAX_QUESTION_SUGGESTIONS);
        questions.push({ question, suggestions });
    }
    return questions.slice(0, MAX_AUTHOR_QUESTIONS);
}

/**
 * The author's answers that say something: question and answer trimmed,
 * the blank ones dropped. What generateArc stamps on the arc.
 * @param {unknown} authorAnswers
 * @returns {{ question: string, answer: string }[]}
 */
export function answeredAuthorAnswers(authorAnswers) {
    if (!Array.isArray(authorAnswers)) return [];
    return authorAnswers
        .map(pair => ({ question: String(pair?.question ?? '').trim(), answer: String(pair?.answer ?? '').trim() }))
        .filter(pair => pair.question && pair.answer);
}

/**
 * The author's answers as prompt lines, a Q line and an A line per pair.
 * The question call and the outline print them the same way.
 * @param {{ question: string, answer: string }[]} authorAnswers
 * @returns {string}
 */
function formatAnswerPairs(authorAnswers) {
    return authorAnswers.map(pair => `Q: ${pair.question}\nA: ${pair.answer}`).join('\n');
}

// Prompt template loading and placeholder substitution.
const PROMPTS_BASE_URL = new URL('../../prompts/', import.meta.url).href;

const templateCache = new Map();

const VALID_TEMPLATES = new Set([
    'analyze-context.txt',
    'ask-questions.txt',
    'generate-arc.txt',
    'check-plan.txt',
    'extract-knowledge.txt',
]);

/**
 * Load a prompt template file
 * @param {string} filename - Template filename (must be in VALID_TEMPLATES)
 * @returns {Promise<string>}
 */
export async function loadTemplate(filename) {
    if (!VALID_TEMPLATES.has(filename)) {
        throw new Error(`[Story Arc] Invalid template: ${filename}`);
    }

    if (templateCache.has(filename)) {
        const cachedTemplate = templateCache.get(filename);
        return cachedTemplate;
    }

    const url = `${PROMPTS_BASE_URL}${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`[Story Arc] Failed to load template ${filename}: ${response.status}`);
    }

    const text = await response.text();
    templateCache.set(filename, text);
    return text;
}

/**
 * Fill placeholders in a template string.
 * Placeholders use {{VARIABLE_NAME}} syntax.
 * @param {string} template - Template with placeholders
 * @param {Record<string, string>} variables - Key-value pairs to substitute
 * @returns {string}
 */
export function fillTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        const replacement = value || '';
        result = result.replaceAll(`{{${key}}}`, replacement);
    }
    return result;
}

/**
 * Clear the template cache (useful if templates are edited at runtime)
 */
export function clearTemplateCache() {
    templateCache.clear();
}

function formatCharacter(char) {
    if (!char) return '(No character data available)';
    return `Name: ${char.name}\nDescription: ${char.description}\nPersonality: ${char.personality}\nScenario: ${char.scenario}`;
}

function formatPersona(persona) {
    if (!persona.name && !persona.description) return '(No persona data)';
    return `Name: ${persona.name}\nDescription: ${persona.description}`;
}

function formatEntries(entries) {
    if (!entries.length) return '(None)';
    const formattedEntries = entries.map(entry => {
        const label = entry.comment || '(unnamed)';
        const keywords = Array.isArray(entry.key) ? entry.key.join(', ') : '';
        const keywordNote = keywords ? ` (keywords: ${keywords})` : '';
        return `[${label}]${keywordNote}\n${entry.content}`;
    });
    return formattedEntries.join('\n\n---\n\n');
}

function formatChat(messages) {
    if (!messages.length) return '(No chat history)';
    const transcript = messages.map(message => `${message.name}: ${message.content}`).join('\n\n');
    return transcript;
}

/**
 * One line per running arc for the prompt templates. The arc being
 * re-planned is followed by the player's rulings against it, under
 * "Overruled by the player:", so the analysis does not report an overruled
 * premise as established fact (analyze-context.txt).
 * @param {object[]} arcs - Active arcs
 * @param {string} [reviseArcId] - Arc to mark [BEING RE-PLANNED] (analyze-context.txt explains the mark)
 * @param {object[]} [reviseRulings] - The re-planned arc's rulings, as the wizard passes them
 * @returns {string}
 */
export function formatExistingArcs(arcs, reviseArcId, reviseRulings = []) {
    if (!arcs || !arcs.length) return '(No existing arcs)';
    const arcLines = arcs.map(arc => {
        const mark = arc.id === reviseArcId ? ' [BEING RE-PLANNED]' : '';
        const focus = arc.focus.toUpperCase();
        const arcLine = `[${focus}]${mark} "${arc.title}" — ${arc.premise}`;
        if (arc.id !== reviseArcId || !reviseRulings?.length) return arcLine;
        return `${arcLine}\nOverruled by the player:\n${formatRulings(reviseRulings)}`;
    });
    return arcLines.join('\n');
}

/**
 * The player's rulings as prompt lines, in message order: each quote in the
 * player's words, with the option it picked when it is a bare pick. The
 * three calls of a re-plan print them the same way (ADR-0003).
 * @param {object[]} rulings - Rulings of the arc being re-planned
 * @returns {string}
 */
function formatRulings(rulings) {
    const inMessageOrder = [...rulings].sort((first, second) => first.at - second.at);
    const rulingLines = inMessageOrder.map(ruling => {
        const picked = ruling.chose ? ` (the option picked: "${ruling.chose}")` : '';
        return `- "${ruling.text}"${picked}`;
    });
    return rulingLines.join('\n');
}

/**
 * Render the arc's genre as a prompt section. The analysis reads the story
 * through it; the outline treats it as outranking the analysis and the
 * recorded material, which is where a light story drifted into the register
 * of its procedural summaries (ADR-0004). Empty genre, empty string, so the
 * template keeps no dangling header.
 * @param {string} genre - The arc's genre, '' for none
 * @param {'analysis'|'outline'} phase
 * @returns {string}
 */
export function formatGenreBlock(genre, phase) {
    if (!genre) return '';

    if (phase === 'analysis') {
        return `== GENRE OF THE ARC TO BE PLANNED ==
The author has set this genre for the arc that will be planned from your analysis:

${genre}

Read the story through this lens. Weigh each thread by how well it can serve this genre, and say so. Summaries, lorebook entries and recent chat can lean toward a register this genre does not want -- procedural, investigative or bleak material in a light or heroic story, for example. When they do, report it as an imbalance in the recorded material, not as the story's true direction.

`;
    }

    return `== GENRE (binding) ==
The author has set this arc's genre. It outranks the story analysis and the recorded material: where they lean another way, follow the genre.

${genre}

The genre sets the arc's register: the arc reads as this genre. It does not mean every item carries the genre's signature. Most pressures, secrets, triggers and clues serve the plot, the characters and the stakes in the genre's voice; the genre's signature moments come from a few of them. Never build the arc on one device (one kind of incident, gag, mishap or set piece) repeated across secrets, pressures, triggers and clues: used once, a device lands; used everywhere, it turns the arc into a single joke.

`;
}

/**
 * Render the player's themes as a prompt section for the outline (Phase 2)
 * only. They colour the arc and seed its `themes` field; the obligations
 * come from the direction and the premise, so a theme never becomes a world
 * fact or the reason for a pressure, secret or trigger (ADR-0004, amendment on the
 * themes). Empty, empty string, so the template keeps no dangling header.
 * @param {string} themeSeeds - The player's themes, '' for none
 * @returns {string}
 */
export function formatThemesBlock(themeSeeds) {
    if (!themeSeeds) return '';

    return `== THEMES (colour, not obligations) ==
These are the author's themes for this arc:

${themeSeeds}

They colour the arc: draw on them where the direction and the premise leave room. None of them is an obligation: none has to appear in the pressures, secrets, triggers or world facts. What the arc must deliver comes from the direction and the premise. A theme is never a world fact, and never the reason for a pressure, secret or trigger. The one place the themes seed is the arc's "themes" field: build its thematic statements from them, where the story supports them.

`;
}

/**
 * Render the author's answers from the wizard's Questions step as a prompt
 * section for the outline (Phase 2), right after the creative direction.
 * They are the author's own words about the arc and bind like the
 * direction: the intent that mattered (pressure through deniable hints,
 * nobody rescues) once only came out after planning. Empty, empty string,
 * so the template keeps no dangling header.
 * @param {{ question: string, answer: string }[]} authorAnswers - Answered pairs only
 * @returns {string}
 */
export function formatAuthorAnswersBlock(authorAnswers) {
    if (!authorAnswers?.length) return '';

    return `== AUTHOR'S ANSWERS (binding, like the direction) ==
${formatAnswerPairs(authorAnswers)}

These are the author's own words about this arc, and they bind like the direction: where an answer and the genre, the themes, your own preference or any default in these guidelines disagree, the answer wins.

`;
}

/**
 * Render the story's cast for the outline prompt (Phase 2): the knowledge
 * ledger's characters with their aliases, the taken names and two rules,
 * so the planner names existing characters as the ledger does and gives no
 * new character a name the story already uses (issue #44). The 'checklist'
 * section is the tail of the FINAL CHECKLIST line on existing characters'
 * names. An empty cast (tracker off) renders nothing in either section, so
 * the outline prompt stays as it was.
 * @param {{ name: string, aliases: string[], details?: Record<string, string> }[]} cast - The harvested cast
 * @param {'outline'|'checklist'} section
 * @returns {string}
 */
export function formatCastBlock(cast, section) {
    if (!cast?.length) return '';

    if (section === 'checklist') {
        return ', spelled as the CAST block lists them; no new character has a taken name as a first name or surname unless the plan makes them related and says so';
    }

    const castLines = formatCastLines(cast);
    const takenNames = printTakenNames({ characters: cast });

    return `== CAST (characters already in the story) ==
These characters are already in the story. Each line gives the name, then the aliases, then after a dash what the story has established about them:

${castLines.join('\n')}

Names already taken: ${takenNames.join(', ')}

Two rules for every name in the plan:
1. Name an existing character exactly as listed above, everywhere in the plan: secrets and their holders, pressures, fulfillments, triggers, foreshadowing, world facts and the characters list.
2. A new character gets none of the taken names as a first name or surname, unless the plan makes them related to the character who has it and says so.

`;
}

/**
 * One line per cast member, its aliases in brackets, then after a dash its
 * current details, each labelled by its kind ("— age: 18; role: senior at
 * Westbrook High"). The outline's cast block and the plan check's names
 * block list the cast the same way, so the planner keeps to the details
 * and the check can hold the plan to them.
 * @param {{ name: string, aliases: string[], details?: Record<string, string> }[]} cast
 * @returns {string[]}
 */
function formatCastLines(cast) {
    return cast.map(member => {
        const aliasNote = member.aliases.length ? ` (aliases: ${member.aliases.join(', ')})` : '';
        const detailNotes = Object.entries(member.details ?? {}).map(([kind, text]) => `${kind}: ${text}`);
        const detailNote = detailNotes.length ? ` — ${detailNotes.join('; ')}` : '';
        return `- ${member.name}${aliasNote}${detailNote}`;
    });
}

/**
 * Phase 2: Generate arc outline
 * @param {{ analysis: string, userDirection: string, existingArcs: object[], tier: string, reviseArc: object|null, genre: string, themeSeeds: string, authorAnswers: object[], cast: object[] }} input
 */
async function runPhase2(input, jsonEmphasis = false, callbacks = {}) {
    const template = await loadTemplate('generate-arc.txt');
    const directives = readActiveArcDirectives();
    if (directives.length) {
        console.log(`[Story Arc] Applying ${directives.length} directive(s) from the generation preset`);
    }

    const userDirection = input.userDirection || '(No specific direction provided — generate based on story context)';
    // The arc being re-planned is presented in the ARC SO FAR block; listing
    // it as a running arc too would tell the model not to cover its own ground.
    const otherRunningArcs = input.existingArcs.filter(arc => arc.id !== input.reviseArc?.id);
    const outlineVariables = {
        PHASE1_ANALYSIS: input.analysis,
        GENRE_BLOCK: formatGenreBlock(input.genre, 'outline'),
        AUTHOR_ANSWERS_BLOCK: formatAuthorAnswersBlock(input.authorAnswers),
        THEMES_BLOCK: formatThemesBlock(input.themeSeeds),
        CAST_BLOCK: formatCastBlock(input.cast, 'outline'),
        CAST_CHECKLIST: formatCastBlock(input.cast, 'checklist'),
        USER_DIRECTION: userDirection,
        TIER_BLOCK: buildTierBlock(input.tier),
        ARC_DIRECTIVES: formatArcDirectives(directives),
        ARC_SO_FAR: buildArcSoFar(input.reviseArc),
        EXISTING_ARCS: formatExistingArcs(otherRunningArcs),
    };
    let prompt = fillTemplate(template, outlineVariables);

    if (jsonEmphasis) {
        prompt += '\n\nCRITICAL: Your response must be ONLY a valid JSON object. No prose, no markdown, no explanation. Start with { and end with }.';
    }

    const outlineResponse = await callLlm(prompt, callbacks);
    return outlineResponse;
}

/**
 * Tier block for the generate-arc template.
 *
 * Fills {{TIER_BLOCK}} in prompts/generate-arc.txt with the chosen tier's
 * beat count, beat wording and length band (design spec §1). One template,
 * three blocks — the numbers come from TIER_TABLE so prompt and validator
 * cannot drift apart.
 * @param {'episode'|'act'|'saga'} tier - Unknown values fall back to episode
 * @returns {string} Prompt text ending in a newline
 */
export function buildTierBlock(tier) {
    const row = TIER_TABLE[tier] || TIER_TABLE.episode;
    const [minBeats, maxBeats] = row.beatCount;
    const [minLength, maxLength] = row.lengthBand;
    const lines = [`== TIER: ${row.label.toUpperCase()} ==`];

    if (row.beatKind === 'scene beat') {
        lines.push(
            `This arc is an EPISODE: one playable, resolvable unit of the story, such as a single mission or a single night — roughly ${minLength}-${maxLength} messages of play.`,
            `- Write ${minBeats}-${maxBeats} ordered SCENE BEATS. One is active at a time; the rest stay hidden from the narrating AI until reached.`,
            '- unlockAfter is allowed and welcome for real narrative prerequisites.',
            `- Set estimatedLength between ${minLength} and ${maxLength}.`,
        );
    } else {
        let tierPhrase;
        let scale;
        if (tier === 'saga') {
            tierPhrase = 'a SAGA';
            scale = 'the overarching storyline of this whole roleplay, such as bringing down the big bad';
        } else {
            tierPhrase = 'an ACT';
            scale = 'one leg of the larger story that colours the episodes played inside it without being pursued directly';
        }
        lines.push(
            `This arc is ${tierPhrase}: ${scale} — roughly ${minLength}-${maxLength} messages of play.`,
            `- Write ${minBeats}-${maxBeats} MILESTONES instead of scene beats, listed in the order the story should reach them. The arc is ONE plot thread, and its milestones are the steps of that thread.`,
            '- The narrating AI sees only the current milestone\'s pressure: the first one not yet fulfilled. So the first milestone is what presses from the first message on, and each later one presses only once the story has reached the one before it. A later milestone the story fulfils first still counts, and the earlier ones are then skipped as obsolete.',
            '- Order them so each one sets up the next: benefits before they can be taken away, a reveal after its clues.',
            '- One plot thread per arc: a second, independent thread belongs in a second arc, not in this arc\'s milestones.',
            '- A milestone\'s pressure is a standing force in the world that can persist for dozens of scenes without resolving.',
            '- A milestone\'s intention (fulfillment) names the on-screen moment at which the story shows it has reached a STATE; any scene may show it. Never a specific scene, place or encounter, never a tally of many scenes, never a chain of separate events. "The party has caught the guild lying about the harvest: a forged ledger, a clerk who slips, a granary found full", not "Voss is confronted at the granary."',
            '- Leave unlockAfter empty ([]) on every milestone. Their order is their only prerequisite.',
            '- revealPhase on a secret means which stretch of the whole arc it belongs to (its opening, its middle, its final quarter), not a scene.',
            `- Set estimatedLength between ${minLength} and ${maxLength}.`,
        );
    }

    // The generator passes the chosen tier to validation directly; the echo
    // in the JSON is the fallback for a build that does not.
    lines.push(`- Include "tier": "${row.label.toLowerCase()}" as a top-level field of the JSON.`);

    const tierBlock = lines.join('\n') + '\n';
    return tierBlock;
}

/**
 * Render the directives read from the generation preset as a prompt section.
 * Returns an empty string when nothing is enabled, so the template keeps no
 * dangling header.
 * @param {string[]} directives - Directive texts
 * @returns {string}
 */
export function formatArcDirectives(directives) {
    if (!directives?.length) return '';

    const lines = directives.map(directive => `- ${directive}`).join('\n');
    return `== STANDING CONSTRAINTS ==\nThese apply to every arc planned for this story. Honor them alongside the creative direction above.\n\n${lines}\n`;
}

/**
 * "Arc so far" block for re-planning.
 *
 * Fills {{ARC_SO_FAR}} in prompts/generate-arc.txt when an active arc is
 * being re-planned: the current premise with the instruction to write a
 * premise for the arc as it stands now (the proposal the player reviews in
 * step 3, ADR-0003), the player's rulings as binding when the arc has any,
 * the revealed secrets as established, the secrets not yet revealed for the
 * model to keep, rewrite or drop (ADR-0003), each with its holders, the
 * planted clues pointing at it and the fired triggers linked to it, which
 * it must go on explaining, escalation, the world facts in their order (a
 * re-plan's list replaces them, and an act or saga prints only the first
 * three, so the model keeps the ones still true and their rank), every
 * fulfilled beat's fulfillment text marked "already happened" (design spec §3)
 * and, when there are any, the skipped milestones' as "passed over".
 * @param {object|null} arc - The arc being re-planned, null when planning new
 * @returns {string} Prompt block, '' when planning new so that path stays byte-identical
 */
export function buildArcSoFar(arc) {
    if (!arc) return '';

    const revealedSecrets = arc.secrets.filter(secret => secret.disclosed);
    const revealed = revealedSecrets.length
        ? revealedSecrets.map(secret => `- ${secret.content}`).join('\n')
        : '(none)';
    const unrevealedSecrets = arc.secrets.filter(secret => !secret.disclosed);
    const unrevealed = unrevealedSecrets.length
        ? unrevealedSecrets.map(secret => formatUnrevealedSecret(arc, secret)).join('\n')
        : '(none)';
    const worldFactsSoFar = arcWorldFacts(arc).length
        ? arcWorldFacts(arc).map(fact => `- ${fact}`).join('\n')
        : '(none)';
    const fulfilled = arc.beats.filter(beat => beat.status === 'completed');
    const happened = fulfilled.length
        ? fulfilled.map(beat => `- ${beat.intention}`).join('\n')
        : '(nothing yet — the arc is being re-planned from its start)';
    // A skipped milestone did not happen, but the merge keeps it (isBeatOpen).
    const skipped = arc.beats.filter(beat => beat.status === 'skipped');
    const passedOverBlock = skipped.length
        ? `Passed over (the story moved past them; do not plan them again):\n${skipped.map(beat => `- ${beat.intention}`).join('\n')}\n\n`
        : '';

    const rulings = arc.rulings || [];
    const premiseInstruction = rulings.length
        ? 'Write a premise for the arc as it stands now that follows every one of the player\'s rulings below, keeping what the current premise says that no ruling touches and that is still true.'
        : 'Write a premise for the arc as it stands now, keeping what the current premise says that is still true.';
    const rulingsBlock = rulings.length
        ? `The player's rulings (binding: they override the premise and the earlier plan):\n${formatRulings(rulings)}\n\n`
        : '';

    return `== ARC SO FAR ==
You are RE-PLANNING an arc that is already running, not inventing a new one. The story has moved on from what its remaining beats assumed; plan the rest of it from where the story is now. The revealed secrets and what has already happened below are established and stay true. ${premiseInstruction} Your "secrets" output holds the secrets not yet revealed that you keep or rewrite, and any new ones; a secret you leave out is dropped. Never put a revealed secret in it. Do not repeat anything marked as already happened; your beats are what comes NEXT. The current premise and escalation are continuity, not a template: keep their facts, drop any staging or fixation in them that the story no longer carries, and write the new pressures fresh under the rules below rather than copying the old wording.

Current premise: ${arc.premise}

${rulingsBlock}Secrets already revealed (established, do not restate):
${revealed}

Secrets not yet revealed (re-plan them freely: keep, rewrite or drop each, keeping its id when you keep or rewrite it; a secret with planted clues or fired triggers listed under it must be kept or rewritten so it still explains them):
${unrevealed}

Escalation so far: ${arc.escalation || '(none recorded)'}

World facts so far, most important first (keep in your "worldFacts" each one that is still true in the story, in this order; reword or drop one the story has overtaken; put a new fact before a kept one only when it matters more):
${worldFactsSoFar}

Already happened (fulfilled beats — do not plan these again):
${happened}

${passedOverBlock}`;
}

/**
 * One secret not yet revealed, for the arc-so-far block: its id, which the
 * model keeps when it keeps or rewrites the secret, its content, and under
 * it its holders, the planted clues pointing at it and the fired triggers
 * linked to it: what of the secret has already entered the story.
 * @param {object} arc
 * @param {object} secret
 * @returns {string}
 */
function formatUnrevealedSecret(arc, secret) {
    const lines = [`- [${secret.id}] ${secret.content}`];
    if (secret.holders?.length) lines.push(`  Known to: ${secret.holders.join(', ')}`);
    for (const foreshadowing of plantedCluesOfSecret(arc, secret.id)) {
        lines.push(`  Planted clue: ${foreshadowing.clue}`);
    }
    const firedTriggers = arc.triggers.filter(trigger => trigger.fired && trigger.secret === secret.id);
    for (const trigger of firedTriggers) {
        lines.push(`  Fired trigger: IF ${trigger.condition} → ${trigger.action}`);
    }
    return lines.join('\n');
}

/**
 * Phase 3: check the plan for give-aways before anyone plays it.
 *
 * The generator's rules alone slipped: a re-plan wrote a trigger that stated
 * a climax secret and a payoff clause the narrator would play out at once
 * (Paragon chat, 2026-10-30). Fixing that by hand means the player reads the
 * secrets, so a second, narrow call does it: rewrite every trigger action or
 * pressure that gives a hidden secret away, mark the secrets the story has
 * already revealed (re-plan only, judged by the wording the re-planned arc's
 * secrets had before the re-plan), and tie triggers to the secret they touch.
 * The same call rewrites a fulfillment that is a tally of many scenes or a
 * chain of separate events into the one on-screen moment at which the
 * development shows: recognition judges a message or two at a time, and
 * a sum over scenes never shows in one (a tally stayed open for 439 messages
 * in the Paragon chat, 2026-11-04).
 * While the knowledge tracker is on, the same call also gets the story's
 * cast and renames a new character who got a taken name, or a cast member
 * spelled wrongly, everywhere in the plan (issue #49): the narrator reads
 * the plan on every message for a whole act, and the player never sees it
 * to fix a name.
 * A failed or unreadable check keeps the plan as generated — the user waited
 * minutes for it — except on a re-plan's secrets: without the check's
 * revealed list nothing tells which of them came out, so every earlier
 * secret is kept as stored (keepEarlierSecrets).
 * @param {object} arc - The validated (and on re-plan, merged) arc
 * @param {{ analysis: string, chatHistory: object[] }|null} story - Re-plan only
 * @param {object[]} earlierSecrets - The re-planned arc's secrets as stored before the re-plan ([] for a new arc)
 * @param {{ cast: object[], replanPremise: string, replanTitle: string }} names - The
 *   harvested cast, and on a re-plan the premise and title the wizard passed in ('' otherwise)
 * @param {GenerationCallbacks} [callbacks]
 * @param {string[]} [onScreenSecretIds=[]] - Earlier secrets the knowledge ledger saw come out
 * @returns {Promise<object>} The checked arc, or the arc unchanged
 */
async function runPlanCheck(arc, story, earlierSecrets, names, callbacks = {}, onScreenSecretIds = []) {
    const { onProgress = () => {} } = callbacks;
    onProgress('phase3', 'Checking the plan for give-aways...');
    try {
        const template = await loadTemplate('check-plan.txt');
        const prompt = fillTemplate(template, buildPlanCheckVariables(arc, story, names.cast, earlierSecrets));
        const response = await callLlm(prompt, callbacks);
        const parsed = parseLlmJson(response);
        if (!parsed) {
            console.warn('[Story Arc] Plan check answered no JSON; keeping the plan as generated');
            onProgress('retry', 'Plan check unreadable — keeping the plan as generated');
            return keepEarlierSecrets(arc, earlierSecrets);
        }
        return applyPlanCheck(arc, parsed, earlierSecrets, names, onScreenSecretIds);
    } catch (err) {
        console.warn('[Story Arc] Plan check failed; keeping the plan as generated:', err);
        onProgress('retry', `Plan check failed (${err.message}) — keeping the plan as generated`);
        return keepEarlierSecrets(arc, earlierSecrets);
    }
}

/** Messages of the story the plan check reads to judge what has come out. */
const PLAN_CHECK_RECENT_MESSAGES = 10;

/**
 * Template variables for check-plan.txt: every secret with its phase,
 * disclosure and planted clues, the unfired triggers, the pressures and fulfillments of the
 * open beats (isBeatOpen), and the world facts — the items the narrator will
 * see — each by id (a world fact by its index).
 * A completed or skipped beat's fulfillment is never passed: a re-plan keeps
 * it, and a completed one has already been recognised as written. A re-plan also gets the Phase 1
 * analysis and the last ten story messages, then the re-planned arc's
 * secrets as worded before the re-plan, by id, which step 1 judges: a
 * secret that came out but was never marked disclosed may have been
 * rewritten by the planner (ADR-0003). It also gets its proposed premise as the
 * premise, since the road was planned around it. The player's rulings and
 * the author's answers to the wizard's questions (`arc.authorAnswers`)
 * stand with premise and direction as public author input, so the check
 * leaves alone what carries them out and rewrites to the register they ask
 * for. With a cast (tracker on), the names block carries the cast with its
 * details, the taken names, the plan's own list of characters and the
 * renames task (formatPlanCheckNamesBlock); with an empty cast it is '',
 * and the prompt is as it was before the cast.
 * @param {object} arc
 * @param {{ analysis: string, chatHistory: object[] }|null} story
 * @param {{ name: string, aliases: string[], details?: Record<string, string> }[]} [cast=[]] - The harvested cast
 * @param {object[]} [earlierSecrets=[]] - The re-planned arc's secrets before the re-plan
 * @returns {Record<string, string>}
 */
export function buildPlanCheckVariables(arc, story, cast = [], earlierSecrets = []) {
    // On a re-plan the check judges disclosure from the story alone; an old
    // mark may belong to a message the user has since regenerated.
    // A secret rewrite must still explain the clues the player has seen.
    const secretLines = arc.secrets.map(secret => {
        const state = secret.disclosed && !story ? `${secret.revealPhase}, disclosed` : secret.revealPhase;
        const clueLines = plantedCluesOfSecret(arc, secret.id).map(foreshadowing => `\n  Planted clue: ${foreshadowing.clue}`);
        return `- [${secret.id}] (${state}) ${secret.content}${clueLines.join('')}`;
    });
    const triggerLines = arc.triggers
        .filter(trigger => !trigger.fired)
        .map(trigger => `- [${trigger.id}] IF ${trigger.condition} → ${trigger.action}`);
    const pressureLines = arc.beats
        .filter(beat => isBeatOpen(beat) && beat.pressure)
        .map(beat => `- [${beat.id}] ${beat.pressure}`);
    const fulfillmentLines = arc.beats
        .filter(beat => isBeatOpen(beat) && beat.intention)
        .map(beat => `- [${beat.id}] ${beat.intention}`);
    // A world fact has no id of its own; its index in the list is one.
    const worldFactLines = arcWorldFacts(arc).map((fact, index) => `- [${index}] ${fact}`);

    let storyBlock = '';
    if (story) {
        const recentMessages = story.chatHistory.slice(-PLAN_CHECK_RECENT_MESSAGES);
        const earlierSecretLines = earlierSecrets.map(secret => `- [${secret.id}] ${secret.content}`);
        storyBlock = `== STORY SO FAR ==\nAnalysis: ${story.analysis}\n\nMost recent messages:\n${formatChat(recentMessages)}\n\n`
            + '== SECRETS BEFORE THIS RE-PLAN ==\n'
            + 'The arc\'s secrets as they were worded while the story above was played. The plan below may have rewritten or dropped some of them; step 1 judges these.\n'
            + `${earlierSecretLines.join('\n') || '(none)'}\n\n`;
    }

    return {
        // A re-plan's road was planned around the proposed premise (ADR-0003).
        PREMISE: arc.proposedPremise || arc.premise || '(none)',
        DIRECTION: arc.direction || '(none)',
        RULINGS: arc.rulings?.length ? formatRulings(arc.rulings) : '(none)',
        AUTHOR_ANSWERS: formatAuthorAnswers(arc.authorAnswers) || '(none)',
        STORY_BLOCK: storyBlock,
        SECRETS: secretLines.join('\n') || '(none)',
        TRIGGERS: triggerLines.join('\n') || '(none)',
        PRESSURES: pressureLines.join('\n') || '(none)',
        FULFILLMENTS: fulfillmentLines.join('\n') || '(none)',
        WORLD_FACTS: worldFactLines.join('\n') || '(none)',
        NAMES_BLOCK: formatPlanCheckNamesBlock(cast, arc.characters),
    };
}

/**
 * The author's answers to the wizard's questions, one Q line and one A line
 * each. An arc planned before the questions has no list; an entry without
 * a question or an answer as text is left out.
 * @param {{ question: string, answer: string }[]|undefined} authorAnswers
 * @returns {string} The lines, or '' when there is none
 */
function formatAuthorAnswers(authorAnswers) {
    const answerLines = answeredAuthorAnswers(authorAnswers).map(pair => `- Q: ${pair.question}\n  A: ${pair.answer}`);
    return answerLines.join('\n');
}

/**
 * The planted clues that point at a secret. A foreshadowing entry's
 * `target` is free text; the outline prompt asks for "secret:<id>" (or
 * "beat:<id>"), and nothing else links a clue to a secret. So a clue points
 * at the secret when its target, trimmed and without a "secret:" prefix in
 * any case, starts with the secret's id: the leading token, up to the first
 * whitespace, "(", ",", ";" or "- ", so "secret:voss_betrayal (his deal)"
 * and "secret:voss_betrayal - the deal" both point at voss_betrayal. A
 * target in prose points at nothing, unless its first word is an id.
 * @param {object} arc
 * @param {string} secretId
 * @returns {object[]} Foreshadowing entries with `planted` set
 */
export function plantedCluesOfSecret(arc, secretId) {
    return (arc.foreshadowing ?? []).filter(foreshadowing => {
        if (!foreshadowing.planted) return false;
        const target = String(foreshadowing.target ?? '').trim().replace(/^secret:\s*/i, '');
        const leadingId = target.match(/^.*?(?=[\s(,;]|-\s|$)/)[0];
        return leadingId === secretId;
    });
}

/**
 * The plan check's names block: the cast with aliases and the taken names,
 * listed as the outline prompt's cast block lists them, the plan's own
 * `characters` field, and the renames task with its answer key, so the
 * fixed part of check-plan.txt does not change. The `characters` field is
 * not a reliable list of the plan's characters (the Street act listed a
 * street punk under another name than its secrets did), so the task asks
 * for every character the plan names.
 * @param {{ name: string, aliases: string[], details?: Record<string, string> }[]} cast
 * @param {string[]} [planCharacters] - The arc's `characters` field
 * @returns {string} The block, or '' for an empty cast
 */
function formatPlanCheckNamesBlock(cast, planCharacters) {
    if (!cast?.length) return '';

    const castLines = formatCastLines(cast);
    const takenNames = printTakenNames({ characters: cast });
    const planCharacterLines = (planCharacters ?? []).map(name => `- ${name}`);

    return `== NAMES ==
The cast, the characters already in the story. Each line gives the name, then the aliases, then after a dash what the story has established about them:

${castLines.join('\n')}

Names already taken: ${takenNames.join(', ')}

The plan's own list of characters. It can be incomplete: the secrets, triggers, pressures and fulfillments above name characters too.

${planCharacterLines.join('\n') || '(none)'}

RENAMES. For each character the plan names, decide whether it is a cast member or a new character.
- A cast member named differently from the cast (a changed surname, another spelling) is renamed to the cast's name.
- A new character whose first name or surname is a taken name, and whom the plan does not make related to the character who has it, is renamed to a full name that uses no taken name.
- A name that extends a cast name by one more name ("Julian Vance" for the cast's "Vance") may be that cast member. Leave it unless the plan makes clear it is someone else.
- Never rename a character the author's direction names.
- Give one pair for each form the plan uses for the character: the full name, and any short form that means that character alone in this plan.
Answer the renames as one more key of the JSON object below: "renames": [{ "from": "the name as the plan writes it", "to": "the new name" }]. An empty list is fine.

`;
}

/**
 * Apply the plan check's answer to a copy of the arc. Only what the check may
 * touch is changed: the action of an unfired trigger, the pressure and the
 * fulfillment (`intention`) of an open beat (isBeatOpen), the disclosure of a
 * secret the story can have revealed (one of `earlierSecrets`, set or
 * cleared to match the answer's revealed list), the content of a secret not
 * disclosed, and an empty secret link on a trigger. An earlier secret the
 * list names comes back as it was stored, disclosed, in place of whatever
 * the planner wrote under its id, or at the end when the plan dropped it:
 * what came out on screen is situation (ADR-0003). Its id stays, so the
 * planted clues, fired triggers and ledger facts that point at it point at
 * it again. A secret rewrite is judged after the revealed list, so
 * a secret that came out is never rewritten; any other rewrite replaces
 * `content` directly, on a re-plan too, since an unrevealed secret is road
 * (ADR-0003); one identical to the stored text is dropped. Unknown ids, empty
 * texts and lists of the wrong shape are ignored; a fulfillment rewrite that
 * is ignored is logged, since it leaves a beat that may never be recognised.
 * A world fact is rewritten or dropped by its index (applyWorldFactRewrites).
 * After the rewrites, the answer's renames are applied by applyPlanRenames.
 * The arc given is not mutated.
 * @param {object} arc
 * @param {{ revealed?: string[], rewrites?: object[], links?: object[], renames?: object[] }} answer - Parsed check output
 * An earlier secret in `onScreenSecretIds` counts as listed: the knowledge
 * ledger saw it come out, and its fact goes when that message does. A
 * re-plan's answer without a revealed list keeps every earlier secret as
 * stored (keepEarlierSecrets) and rewrites only the plan's new ones.
 * @param {object[]} earlierSecrets - The re-planned arc's secrets before the re-plan ([] for a new arc)
 * @param {{ cast?: object[], replanPremise?: string, replanTitle?: string }} [names={}] - The
 *   harvested cast, and on a re-plan the premise and title the wizard passed in
 * @param {string[]} [onScreenSecretIds=[]] - Earlier secrets the knowledge ledger saw come out
 * @returns {object}
 */
export function applyPlanCheck(arc, answer, earlierSecrets, names = {}, onScreenSecretIds = []) {
    const hasRevealedList = Array.isArray(answer.revealed);
    const rewrites = Array.isArray(answer.rewrites) ? answer.rewrites : [];
    const links = Array.isArray(answer.links) ? answer.links : [];

    const rewriteText = (kind, id) => {
        const rewrite = rewrites.find(candidate => candidate?.kind === kind && candidate.id === id);
        let text = String(rewrite?.text || '').trim();
        // The check once echoed whole trigger lines, condition included
        // (live run on the Paragon act, 2026-10-30); keep only the action.
        if (kind === 'trigger' && /^IF\b/.test(text) && text.includes('→')) {
            text = text.slice(text.lastIndexOf('→') + 1).trim();
        }
        return text || null;
    };

    // For the re-planned arc's own secrets the list decides both ways: the
    // user can delete or regenerate the message a secret came out in, and a
    // plan that kept the old mark went on stating it (Paragon, 2026-10-31).
    // The disclosure is settled first: a secret that came out is never
    // rewritten (ADR-0003).
    const earlierById = new Map(earlierSecrets.map(secret => [secret.id, secret]));
    let settledSecrets;
    if (!hasRevealedList && earlierSecrets.length) {
        settledSecrets = keepEarlierSecrets(arc, earlierSecrets).secrets;
    } else {
        const listedIds = hasRevealedList ? answer.revealed : [];
        const revealedIds = [...earlierById.keys()].filter(id => listedIds.includes(id) || onScreenSecretIds.includes(id));
        settledSecrets = arc.secrets.map(secret => {
            if (!hasRevealedList || !earlierById.has(secret.id)) return secret;
            if (revealedIds.includes(secret.id)) return { ...earlierById.get(secret.id), disclosed: true };
            return secret.disclosed ? { ...secret, disclosed: false } : secret;
        });
        for (const id of revealedIds) {
            if (!settledSecrets.some(secret => secret.id === id)) settledSecrets.push({ ...earlierById.get(id), disclosed: true });
        }
    }
    const secretIds = new Set(settledSecrets.map(secret => secret.id));
    const secrets = settledSecrets.map(secret => {
        // Without a revealed list an earlier secret may have come out unseen.
        if (secret.disclosed || (!hasRevealedList && earlierById.has(secret.id))) return secret;
        const content = rewriteText('secret', secret.id);
        if (!content || content === String(secret.content ?? '').trim()) return secret;
        return { ...secret, content };
    });

    const linkedSecret = (triggerId) => {
        const link = links.find(candidate => candidate?.trigger === triggerId);
        return secretIds.has(link?.secret) ? link.secret : null;
    };

    const triggers = arc.triggers.map(trigger => {
        if (trigger.fired) return trigger;
        const action = rewriteText('trigger', trigger.id) || trigger.action;
        const secret = secretIds.has(trigger.secret) ? trigger.secret : (linkedSecret(trigger.id) || trigger.secret);
        if (action === trigger.action && secret === trigger.secret) return trigger;
        return { ...trigger, action, secret };
    });

    // A fulfillment rewrite for a completed or skipped beat counts as
    // unknown: what was recognised stays as written, and a skipped one is kept.
    const openBeatIds = new Set(arc.beats.filter(isBeatOpen).map(beat => beat.id));
    for (const rewrite of rewrites) {
        if (rewrite?.kind !== 'fulfillment') continue;
        if (!openBeatIds.has(rewrite.id)) {
            console.warn(`[Story Arc] Plan check rewrote the fulfillment of unknown or closed beat "${rewrite.id}"; ignored`);
        } else if (!String(rewrite.text || '').trim()) {
            console.warn(`[Story Arc] Plan check answered an empty fulfillment for beat "${rewrite.id}"; ignored`);
        }
    }

    const beats = arc.beats.map(beat => {
        if (!isBeatOpen(beat)) return beat;
        const pressure = rewriteText('pressure', beat.id) || beat.pressure;
        const intention = rewriteText('fulfillment', beat.id) || beat.intention;
        if (pressure === beat.pressure && intention === beat.intention) return beat;
        return { ...beat, pressure, intention };
    });

    const rewrittenArc = { ...arc, secrets, triggers, beats };
    // An arc stored before world facts keeps having no list.
    if (Array.isArray(arc.worldFacts)) rewrittenArc.worldFacts = applyWorldFactRewrites(arcWorldFacts(arc), rewrites);
    return applyPlanRenames(rewrittenArc, answer.renames, names);
}

/**
 * The re-planned arc's secrets as stored, and after them the plan's new
 * ones: the add-only re-plan, for when the plan check cannot say which
 * earlier secret came out. A plan secret under an earlier id gives way to
 * the stored one. A fresh plan (no earlier secrets) is returned as it is.
 * @param {object} arc - The merged arc
 * @param {object[]} earlierSecrets - The re-planned arc's secrets before the re-plan
 * @returns {object}
 */
function keepEarlierSecrets(arc, earlierSecrets) {
    if (!earlierSecrets.length) return arc;
    console.warn('[Story Arc] Re-plan keeps every earlier secret as stored: the plan check gave no revealed list');
    const earlierIds = new Set(earlierSecrets.map(secret => secret.id));
    const newSecrets = arc.secrets.filter(secret => !earlierIds.has(secret.id));
    return { ...arc, secrets: [...earlierSecrets, ...newSecrets] };
}

/**
 * The ids of an arc's secrets that came out on screen while the knowledge
 * tracker ran: a ledger fact links to each by `{ arcId, secretId }`. The
 * extraction never sets `disclosed` (only the plan check and a hand toggle
 * do), so on a re-plan a secret counts as revealed when it is disclosed or
 * listed here.
 * @param {object} arc
 * @param {object} ledger - The chat's knowledge ledger
 * @returns {string[]}
 */
export function secretIdsRevealedOnScreen(arc, ledger) {
    const linkedSecretIds = new Set((ledger?.facts ?? [])
        .filter(fact => fact.secret?.arcId === arc.id)
        .map(fact => fact.secret.secretId));
    return arc.secrets.filter(secret => linkedSecretIds.has(secret.id)).map(secret => secret.id);
}

/**
 * A copy of the arc whose secrets named in `onScreenSecretIds` are marked
 * disclosed, so the arc-so-far block lists them as established, the merge
 * keeps them and the plan check never rewrites them. The arc given is not
 * mutated.
 * @param {object} arc
 * @param {string[]} onScreenSecretIds - From secretIdsRevealedOnScreen
 * @returns {object}
 */
export function markSecretsRevealedOnScreen(arc, onScreenSecretIds) {
    if (!onScreenSecretIds.length) return arc;
    const secrets = arc.secrets.map(secret =>
        onScreenSecretIds.includes(secret.id) && !secret.disclosed ? { ...secret, disclosed: true } : secret);
    return { ...arc, secrets };
}

/**
 * Apply the plan check's world-fact rewrites: a rewrite names a fact by its
 * index in the list as given to the check (`id`, a number or a numeric
 * string); a text replaces the fact, an empty text drops it — a fact that
 * only says how to narrate has no statement of fact to keep (ADR-0009).
 * An unknown index is ignored with a warning, and so is a rewrite without a
 * string text: only an explicit blank text drops a fact. Indexes refer to the
 * list before any drop, so dropping one fact never shifts another's rewrite.
 * @param {string[]} worldFacts
 * @param {object[]} rewrites - The check's rewrites, of every kind
 * @returns {string[]} A new list
 */
function applyWorldFactRewrites(worldFacts, rewrites) {
    const replacements = new Map();
    for (const rewrite of rewrites) {
        if (rewrite?.kind !== 'worldFact') continue;
        // The check sees the facts as "- [1] …" and may echo the brackets.
        const idText = String(rewrite.id ?? '').trim().replace(/^\[\s*(.*?)\s*\]$/, '$1');
        const index = Number(idText);
        if (idText === '' || !Number.isInteger(index) || index < 0 || index >= worldFacts.length) {
            console.warn(`[Story Arc] Plan check rewrote unknown world fact "${rewrite.id}"; ignored`);
            continue;
        }
        if (typeof rewrite.text !== 'string') {
            console.warn(`[Story Arc] Plan check rewrote world fact ${index} without a text; ignored`);
            continue;
        }
        replacements.set(index, rewrite.text.trim());
    }
    return worldFacts
        .map((fact, index) => (replacements.has(index) ? replacements.get(index) : fact))
        .filter(Boolean);
}

/**
 * Apply the plan check's renames to a copy of the arc (issue #49). A
 * character carries one name everywhere, so unlike the rewrites a rename
 * reaches every text field of the plan (see renamePlanTexts), secrets
 * included. The check judges which characters to rename; code guards what
 * it may rename, and drops a pair with a warning when:
 * - `from` is a cast name or alias: a cast member's correct name stays;
 * - `from` occurs in the direction, or on a re-plan in the premise the
 *   wizard passed in: those are the author's words;
 * - on a re-plan, `from` occurs in the title the wizard passed in: the
 *   title stays the player's alone (ADR-0003), so it is never renamed; a
 *   new plan's generated title may be;
 * - `from` occurs in a ruling's quote or in the option a bare pick chose
 *   (the arc's rulings, as the wizard passed them): the player's words;
 * - `from` occurs in an answer of the author's answers (`arc.authorAnswers`):
 *   the author's words about the arc; the question is the model's and
 *   protects nothing;
 * - `to` is not a cast name or alias and uses a taken name: the check
 *   cannot swap one collision for another;
 * - `from` contains a single-word cast record's name as a whole name and
 *   `to` is not that record's name: "Julian Vance" against the record
 *   "Vance" may be that character, so such a pair may only bring the name
 *   back to the cast's spelling (the Street act's "Julian Vance" was the
 *   record "Vance", 2026-11-04);
 * - `from` does not occur in the plan.
 * A missing or wrongly shaped list renames nothing; a malformed item is
 * ignored with a warning. Kept renames are logged as name pairs only,
 * never with the plan's text around them.
 * @param {object} arc - The arc after the rewrites, already a copy
 * @param {unknown} renames - The answer's `renames`
 * @param {{ cast?: object[], replanPremise?: string, replanTitle?: string }} names
 * @returns {object} The renamed arc, or the arc itself when nothing is renamed
 */
function applyPlanRenames(arc, renames, names) {
    if (!Array.isArray(renames) || renames.length === 0) return arc;

    const cast = names.cast ?? [];
    const castNames = new Set(cast.flatMap(member => [member.name, ...(member.aliases ?? [])]).map(foldName));
    const takenNames = listTakenNames({ characters: cast });
    const singleWordRecordNames = cast
        .map(member => member.name)
        .filter(name => nameWords(name).length === 1);
    const authorTexts = [arc.direction, names.replanPremise].filter(text => typeof text === 'string');
    const rulingTexts = (arc.rulings ?? [])
        .flatMap(ruling => [ruling.text, ruling.chose])
        .filter(text => typeof text === 'string');
    // The answer is the author's; the question was written by the model.
    const answerTexts = answeredAuthorAnswers(arc.authorAnswers).map(pair => pair.answer);
    const replanTitle = names.replanTitle || '';
    const planTexts = [];
    renamePlanTexts(arc, text => {
        planTexts.push(text);
        return text;
    });

    const keptRenames = new Map();
    for (const rename of renames) {
        const from = typeof rename?.from === 'string' ? rename.from.trim() : '';
        const to = typeof rename?.to === 'string' ? rename.to.trim() : '';
        if (!from || !to || from === to || keptRenames.has(from)) {
            console.warn('[Story Arc] Plan check answered a malformed rename; ignored:', JSON.stringify(rename));
            continue;
        }

        const ignoredBecause = (reason) => console.warn(`[Story Arc] Plan check rename "${from}" → "${to}" ignored: ${reason}`);
        if (castNames.has(foldName(from))) {
            ignoredBecause('it is a cast name or alias');
            continue;
        }
        if (authorTexts.some(text => containsWholeName(text, from))) {
            ignoredBecause('the author\'s direction or premise names it');
            continue;
        }
        if (containsWholeName(replanTitle, from)) {
            ignoredBecause('the player\'s title names it');
            continue;
        }
        if (rulingTexts.some(text => containsWholeName(text, from))) {
            ignoredBecause('a ruling of the player names it');
            continue;
        }
        if (answerTexts.some(text => containsWholeName(text, from))) {
            ignoredBecause('the author\'s answers name it');
            continue;
        }
        if (!castNames.has(foldName(to)) && usesTakenName(to, takenNames)) {
            ignoredBecause('the new name uses a taken name');
            continue;
        }
        const recordName = singleWordRecordNames.find(name => containsWholeName(from, name));
        if (recordName && to !== recordName) {
            ignoredBecause(`it may be the cast's "${recordName}"`);
            continue;
        }
        if (!planTexts.some(text => containsWholeName(text, from))) {
            ignoredBecause('the plan does not use it');
            continue;
        }
        keptRenames.set(from, to);
    }
    if (keptRenames.size === 0) return arc;

    const keptPairs = [...keptRenames].map(([from, to]) => `"${from}" → "${to}"`);
    console.log(`[Story Arc] Plan check renamed: ${keptPairs.join(', ')}`);

    // One pass over each text, the longest name first in the alternation, so
    // "Julian Hale" wins over "Hale" and no new name is renamed again.
    const longestFirst = [...keptRenames.keys()].sort((a, b) => b.length - a.length);
    const renamePattern = wholeNamePattern(longestFirst.map(escapeRegExp).join('|'));
    return renamePlanTexts(arc, text => text.replace(renamePattern, from => keptRenames.get(from)));
}

/**
 * Run `renameText` over every text field of the plan and return the copy:
 * the title, the premise (and a re-plan's proposed premise), themes, tone,
 * directives, anti-patterns, world facts, escalation and characters; each secret's
 * content and holders; each foreshadowing entry's clue and target; each
 * beat's pressure, fulfillment (`intention`) and flexibility, except
 * completed and skipped beats; each trigger's condition and action, except fired
 * triggers. The direction, the genre and the theme seeds are never passed. A field that is
 * not a string is left as it is.
 * @param {object} arc
 * @param {(text: string) => string} renameText
 * @returns {object}
 */
function renamePlanTexts(arc, renameText) {
    const renameField = (value) => (typeof value === 'string' ? renameText(value) : value);
    const renameList = (list) => (Array.isArray(list) ? list.map(renameField) : list);

    const renamedArc = { ...arc };
    for (const field of ['title', 'premise', 'proposedPremise', 'tone', 'escalation']) {
        if (field in arc) renamedArc[field] = renameField(arc[field]);
    }
    for (const field of ['themes', 'directives', 'antiPatterns', 'worldFacts', 'characters']) {
        if (field in arc) renamedArc[field] = renameList(arc[field]);
    }
    renamedArc.secrets = (arc.secrets ?? []).map(secret => ({
        ...secret,
        content: renameField(secret.content),
        holders: renameList(secret.holders),
    }));
    renamedArc.foreshadowing = (arc.foreshadowing ?? []).map(entry => ({
        ...entry,
        clue: renameField(entry.clue),
        target: renameField(entry.target),
    }));
    renamedArc.beats = (arc.beats ?? []).map(beat => {
        if (!isBeatOpen(beat)) return beat;
        return {
            ...beat,
            pressure: renameField(beat.pressure),
            intention: renameField(beat.intention),
            flexibility: renameField(beat.flexibility),
        };
    });
    renamedArc.triggers = (arc.triggers ?? []).map(trigger => {
        if (trigger.fired) return trigger;
        return { ...trigger, condition: renameField(trigger.condition), action: renameField(trigger.action) };
    });
    return renamedArc;
}

/**
 * A whole-name match of `namePattern`: case-sensitive, and not preceded or
 * followed by a letter, a digit, a hyphen or an apostrophe, so "Vance"
 * never matches inside "Vance-Chen", "Vancester" or "O'Vance". A possessive
 * "'s" or "’s" after the name still matches ("Vance's").
 * @param {string} namePattern - An escaped name, or an alternation of them
 * @returns {RegExp}
 */
function wholeNamePattern(namePattern) {
    const before = '(?<![\\p{L}\\p{N}\'’-])';
    const after = '(?![\\p{L}\\p{N}-])(?![\'’](?!s(?![\\p{L}\\p{N}]))[\\p{L}\\p{N}])';
    return new RegExp(`${before}(?:${namePattern})${after}`, 'gu');
}

/** Whether `text` holds `name` as a whole name (see wholeNamePattern). */
function containsWholeName(text, name) {
    return wholeNamePattern(escapeRegExp(name)).test(text);
}

/** Escape the characters a RegExp reads as syntax. */
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a name uses a taken name: any of its name words (see nameWords),
 * or any part of a hyphenated one, is a taken name.
 * @param {string} name
 * @param {Map<string, string>} takenNames - listTakenNames' map, keyed by the folded form
 * @returns {boolean}
 */
function usesTakenName(name, takenNames) {
    return nameWords(name).some(word => {
        const parts = [word, ...word.split('-')].filter(part => part !== '');
        return parts.some(part => takenNames.has(foldName(part)));
    });
}

/**
 * Call the LLM with automatic retries on transient failures (502, timeout, etc.)
 *
 * Sends the prompt as a system message (large context) with a short user
 * message trigger. This produces a natural message structure that API
 * proxies handle correctly, instead of a single massive user message.
 *
 * Routes through the configured Connection Manager profile when one is set
 * (response length comes from the profile's preset); otherwise falls back
 * to a direct backend call using the current chat API.
 *
 * The knowledge extraction (lib/knowledge/ledger.js) calls it too.
 *
 * @param {string} prompt - The full prompt text (sent as system message)
 * @param {GenerationCallbacks} [callbacks] - Progress callbacks
 * @param {number} [maxRetries=2] - Maximum retry attempts
 * @returns {Promise<string>}
 */
export async function callLlm(prompt, callbacks = {}, maxRetries = 2) {
    const { onProgress = () => {}, onChunk = () => {} } = callbacks;
    const estimatedTokens = Math.ceil(prompt.length / 4);
    console.log(`[Story Arc] Sending prompt: ${prompt.length} chars (~${estimatedTokens} tokens)`);

    const messages = [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Follow the instructions above and produce the requested output now.' },
    ];
    const profileId = getSettings().defaultConnectionProfile;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = profileId
                ? await callViaProfile(profileId, messages, onChunk)
                : await callBackendDirectly(messages, onChunk);
            console.log(`[Story Arc] Received response: ${response?.length || 0} chars`);
            return response;
        } catch (err) {
            // ConnectionManagerRequestService wraps errors; the detail is in err.cause
            const detail = `${err.message} ${err.cause?.message || ''}`;
            if (isRetryableError(detail) && attempt < maxRetries) {
                const retryDelayMilliseconds = 2000 * (attempt + 1);
                console.warn(`[Story Arc] LLM call failed (attempt ${attempt + 1}/${maxRetries + 1}): ${detail}. Retrying in ${retryDelayMilliseconds}ms...`);
                onProgress('retry', `Call failed (${err.message}) — retrying, attempt ${attempt + 2}/${maxRetries + 1}...`);
                await delay(retryDelayMilliseconds);
                continue;
            }
            throw err;
        }
    }
}

/**
 * Decide whether a failed LLM call is worth retrying.
 *
 * Transient infrastructure failures (bad gateway, timeouts) and empty responses
 * are retryable — the latter happens with reasoning models that emit only
 * reasoning deltas and no content. Auth, quota and model errors are not: they
 * fail the same way every time, so retrying only wastes the user's minutes.
 *
 * @param {string} detail - Error message plus wrapped cause message
 * @returns {boolean}
 */
export function isRetryableError(detail) {
    return /502|503|504|timeout|gateway|ETIMEDOUT|empty response/i.test(detail);
}

/**
 * Call the LLM through a Connection Manager profile. Streaming is forced on
 * (non-streaming requests time out on providers that generate the whole
 * response before sending). maxTokens is left undefined so the profile
 * preset's response length applies.
 * @param {string} profileId - Connection Manager profile id
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {(charsReceived: number) => void} [onChunk] - Streaming progress callback
 * @returns {Promise<string>}
 */
async function callViaProfile(profileId, messages, onChunk = () => {}) {
    const { ConnectionManagerRequestService } = await import('/scripts/extensions/shared.js');
    const streamFactory = await ConnectionManagerRequestService.sendRequest(
        profileId,
        messages,
        undefined,
        { stream: true },
    );

    let text = '';
    for await (const chunk of streamFactory()) {
        // Each chunk carries the whole text so far, so it replaces rather than
        // appends (unlike callBackendDirectly, whose events carry only deltas).
        text = chunk.text;
        const charsReceived = text?.length || 0;
        onChunk(charsReceived);
    }

    if (!text) {
        throw new Error('Empty response from API');
    }
    return text;
}

/**
 * Call ST's backend directly with a minimal request body, using the API the
 * chat is currently connected to. Fallback for when no Connection Manager
 * profile is configured. generateRaw adds many extra fields
 * (include_reasoning, reasoning_effort, type, etc.) that can cause issues
 * with some API providers, hence the hand-built request.
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {(charsReceived: number) => void} [onChunk] - Streaming progress callback
 * @returns {Promise<string>}
 */
async function callBackendDirectly(messages, onChunk = () => {}) {
    // Read current API settings from ST's openai module
    const { oai_settings, getChatCompletionModel, getStreamingReply } = await import('/scripts/openai.js');

    const model = getChatCompletionModel(oai_settings);
    const temperature = Number(oai_settings.temp_openai) || 0.7;
    const maxTokens = Number(oai_settings.openai_max_tokens) || 4096;

    const body = {
        messages,
        model: model,
        temperature,
        max_tokens: maxTokens,
        chat_completion_source: oai_settings.chat_completion_source,
        stream: true,
    };

    // Add custom URL if using custom/nanogpt source
    if (oai_settings.custom_url) {
        body.custom_url = oai_settings.custom_url;
    }

    const headers = getRequestHeaders();
    const requestBody = JSON.stringify(body);
    const res = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers,
        body: requestBody,
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const errorExcerpt = errText.substring(0, 200);
        throw new Error(`Got response status ${res.status}: ${errorExcerpt}`);
    }

    // ST's EventSourceStream buffers until an event is complete, so an event
    // split across two network chunks arrives whole.
    const { default: EventSourceStream } = await import('/scripts/sse-stream.js');
    const eventStream = new EventSourceStream();
    res.body.pipeThrough(eventStream);
    // Read the way ST's own custom-request.js does: a reader loop, not
    // for await, which not every browser supports on a ReadableStream.
    const reader = eventStream.readable.getReader();

    // Each event carries only the new delta, so the deltas are appended
    // (unlike callViaProfile, whose chunks carry the whole text so far).
    // The event shape depends on the source (OpenAI choices/delta, Google
    // candidates/parts, Claude delta.text): ST's getStreamingReply reads them
    // all, as custom-request.js does. Thoughts stay out of the text.
    const streamState = { reasoning: '', images: [], signature: '', toolSignatures: {} };
    let fullText = '';
    while (true) {
        const { done, value: event } = await reader.read();
        if (done || event.data === '[DONE]') break;

        const parsed = JSON.parse(event.data);
        if (parsed.error) {
            const errorMessage = parsed.error.message || JSON.stringify(parsed.error);
            throw new Error(`API error: ${errorMessage}`);
        }
        const replyDelta = getStreamingReply(parsed, streamState, {
            chatCompletionSource: body.chat_completion_source,
            overrideShowThoughts: false,
        });
        fullText += replyDelta;
        onChunk(fullText.length);
    }

    if (!fullText) {
        throw new Error('Empty response from API');
    }

    return fullText;
}
