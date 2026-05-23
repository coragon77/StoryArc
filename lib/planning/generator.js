/**
 * @file Multi-phase LLM generation for arc plans
 * @module planning/generator
 */

import { generateQuietPrompt, chat } from '/script.js';
import { loadTemplate, fillTemplate } from './templates.js';
import { parseLlmJson, validateArcPlan } from './validation.js';
import { getChatSettings } from '../core/settings.js';

/**
 * @typedef {object} GenerationCallbacks
 * @property {(phase: string, message: string) => void} onProgress
 * @property {() => boolean} isCancelled
 */

/**
 * Generate an arc plan using multi-phase LLM generation.
 * @param {import('../context/harvester.js').HarvestedContext} context - Harvested context
 * @param {string} userDirection - User's creative direction text
 * @param {GenerationCallbacks} [callbacks] - Progress callbacks
 * @returns {Promise<{ arc: object|null, error: string|null }>}
 */
export async function generateArc(context, userDirection, callbacks = {}) {
    const { onProgress = () => {}, isCancelled = () => false } = callbacks;

    try {
        // Phase 1: Analysis
        onProgress('phase1', 'Analyzing story context...');
        const analysis = await runPhase1(context);
        if (isCancelled()) return { arc: null, error: 'Cancelled' };

        // Phase 2: Arc Outline
        onProgress('phase2', 'Generating arc outline...');
        const arcJson = await runPhase2(analysis, userDirection, context.existingArcs);
        if (isCancelled()) return { arc: null, error: 'Cancelled' };

        // Phase 3: Detail Pass (optional — deferred to post-MVP)

        // Parse and validate
        const parsed = parseLlmJson(arcJson);
        if (!parsed) {
            // Retry once with emphasis on JSON
            onProgress('retry', 'Retrying with structured output...');
            const retryJson = await runPhase2(analysis, userDirection, context.existingArcs, true);
            const retryParsed = parseLlmJson(retryJson);
            if (!retryParsed) {
                return { arc: null, error: 'Failed to parse LLM output as JSON after retry' };
            }
            const retryResult = validateArcPlan(retryParsed);
            if (!retryResult.valid) {
                return { arc: null, error: `Validation failed: ${retryResult.errors.join(', ')}` };
            }
            retryResult.arc.messageStart = chat?.length || 0;
            return { arc: retryResult.arc, error: null };
        }

        const result = validateArcPlan(parsed);
        if (!result.valid) {
            return { arc: null, error: `Validation failed: ${result.errors.join(', ')}` };
        }

        result.arc.messageStart = chat?.length || 0;

        return { arc: result.arc, error: null };

    } catch (err) {
        console.error('[Story Arc] Generation failed:', err);
        return { arc: null, error: err.message };
    }
}

/**
 * Phase 1: Analyze story state
 */
async function runPhase1(context) {
    const template = await loadTemplate('analyze-context.txt');
    const prompt = fillTemplate(template, {
        CHARACTER_DESCRIPTION: formatCharacter(context.character),
        PERSONA: formatPersona(context.persona),
        LOREBOOK_CONSTANTS: formatEntries(context.lorebook.constants),
        LOREBOOK_HISTORY: formatEntries(context.lorebook.arcSummaries),
        LOREBOOK_RECENT: formatEntries(context.lorebook.recent),
        CHAT_HISTORY: formatChat(context.chatHistory),
        EXISTING_ARCS: formatExistingArcs(context.existingArcs),
    });

    return await callLlm(prompt);
}

/**
 * Phase 2: Generate arc outline
 */
async function runPhase2(analysis, userDirection, existingArcs, jsonEmphasis = false) {
    const template = await loadTemplate('generate-arc.txt');
    let prompt = fillTemplate(template, {
        PHASE1_ANALYSIS: analysis,
        USER_DIRECTION: userDirection || '(No specific direction provided — generate based on story context)',
        EXISTING_ARCS: formatExistingArcs(existingArcs),
    });

    if (jsonEmphasis) {
        prompt += '\n\nCRITICAL: Your response must be ONLY a valid JSON object. No prose, no markdown, no explanation. Start with { and end with }.';
    }

    return await callLlm(prompt);
}

/**
 * Call the LLM with automatic retries on transient failures (502, timeout, etc.)
 *
 * Uses generateRaw with quietToLoud=true so that streaming stays enabled.
 * Without this, ST sends non-streaming requests for "quiet" mode, which causes
 * timeouts on many API providers (they need to generate the full response before
 * sending anything back).
 *
 * @param {string} prompt - The prompt text
 * @param {number} [maxRetries=2] - Maximum retry attempts
 * @returns {Promise<string>}
 */
async function callLlm(prompt, maxRetries = 2) {
    // TODO: Add Connection Manager support when UI for profile selection is built
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await generateQuietPrompt({
                quietPrompt: prompt,
                quietToLoud: true,
                skipWIAN: true,
            });
            return response;
        } catch (err) {
            const isTransient = /502|503|504|timeout|gateway|ETIMEDOUT/i.test(err.message);
            if (isTransient && attempt < maxRetries) {
                const delay = 2000 * (attempt + 1);
                console.warn(`[Story Arc] LLM call failed (attempt ${attempt + 1}/${maxRetries + 1}): ${err.message}. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

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
    return entries.map(e => {
        const label = e.comment || '(unnamed)';
        const keywords = Array.isArray(e.key) ? e.key.join(', ') : '';
        return `[${label}]${keywords ? ` (keywords: ${keywords})` : ''}\n${e.content}`;
    }).join('\n\n---\n\n');
}

function formatChat(messages) {
    if (!messages.length) return '(No chat history)';
    return messages.map(m => `${m.name}: ${m.content}`).join('\n\n');
}

function formatExistingArcs(arcs) {
    if (!arcs || !arcs.length) return '(No existing arcs)';
    return arcs.map(a => `[${a.focus.toUpperCase()}] "${a.title}" — ${a.premise}`).join('\n');
}
