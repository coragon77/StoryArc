/**
 * @file Core constants for Story Arc extension
 * @module core/constants
 */

export const MODULE_NAME = 'story_arc';

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

/** Default global extension settings */
export const defaultSettings = {
    enabled: false,
    defaultConnectionProfile: null,
    defaultInjectionBudget: 3000,
    defaultPacingStyle: 'moderate',
};

/** Default per-chat settings stored in chat_metadata.story_arc.settings */
export const defaultPerChatSettings = {
    connectionProfile: null,
    signalPrefix: '[ARC_SIGNAL',
    injectionBudget: 3000,
    autoTrack: true,
};

/** Default arc object (used when creating new arcs) */
export function createDefaultArc(overrides = {}) {
    return {
        id: crypto.randomUUID(),
        title: '',
        status: 'active',
        focus: 'foreground',
        createdAt: new Date().toISOString(),
        messageStart: 0,
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
        subArcs: [],
        ...overrides,
    };
}
