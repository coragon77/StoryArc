# Architecture

- **Coverage:** `index.js`, `lib/`, `prompts/`
- **Last Updated:** 2026-08-30

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
  │       Foreground arcs — premise, tone, the ACTIVE beat's pressure only, secrets,
  │                          foreshadowing, triggers, pacing directives, anti-patterns
  │       Background arcs — summary only: premise + "keep as distant tension"
  │     story_arc_signals (IN_CHAT, depth 0) — continuation guard + confidentiality
  │       clause always; the beat check only while a beat is active. Placed as
  │       the last message before generation (models ignore it anywhere else)
  ├── Both are set to '' when no arcs are active or the extension is disabled
  └── On CHAT_COMPLETION_PROMPT_READY: stamp each user message in the OUTGOING
        prompt array with "[Arc: message N of ~M]", N derived from that message's
        own chat index. Old positions never change bytes, so the provider's
        prefix cache survives. Stored chat and the UI are untouched.
       |
       v
Signal-Based Progress Tracking  (lib/injection/signals.js)
  ├── On MESSAGE_RECEIVED: scan AI message for [ARC_SIGNAL:arcId:beatId:COMPLETE]
  │     (emitted HTML-comment-wrapped; bare form still parsed for old messages)
  ├── Mark matching beats as completed (active only; at most one per arc per message)
  ├── Unlock gated beats whose unlockAfter prerequisites are all complete
  ├── Mark arc complete when all non-optional beats are done
  ├── Strip signal tokens (and their leftover blank lines) from the message
  ├── Scrub leaked plan identifiers (beat/arc ids, all arcs) from the message
  └── Save updated arc state to chat_metadata, refresh progress UI
       |
       v
Beat Promotion  (lib/injection/signals.js — promoteNextBeats)
  ├── On USER_MESSAGE_RENDERED: for every active arc without an active beat,
  │     promote its first pending beat to active and persist
  └── Between completion and promotion the arc lingers: the plan section carries a
        "develop the consequences" directive instead of a pressure, and no marker
        lines are injected. The player always reacts before the model learns
        what comes next; the next user message always ends the linger
       |
       v
UI Display  (lib/ui/)
  ├── Settings panel in ST extension drawer (setup rows only)
  ├── Wand-menu entry + popup (Plan / Manage / progress cards) — the everyday route
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

- `builder.js` — `buildInjection(arcs)` separates arcs into foreground and background, builds a structured text block for each, and trims an over-budget body at **line boundaries** (`trimToBudget`): sections are ordered guardrails-first (pacing rules, DO NOT, directives) then fat lists last in survival order (secrets, triggers, foreshadowing), so trailing whole list items drop — never a mid-sentence cut, never the pacing rules. A header whose items were all dropped is removed too. The order matters: the earlier naive tail-slice fired on every generation of a big arc and deleted exactly the guardrail sections while keeping the content blobs (found live 2026-08-29); `buildSignalInjection(arcs)` builds the in-chat injection as a *separate* injection (empty only when there are no arcs) — the signal directive was moved out of the plan text because the tail-slice budget trim used to cut it off first on any realistic plan (27c3d17), and it now also carries the `ARC PACING:` phase brake (see below).
  - **No injected text may change per message — anywhere, including the tail.** `story_arc_plan` goes in at `IN_PROMPT`, ahead of the chat history and therefore inside the prefix an LLM provider caches. The plan text used to carry `Messages into arc: N` and `Do not advance … for at least N more messages`, both derived from `chat.length`, so every generation was a full cache write and zero cache read (found live 2026-08-30: `cache_read_input_tokens: 0`, 111,738 tokens rewritten per turn). Moving those counters past ST's Claude breakpoint (`cachingAtDepthForClaude` in `src/prompt-converters.js`) into the `IN_CHAT` depth-0 block did **not** fix it: measured again post-`85f469b` inside the 1h TTL, a chat with Story Arc active still read `cache_read_input_tokens: 0` while an identical chat without it cached normally. With this provider (nanogpt → `claude-opus-4-5-20251101:thinking`), Anthropic's documented 20-block lookback does not rescue a changing tail; every byte that occupied a position last turn must be identical this turn. So `buildPacingBlock()` no longer counts at all — it states the phase brake as a fixed arc-relative boundary (`phaseBoundaryMessage()`), which moves only when the phase does. The current count reaches the model through per-message stamps instead (see `stamping.js` below). The pacing block is emitted regardless of `autoTrack`; only the BEAT CHECK half is gated on it. The in-chat block is appended to the existing injection rather than added as a second one because the Claude converter counts system messages toward the depth, so each extra low-depth message pushes the breakpoint one real message further back.
- `stamping.js` — **how the exact counter survives the cache.** The model still needs "how far into this arc are we" on every generation, and one counter line anywhere is exactly the shape that breaks the prefix. The fix is to give every message its own counter: `buildStamp(arc, chatIndex)` returns `[Arc: message N of ~M]` where `N = chatIndex - arc.messageStart + 1` and `M = arc.estimatedLength` — a pure function of the index and fixed arc metadata, so message 67 reads "message 67 of ~80" this turn and every later turn. Old positions keep their bytes, only the appended tail is new, and the newest message carries the current number. `stampPromptMessages()` prepends the stamps on `CHAT_COMPLETION_PROMPT_READY`, mutating ST's outgoing messages array in place; stored chat (`chat[i].mes`) and the rendered UI are never touched. Details that matter:
  - **Only user messages are stamped** — half the tokens for the same pacing signal, and stamping the model's own past replies invites it to imitate the format and write `[Arc: message …]` into its prose. The cost is that the newest stamp lags on generations that follow an assistant message (Continue, or generating without typing): the model then reads the last *user* message's number, which can be a few behind. Accepted deliberately; the phase brake, not the exact count, is what enforces pacing.
  - **`focus` toggling counts as a lifecycle change.** The stamp comes from the first foreground arc, and `focus` defaults to `foreground` for every new arc, so promoting or demoting an arc in the Arc Manager can hand every historical position a different arc's numbering. Same one-time cache miss as activating or deleting an arc, but a user hits this one far more often.
  - **Prompt entries are matched to chat indices by content suffix, not by position.** ST filters `is_system` messages out of `coreChat` (`public/script.js:4496`), `doChatInject` splices entries in, and other extensions add their own, so positions do not line up. An entry that matches nothing is skipped *without* consuming a chat index, so a foreign entry cannot shift every later number. If a regex script rewrote message text for the prompt, nothing matches and nothing is stamped — a no-op, never a wrong count.
  - **Arc lifecycle changes cost one cache miss.** Activating, completing or deleting an arc, or re-estimating its length, changes historical stamps. That is a few times per arc, and accepted.
  - **Other extensions' `generateRaw` calls fire the same event** (`public/script.js:4037`). The pass runs only on prompts containing `INJECTION_HEADER`, which only the real chat prompt carries.
  - **The plan section shows one beat and no ids.** The foreground section carries a `CURRENT PRESSURE:` block holding the active beat's `pressure` text (falling back to `intention` for arcs planned before the field existed). Pending and locked beats are omitted entirely — no ids, no intentions, no teaser. Beat ids appear nowhere in the plan text at all. The old `CURRENT BEATS` list with `(NOW)`/`(upcoming)` markers turned the plan into a visible task list: live testing burned 7 of 10 non-optional beats in ~8 exchanges on an arc planned for 40 messages.
  - **Linger.** When an arc has no active beat (the gap between a completion and the next user message), the pressure block is replaced by a directive to develop consequences and introduce no new major developments.
  - `buildSignalDirective` always emits the continuation guard (never restart the scene, even when the last message is not the user's — RP presets like Celia wrap "the latest turn" at fixed depths, which mislabels the anchor when the user generates without input) and the confidentiality clause declaring the plan invisible scaffolding whose internals must not appear in any journal/summary/state-tracking block the preset requests. Both must survive linger, so neither is gated on having an active beat. The BEAT CHECK block and its marker lines are gated: they appear only while a beat is active, and each line is phrased as recognition of the past (`If the story has already brought this about — "<intention>" — output exactly: …`) with an explicit "these are not instructions, do not steer toward them". Earlier phrasings were read as objectives; a bare `:COMPLETE` token was read as status and forced the active beat into every reply
- `pacing.js` — `calculatePhase(arc)` computes beat-completion ratio and message-count ratio against `estimatedLength`, takes the minimum to get a conservative phase; `getPacingDirective(phase)` returns the directive string; `phaseBoundaryMessage(arc, phase)` returns the arc-relative message number where the phase ends — it does not read `chat.length`, which is what makes it safe to put in the prompt; `messagesUntilNextPhase(arc, phase)` turns the same boundary into a countdown for the progress card's "~N msgs to next phase" line, and is UI-only now. Both return `0` — not `NaN` — when the boundary cannot be computed, which is the case for arcs planned before `estimatedLength` and `messageStart` existed (e1bc69a)
- `signals.js` — `parseSignals(text)` finds all `[ARC_SIGNAL:arcId:beatId:COMPLETE]` tokens anywhere in the message, bare or HTML-comment-wrapped (the directive asks for the comment form — ST's renderer hides it completely, even mid-stream; verified against `messageFormatting`: a custom tag leaves an empty `<p>`, an open/close tag leaks its inner text, a comment leaves nothing); `processSignalResults(signals, activeArcs)` marks signaled beats completed (`active` beats only, and at most one per arc per message — `pending` beats are not shown to the model at all, so a signal for one is a hallucinated or stale id, and an eager scene claiming two beats at once burns the arc's pace), unlocks beats whose `unlockAfter` list is satisfied, marks arcs complete when all non-optional beats are done (27c3d17). It deliberately does **not** promote the next beat; `promoteNextBeats(arcs)` does that on `USER_MESSAGE_RENDERED`, activating the first pending beat of every active arc that has none. Recording stays liberal in one direction on purpose: a completion signal is never refused for being too fast, because the signal arrives *after* the scene was written and refusing it would make the tracker disagree with the visible story. The brake is what the model can see, not what the bookkeeping accepts; `stripSignalsFromMessage()` removes tokens from both `chat[]` and the rendered DOM and trims the blank lines the marker leaves at message start; `scrubArcInternals(messageIndex, arcs)` mechanically removes leaked beat/arc ids from the saved message after marker parsing — the confidentiality clause steers the model, only the scrub guarantees it (RP presets with state-tracking blocks, e.g. Celia's `[Main-line]`, otherwise persist beat ids and next-beat agendas into history, where they steer later generations). Called with *all* arcs, not just active — past arcs' ids linger in journal recaps. Only underscore-containing ids are scrubbed; a plain-word id is indistinguishable from prose and harmless

### lib/ui/

All user-facing views. No business logic — delegates to core/context/planning/injection.

- `settings-panel.js` — renders into the ST extension drawer; enable toggle, **"Generation profile" dropdown** (lists Connection Manager profiles from `extension_settings.connectionManager.profiles`, persists to `defaultConnectionProfile`, repopulates on mousedown so newly created profiles appear; empty option = "Current API" fallback — e65449d), "Plan Next Arc" / "Manage Arcs" buttons, and the progress container. History note: the profile picker was claimed by the original docs long before it existed (VERIFY resolved 2026-08-28: never shipped until e65449d). The injection budget slider from the design spec remains unimplemented — only the settings key exists.

- `wizard.js` — multi-step planning popup: (1) show harvested context preview, (2) freeform direction input, (3) live generation progress, (4) plan preview with accept/reject. Step 3 uses `createStepLog()`, an append-only log: each `onProgress` closes the running line (✓ plus elapsed seconds, ✗ when the next step is a retry) and appends a new one, while `onChunk` rewrites the running line's detail with the received char count, repainted at most every 250 ms.
- `arc-manager.js` — popup listing all arcs with status badges; controls to toggle foreground/background, activate/deactivate, delete
- `wand-menu.js` — `registerWandMenuEntry()` appends a "Story Arc" item to ST's `#extensionsMenu` (the wand next to the chat bar) and `showWandPopup()` opens the quick-access popup: Plan Next Arc, Manage Arcs, and the active arcs' progress cards, all reusing `showWizard` / `showArcManager` / `renderProgressDisplay`. Setup rows (enable toggle, generation profile, arc preset) deliberately stay in the settings drawer, so the wand popup holds only the per-chat actions. Disabled extension shows a "disabled" note instead of dead buttons. Story Mode's Popper dropdown was not copied — nested ST popups stack badly, so this popup closes itself before opening the wizard or the manager (f4a0503). `showWandPopup` runs a `do…while` loop around the popup: when the sub-popup resolves, the wand popup is rebuilt and shown again, so several actions run without reopening the menu and the progress cards pick up whatever just changed (f754381)
- `progress.js` — compact widget showing beat list with status indicators (active / completed / pending / locked), injected near the ST message input. Each card also carries a `~N msgs to next phase` line, rendered only while the message count is what holds the phase back — `calculatePhase()` takes the minimum of beat ratio and message ratio, so a full beat bar can still sit in an early phase and the reason was previously invisible. `0` (the beats are the limit, or the arc has no `estimatedLength`) and the `resolution` phase, which has nothing after it, both hide the line (e1bc69a)

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
        pressure: string,    // the force the beat exerts BEFORE it happens — the only
                             // part the narrating AI ever sees. '' on pre-2026-08-29
                             // arcs; the builder falls back to intention
        intention: string,   // the fulfillment condition: what has already happened on
                             // screen when the beat is complete (past tense). Shown only
                             // in the signal directive, never in the plan text
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
<!-- [ARC_SIGNAL:<arcId-prefix>:<beatId>:COMPLETE] -->
```

The HTML-comment wrapper makes the marker invisible in ST's renderer even while it streams in; the bare form (without the wrapper) is still parsed for messages written before the change. Only the first 8 characters of the arc UUID are used in the signal to keep it compact. The model is told to put the marker on the **first** line of its reply, not the last — end-of-message markers get eaten whenever the response hits the token cap. On `MESSAGE_RECEIVED`, `parseSignals()` scans the whole message, `processSignalResults()` resolves the full arc by prefix match, `stripSignalsFromMessage()` removes the tokens (and their leftover blank lines) before the user sees them, and `scrubArcInternals()` deletes any beat/arc ids the model leaked elsewhere in the message — journals and state-tracking blocks from RP presets otherwise carry plan internals (spoilers, next-beat agendas) into saved history.

Directive placement is the load-bearing detail (27c3d17): with the directive in the system prompt (or even one message back from the end), GLM 5.2 reasoned about beats in its chain-of-thought and still never emitted a marker. Depth 0 produced compliance. Emission remains stochastic per message — acceptable over a 40-message arc, since beats only need to complete eventually.

## Pacing Enforcement

Prompt-side pacing ("do not advance for N more messages") was demonstrably ignored, so the brakes are mechanical and sit on what the model can *see*:

1. **Information hiding** — the plan text shows one beat, as a pressure, with no id. A model cannot race toward objectives it was never given.
2. **Pressure/fulfillment split** — the plan shows the beat as weather (`pressure`, no completion state); only the signal directive carries the fulfillment condition (`intention`), phrased as recognition of the past. An outcome-phrased beat is a solvable, and models are trained to solve visible goals in one scene and then parrot the solution into dialogue.
3. **Active-only, one per arc per message** — the backstop in `processSignalResults` against one eager scene burning several beats.
4. **Promotion on the next user turn** — after a completion the arc is left with no active beat until `USER_MESSAGE_RENDERED`. The AI's own aftermath prose and empty-input continues cannot chain into the next objective; the player reacts to a development before the model learns what follows.

Promotion is reactive, not clocked. A message-budget hold was considered and rejected: scenes must react to the roleplay, not to a round counter, and a clock detaches the plan from an unforeseen story direction. The accepted consequence is that an arc "planned for 40 messages" can finish sooner if the model keeps fulfilling beats and the player plays along — `estimatedLength` feeds only the advisory phase wording, and the real pace is set by the player's turns.

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
| Outgoing prompt | in-place mutation of `eventData.chat` on `CHAT_COMPLETION_PROMPT_READY` | Stamp per-message arc counters (see `stamping.js`) |
| LLM calls | `ConnectionManagerRequestService.sendRequest()` (profile set) or direct `fetch()` to `/api/backends/chat-completions/generate` (fallback) | Run multi-phase generation (not `generateRaw()` — see Gotchas, a14ae32) |
| Per-chat persistence | `chat_metadata` + `saveMetadata()` | Store arc plans |
| Global settings | `extension_settings` + `saveSettingsDebounced()` | Store config |
| Events | `eventSource.on(event_types.*)` | React to chat lifecycle |
| UI popups | `Popup` class from `/scripts/popup.js` | Wizard, arc manager and wand popup |
| Wand menu | append to `#extensionsMenu` | "Story Arc" quick-access entry next to the chat bar (f4a0503) |

Key events used:

| Event | Handler |
|-------|---------|
| `GENERATION_STARTED` | Build and inject arc guidance (or clear it when no arcs / disabled) |
| `MESSAGE_RECEIVED` | Parse signals, update beat status, scrub leaked ids, refresh progress |
| `USER_MESSAGE_RENDERED` | Promote the next beat in arcs left without an active one |
| `CHAT_CHANGED` | Re-initialize per-chat state, refresh UI |

`MESSAGE_RECEIVED` fires only for AI messages; user messages fire `USER_MESSAGE_RENDERED` (the same event Story Mode counts rounds on). The split is what makes the promotion gap a *user* turn rather than any turn.

**Emission order matters here.** `Generate()` emits `GENERATION_STARTED` at its top (`public/script.js:4299`) and only calls `sendMessageAsUser()` — which emits `MESSAGE_SENT` and then `USER_MESSAGE_RENDERED` — about 150 lines later (`:4453`, emitting at `:5912`/`:5919`). The injection for the message the user just typed is therefore built *before* promotion runs, so a freshly promoted beat's pressure first reaches the model on the generation after that. The resulting sequence, per completed beat:

1. AI message completes a beat; the arc is left with no active beat.
2. The player types a reaction. Its generation still sees the linger directive → the AI writes one consequences/breather message with no beat check.
3. The player types again. This generation carries the newly promoted beat's pressure.

One AI message of breathing room per beat, which is the intent. This cannot be shortened by choosing a different event: every user-message event fires after `GENERATION_STARTED` inside the same `Generate()` call. Promoting in `onGenerationStarted` instead would restore exactly the chaining the design removes, because empty-input continues also go through `Generate()`.

## Gotchas

- **Arc generation deliberately does not go through `generateRaw()`.** It adds fields (`include_reasoning`, `reasoning_effort`, `type`, `stop`, `logit_bias`, …) that make some providers answer 502. The profile route goes through `ConnectionManagerRequestService` (a controlled payload via `ChatCompletionService.processRequest`, not the `generateRaw` path); the no-profile fallback `callBackendDirectly()` sends the minimal body SillyTavern-MemoryBooks uses — `messages`, `model`, `temperature`, `max_tokens`, `chat_completion_source`, plus `custom_url` when set. Pinned by a14ae32, e65449d.
- **`maxTokens: undefined` is how the profile preset's response length wins.** `ChatCompletionService.createRequestData` deletes undefined payload keys *before* `presetToGeneratePayload` merges the preset, so an undefined `max_tokens` lets the preset's value through. Passing a number would override the preset on every call. Pinned by e65449d.
- **The signal directive must never live inside the budget-trimmed plan text.** The trim slices from the tail, the directive was the last section — so on any plan larger than the budget the model never saw the signal protocol at all. This was the primary reason tracking never worked. It now injects separately (`story_arc_signals`). Pinned by 27c3d17.
- **The signal directive only works at IN_CHAT depth 0.** In the system prompt or even one message from the end, GLM 5.2 demonstrably reasoned about the beats in its chain-of-thought and still skipped the marker; as the final message before generation it complied. Marker goes on the reply's *first* line — end-of-message markers are eaten by response-token-cap truncation. Pinned by 27c3d17.
- **Beat progression needs explicit promotion.** Completing a beat does not make the next one `active` by itself; without a promotion step the arc has no active beat after the first completion, the directive lists no markers, and tracking silently dies. Promotion now lives in `promoteNextBeats` on `USER_MESSAGE_RENDERED` — deliberately one user turn later than the completion, never in `processSignalResults`. Pinned by 27c3d17 (the step) and this change (its placement).
- **A visible plan is a task list.** Listing pending beats with ids and intentions made GLM 5.2 drive at them: 7 of 10 non-optional beats in ~8 exchanges on a 40-message arc, with beat intentions parroted into dialogue. The plan text now shows one beat, as a pressure, without ids. This is the primary pacing brake; the prompt-side "do not advance for N more messages" rule was ignored every time.
- **Never refuse a completion for being too fast.** The signal arrives after the scene is already on screen, so refusing it makes the tracker disagree with the visible story and re-arms the same marker instruction next message — a loop. Bookkeeping stays liberal; the pace is controlled by what the model is shown, not by what the recorder accepts.
- **Do not migrate stored arcs to add `pressure`.** Arcs planned before 2026-08-29 have beats without the field; `buildForegroundSection` falls back to `intention` and they keep working. A live arc in the owner's Amy chat depends on this.
- **`setExtensionPrompt` takes `(key, value, position, depth, scan, role, filter)`.** The original call passed seven positional args (an extra `0` before `scan`), shifting `role` into `scan` and the role constant into `filter` — it only worked because everything coerced to the intended values. Pinned by 27c3d17.
- **`generateQuietPrompt()` is not the alternative.** It routes through the full chat pipeline, which re-enters Story Arc's own `GENERATION_STARTED` / `MESSAGE_RECEIVED` handlers while a plan is being generated. Tried in 8787fea, reverted in a700465.
- **Non-streaming requests time out on large prompts.** The arc prompt arrives as one 24K+ char message and exceeds nano-gpt's ~38s non-streaming ceiling; normal chat escapes this only because its prompt is spread over many small messages. The request therefore sets `stream: true` and reassembles the SSE `data:` chunks, skipping `[DONE]`. Pinned by a257d92.
- **The model name must come from `getChatCompletionModel(oai_settings)`.** `oai_settings.openai_model` is only correct for the OpenAI source — nanogpt keeps its model in `oai_settings.nanogpt_model`, so reading the field directly sent "gpt-5" to a backend that does not serve it. Pinned by ca2dfb8.
- **A 200 OK can still be an error.** Some backends return `{ error: … }` in a 200 body, and errors also turn up inside individual SSE chunks. Both paths throw instead of handing the body to the arc JSON parser, which otherwise reports it as a parse failure. Pinned by 3a14aa3.
- **The settings drawer needs ST's exact markup.** The header div must carry `inline-drawer-toggle` — ST binds its click handler to that class, not to `inline-drawer-header` — and without it the drawer silently never opens. Pinned by 1310dc7. Leave the styling to ST too: wrapper padding and a header border misalign the panel in the drawer list (a09887b).
- **Assistant-last histories make RP presets restart the scene.** Celia injects `<latest_turn_start>`/`<latest_turn_end>` wrappers at fixed IN_CHAT depths 1/0; when the user generates without typing (a normal way to advance the story), the wrappers label the model's *own last reply* as "the latest turn to answer", and GLM re-answered the last user message from scratch — three parallel takes of the same scene. The signal directive's continuation guard counters this at depth 0. Pinned by 8dbfdb1.
- **Every popup must unbind its click namespace when it resolves.** The handlers are delegated on `document`, so they outlive the popup's DOM. The wizard's `click.storyArcWizard` stayed bound after the wizard closed, and one click in the arc manager then fired both modules' `.story-arc-spoiler-toggle` handlers — the spoiler toggled twice and looked like nothing happened. The manager leaked the same way in reverse. Each popup now calls `$(document).off('click.<namespace>')` after `await popupPromise`. Pinned by 7945e3a; `wand-menu.js` follows the same pattern for `click.storyArcWandPopup`, and needs it more than the others because the popup is reopened in a loop.
- **Prompt clauses steer; only post-processing guarantees.** GLM pastes beat ids and next-beat agendas into Celia's `[Main-line]`/journal blocks even when told not to; because those blocks re-enter the prompt as history, the model ends up pacing the arc off its own agenda instead of the pacing rules. `scrubArcInternals` deletes the ids mechanically after every AI message — the confidentiality clause reduces the leakage, the scrub makes the identifiers unable to persist.

## Design Principles

1. **Context-first** — arc quality is bounded by context quality. Lorebook classification, chat trimming, and character harvesting are all weighted toward signal over noise.
2. **Narrative-first schema** — beats express *intention*, not script. Secrets, foreshadowing, and triggers give the AI creative latitude while keeping the arc on track.
3. **Conservative pacing** — phase advancement requires both beat completion and message count to exceed the threshold. The AI is explicitly told not to rush.
4. **Non-destructive** — read-only access to lorebook, chat history, and character data. Only `chat_metadata.story_arc` is written.
5. **Lean** — no bundler, no library, no file storage beyond `chat_metadata`. One module per responsibility. No features outside the core loop: harvest → plan → inject → track.
6. **Graceful degradation** — any single context source (lorebook, chat, character) is sufficient for generation. Empty sources produce placeholder text rather than errors.
