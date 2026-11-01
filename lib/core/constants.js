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

/**
 * How a holder learned a fact (ADR-0007): saw or heard it on-screen, was
 * told by another character, was entered by the player, or was planned to
 * know it (a revealed secret's planned holders).
 */
export const HOLDER_HOW = {
    witnessed: 'witnessed',
    told: 'told',
    user: 'user',
    plan: 'plan',
};

/**
 * Default global settings of the knowledge tracker (ADR-0007), stored at
 * extension_settings.story_arc.knowledgeTracker. Off by default: with the
 * switch off Story Arc runs no extraction call, injects no knowledge block
 * and prints no secret holders.
 */
export const defaultKnowledgeTrackerSettings = {
    enabled: false,
    // Update the ledger every N AI replies; 1 is after every reply.
    updateInterval: 1,
};

/** Default global extension settings */
export const defaultSettings = {
    enabled: false,
    defaultConnectionProfile: null,
    knowledgeTracker: defaultKnowledgeTrackerSettings,
};

/** Default per-chat settings stored in chat_metadata.story_arc.settings */
export const defaultPerChatSettings = {
    injectionBudget: 3000,
    autoTrack: true,
};

/**
 * Extension prompt key of the knowledge block (ADR-0007): the "who knows
 * what" lines injected in-chat at depth 1. Reserved here so every knowledge
 * tracker ticket uses the same key; it stays empty while the tracker is off.
 */
export const KNOWLEDGE_PROMPT_KEY = 'story_arc_knowledge';

/**
 * An empty knowledge ledger, stored per chat at chat_metadata.story_arc.knowledge
 * (ADR-0007). The ledger stores only who knows; "does not know" is worked out
 * when the knowledge block is built and never stored.
 *
 * Shape:
 *
 *     characters: [{ id, name, aliases: [name] }]
 *     facts: [{
 *         id, text,
 *         public: bool,              // known to everyone (a broadcast, the news)
 *         secret?: { arcId, secretId },  // only on a fact a plan secret became when revealed on-screen
 *         holders: [{
 *             characterId,
 *             how: 'witnessed' | 'told' | 'user' | 'plan',   // HOLDER_HOW
 *             toldBy: characterId | null,   // who told them, for how 'told'
 *             at: messageIndex | null,      // message they learned it from;
 *                                           // null (entered by the user) survives every rollback
 *         }],
 *     }]
 *     scene: { at: messageIndex | null, present: [characterId] }  // from the last extraction
 *     sceneHistory: [{ at: messageIndex, present: [characterId] }]  // earlier scenes, oldest first, the
 *                                     // newest ten; a rollback goes back to the latest one before the
 *                                     // dropped message. Missing in ledgers from before it: read as empty.
 *     retractedFacts: [{ at: messageIndex, fact }]  // facts an out-of-character correction at message
 *                                     // `at` took back, whole; a rollback of that message brings them
 *                                     // back. Missing until the first retraction: read as empty.
 *     lastUpdatedAt: messageIndex | null  // last message the ledger covers; null before the first update
 *
 * @returns {object} A fresh ledger; no two calls share an array
 */
export function createEmptyKnowledgeLedger() {
    return {
        characters: [],
        facts: [],
        scene: { at: null, present: [] },
        sceneHistory: [],
        lastUpdatedAt: null,
    };
}

/** Default arc object (used when creating new arcs) */
export function createDefaultArc(overrides = {}) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    return {
        id,
        title: '',
        status: 'active',
        tier: 'episode',
        focus: 'normal',
        createdAt,
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
