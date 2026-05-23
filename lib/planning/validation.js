/**
 * @file Arc plan validation — parse LLM output and validate schema
 * @module planning/validation
 */

import { createDefaultArc } from '../core/constants.js';

/**
 * Parse LLM output as JSON. Handles common LLM formatting issues:
 * - Strips markdown code fences
 * - Finds JSON object in mixed text
 * @param {string} text - Raw LLM output
 * @returns {object|null} Parsed object or null if unparseable
 */
export function parseLlmJson(text) {
    if (!text) return null;

    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

    try {
        return JSON.parse(cleaned);
    } catch {
        // Try to find a JSON object in the text
    }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
        return null;
    }
}

/**
 * Validate and normalize a parsed arc plan.
 * Required: title, premise, beats (at least one).
 * Missing optional fields get defaults from createDefaultArc.
 * @param {object} raw - Parsed JSON from LLM
 * @returns {{ valid: boolean, arc: object|null, errors: string[] }}
 */
export function validateArcPlan(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object') {
        return { valid: false, arc: null, errors: ['Not a valid object'] };
    }

    if (!raw.title) errors.push('Missing required field: title');
    if (!raw.premise) errors.push('Missing required field: premise');
    if (!raw.beats || !Array.isArray(raw.beats) || raw.beats.length === 0) {
        errors.push('Missing required field: beats (must be non-empty array)');
    }

    if (errors.length > 0) {
        return { valid: false, arc: null, errors };
    }

    const arc = createDefaultArc({
        title: raw.title,
        premise: raw.premise,
        themes: ensureArray(raw.themes),
        tone: raw.tone || '',
        directives: ensureArray(raw.directives),
        antiPatterns: ensureArray(raw.antiPatterns || raw.anti_patterns),
        secrets: ensureArray(raw.secrets).map(normalizeSecret),
        foreshadowing: ensureArray(raw.foreshadowing).map(normalizeForeshadowing),
        beats: ensureArray(raw.beats).map(normalizeBeat),
        escalation: raw.escalation || '',
        triggers: ensureArray(raw.triggers).map(normalizeTrigger),
        characters: ensureArray(raw.characters),
        estimatedLength: raw.estimatedLength || raw.estimated_length || 40,
    });

    return { valid: true, arc, errors: [] };
}

function ensureArray(val) {
    if (Array.isArray(val)) return val;
    if (val) return [val];
    return [];
}

function normalizeBeat(beat, index) {
    return {
        id: beat.id || `beat_${index + 1}`,
        intention: beat.intention || beat.description || '',
        flexibility: beat.flexibility || '',
        urgency: beat.urgency || 'when-ready',
        status: beat.status || (index === 0 ? 'active' : 'pending'),
        unlockAfter: ensureArray(beat.unlockAfter || beat.unlock_after),
        phase: beat.phase || 'development',
        optional: beat.optional || false,
    };
}

function normalizeSecret(secret, index) {
    return {
        id: secret.id || `secret_${index + 1}`,
        content: secret.content || (typeof secret === 'string' ? secret : ''),
        revealPhase: secret.revealPhase || secret.reveal_phase || 'any',
        disclosed: false,
    };
}

function normalizeForeshadowing(fs, index) {
    return {
        id: fs.id || `foreshadow_${index + 1}`,
        clue: fs.clue || '',
        target: fs.target || '',
        planted: false,
    };
}

function normalizeTrigger(trigger, index) {
    return {
        id: trigger.id || `trigger_${index + 1}`,
        condition: trigger.condition || '',
        action: trigger.action || '',
        fired: false,
    };
}
