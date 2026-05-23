# StoryArc Design Specification

**Date:** 2026-05-23
**Status:** Draft (spec-reviewed, pending user approval)

**Note:** The module structure in this spec (5 modules: core, context, planning, injection, ui) supersedes the 4-module structure in CLAUDE.md. CLAUDE.md should be updated to match before implementation begins.

## 1. Overview

StoryArc is a SillyTavern extension that acts as an automated dungeon master for long-running roleplay stories. It harvests context from the active chat (character cards, personas, lorebooks, chat history), lets the user provide creative direction, and uses a planning LLM to generate detailed narrative outlines. These outlines are injected into the chat LLM's prompt, giving it something it never normally has: knowledge of where the story is going.

The user experiences the story as a player, not a planner. Plans are hidden by default behind spoiler toggles. Mysteries have real answers. Foreshadowing is deliberate. The AI sustains tension instead of rushing to resolution.

### 1.1 Core Problem

LLMs improvise moment-to-moment. When they introduce a mystery, they don't know the answer. When they create tension, they resolve it immediately. Long-running stories (1000+ messages) become flat, repetitive, and aimless -- "AI slop." Even experienced human co-authors run out of ideas after extended sessions.

### 1.2 Solution

A separate planning LLM generates a novelist-quality outline with secrets, foreshadowing, flexible beats, and pacing controls. This outline is injected into the chat LLM's system prompt, creating narrative depth that pure improvisation cannot achieve.

## 2. Data Model

### 2.1 Arc Schema

An arc is the fundamental unit. Arcs can contain sub-arcs (same schema, nested). Multiple independent arcs run simultaneously.

```javascript
{
  // Identity
  id: string,                     // UUID
  title: string,                  // "The Valdris Gambit"
  status: "active" | "completed" | "abandoned",
  focus: "foreground" | "background",
  createdAt: string,              // ISO timestamp
  messageStart: number,           // Chat message index when arc was activated

  // Narrative identity
  premise: string,                // What this arc is about
  themes: string[],               // ["autonomy", "institutional power"]
  tone: string,                   // "Tension building from polite menace to open coercion"

  // Directives (what IS / what is NOT)
  directives: string[],           // Positive instructions for the AI
  antiPatterns: string[],         // Things the AI must NOT do

  // Secrets (hidden from user by default, known to AI)
  secrets: [
    {
      id: string,
      content: string,            // The secret itself
      revealPhase: "setup" | "development" | "escalation" | "climax" | "any",
      disclosed: boolean          // Whether this secret has been revealed in-story
    }
  ],

  // Foreshadowing
  foreshadowing: [
    {
      id: string,
      clue: string,              // What to plant
      target: string,            // What it foreshadows
      planted: boolean           // Whether it has appeared in-story
    }
  ],

  // Narrative beats (flexible, not strictly sequential)
  beats: [
    {
      id: string,
      intention: string,         // What should happen, narratively
      flexibility: string,       // How much latitude the AI has
      urgency: "soon" | "when-ready" | "climactic",
      status: "locked" | "pending" | "active" | "completed",
      unlockAfter: string[],     // Beat IDs that must complete first
      phase: "setup" | "development" | "escalation" | "climax" | "resolution",
      optional: boolean             // If true, not required for arc completion
    }
  ],

  // Escalation pattern
  escalation: string,            // Prose description of how tension builds

  // Triggers (opportunistic, fire when conditions are met)
  triggers: [
    {
      id: string,
      condition: string,         // Narrative condition (evaluated by chat LLM, not programmatically)
      action: string,            // What should happen
      fired: boolean             // Cross-arc triggers work implicitly: the chat LLM sees triggers from all active arcs in the injection
    }
  ],

  // Characters involved
  characters: string[],          // Named characters central to this arc

  // Pacing
  estimatedLength: number,       // Estimated messages for this arc (default: 40)

  // Sub-arcs (reserved for future use -- not in initial implementation)
  subArcs: []                    // Same schema, nested. Depth limit: 1 level.
}
```

### 2.2 Storage

All arc data is stored in `chat_metadata` (per-chat, persists with chat file):

```javascript
chat_metadata.story_arc = {
  version: 1,
  arcs: [],                      // Array of arc objects
  settings: {
    connectionProfile: null,     // Connection Manager profile ID (optional)
    signalPrefix: "[ARC_SIGNAL", // Signal pattern for beat detection
    injectionBudget: 3000,       // Max tokens for prompt injection (increase for large context windows)
    autoTrack: true              // Enable signal-based progress tracking
  }
}
```

Global settings (shared across chats) in `extension_settings.story_arc`:

```javascript
{
  enabled: false,
  defaultConnectionProfile: null,
  defaultInjectionBudget: 3000,
  defaultPacingStyle: "moderate"  // "relaxed" | "moderate" | "tight"
}
```

## 3. Context Harvesting

When the user initiates arc planning, the extension gathers all available context from the active chat.

### 3.1 Sources

| Source | Import / API | Data Extracted |
|--------|-------------|----------------|
| Character card | `characters[this_chid]` from `/script.js` | name, description, personality, scenario |
| Persona | `power_user` from `/scripts/power-user.js`, `getContext().name1` | user persona name, description |
| Lorebooks | `world_info` from `/scripts/world-info.js` or `getContext().worldInfo`, with HTTP API fallback (`POST /api/worldinfo/list`, `/api/worldinfo/get`) for full multi-book access | All enabled entries from all connected books (character-bound, global, chat-bound) |
| Chat history | `chat` from `/script.js` | Recent N messages (configurable, default 50) |
| Existing arcs | `chat_metadata.story_arc` | Currently active arc plans |
| User input | Wizard text area | Free-form creative direction |

### 3.2 Processing Pipeline

1. Fetch all sources in parallel
2. Filter lorebook entries: drop `disable: true`, sort by `order`
3. Categorize lorebook entries heuristically:
   - **Constants** (`constant: true`) -- world rules, game systems, character data
   - **Arc summaries** (comment matches `[ARC ...]` pattern) -- compressed past story
   - **Recent memories** (everything else enabled) -- current events
4. Truncate chat history to fit token budget
5. Assemble a structured context document for the planning LLM
6. Present a summary to the user for review

### 3.3 Context Review UI

The user sees a summary before generation:
- Character and persona names
- Lorebook entry count by category (constants, arc summaries, recent)
- Chat message count
- Estimated token count
- Expandable sections to inspect and include/exclude individual entries

### 3.4 Token Budget

The harvested context + planning prompt must fit the planning LLM's context window. The extension estimates token count (chars / 4 as rough heuristic) and warns if the context is too large. The user can exclude entries or reduce chat history depth to fit.

## 4. Plan Generation

### 4.1 Multi-Phase Generation

The planning LLM generates the arc in 2-3 phases. Each phase uses a prompt template from the `prompts/` directory.

**Phase 1 -- Analysis:**
- Input: All harvested context
- Output: Summary of current story state, active narrative threads, character dynamics, unresolved tensions, world state
- Purpose: Forces the LLM to understand before it creates

**Phase 2 -- Arc Outline:**
- Input: Phase 1 analysis + user's creative direction
- Output: Complete arc plan (premise, themes, secrets, foreshadowing, beats, escalation, directives, anti-patterns)
- Purpose: The creative work -- inventing the actual story

**Phase 3 -- Detail Pass (optional):**
- Input: Phase 2 outline
- Output: Expanded beats with more specificity, additional foreshadowing, sub-arc sketches, refined pacing
- Purpose: Adds depth for complex arcs

### 4.2 LLM Communication

Default: `generateRaw()` from `/script.js` (uses the chat's current API connection).

Optional: `ConnectionManagerRequestService.sendRequest()` from `/scripts/extensions/shared.js` (uses a dedicated API profile configured by the user). This allows using a stronger model for planning (e.g., Opus for planning, Sonnet for chat).

```javascript
// Default path -- uses the chat's active API connection
// Arguments: prompt, api ('' = current), instructOverride, quietToLogs, abortSignal
const response = await generateRaw(prompt, '', false, false, abortController.signal);

// Connection Manager path (if profile configured)
const result = await ConnectionManagerRequestService.sendRequest(
    profileId, messages, maxTokens,
    { stream: false, extractData: true }
);
```

Note: The exact `generateRaw` signature should be verified against the current ST source at implementation time, as it may vary between ST versions.

### 4.3 Prompt Templates

Templates are `.txt` files in `prompts/` with placeholder substitution:

- `analyze-context.txt` -- Phase 1 analysis prompt
- `generate-arc.txt` -- Phase 2 arc generation prompt
- `detail-pass.txt` -- Phase 3 detail expansion prompt
- `build-injection.txt` -- Template for runtime prompt injection

Templates are loaded at runtime via `fetch()` relative to the extension's base URL (e.g., `fetch('/scripts/extensions/third-party/StoryArc/prompts/analyze-context.txt')`). The extension base path can be derived from `import.meta.url` or constructed from the known extension name.

Placeholders use `{{VARIABLE_NAME}}` syntax:
- `{{CHARACTER_DESCRIPTION}}` -- current character card
- `{{PERSONA}}` -- user's persona
- `{{LOREBOOK_CONSTANTS}}` -- constant lorebook entries
- `{{LOREBOOK_HISTORY}}` -- arc summaries
- `{{LOREBOOK_RECENT}}` -- recent memories
- `{{CHAT_HISTORY}}` -- recent chat messages
- `{{USER_DIRECTION}}` -- user's creative input
- `{{EXISTING_ARCS}}` -- summaries of currently active arcs
- `{{PHASE1_ANALYSIS}}` -- output from Phase 1 (used in Phase 2)
- `{{PHASE2_OUTLINE}}` -- output from Phase 2 (used in Phase 3)

### 4.4 Output Validation

The LLM's output is parsed as JSON and validated against the arc schema. Required fields: `title`, `premise`, `beats` (at least one). Missing optional fields get defaults. If JSON parsing fails, the extension retries once with a simpler prompt that emphasizes JSON formatting.

## 5. Prompt Injection

### 5.1 Injection Trigger

On every `GENERATION_STARTED` event, the extension rebuilds the injection prompt from all active arcs and calls `setExtensionPrompt()`.

```javascript
setExtensionPrompt(
    'story_arc_plan',
    injectionText,
    extension_prompt_types.IN_PROMPT,
    0,
    0,
    false,
    extension_prompt_roles.SYSTEM
);
```

### 5.2 Injection Structure

The injection is built in layers:

```
[STORY ARC - NARRATIVE DIRECTION]

=== FOREGROUNDED: "{arc title}" ===
[Phase: {phase} | Messages into arc: {count} | Pacing: {pacing}]

PREMISE: {premise}

TONE: {tone}

CURRENT BEATS:
{only beats with status "active" or urgency "soon" that are unlocked}

SECRETS:
{secrets appropriate for current phase, with "guard carefully" instruction}

FORESHADOWING TO PLANT:
{unplanted foreshadowing entries}

TRIGGERS:
{unfired triggers with conditions}

PACING RULES:
- You are in {PHASE}. {phase-specific pacing instruction}
- Do not advance to the next phase for at least {N} more messages.
- If tempted to resolve something, add a complication instead.

DO NOT:
{antiPatterns}

=== BACKGROUNDED: "{arc title}" ===
{One-line summary. "Keep this present as distant tension. Do not advance."}

[END STORY ARC]
```

### 5.3 Beat Gating

Beats have a `status` field that controls visibility in the injection:

- `"locked"` -- not visible to the AI at all. Unlocks when `unlockAfter` beats complete.
- `"pending"` -- visible but marked as "not yet, coming later"
- `"active"` -- fully described, the AI should work toward this
- `"completed"` -- mentioned as accomplished, no longer a goal

Only `"active"` and `"pending"` beats appear in the injection. `"locked"` beats are completely hidden -- the AI cannot rush toward something it doesn't know about.

### 5.4 Progressive Secret Disclosure

Secrets have a `revealPhase` field. During earlier phases, only early-phase secrets appear in the injection. Later secrets are withheld entirely until the arc reaches the appropriate phase. This prevents the AI from dropping hints about late-game twists during setup.

### 5.5 Pacing Controls

The injection includes explicit pacing directives that change with arc phase:

| Phase | Message Range | Pacing Directive |
|-------|--------------|------------------|
| Setup | 0-20% | Plant seeds. Build atmosphere. No revelations. No confrontations. |
| Development | 20-50% | Tensions grow. Complications deepen. Hints become patterns. |
| Escalation | 50-75% | Stakes rise sharply. Confrontations can begin. Secrets start surfacing. |
| Climax | 75-90% | Major beats resolve. Secrets revealed. Decisive moments. |
| Resolution | 90-100% | Aftermath. Emotional processing. Seeds for the next arc. |

Phase is primarily determined by **beat completion ratio** (completed beats / total non-optional beats). Message count since `messageStart` acts as a floor: the arc cannot advance past a phase until both the beat ratio AND the minimum message count are met. This prevents the AI from rushing through beats while also preventing arcs from stalling if beats aren't signaled.

**Phase calculation:**
```
beatRatio = completedBeats / totalNonOptionalBeats
messageRatio = (currentMessage - messageStart) / estimatedLength

phase = min(phaseFromBeats(beatRatio), phaseFromMessages(messageRatio))
```

Where `phaseFromBeats` and `phaseFromMessages` both use the percentage ranges above. Taking the minimum means both conditions must be met to advance.

### 5.6 Token Management

The total injection is rebuilt each message. If it exceeds the configured `injectionBudget`:
1. Background arcs are condensed to single-line summaries
2. Completed beats are removed
3. Planted foreshadowing entries are removed
4. If still over budget, the oldest foreground arc's detail is trimmed

## 6. Progress Tracking

### 6.1 Signal-in-Prompt Detection

The prompt injection includes a signal directive:

```
When a narrative beat has been meaningfully fulfilled, append this
signal at the very end of your message, after all story content:
[ARC_SIGNAL:{arc_id}:{beat_id}:COMPLETE]

Only signal when the beat's INTENTION has been met, not when something
vaguely similar happens. If uncertain, do not signal.

Note: Beat IDs in signals should be short, human-readable identifiers (e.g., `valdris_dinner`, `first_clue`) rather than UUIDs to improve LLM signal accuracy. The arc's internal UUID remains the canonical identifier; the beat's `id` field used in signals should be a short slug generated during planning.
```

### 6.2 Signal Processing

On every `MESSAGE_RECEIVED` event:

1. Parse the AI's response for `[ARC_SIGNAL:...]` patterns
2. Strip signals from the displayed message (user never sees them)
3. Validate: does the arc and beat exist? Is the beat currently active?
4. If valid: update beat status to `"completed"` in `chat_metadata`
5. Check if completed beat unlocks any `"locked"` beats (via `unlockAfter`)
6. Rebuild prompt injection with newly unlocked beats
7. Update UI progress indicators
8. Save metadata

### 6.3 Manual Override

The user can always manually mark beats as complete or incomplete via the arc manager (behind spoiler toggles). This handles:
- False positives (AI signaled prematurely)
- Missed signals (AI forgot to signal)
- User wanting to skip or revisit beats

### 6.4 Phase Transitions

Phase is calculated using the algorithm defined in Section 5.5: beat completion ratio as the primary driver, message count as a floor. When the phase changes, the injection automatically updates pacing language.

### 6.5 Arc Completion

An arc is complete when all non-optional beats are completed, or the user manually marks it complete. On completion:
- Status changes to `"completed"`
- Prompt injection removes the arc
- UI shows the arc as finished
- The user can immediately plan the next arc

## 7. User Interface

### 7.1 Settings Panel (Extension Drawer)

Located in SillyTavern's extension settings drawer. Contains:

- Enable/disable toggle
- Connection Manager profile selector (optional, for planning LLM)
- Default token budget slider for prompt injection
- "Plan Next Arc" button (opens wizard)
- "Manage Arcs" button (opens arc manager)
- Compact progress display for active arcs

### 7.2 Arc Planning Wizard (Popup)

A 3-step popup dialog using SillyTavern's `Popup` API.

**Step 1 -- Context Review:**
- Harvested context summary (character, persona, lorebook counts, chat depth)
- Expandable sections to inspect individual lorebook entries
- Checkboxes to include/exclude specific entries
- Token count estimate with warning if too large
- "Next" button

**Step 2 -- Creative Direction:**
- Large free-form text area for the user's narrative briefing
- Placeholder text with examples: "Describe what you want this arc to explore. Factions, antagonists, themes, situations, tone..."
- Optional: parent arc selector (to create a sub-arc)
- Optional: arc type hints (dropdown: mystery, political intrigue, action, character study, exploration, custom)
- "Generate" button

**Step 3 -- Review & Activate:**
- Generated plan displayed with spoiler handling:
  - **Always visible:** title, themes, tone, directives, anti-patterns, character list
  - **Behind collapsible spoiler toggles:** premise detail, secrets, foreshadowing, beat list, escalation pattern, triggers
- Edit button per section (inline editing)
- "Regenerate" button (re-runs generation with same inputs)
- "Activate" button (makes the arc live)

### 7.3 Arc Manager (Popup)

A popup listing all arcs for the current chat.

- Per-arc row: title, status badge, focus indicator, progress bar, phase label
- Per-arc controls:
  - Focus toggle (foreground / background)
  - Edit (opens plan in editable view with spoiler toggles)
  - Complete / Abandon
  - "New Sub-Arc" (opens wizard with parent pre-selected)
- Active arcs at top, completed/abandoned collapsed at bottom

### 7.4 Progress Display (Extension Drawer -- Compact)

Lightweight, always visible in the settings panel when arcs are active:

- Per active arc: title + progress bar + phase label
- Foreground arcs shown prominently, background arcs condensed
- Click to expand: beat progress list (spoiler-gated)
- No spoilers in the default view

### 7.5 Spoiler Toggle Pattern

All spoiler-sensitive content uses a consistent UI pattern:

```html
<div class="story-arc-spoiler">
  <div class="story-arc-spoiler-toggle" data-expanded="false">
    Secrets (3) -- click to reveal
  </div>
  <div class="story-arc-spoiler-content" style="display:none;">
    <!-- secret content here -->
  </div>
</div>
```

Spoiler toggles are collapsed by default. Expanding shows a brief warning: "This contains story spoilers."

## 8. Module Structure

```
StoryArc/
├── index.js                    # Entry point, UI setup, event wiring
├── style.css                   # CSS import hub (@import for each module)
├── manifest.json               # SillyTavern extension manifest
├── prompts/
│   ├── analyze-context.txt     # Phase 1: story state analysis
│   ├── generate-arc.txt        # Phase 2: arc outline generation
│   ├── detail-pass.txt         # Phase 3: detail expansion
│   └── build-injection.txt     # Runtime prompt injection template
├── lib/
│   ├── core/
│   │   ├── index.js            # Facade: re-exports public API
│   │   ├── constants.js        # MODULE_NAME, default settings, schema defaults
│   │   └── settings.js         # Settings load/save, defaults merging
│   ├── context/
│   │   ├── index.js            # Facade
│   │   ├── harvester.js        # Orchestrates all context gathering
│   │   ├── lorebook.js         # HTTP API adapter for world info
│   │   ├── character.js        # Character card + persona extraction
│   │   └── chat-history.js     # Chat message extraction + truncation
│   ├── planning/
│   │   ├── index.js            # Facade
│   │   ├── generator.js        # Multi-phase LLM generation orchestration
│   │   ├── validation.js       # JSON parsing + schema validation
│   │   ├── storage.js          # Arc CRUD operations on chat_metadata
│   │   └── templates.js        # Load and fill prompt templates
│   ├── injection/
│   │   ├── index.js            # Facade
│   │   ├── builder.js          # Build injection text from active arcs
│   │   ├── pacing.js           # Phase calculation + pacing directives
│   │   └── signals.js          # Parse + handle ARC_SIGNAL patterns
│   ├── ui/
│   │   ├── index.js            # Facade
│   │   ├── settings-panel.js   # Extension drawer content
│   │   ├── wizard.js           # Arc planning wizard popup
│   │   ├── arc-manager.js      # Arc list + controls popup
│   │   └── progress.js         # Compact progress display
│   └── css/
│       ├── core.css            # Base styles, variables, .story-arc-* prefix
│       ├── wizard.css          # Wizard popup styles
│       ├── arc-manager.css     # Arc manager popup styles
│       ├── progress.css        # Progress display styles
│       └── spoiler.css         # Spoiler toggle styles
```

### 8.1 Module Responsibilities

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `core` | Constants, settings, shared state | `MODULE_NAME`, `loadSettings`, `getSettings`, `defaultSettings` |
| `context` | Gather story context from all sources | `harvestContext`, `fetchLorebooks`, `getCharacterData` |
| `planning` | Generate and store arc plans | `generateArc`, `saveArc`, `getArcs`, `deleteArc`, `updateArc` |
| `injection` | Build and manage prompt injection | `buildInjection`, `processSignals`, `calculatePhase` |
| `ui` | All user interface components | `renderSettingsPanel`, `showWizard`, `showArcManager`, `updateProgress` |

### 8.2 Event Wiring (index.js)

```javascript
// On extension load
jQuery(async function() {
    loadSettings();
    addSettingsPanel();
    setupEventListeners();

    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    console.log('[Story Arc] Extension loaded');
});

// GENERATION_STARTED: rebuild and inject the prompt
async function onGenerationStarted() {
    if (!isEnabled()) return;
    const arcs = getActiveArcs();
    if (!arcs.length) return;
    const injection = buildInjection(arcs);
    setExtensionPrompt('story_arc_plan', injection, ...);
}

// MESSAGE_RECEIVED: check for signals, update progress
async function onMessageReceived(messageIndex) {
    if (!isEnabled()) return;
    const message = chat[messageIndex];
    const signals = processSignals(message);
    if (signals.length) {
        stripSignalsFromMessage(messageIndex);
        updateArcProgress(signals);
        updateProgress();
        saveMetadata();
    }
}

// CHAT_CHANGED: reload arc state for the new chat
function onChatChanged() {
    loadSettings();
    updateProgress();
}
```

## 9. Implementation Notes

### 9.1 Dependencies

No external dependencies. Uses only SillyTavern's built-in APIs:
- jQuery (global, provided by ST)
- SillyTavern Popup API
- SillyTavern event system
- SillyTavern extension settings/metadata
- SillyTavern prompt injection
- SillyTavern Connection Manager (optional)

### 9.2 CSS Conventions

- All classes prefixed with `story-arc-` to avoid conflicts
- Modular CSS files per UI component, imported via `style.css`
- Follow SillyTavern's existing visual language (dark theme, standard form controls)

### 9.3 Console Logging

All console output prefixed with `[Story Arc]`:
```javascript
console.log('[Story Arc] Extension loaded');
console.warn('[Story Arc] Signal referenced unknown beat:', beatId);
console.error('[Story Arc] Plan generation failed:', error);
```

### 9.4 Read-Only Principle

The extension never modifies the user's lorebook, chat history, character cards, or other extensions' data. It only reads context and writes to its own `chat_metadata.story_arc` namespace. The one exception: signal stripping (Section 6.2) modifies the AI's displayed message to remove `[ARC_SIGNAL:...]` patterns before the user sees them. This is a display-only modification — it does not alter the stored chat message.

### 9.5 Error Handling

- LLM generation failures: retry once, then show error to user with option to retry manually
- JSON parse failures: retry with simplified prompt emphasizing JSON output
- Missing context sources: continue with available sources (graceful degradation)
- Signal parse errors: log warning, ignore invalid signals silently

### 9.6 Performance Considerations

- Context harvesting fetches lorebooks via HTTP -- do this once at wizard start, not on every message
- Prompt injection is rebuilt on every `GENERATION_STARTED` -- keep it fast (string concatenation from cached arc data, no async)
- Signal parsing uses a simple regex, not LLM calls
- Arc data stays in `chat_metadata` -- no additional storage layer
