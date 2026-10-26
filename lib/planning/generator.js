/**
 * @file Multi-phase LLM generation for arc plans
 * @module planning/generator
 */

import { chat, getRequestHeaders } from '/script.js';
import { delay } from '/scripts/utils.js';
import { parseLlmJson, validateArcPlan } from './validation.js';
import { readActiveArcDirectives } from './arc-preset.js';
import { mergeReplan } from './replan.js';
import { getSettings } from '../core/settings.js';
import { TIER_TABLE } from '../core/constants.js';

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
 *   premise, direction and genre as edited in the wizard; null when planning new
 * @property {string} [genre=''] - The arc's genre as written in the wizard; binding
 *   in both phases, empty for none (ADR-0004)
 */

/**
 * Generate an arc plan using multi-phase LLM generation.
 * @param {import('../context/harvester.js').HarvestedContext} context - Harvested context
 * @param {string} userDirection - User's creative direction text
 * @param {GenerationCallbacks} [callbacks] - Progress callbacks
 * @param {GenerationOptions} [options]
 * @returns {Promise<{ arc: object|null, error: string|null }>}
 */
export async function generateArc(context, userDirection, callbacks = {}, options = {}) {
    const { onProgress = () => {}, isCancelled = () => false } = callbacks;
    const { tier = 'episode', reviseArc = null } = options;
    const genre = (options.genre || '').trim();

    try {
        // Phase 1: Analysis
        onProgress('phase1', 'Analyzing story context...');
        const analysis = await runPhase1(context, reviseArc?.id, genre, callbacks);
        if (isCancelled()) return { arc: null, error: 'Cancelled' };

        // Phase 2: Arc Outline
        const phase2 = { analysis, userDirection, existingArcs: context.existingArcs, tier, reviseArc, genre };
        onProgress('phase2', 'Generating arc outline...');
        const outlineResponse = await runPhase2(phase2, false, callbacks);
        let parsed = parseLlmJson(outlineResponse);
        if (isCancelled()) return { arc: null, error: 'Cancelled' };

        if (!parsed) {
            // Retry once with emphasis on JSON
            onProgress('retry', 'Retrying with structured output...');
            const retryResponse = await runPhase2(phase2, true, callbacks);
            parsed = parseLlmJson(retryResponse);
            if (!parsed) {
                return { arc: null, error: 'Failed to parse LLM output as JSON after retry' };
            }
        }

        const result = validateArcPlan(parsed, { tier });
        if (!result.valid) {
            const validationErrors = result.errors.join(', ');
            return { arc: null, error: `Validation failed: ${validationErrors}` };
        }

        result.arc.messageStart = chat?.length || 0;
        result.arc.lastFulfilledAt = result.arc.messageStart;
        result.arc.direction = userDirection;
        // From the wizard, never from the model: validateArcPlan drops an echoed one.
        if (genre) result.arc.genre = genre;

        // Re-plan: the generated plan is the new road; the situation stays.
        if (reviseArc) {
            const mergedArc = mergeReplan(reviseArc, result.arc);
            return { arc: mergedArc, error: null };
        }

        return { arc: result.arc, error: null };

    } catch (err) {
        console.error('[Story Arc] Generation failed:', err);
        return { arc: null, error: err.message };
    }
}

/**
 * Phase 1: Analyze story state
 * @param {string} [reviseArcId] - Arc marked [BEING RE-PLANNED] in the existing-arcs list
 * @param {string} genre - The arc's genre, '' for none
 */
async function runPhase1(context, reviseArcId, genre, callbacks) {
    const template = await loadTemplate('analyze-context.txt');
    const analysisVariables = {
        CHARACTER_DESCRIPTION: formatCharacter(context.character),
        PERSONA: formatPersona(context.persona),
        LOREBOOK_CONSTANTS: formatEntries(context.lorebook.constants),
        LOREBOOK_HISTORY: formatEntries(context.lorebook.arcSummaries),
        LOREBOOK_RECENT: formatEntries(context.lorebook.recent),
        CHAT_HISTORY: formatChat(context.chatHistory),
        EXISTING_ARCS: formatExistingArcs(context.existingArcs, reviseArcId),
        GENRE_BLOCK: formatGenreBlock(genre, 'analysis'),
    };
    const prompt = fillTemplate(template, analysisVariables);

    const analysis = await callLlm(prompt, callbacks);
    return analysis;
}

// Prompt template loading and placeholder substitution.
const PROMPTS_BASE_URL = new URL('../../prompts/', import.meta.url).href;

const templateCache = new Map();

const VALID_TEMPLATES = new Set([
    'analyze-context.txt',
    'generate-arc.txt',
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
 * One line per running arc for the prompt templates.
 * @param {object[]} arcs - Active arcs
 * @param {string} [reviseArcId] - Arc to mark [BEING RE-PLANNED] (analyze-context.txt explains the mark)
 * @returns {string}
 */
export function formatExistingArcs(arcs, reviseArcId) {
    if (!arcs || !arcs.length) return '(No existing arcs)';
    const arcLines = arcs.map(arc => {
        const mark = arc.id === reviseArcId ? ' [BEING RE-PLANNED]' : '';
        const focus = arc.focus.toUpperCase();
        return `[${focus}]${mark} "${arc.title}" — ${arc.premise}`;
    });
    return arcLines.join('\n');
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

Every pressure, secret, trigger, foreshadowing clue and directive, and the tone, must read as this genre. The arc must deliver what readers of this genre come for.

`;
}

/**
 * Phase 2: Generate arc outline
 * @param {{ analysis: string, userDirection: string, existingArcs: object[], tier: string, reviseArc: object|null, genre: string }} input
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
            `- Write ${minBeats}-${maxBeats} unordered MILESTONES instead of scene beats. All of them stand at once from the first message on; any may be fulfilled in any order, in any scene.`,
            '- A milestone\'s pressure is a standing force in the world that can persist for dozens of scenes without resolving.',
            '- A milestone\'s intention (fulfillment) names a STATE the story has reached, never a specific scene, place or encounter. "The party knows the guild has been lying about the harvest", not "Voss is confronted at the granary."',
            '- Leave unlockAfter empty ([]) on every milestone. Milestones have no prerequisites.',
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
 * being re-planned: premise, secrets, escalation and every fulfilled beat's
 * fulfillment text marked "already happened" (design spec §3).
 * @param {object|null} arc - The arc being re-planned, null when planning new
 * @returns {string} Prompt block, '' when planning new so that path stays byte-identical
 */
export function buildArcSoFar(arc) {
    if (!arc) return '';

    const secrets = arc.secrets.length
        ? arc.secrets.map(secret => `- ${secret.content}`).join('\n')
        : '(none)';
    const fulfilled = arc.beats.filter(beat => beat.status === 'completed');
    const happened = fulfilled.length
        ? fulfilled.map(beat => `- ${beat.intention}`).join('\n')
        : '(nothing yet — the arc is being re-planned from its start)';

    return `== ARC SO FAR ==
You are RE-PLANNING an arc that is already running, not inventing a new one. The story has moved on from what its remaining beats assumed; plan the rest of it from where the story is now. Everything below is established and stays true. Keep the premise as given. Do not restate the secrets listed here: your "secrets" output may only ADD new ones. Do not repeat anything marked as already happened; your beats are what comes NEXT.

Premise: ${arc.premise}

Secrets already established (do not restate, only add):
${secrets}

Escalation so far: ${arc.escalation || '(none recorded)'}

Already happened (fulfilled beats — do not plan these again):
${happened}

`;
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
 * @param {string} prompt - The full prompt text (sent as system message)
 * @param {GenerationCallbacks} [callbacks] - Progress callbacks
 * @param {number} [maxRetries=2] - Maximum retry attempts
 * @returns {Promise<string>}
 */
async function callLlm(prompt, callbacks = {}, maxRetries = 2) {
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
