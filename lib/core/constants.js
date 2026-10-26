/**
 * @file Core constants for Story Arc extension
 * @module core/constants
 */

export const MODULE_NAME = 'story_arc';

/**
 * Header line of the IN_PROMPT arc block. Doubles as the marker that tells the
 * stamping pass "this outgoing prompt is the real chat prompt", so that other
 * extensions' generateRaw calls (which fire the same event) are left alone.
 */
export const INJECTION_HEADER = '[STORY ARC - NARRATIVE DIRECTION]';

/** Phases in order, with percentage ranges for pacing */
export const ARC_PHASES = {
    setup:       { min: 0,    max: 0.20, label: 'Setup' },
    development: { min: 0.20, max: 0.50, label: 'Development' },
    escalation:  { min: 0.50, max: 0.75, label: 'Escalation' },
    climax:      { min: 0.75, max: 0.90, label: 'Climax' },
    resolution:  { min: 0.90, max: 1.00, label: 'Resolution' },
};

/** Phase names in order for iteration */
export const PHASE_ORDER = ['setup', 'development', 'escalation', 'climax', 'resolution'];

/** Pacing directive text per phase */
export const PACING_DIRECTIVES = {
    setup: 'Plant seeds. Build atmosphere. No revelations. No confrontations.',
    development: 'Tensions grow. Complications deepen. Hints become patterns.',
    escalation: 'Stakes rise sharply. Confrontations can begin. Secrets start surfacing.',
    climax: 'Major beats resolve. Secrets revealed. Decisive moments.',
    resolution: 'Aftermath. Emotional processing. Seeds for the next arc.',
};

/**
 * Tier table — the size class of an arc and the shape of its beats. Filled in
 * from the 2026-09-16 design spec §1; the generator's tier block and the
 * validator's length clamp read from here.
 */
export const TIER_TABLE = {
    episode: { label: 'Episode', beatKind: 'scene beat', beatCount: [5, 8], lengthBand: [8, 20] },
    act:     { label: 'Act',     beatKind: 'milestone',  beatCount: [3, 5], lengthBand: [60, 150] },
    saga:    { label: 'Saga',    beatKind: 'milestone',  beatCount: [2, 4], lengthBand: [400, 1500] },
};

/** Focus values — how much attention an arc gets right now (ADR-0001) */
export const ARC_FOCUS = ['paused', 'background', 'normal', 'spotlight'];

/** Default global extension settings */
export const defaultSettings = {
    enabled: false,
    defaultConnectionProfile: null,
};

/** Default per-chat settings stored in chat_metadata.story_arc.settings */
export const defaultPerChatSettings = {
    injectionBudget: 3000,
    autoTrack: true,
};

/** Default arc object (used when creating new arcs) */
export function createDefaultArc(overrides = {}) {
    return {
        id: crypto.randomUUID(),
        title: '',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        createdAt: new Date().toISOString(),
        messageStart: 0,
        // Chat index of the last fulfillment; set to messageStart at planning.
        lastFulfilledAt: 0,
        // Chat length when the arc was paused; null while not paused.
        pausedAt: null,
        // The player's free-text guidance the arc was generated from.
        direction: '',
        premise: '',
        themes: [],
        tone: '',
        directives: [],
        antiPatterns: [],
        secrets: [],
        foreshadowing: [],
        beats: [],
        escalation: '',
        triggers: [],
        characters: [],
        estimatedLength: 40,
        ...overrides,
    };
}
