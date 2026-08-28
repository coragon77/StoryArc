# Architecture

- **Coverage:** `index.js`, `lib/`, `prompts/`
- **Last Updated:** 2026-08-28

System design for Story Arc. For quick reference, see [CLAUDE.md](../../CLAUDE.md). For file index, see [code-index.md](./code-index.md).

## High-Level Data Flow

```
User clicks "Plan Next Arc"
       |
       v
Context Harvesting  (lib/context/)
  ├── Lorebook: classify World Info entries into constants / arc-summaries / recent
  ├── Character: pull character card fields + user persona
  ├── Chat history: extract recent messages within token budget
  └── Existing arcs: read active/completed arcs from chat_metadata
       |
       v
Arc Generation  (lib/planning/)
  ├── Phase 1 — Analysis: send harvested context through analyze-context.txt prompt
  │     → LLM produces a prose story-state summary
  ├── Phase 2 — Arc Outline: send analysis + user direction through generate-arc.txt
  │     → LLM returns a JSON arc plan
  ├── Each LLM call: direct streaming POST to /api/backends/chat-completions/generate,
  │     auto-retried (max 2, linear backoff) on transient errors
  ├── Parse + validate JSON (strip fences, extract object, schema-check)
  ├── Retry once with stricter JSON instruction if parse fails
  └── Normalize schema, assign defaults, save to chat_metadata.story_arc.arcs
       |
       v
Prompt Injection  (lib/injection/)
  ├── On GENERATION_STARTED: read active arcs from storage
  ├── Calculate current phase for each arc (beat ratio × message ratio, take minimum)
  ├── Build injection text:
  │     Foreground arcs — full detail: premise, tone, beats, secrets, foreshadowing,
  │                        triggers, pacing directives, anti-patterns
  │     Background arcs — summary only: premise + "keep as distant tension"
  │     Signal directive — instruct AI which [ARC_SIGNAL:…:COMPLETE] to emit
  └── Call setExtensionPrompt() with token-budgeted text
       |
       v
Signal-Based Progress Tracking  (lib/injection/signals.js)
  ├── On MESSAGE_RECEIVED: scan AI message for [ARC_SIGNAL:arcId:beatId:COMPLETE]
  ├── Mark matching beats as completed
  ├── Unlock gated beats whose unlockAfter prerequisites are all complete
  ├── Mark arc complete when all non-optional beats are done
  ├── Strip signal tokens from displayed message text
  └── Save updated arc state to chat_metadata, refresh progress UI
       |
       v
UI Display  (lib/ui/)
  ├── Settings panel in ST extension drawer
  ├── Planning wizard popup (context preview → direction → generation progress)
  ├── Arc manager popup (list arcs, toggle foreground/background, delete)
  └── Compact progress widget in ST sidebar (beat list with status indicators)
```

## Module Responsibilities

### lib/core/

Shared constants, settings management, and per-chat state initialization.

- `constants.js` — `MODULE_NAME`, `defaultSettings`, `defaultPerChatSettings`, `ARC_PHASES` (five phases with 0–1 percentage ranges), `PHASE_ORDER`, `PACING_DIRECTIVES` (one directive string per phase), `createDefaultArc()` factory
- `settings.js` — `loadSettings()` / `getSettings()` / `isEnabled()` for global extension settings; `ensureChatState()` initializes `chat_metadata.story_arc` on demand; `getChatSettings()` returns per-chat settings with defaults merged

No other module depends on more than `core/`. Core has no circular dependencies.

### lib/context/

Harvests story state from all available ST data sources.

- `harvester.js` — `harvestContext()` orchestrates the other harvesters and returns a `HarvestedContext` object with fields: `character`, `persona`, `lorebook` (split into `constants` / `arcSummaries` / `recent`), `chatHistory`, `existingArcs`
- `lorebook.js` — reads World Info entries, classifies by comment/tag into three buckets
- `character.js` — pulls character name, description, personality, scenario; also reads the active user persona
- `chat-history.js` — extracts recent chat messages up to a token budget; exports `estimateTokens()` (character-count heuristic: chars / 4)

### lib/planning/

Arc generation, validation, storage, and prompt template management.

- `generator.js` — `generateArc(context, userDirection, callbacks)` runs the two-phase LLM pipeline; Phase 3 (detail pass) is scaffolded but deferred post-MVP; includes retry logic for JSON parse failures; supports progress callbacks (`onProgress`, `isCancelled`). Both phases go through `callLlm()`, which wraps the call in a transient-error retry loop (max 2 retries, linear backoff `2000 * (attempt + 1)`, matching `502|503|504|timeout|gateway|ETIMEDOUT` — 42bce4a, d064dc3; 42bce4a's message says "exponential", the code is linear), and `callBackendDirectly()`, which POSTs a minimal body to ST's `/api/backends/chat-completions/generate` with `stream: true` and assembles the SSE deltas (a14ae32, a257d92). Model comes from `getChatCompletionModel(oai_settings)`, temperature from `oai_settings.temp_openai`, `max_tokens` fixed at 4096.

  The fixed `max_tokens: 4096` (entered via a700465/a14ae32 during the 502 debugging session) is a leftover, not a decision — owner's word, 2026-08-28: it is unwanted, and arc generation should take its response length from the connection profile once Connection Manager support is wired. (INTENT resolved 2026-08-28)
- `validation.js` — `parseLlmJson()` strips markdown fences and extracts the first JSON object; `validateArcPlan()` checks required fields (`title`, `premise`, `beats`), normalizes optional fields via helper functions, returns `{ valid, arc, errors }`
- `storage.js` — CRUD on `chat_metadata.story_arc.arcs[]`: `getArcs()`, `getActiveArcs()`, `getArcById()`, `saveArc()`, `updateArc()`, `deleteArc()`; each write calls `saveMetadata()`
- `templates.js` — `loadTemplate(name)` fetches a `.txt` file from `prompts/`; `fillTemplate(template, vars)` does `{{KEY}}` substitution

### lib/injection/

Builds and delivers prompt injections; tracks progress via AI-emitted signals.

- `builder.js` — `buildInjection(arcs)` separates arcs into foreground and background, builds a structured text block for each, appends the signal directive when `autoTrack` is on, trims to token budget if needed
- `pacing.js` — `calculatePhase(arc)` computes beat-completion ratio and message-count ratio against `estimatedLength`, takes the minimum to get a conservative phase; `getPacingDirective(phase)` returns the directive string; `messagesUntilNextPhase()` for pacing hint in injection
- `signals.js` — `parseSignals(text)` finds all `[ARC_SIGNAL:arcId:beatId:COMPLETE]` tokens; `processSignalResults(signals, activeArcs)` marks beats completed, unlocks beats whose `unlockAfter` list is satisfied, marks arcs complete when all non-optional beats are done; `stripSignalsFromMessage()` removes tokens from both `chat[]` and the rendered DOM

### lib/ui/

All user-facing views. No business logic — delegates to core/context/planning/injection.

- `settings-panel.js` — renders into the ST extension drawer; enable toggle, "Plan Next Arc" / "Manage Arcs" buttons, and the progress container. The connection profile picker and injection budget slider this doc originally claimed were never implemented: `git log --all -S 'profile' -- lib/ui/settings-panel.js` is empty across the file's whole history, `generator.js` carries a TODO for Connection Manager support "when UI for profile selection is built", and only the settings keys (`defaultConnectionProfile`, `connectionProfile` in `lib/core/constants.js`) exist. The claim described the design spec, not shipped UI. (VERIFY resolved 2026-08-28)

- `wizard.js` — multi-step planning popup: (1) show harvested context preview, (2) freeform direction input, (3) live generation progress, (4) plan preview with accept/reject
- `arc-manager.js` — popup listing all arcs with status badges; controls to toggle foreground/background, activate/deactivate, delete
- `progress.js` — compact widget showing beat list with status indicators (active / completed / pending / locked), injected near the ST message input

## Arc Schema

The arc object stored in `chat_metadata.story_arc.arcs[]`:

```javascript
{
    id: string,              // UUID
    title: string,
    status: 'active' | 'completed' | 'abandoned',
    focus: 'foreground' | 'background',
    createdAt: ISO8601,
    messageStart: number,    // chat.length when arc was created (for phase calculation)
    estimatedLength: number, // expected number of messages for the full arc

    // Narrative identity
    premise: string,
    themes: string[],
    tone: string,
    directives: string[],    // "always do" rules for the AI
    antiPatterns: string[],  // "never do" rules

    // Beats — the structural spine
    beats: [{
        id: string,
        intention: string,   // what must narratively happen (flexible, not a script)
        flexibility: string, // how literally to interpret the intention
        urgency: 'when-ready' | 'soon' | 'urgent',
        status: 'pending' | 'active' | 'completed' | 'locked' | 'skipped',
        unlockAfter: string[], // beat IDs that must complete first
        phase: string,       // which phase this beat belongs to
        optional: boolean,
    }],

    // Dramatic elements
    secrets: [{
        id: string,
        content: string,     // the secret the AI knows but must not reveal directly
        revealPhase: string, // earliest phase at which to begin hinting
        disclosed: boolean,
    }],
    foreshadowing: [{
        id: string,
        clue: string,        // what to plant
        target: string,      // what it foreshadows
        planted: boolean,
    }],
    triggers: [{
        id: string,
        condition: string,   // narrative condition to watch for
        action: string,      // what to do when triggered
        fired: boolean,
    }],

    escalation: string,      // prose describing how tension should grow
    characters: string[],    // character names whose arcs intersect
    subArcs: object[],       // nested arcs (future use)
}
```

## Phase System

Five phases, each with a 0–1 percentage range applied to both beat-completion ratio and message-count ratio. The current phase is whichever of the two ratios is lower (conservative — do not rush ahead).

| Phase | Range | Pacing Directive |
|-------|-------|-----------------|
| Setup | 0–20% | Plant seeds. Build atmosphere. No revelations. No confrontations. |
| Development | 20–50% | Tensions grow. Complications deepen. Hints become patterns. |
| Escalation | 50–75% | Stakes rise sharply. Confrontations can begin. Secrets start surfacing. |
| Climax | 75–90% | Major beats resolve. Secrets revealed. Decisive moments. |
| Resolution | 90–100% | Aftermath. Emotional processing. Seeds for the next arc. |

## Signal Protocol

When `autoTrack` is enabled, the prompt injection instructs the AI to append completion signals:

```
[ARC_SIGNAL:<arcId-prefix>:<beatId>:COMPLETE]
```

Only the first 8 characters of the arc UUID are used in the signal to keep it compact. On `MESSAGE_RECEIVED`, `parseSignals()` scans the message, `processSignalResults()` resolves the full arc by prefix match, and `stripSignalsFromMessage()` removes the tokens before the user sees them.

## Multi-Arc Support

Multiple arcs can be active simultaneously with different focus levels:

- **Foreground** arcs receive full injection detail: beats, secrets, foreshadowing, pacing rules. There should normally be one foreground arc at a time.
- **Background** arcs receive a brief summary only: premise + instruction to keep it as "distant tension" without advancing beats. Multiple background arcs are fine.

The user can promote/demote arcs between foreground and background via the Arc Manager.

## State Storage

### Global Settings (`extension_settings.story_arc`)
```javascript
{
    enabled: boolean,
    defaultConnectionProfile: string|null,
    defaultInjectionBudget: number,        // default 3000 tokens
    defaultPacingStyle: string,            // 'moderate' etc.
}
```

### Per-Chat State (`chat_metadata.story_arc`)
```javascript
{
    version: 1,
    arcs: ArcObject[],         // all arcs for this chat (active, completed, abandoned)
    settings: {
        connectionProfile: string|null,
        signalPrefix: '[ARC_SIGNAL',
        injectionBudget: number,
        autoTrack: boolean,
    },
}
```

## SillyTavern Integration Points

| Integration | API | Purpose |
|------------|-----|---------|
| World Info | `world_info` import or `context.worldInfo` | Read lorebook entries |
| Chat messages | `chat` import from `/script.js` | Read history + signal scanning |
| Prompt injection | `setExtensionPrompt()` | Inject arc guidance into AI context |
| LLM calls | direct `fetch()` to `/api/backends/chat-completions/generate` | Run multi-phase generation (not `generateRaw()` — see Gotchas, a14ae32) |
| Per-chat persistence | `chat_metadata` + `saveMetadata()` | Store arc plans |
| Global settings | `extension_settings` + `saveSettingsDebounced()` | Store config |
| Events | `eventSource.on(event_types.*)` | React to chat lifecycle |
| UI popups | `Popup` class from `/scripts/popup.js` | Wizard and arc manager |

Key events used:

| Event | Handler |
|-------|---------|
| `GENERATION_STARTED` | Build and inject arc guidance |
| `MESSAGE_RECEIVED` | Parse signals, update beat status |
| `USER_MESSAGE_RENDERED` | Refresh progress display |
| `CHAT_CHANGED` | Re-initialize per-chat state, refresh UI |

## Gotchas

- **Arc generation deliberately does not go through `generateRaw()`.** It adds fields (`include_reasoning`, `reasoning_effort`, `type`, `stop`, `logit_bias`, …) that make some providers answer 502. `callBackendDirectly()` sends the minimal body SillyTavern-MemoryBooks uses — `messages`, `model`, `temperature`, `max_tokens`, `chat_completion_source`, plus `custom_url` when set. Pinned by a14ae32.
- **`generateQuietPrompt()` is not the alternative.** It routes through the full chat pipeline, which re-enters Story Arc's own `GENERATION_STARTED` / `MESSAGE_RECEIVED` handlers while a plan is being generated. Tried in 8787fea, reverted in a700465.
- **Non-streaming requests time out on large prompts.** The arc prompt arrives as one 24K+ char message and exceeds nano-gpt's ~38s non-streaming ceiling; normal chat escapes this only because its prompt is spread over many small messages. The request therefore sets `stream: true` and reassembles the SSE `data:` chunks, skipping `[DONE]`. Pinned by a257d92.
- **The model name must come from `getChatCompletionModel(oai_settings)`.** `oai_settings.openai_model` is only correct for the OpenAI source — nanogpt keeps its model in `oai_settings.nanogpt_model`, so reading the field directly sent "gpt-5" to a backend that does not serve it. Pinned by ca2dfb8.
- **A 200 OK can still be an error.** Some backends return `{ error: … }` in a 200 body, and errors also turn up inside individual SSE chunks. Both paths throw instead of handing the body to the arc JSON parser, which otherwise reports it as a parse failure. Pinned by 3a14aa3.
- **The settings drawer needs ST's exact markup.** The header div must carry `inline-drawer-toggle` — ST binds its click handler to that class, not to `inline-drawer-header` — and without it the drawer silently never opens. Pinned by 1310dc7. Leave the styling to ST too: wrapper padding and a header border misalign the panel in the drawer list (a09887b).

## Design Principles

1. **Context-first** — arc quality is bounded by context quality. Lorebook classification, chat trimming, and character harvesting are all weighted toward signal over noise.
2. **Narrative-first schema** — beats express *intention*, not script. Secrets, foreshadowing, and triggers give the AI creative latitude while keeping the arc on track.
3. **Conservative pacing** — phase advancement requires both beat completion and message count to exceed the threshold. The AI is explicitly told not to rush.
4. **Non-destructive** — read-only access to lorebook, chat history, and character data. Only `chat_metadata.story_arc` is written.
5. **Lean** — no bundler, no library, no file storage beyond `chat_metadata`. One module per responsibility. No features outside the core loop: harvest → plan → inject → track.
6. **Graceful degradation** — any single context source (lorebook, chat, character) is sufficient for generation. Empty sources produce placeholder text rather than errors.
