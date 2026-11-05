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
 * The kinds of character details a cast member can carry (spec #50), in the
 * order the knowledge block and the extraction input print them. A relation's
 * value is `{ kind, of }`: a kinship word and the other cast member's id.
 */
export const DETAIL_KINDS = ['gender', 'age', 'role', 'relation', 'status'];

/** The values a character's status detail takes. */
export const DETAIL_STATUS_VALUES = ['alive', 'dead'];

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
    // Character details on top of the tracker; off by default, like the tracker.
    characterDetails: false,
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
 * Extension prompt key of the taken-names block (ADR-0007, amended): every
 * name the ledger's characters already use, in-chat at depth 1. ST joins the
 * prompts of one depth and role in the sorted order of their keys, so it
 * lands right after the knowledge block; it stays empty while the tracker
 * is off.
 */
export const NAMES_PROMPT_KEY = 'story_arc_names';

/**
 * An empty knowledge ledger, stored per chat at chat_metadata.story_arc.knowledge
 * (ADR-0007). The ledger stores only who knows; who else shares a fact is
 * worked out when the knowledge block is built.
 *
 * Shape:
 *
 *     characters: [{
 *         id, name, aliases: [name],    // name '' for an unnamed relative: then details.relation gives
 *                                       // its display name ("Kendra Osei's mother", characterDisplayName);
 *                                       // the relation the extraction created it with is a record entry
 *         nameClash?: {                 // only on a character the extraction added with a name
 *             names: [name],            // another character already had: the shared names, spelled
 *             at: messageIndex,         // as the taken-names block prints them; the last message the
 *             messageId?,               // answer covered and its Story Arc message id. Saving the
 *         },                            // character in the Knowledge popup removes it; never rolled back
 *         details?: {                   // character details (DETAIL_KINDS). An absent kind is unknown;
 *             gender?: [entry],         // older records have no details at all. Each kind is a
 *             age?: [entry],            // history, oldest first; the current value is the last
 *             role?: [entry],           // entry. entry: { value, at: messageIndex, messageId? },
 *             relation?: [entry],       // written by the extraction. value: short text as the story
 *             status?: [entry],         // states it; for relation { kind: kinship word, of: characterId };
 *         },                            // for status 'alive' | 'dead' (DETAIL_STATUS_VALUES). An entry
 *                                       // rolls back like a holder entry (same at / messageId rules);
 *                                       // a kind with no entry left is unknown again.
 *                                       // Three entry shapes: a story entry { value, at, messageId? }
 *                                       // from the extraction rolls back with its message; a record
 *                                       // entry { value, at: null, by: 'record' }, only the relation
 *                                       // an unnamed relative was created with, survives every rollback
 *                                       // and locks nothing; a player entry { value, at: null, by: 'user' }
 *                                       // from the Knowledge popup, last in its history, survives every
 *                                       // rollback and locks the kind against the extraction
 *     }]
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
 *             messageId?,                   // that message's Story Arc message id (extra.story_arc_message_id),
 *                                           // so a deletion before it moves the entry instead of
 *                                           // dropping it; missing on entries from before the message ids
 *         }],
 *     }]
 *     scene: { at: messageIndex | null, messageId?, present: [characterId] }  // from the last extraction
 *     sceneHistory: [{ at: messageIndex, messageId?, present: [characterId] }]  // earlier scenes, oldest
 *                                     // first, the newest ten; a rollback goes back to the latest one before
 *                                     // the dropped message. Missing in ledgers from before it: read as empty.
 *     retractedFacts: [{ at: messageIndex, messageId?, fact }]  // facts an out-of-character correction at message
 *                                     // `at` took back, whole; a rollback of that message brings them
 *                                     // back. Missing until the first retraction: read as empty.
 *     lastUpdatedAt: messageIndex | null  // last message the ledger covers; null before the first update
 *     lastUpdatedMessageId?              // that message's Story Arc message id
 *     updateLog: [record]   // what happened to the ledger, the newest KNOWLEDGE_UPDATE_LOG_CAP (20)
 *                           // records, oldest first; nothing reads it, it is there for whoever opens
 *                           // the chat file. Missing until the first record: read as empty. Records:
 *         { kind: 'update' | 'reextract', from, to,   // the messages the call read
 *           messageId: id | null,                       // Story Arc message id of message `to`
 *           answer: { present, newCharacters, learned, retracted, revealedSecrets, fulfilled },  // list lengths
 *           factsCreated: [factId], holdersAdded: n, factsRetracted: [factId],   // what the apply did
 *           beatsCompleted: n,        // counts only, never beat ids or texts: the plan is spoiler-protected
 *           detailsSet: n, detailsChanged: n, restatementsIgnored: n,   // character details, counts only;
 *           detailsLocked: n }        // detailsLocked: items skipped because the player locked the kind
 *         { kind: 'skipped', from, to, reason: 'no answer' | 'chat changed' | 'ledger moved' }
 *         { kind: 'rollback', from: firstGoneIndex, factsDropped: [factId], holdersDropped: n,
 *           factsRestored: [factId], detailsDropped: n }   // only when the rollback changed something
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
