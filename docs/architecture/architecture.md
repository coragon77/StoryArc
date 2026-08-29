# Architecture

- **Coverage:** `index.js`, `lib/`, `prompts/`
- **Last Updated:** 2026-08-29

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
  ├── Each LLM call: ConnectionManagerRequestService (when a generation profile is
  │     configured) or direct streaming POST to /api/backends/chat-completions/generate,
  │     auto-retried (max 2, linear backoff) on transient errors
  ├── Parse + validate JSON (strip fences, extract object, schema-check)
  ├── Retry once with stricter JSON instruction if parse fails
  └── Normalize schema, assign defaults, save to chat_metadata.story_arc.arcs
       |
       v
Prompt Injection  (lib/injection/)
  ├── On GENERATION_STARTED: read active arcs from storage
  ├── Calculate current phase for each arc (beat ratio × message ratio, take minimum)
  ├── Build TWO separate injections:
  │     story_arc_plan (IN_PROMPT) — token-budgeted plan text:
  │       Foreground arcs — full detail: premise, tone, beats, secrets, foreshadowing,
  │                          triggers, pacing directives, anti-patterns
  │       Background arcs — summary only: premise + "keep as distant tension"
  │     story_arc_signals (IN_CHAT, depth 0) — the beat-signal directive, placed as
  │       the last message before generation (models ignore it anywhere else)
  └── Both are set to '' when no arcs are active or the extension is disabled
       |
       v
Signal-Based Progress Tracking  (lib/injection/signals.js)
  ├── On MESSAGE_RECEIVED: scan AI message for [ARC_SIGNAL:arcId:beatId:COMPLETE]
  ├── Mark matching beats as completed (active or pending; locked/completed refused)
  ├── Unlock gated beats whose unlockAfter prerequisites are all complete
  ├── Promote the first pending beat to active when no beat is active
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

- `generator.js` — `generateArc(context, userDirection, callbacks)` runs the two-phase LLM pipeline; Phase 3 (detail pass) is scaffolded but deferred post-MVP; includes retry logic for JSON parse failures; supports progress callbacks (`onProgress`, `onChunk`, `isCancelled`). Both phases go through `callLlm()`, which builds a system+user message pair (large prompt as system message, short user trigger) and wraps the call in a retry loop (max 2 retries, linear backoff `2000 * (attempt + 1)` — 42bce4a, d064dc3; 42bce4a's message says "exponential", the code is linear). Whether an error is retried is decided by the exported `isRetryableError(detail)`, which matches `502|503|504|timeout|gateway|ETIMEDOUT|empty response` against `err.message` plus `err.cause?.message`. `empty response` is in that list because reasoning models (glm-5.2:thinking) sometimes emit only reasoning deltas and no content, which the routes below turn into `Empty response from API` — a per-call accident worth retrying. Auth, quota and model errors are deliberately not retryable: they fail identically every time and retrying only costs the user minutes. Each retry is reported through `onProgress('retry', …)` so the wizard shows it. The call itself takes one of two routes (e65449d):
  - **Profile route** — when `defaultConnectionProfile` is set, `callViaProfile()` streams through `ConnectionManagerRequestService.sendRequest(profileId, messages, undefined, { stream: true })`. `maxTokens` is deliberately `undefined`: ST deletes undefined payload keys before merging the profile preset, so the preset's response length wins — this is the owner-intended replacement for the old hardcoded `max_tokens: 4096` (INTENT of 2026-08-28 implemented in e65449d).
  - **Fallback route** — no profile configured: `callBackendDirectly()` POSTs a minimal body to ST's `/api/backends/chat-completions/generate` with `stream: true` and assembles the SSE deltas (a14ae32, a257d92). Model comes from `getChatCompletionModel(oai_settings)`, temperature from `oai_settings.temp_openai`, `max_tokens` from `oai_settings.openai_max_tokens` (the current API's response-length setting, 4096 only as last-resort default).

  Both routes report streaming progress by calling `onChunk(charsReceived)` per chunk. On the profile route `chunk.text` is cumulative and content-only (reasoning deltas live in `chunk.state.reasoning` and never reach `text`), so the count is `text.length`; the fallback route counts the SSE-assembled `fullText`. Phase 2 can run two minutes, and without this the wizard has nothing to show.
- `validation.js` — `parseLlmJson()` strips markdown fences and extracts the first JSON object; `validateArcPlan()` checks required fields (`title`, `premise`, `beats`), normalizes optional fields via helper functions, returns `{ valid, arc, errors }`
- `storage.js` — CRUD on `chat_metadata.story_arc.arcs[]`: `getArcs()`, `getActiveArcs()`, `getArcById()`, `saveArc()`, `updateArc()`, `deleteArc()`; each write calls `saveMetadata()`
- `templates.js` — `loadTemplate(name)` fetches a `.txt` file from `prompts/`; `fillTemplate(template, vars)` does `{{KEY}}` substitution
- `arc-preset.js` — the "Create arc preset" button behind the settings panel, plus the standing directives it stores.
  - `createArcPreset(baseProfileId, confirmOverwrite)` creates a barebones chat-completion preset named `Story Arc Generation` — not derived from any base preset — and clones the currently selected generation profile into a profile of the same name that pins it. Connection details (API, model, secret) come from the profile at request time, so the preset carries only generation parameters: the wire-verified combination (`reasoning_effort: 'high'`, `openai_max_tokens: 20000`, `temperature: 0.8`, `top_p: 0.95`, `stream_openai: true`) plus neutral pins for every other sampler/behavior key (`ARC_PRESET_SETTINGS`), because `presetToGeneratePayload` starts from a clone of the *live* chat settings and only overlays keys the preset defines — a dropped key silently falls back to the roleplay session.
  - **Standing directives** — adult content and genre live as ordinary prompt entries (`storyArcAdultContent`, `storyArcGenre`) inside the arc preset (whose prompt list carries *only* these entries — safe because ST's `PromptManager.checkForMissingPrompts` re-adds its mandatory system prompts on load), so the user edits and toggles them in SillyTavern's own prompt manager instead of in an extension panel. Nothing in ST reads them: Story Arc's calls never use a preset's prompt list, so the list is free storage. `readActiveArcDirectives()` resolves the preset pinned by the active generation profile, `collectArcDirectives(preset)` returns the enabled entries' text, and `generator.js` renders them into Phase 2 as a `== STANDING CONSTRAINTS ==` section via `{{ARC_DIRECTIVES}}`. Nothing enabled means no section at all. They are read from the *stored* preset, so a toggle counts only once the user saves the preset — ST's prompt manager writes toggles to the live settings, not to the preset file. Re-creating carries edited text and toggle states over from the preset it replaces, so a hand-written genre survives.

### lib/injection/

Builds and delivers prompt injections; tracks progress via AI-emitted signals.

- `builder.js` — `buildInjection(arcs)` separates arcs into foreground and background, builds a structured text block for each (beat lines carry their `[beatId]` so the model can connect beats to signal markers), trims the body to token budget if needed; `buildSignalInjection(arcs)` builds the beat-signal directive as a *separate* injection (empty when `autoTrack` is off or no beat is active) — it was moved out of the plan text because the tail-slice budget trim used to cut it off first on any realistic plan (27c3d17)
- `pacing.js` — `calculatePhase(arc)` computes beat-completion ratio and message-count ratio against `estimatedLength`, takes the minimum to get a conservative phase; `getPacingDirective(phase)` returns the directive string; `messagesUntilNextPhase()` for pacing hint in injection
- `signals.js` — `parseSignals(text)` finds all `[ARC_SIGNAL:arcId:beatId:COMPLETE]` tokens anywhere in the message; `processSignalResults(signals, activeArcs)` marks signaled beats completed (accepts `active` *and* `pending` beats — stories often fulfill the next beat in the same scene; `locked`/`completed` are refused), unlocks beats whose `unlockAfter` list is satisfied, promotes the first pending beat to `active` when none is active (without this the arc stalls after its first completed beat), marks arcs complete when all non-optional beats are done (27c3d17); `stripSignalsFromMessage()` removes tokens from both `chat[]` and the rendered DOM

### lib/ui/

All user-facing views. No business logic — delegates to core/context/planning/injection.

- `settings-panel.js` — renders into the ST extension drawer; enable toggle, **"Generation profile" dropdown** (lists Connection Manager profiles from `extension_settings.connectionManager.profiles`, persists to `defaultConnectionProfile`, repopulates on mousedown so newly created profiles appear; empty option = "Current API" fallback — e65449d), "Plan Next Arc" / "Manage Arcs" buttons, and the progress container. History note: the profile picker was claimed by the original docs long before it existed (VERIFY resolved 2026-08-28: never shipped until e65449d). The injection budget slider from the design spec remains unimplemented — only the settings key exists.

- `wizard.js` — multi-step planning popup: (1) show harvested context preview, (2) freeform direction input, (3) live generation progress, (4) plan preview with accept/reject. Step 3 uses `createStepLog()`, an append-only log: each `onProgress` closes the running line (✓ plus elapsed seconds, ✗ when the next step is a retry) and appends a new one, while `onChunk` rewrites the running line's detail with the received char count, repainted at most every 250 ms.
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

When `autoTrack` is enabled, a dedicated injection (`story_arc_signals`, IN_CHAT depth 0 — the last message the model sees before generating) instructs the AI to emit completion markers:

```
[ARC_SIGNAL:<arcId-prefix>:<beatId>:COMPLETE]
```

Only the first 8 characters of the arc UUID are used in the signal to keep it compact. The model is told to put the marker on the **first** line of its reply, not the last — end-of-message markers get eaten whenever the response hits the token cap. On `MESSAGE_RECEIVED`, `parseSignals()` scans the whole message, `processSignalResults()` resolves the full arc by prefix match, and `stripSignalsFromMessage()` removes the tokens before the user sees them.

Directive placement is the load-bearing detail (27c3d17): with the directive in the system prompt (or even one message back from the end), GLM 5.2 reasoned about beats in its chain-of-thought and still never emitted a marker. Depth 0 produced compliance. Emission remains stochastic per message — acceptable over a 40-message arc, since beats only need to complete eventually.

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
| Prompt injection | `setExtensionPrompt()` ×2 (`story_arc_plan` IN_PROMPT, `story_arc_signals` IN_CHAT depth 0) | Inject arc guidance + signal directive |
| LLM calls | `ConnectionManagerRequestService.sendRequest()` (profile set) or direct `fetch()` to `/api/backends/chat-completions/generate` (fallback) | Run multi-phase generation (not `generateRaw()` — see Gotchas, a14ae32) |
| Per-chat persistence | `chat_metadata` + `saveMetadata()` | Store arc plans |
| Global settings | `extension_settings` + `saveSettingsDebounced()` | Store config |
| Events | `eventSource.on(event_types.*)` | React to chat lifecycle |
| UI popups | `Popup` class from `/scripts/popup.js` | Wizard and arc manager |

Key events used:

| Event | Handler |
|-------|---------|
| `GENERATION_STARTED` | Build and inject arc guidance (or clear it when no arcs / disabled) |
| `MESSAGE_RECEIVED` | Parse signals, update beat status, refresh progress |
| `CHAT_CHANGED` | Re-initialize per-chat state, refresh UI |

(`USER_MESSAGE_RENDERED` appeared in earlier revisions of this doc but was never wired in code; progress refreshes on the two events above.)

## Gotchas

- **Arc generation deliberately does not go through `generateRaw()`.** It adds fields (`include_reasoning`, `reasoning_effort`, `type`, `stop`, `logit_bias`, …) that make some providers answer 502. The profile route goes through `ConnectionManagerRequestService` (a controlled payload via `ChatCompletionService.processRequest`, not the `generateRaw` path); the no-profile fallback `callBackendDirectly()` sends the minimal body SillyTavern-MemoryBooks uses — `messages`, `model`, `temperature`, `max_tokens`, `chat_completion_source`, plus `custom_url` when set. Pinned by a14ae32, e65449d.
- **`maxTokens: undefined` is how the profile preset's response length wins.** `ChatCompletionService.createRequestData` deletes undefined payload keys *before* `presetToGeneratePayload` merges the preset, so an undefined `max_tokens` lets the preset's value through. Passing a number would override the preset on every call. Pinned by e65449d.
- **The signal directive must never live inside the budget-trimmed plan text.** The trim slices from the tail, the directive was the last section — so on any plan larger than the budget the model never saw the signal protocol at all. This was the primary reason tracking never worked. It now injects separately (`story_arc_signals`). Pinned by 27c3d17.
- **The signal directive only works at IN_CHAT depth 0.** In the system prompt or even one message from the end, GLM 5.2 demonstrably reasoned about the beats in its chain-of-thought and still skipped the marker; as the final message before generation it complied. Marker goes on the reply's *first* line — end-of-message markers are eaten by response-token-cap truncation. Pinned by 27c3d17.
- **Beat progression needs explicit promotion.** Completing a beat does not make the next one `active` by itself; without the promotion step in `processSignalResults` the arc has no `(NOW)` beat after the first completion, the directive lists no markers, and tracking silently dies. Pinned by 27c3d17.
- **`setExtensionPrompt` takes `(key, value, position, depth, scan, role, filter)`.** The original call passed seven positional args (an extra `0` before `scan`), shifting `role` into `scan` and the role constant into `filter` — it only worked because everything coerced to the intended values. Pinned by 27c3d17.
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
