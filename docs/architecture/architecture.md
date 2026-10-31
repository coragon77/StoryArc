# Architecture

- **Coverage:** `index.js`, `lib/`, `prompts/`
- **Last Updated:** 2026-10-30

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
  ├── Wizard input: tier (episode / act / saga, from TIER_TABLE) + free-text direction;
  │     in revise mode (re-plan) also the arc being re-planned with edited title/premise
  ├── Phase 1 — Analysis: send harvested context through analyze-context.txt prompt
  │     → LLM produces a prose story-state summary (a re-planned arc is marked
  │       [BEING RE-PLANNED] so its unfulfilled beats are not reported as open threads)
  ├── Phase 2 — Arc Outline: send analysis + user direction through generate-arc.txt,
  │     with {{TIER_BLOCK}} (beat kind, count, length band) and, on re-plan,
  │     {{ARC_SO_FAR}} (premise, secrets, fulfilled beats as "already happened")
  │     → LLM returns a JSON arc plan
  ├── Each LLM call: ConnectionManagerRequestService (when a generation profile is
  │     configured) or direct streaming POST to /api/backends/chat-completions/generate,
  │     auto-retried (max 2, linear backoff) on transient errors
  ├── Parse + validate JSON (strip fences, extract object, schema-check; the tier
  │     shapes the beats: scene beats ordered with one active, milestones all active;
  │     estimatedLength clamped to the tier's band)
  ├── Retry once with stricter JSON instruction if parse fails
  ├── Re-plan only: mergeReplan(existing, generated) keeps the situation, replaces the road
  └── Normalize schema, assign defaults, save to chat_metadata.story_arc.arcs
      (re-plan: updateArc on the existing id instead)
       |
       v
Prompt Injection  (lib/injection/)
  ├── On GENERATION_STARTED: read active arcs from storage
  ├── Calculate current phase for each arc (beat ratio × message ratio, take minimum)
  ├── Build TWO separate injections:
  │     story_arc_plan (IN_PROMPT) — token-budgeted plan text, one section per arc
  │       chosen by (tier, focus) — see "Tiers and Focus" below and lib/injection/builder.js:
  │       Episode, normal/spotlight — premise, tone, the ACTIVE beat's pressure only,
  │                          secrets, foreshadowing, triggers, pacing directives, anti-patterns
  │       Act/saga, normal — premise + every unfulfilled milestone's pressure as
  │                          STANDING PRESSURES, then gated secrets, triggers, foreshadowing
  │       Act/saga, spotlight — same section, pressures under BRING TO A HEAD + one
  │                          trailer sentence; ordered first
  │       Paused (any tier) — one line: premise + "pending, not being pursued right now"
  │     story_arc_signals (IN_CHAT, depth 0) — ARC PACING brake for the pacing clock;
  │       continuation guard + confidentiality clause always; the beat check lists
  │       every active beat of every non-paused arc. Placed as the last message
  │       before generation (models ignore it anywhere else)
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
  ├── Mark matching beats as completed (active only; at most one per arc per message);
  │     stamp arc.lastFulfilledAt with the message's chat index
  ├── Unlock gated beats whose unlockAfter prerequisites are all complete
  ├── Mark arc complete when all non-optional beats are done
  ├── Queue PLANTED (clue) and FIRED (trigger) marks; apply the queue when a beat
  │     completed in this message or the oldest mark waited MARK_FLUSH_WINDOW (20)
  │     messages, so marks cost no miss of their own when a beat completes, and at
  │     most one per 20 messages otherwise
  ├── Strip signal tokens (and their leftover blank lines) from the message
  ├── Scrub leaked plan identifiers (beat/arc ids, all arcs) from the message
  └── Save updated arc state to chat_metadata, refresh progress UI
       |
       v
Beat Promotion  (lib/injection/signals.js — promoteNextBeats)
  ├── On USER_MESSAGE_RENDERED: for every active episode without an active beat,
  │     promote its first pending beat to active and persist; for every act or
  │     saga, activate every pending milestone (all milestones stand at once)
  └── Between completion and promotion an episode lingers: the plan section carries a
        "develop the consequences" directive instead of a pressure, and no marker
        lines are injected. The player always reacts before the model learns
        what comes next; the next user message always ends the linger
       |
       v
UI Display  (lib/ui/)
  ├── Settings panel in ST extension drawer (setup rows only)
  ├── Wand-menu entry + popup (Plan / Manage / progress cards) — the everyday route
  ├── Planning wizard popup (context preview → tier + direction → generation progress);
  │     the same popup in revise mode re-plans an existing arc
  ├── Arc manager popup (list arcs, focus paused/background/normal/spotlight, re-plan, delete)
  └── Compact progress widget in ST sidebar (beat/milestone count, phase, "~N msgs to
        next phase", and the stall nudge "May have drifted — re-plan?")
```

## Module Responsibilities

### lib/core/

Shared constants, settings management, and per-chat state initialization.

- `constants.js` — `MODULE_NAME`, `INJECTION_HEADER` (first line of the plan block; doubles as the marker that tells the stamping pass "this is the real chat prompt"), `defaultSettings`, `defaultPerChatSettings`, `ARC_PHASES` (five phases with 0–1 percentage ranges), `PHASE_ORDER`, `PACING_DIRECTIVES` (one directive string per phase), `TIER_TABLE` (episode/act/saga: `label`, `beatKind`, `beatCount`, `lengthBand` — design spec 2026-09-16 §1; read by the generator's tier block, the validator's clamp, the milestone section header and the UI badges, so prompt and validator cannot drift apart), `ARC_FOCUS`, `createDefaultArc()` factory
- `settings.js` — `loadSettings()` / `getSettings()` / `isEnabled()` for global extension settings; `ensureChatState()` initializes `chat_metadata.story_arc` on demand and runs `migrateArc()` over every stored arc; `getChatSettings()` returns per-chat settings with defaults merged. `arcTier(arc)` and `arcMessageStart(arc)` state the two fallbacks every reader uses: an arc without a tier is an episode (the migration rule), an arc without `messageStart` counts from chat index 0; tests pin both. `getArcs()` and `getChatSettings()` carry a comment at the `ensureChatState()` call saying that the read may migrate and save
  - **Migration (2026-09-16, ADR-0001).** An arc without `tier` was planned before tiers existed. It becomes `tier: 'episode'` (its beats are ordered scene beats, so no other tier fits); `focus: 'foreground'` → `'normal'`, `'background'` → `'paused'` with `pausedAt = chat.length` at migration. Nothing else on the arc changes. `ensureChatState()` runs on every `getArcs()`, so the migration happens before the first injection is built; `saveMetadata()` is called once when anything migrated. The guard is `arc.tier` being set, not a version number. The old words survive in exactly one place: the episode section's header line still reads `=== FOREGROUNDED: "<title>" ===`, kept byte-for-byte so existing chats' cached prompt prefixes do not change (158358d). Outside `migrateArc()` itself and this note, nothing uses "foreground" any more. "background" came back on 2026-10-25 as a focus value with a different meaning (an act or saga kept off-screen, ADR-0001 amendment); the migration only touches arcs without a tier, so a pre-tier `background` still becomes `paused` and a tiered `background` arc is never migrated (`tests/test-background.js`).

No other module depends on more than `core/`. Core has no circular dependencies.

### lib/context/

Harvests story state from all available ST data sources.

- `harvester.js` — `harvestContext()` gathers every source and returns a `HarvestedContext` object with fields: `character`, `persona`, `lorebook` (split into `constants` / `arcSummaries` / `recent`), `chatHistory`, `existingArcs`. `chatHistory` holds story messages only: `selectStoryMessages` drops any message that names an id of a stored arc of any status (`arcInternalIds` from `signals.js`), quotes `INJECTION_HEADER` or holds `ARC_SIGNAL` (2026-10-30). A narrator's OOC analysis that printed a secret beside its id had been read by the planner as story, and the secret came back as a milestone pressure. Other OOC messages stay, because the user's own direction belongs in the planner's input
  - Lorebook: `fetchLorebookEntries()` reads World Info entries, `filterAndSort()` and `categorizeEntries()` classify them by comment/tag into three buckets (all three exported for tests)
  - Character: the private `getCharacterData()` pulls character name, description, personality, scenario; the private `getPersonaData()` reads the active user persona
- `chat-history.js` — extracts recent chat messages up to a token budget; exports `estimateTokens()` (character-count heuristic: chars / 4)

### lib/planning/

Arc generation, validation, storage, and prompt template management.

- `generator.js` — `generateArc(context, userDirection, callbacks, { tier, reviseArc, genre })` runs the two-phase LLM pipeline and stamps `tier`, `direction`, `genre` (only when non-empty), `messageStart` and `lastFulfilledAt` (= `messageStart`) on the validated arc. The tier travels three ways: `{{TIER_BLOCK}}` in Phase 2 (`buildTierBlock`, below), `validateArcPlan(parsed, { tier })` so the wizard's choice wins over whatever `tier` the model echoed (4246cf1), and the stamp on the result. Phase 1's `formatExistingArcs(arcs, reviseArcId)` marks the arc being re-planned `[BEING RE-PLANNED]` (`analyze-context.txt` explains the mark); Phase 2's existing-arcs list *omits* that arc — it is presented in the `{{ARC_SO_FAR}}` block (`buildArcSoFar`, below) instead, and listing it under "do not duplicate these" would tell the model not to cover its own ground (e3b81d8). The genre (ADR-0004) travels as `{{GENRE_BLOCK}}` in both phases, rendered by the exported `formatGenreBlock(genre, 'analysis' | 'outline')`: Phase 1 reads the story through it and reports material that leans another way as an imbalance, Phase 2 gets it as `== GENRE (binding) ==` above the creative direction. An empty genre renders no block. The genre is set from the wizard after validation, never from the model. When `reviseArc` is set, the validated plan is passed through `mergeReplan(reviseArc, arc)` (`replan.js`, ADR-0003) *inside* `generateArc`, so the wizard's review step shows the merged arc and Regenerate re-merges. Phase 3 is the plan check (2026-10-30, ADR-0006): `runPlanCheck(arc, story, revealableSecretIds, callbacks)` runs on the validated arc, on re-plan after the merge, so it sees every secret with its `disclosed` state and the ids the plan will be stored with. `buildPlanCheckVariables` fills `prompts/check-plan.txt` with the premise and the direction (passed as public, so carrying them out is never a give-away), every secret by id with phase and disclosure, the unfired triggers and the pressures of beats not yet completed; a re-plan also gets the Phase 1 analysis and the last 10 harvested messages (`PLAN_CHECK_RECENT_MESSAGES`). The model answers `{ revealed, rewrites: [{ kind, id, text }], links: [{ trigger, secret }] }`, and the exported pure `applyPlanCheck(arc, answer, revealableSecretIds)` applies it to a copy: rewrites only the `action` of unfired triggers and the `pressure` of open beats (a trigger rewrite that echoes the `IF … →` line is cut to the action), sets `disclosed` only for secrets of the arc being re-planned, and for those the `revealed` list decides both ways: a secret it leaves out goes back to `disclosed: false` (2026-10-31; a re-plan made while a leaked message was in the chat kept stating the leak after the user regenerated that message). On a re-plan the old `disclosed` mark is not shown to the check, so it judges from the story alone. A secret marked done by hand in the Arc Manager can therefore be un-marked by a re-plan, and fills a trigger's `secret` link only when it is empty or unknown. Unknown ids, empty texts and wrong shapes are ignored. A failed or unreadable check keeps the plan as generated and says so through `onProgress('retry', …)`. Live run on the re-planned Paragon act (after the premise/direction block was added): both revealed secrets found, the three give-aways rewritten, the other five items left alone; the run before it had rewritten two items that carried out the author's direction. The old detail-pass draft `prompts/detail-pass.txt` remains, and the template loader does not accept it. `generateArc` includes retry logic for JSON parse failures; supports progress callbacks (`onProgress`, `onChunk`, `isCancelled`). Both phases go through `callLlm()`, which builds a system+user message pair (large prompt as system message, short user trigger) and wraps the call in a retry loop (max 2 retries, linear backoff `2000 * (attempt + 1)` — 42bce4a, d064dc3; 42bce4a's message says "exponential", the code is linear). Whether an error is retried is decided by the exported `isRetryableError(detail)`, which matches `502|503|504|timeout|gateway|ETIMEDOUT|empty response` against `err.message` plus `err.cause?.message`. `empty response` is in that list because reasoning models (glm-5.2:thinking) sometimes emit only reasoning deltas and no content, which the routes below turn into `Empty response from API` — a per-call accident worth retrying. Auth, quota and model errors are deliberately not retryable: they fail identically every time and retrying only costs the user minutes. Each retry is reported through `onProgress('retry', …)` so the wizard shows it. The call itself takes one of two routes (e65449d):
  - **Profile route** — when `defaultConnectionProfile` is set, `callViaProfile()` streams through `ConnectionManagerRequestService.sendRequest(profileId, messages, undefined, { stream: true })`. `maxTokens` is deliberately `undefined`: ST deletes undefined payload keys before merging the profile preset, so the preset's response length wins — this is the owner-intended replacement for the old hardcoded `max_tokens: 4096` (INTENT of 2026-08-28 implemented in e65449d).
  - **Fallback route** — no profile configured: `callBackendDirectly()` POSTs a minimal body to ST's `/api/backends/chat-completions/generate` with `stream: true` and assembles the SSE deltas (a14ae32, a257d92). The body runs through ST's `EventSourceStream` (`/scripts/sse-stream.js`), which buffers until an event is complete, so an event split across two network chunks arrives whole; a complete event that is not JSON fails the call rather than being skipped. Each event's text is read by ST's `getStreamingReply(parsed, state, { chatCompletionSource })` from `/scripts/openai.js`, which knows every source's event shape (OpenAI `choices[0].delta.content`, Google `candidates[0].content.parts`, Claude `delta.text`); thoughts stay out of the text. Before 2026-10-26 the route read only the OpenAI shape and returned "Empty response from API" for Google and Claude. Model comes from `getChatCompletionModel(oai_settings)`, temperature from `oai_settings.temp_openai`, `max_tokens` from `oai_settings.openai_max_tokens` (the current API's response-length setting, 4096 only as last-resort default).

  Both routes report streaming progress by calling `onChunk(charsReceived)` per chunk. On the profile route `chunk.text` is cumulative and content-only (reasoning deltas live in `chunk.state.reasoning` and never reach `text`), so the count is `text.length`; the fallback route appends each event's delta and counts the assembled `fullText` after every event. Phase 2 can run two minutes, and without this the wizard has nothing to show.
  - **Templates** — `loadTemplate(name)` fetches a `.txt` file from `prompts/`; `fillTemplate(template, vars)` does `{{KEY}}` substitution
  - **Tier block** — `buildTierBlock(tier)` renders the `== TIER: … ==` block for `generate-arc.txt` from `TIER_TABLE`: beat count, "scene beat" vs "milestone" wording, length band; for act/saga also that milestones have no `unlockAfter`, that a fulfillment names a *state* the story has reached rather than a scene, and that `revealPhase` means a stretch of the whole arc. One template with three blocks, because separate templates would drift (77dbf33). The block also asks the model to echo `"tier"` into the JSON — a fallback only, since the generator passes the tier to validation directly.
  - **Arc so far** — `buildArcSoFar(arc)` renders the `== ARC SO FAR ==` block for re-planning: premise, established secrets (add-only instruction), escalation, and every fulfilled beat's fulfillment text under "already happened". Returns `''` for `null`, so the plan-new prompt stays byte-identical (e3b81d8).
- `validation.js` — `parseLlmJson()` strips markdown fences and extracts the first JSON object; `validateArcPlan(raw, { tier })` checks required fields (non-blank `title` and `premise`, non-empty `beats`), then that every beat is an object with a non-blank `intention` and that beat ids are unique after missing ones are filled in positionally — the content rules the Arc Manager's `applyArcEdit` applies too (its JSDoc lists where the two differ on purpose); it normalizes optional fields via helper functions, returns `{ valid, arc, errors }`. The tier decides the beat shape (77dbf33): `normalizeTier` defaults unknown or missing values to `episode`; for a milestone tier (`TIER_TABLE[tier].beatKind === 'milestone'`) every beat is stored `active` with `unlockAfter: []`, for episodes the first beat is `active`, the rest `pending`, `unlockAfter` kept; `estimatedLength` is clamped into `TIER_TABLE[tier].lengthBand` (a model asking for 40 on an episode gets 20). Stored arcs are never re-validated, so the clamp touches new arcs only. One more rule for milestone tiers (7ed5b1e): every milestone must carry a non-empty `pressure`, or validation fails with `Milestone "<id>" has no pressure` per beat — see "Milestones" below. `normalizeTrigger` keeps the trigger's optional `secret` link (the id of the secret it touches, `''` for none; 2026-10-30).
- `storage.js` — CRUD on `chat_metadata.story_arc.arcs[]`: `getArcs()`, `getActiveArcs()`, `getArcById()`, `saveArc()`, `updateArc()`, `replaceArc(storedArc, arc)` (the Arc Manager's JSON editor: replace in place, so a field deleted in the editor is gone), `deleteArc()`; each write calls `saveMetadata()`. `latestGenre(arcs)` returns the genre of the last arc in storage order that has one — the wizard's default for a new arc
- `replan.js` — `mergeReplan(existing, generated)` implements the spec §3 merge table; see "Re-plan" below (e3b81d8, b864ac1).
- `arc-preset.js` — the "Create arc preset" button behind the settings panel, plus the standing directives it stores.
  - `createArcPreset(baseProfileId, confirmOverwrite)` creates a barebones chat-completion preset named `Story Arc Generation` — not derived from any base preset — and clones the currently selected generation profile into a profile of the same name that pins it. Connection details (API, model, secret) come from the profile at request time, so the preset carries only generation parameters: the wire-verified combination (`reasoning_effort: 'high'`, `openai_max_tokens: 20000`, `temperature: 0.8`, `top_p: 0.95`, `stream_openai: true`) plus neutral pins for every other sampler/behavior key (`ARC_PRESET_SETTINGS`), because `presetToGeneratePayload` starts from a clone of the *live* chat settings and only overlays keys the preset defines — a dropped key silently falls back to the roleplay session.
  - **Standing directives** — adult content and genre live as ordinary prompt entries (`storyArcAdultContent`, `storyArcGenre`) inside the arc preset (whose prompt list carries *only* these entries — safe because ST's `PromptManager.checkForMissingPrompts` re-adds its mandatory system prompts on load), so the user edits and toggles them in SillyTavern's own prompt manager instead of in an extension panel. Nothing in ST reads them: Story Arc's calls never use a preset's prompt list, so the list is free storage. `readActiveArcDirectives()` resolves the preset pinned by the active generation profile, `collectArcDirectives(preset)` returns the enabled entries' text, and `generator.js` renders them into Phase 2 as a `== STANDING CONSTRAINTS ==` section via `{{ARC_DIRECTIVES}}`. Nothing enabled means no section at all. They are read from the *stored* preset, so a toggle counts only once the user saves the preset — ST's prompt manager writes toggles to the live settings, not to the preset file. Re-creating carries edited text and toggle states over from the preset it replaces, so a hand-written genre survives.

### lib/injection/

Builds and delivers prompt injections; tracks progress via AI-emitted signals.

- `builder.js` — `buildInjection(arcs)` is a dispatcher: `buildArcSection(arc)` picks one private section builder by focus and tier (`paused` → `buildPausedSection`; `background` → `buildBackgroundSection`; `spotlight` → `buildSpotlightSection`; episode/normal → `buildEpisodeSection`; act or saga/normal → `buildMilestoneSection`), orders sections spotlight first, then normal episodes, then the rest (storage order within each group), and trims an over-budget body by **whole list items** (`trimToBudget`): only the items under `SECRETS`, `TRIGGERS` and `FORESHADOWING TO PLANT` are dropped, from the last one in the body backwards, so the spotlit arc's items (ordered first) go last and no guardrail line (pacing rules, DO NOT, directives) of any section is ever cut — never a mid-sentence cut either. A header goes with its last item. If the body is still over budget once every list item is gone, it is sent over budget and the warning says so. Until 2026-10-26 the trim popped lines off the tail of the whole body, which with a spotlit act or saga plus a normal episode dropped the episode's guardrails before any of the act's list items; the naive tail-slice before that fired on every generation of a big arc and deleted exactly the guardrail sections while keeping the content blobs (found live 2026-08-29); `buildSignalInjection(arcs)` builds the in-chat injection as a *separate* injection (empty only when there are no arcs) — the signal directive (`buildSignalDirective`) was moved out of the plan text because the tail-slice budget trim used to cut it off first on any realistic plan (27c3d17), and it now also carries the `ARC PACING:` phase brake (see below), one line for the pacing clock only (issue #5): the brake's "arc message N" is the number the stamps carry, and the stamps count one episode, so a line for any other episode would point at a counter the model never sees.
  - **Section builders (2026-09-16; separate files under `sections/` until they were folded into `builder.js` on 2026-10-26).** The secrets, triggers and foreshadowing blocks are rendered once, by `pushPlanLists(lines, arc, phase)`, which the spotlit milestone section calls (2026-10-26). The `TRIGGERS` header adds that a trigger changes how characters act and never discloses a SECRET (2026-10-30): a generated trigger action in the Paragon chat restated a guarded secret, and the model narrated it as a confession the moment the condition was near. The header does not protect plans generated before the rule: with the old action re-armed, the next message that pressed the character leaked the secret again (#2023, 2026-10-30), because a general rule loses to the specific action next to it. The fix is in the plan text: `generate-arc.txt` forbids trigger actions that state a secret or a payoff ("creating an opening to …"), and pressures that state a secret, each with a FINAL CHECKLIST line. Plans already stored keep their text until re-planned (ADR-0003 rewrites unfired triggers) or edited in the Arc Manager. A post-generation word-overlap check was tried on the Paragon plans and rejected: a harmless pressure ("Fletchette is still holding the … SD card of Dice's bare chest", 4 shared words with its secret) scored like the two leaks (5 each), and 150 of the chat's item–secret pairs shared 4 or more words. The `PLANT CHECK` line still quotes each unfired trigger's action verbatim. Both places now leave out a trigger tied to a secret until that secret is shown (`isTriggerShown`: no link or an unknown id → shown; linked secret disclosed → shown; else `shouldShowSecret(revealPhase, phase)`; 2026-10-30): a re-planned act carried a climax-secret trigger into the prompt at escalation while the secret itself was held back. The plant check computes the phase with `calculatePhase`, the same phase that gates secrets in the plan, so its line set changes only when the plan text does and no extra cache miss appears. The plan check (Phase 3, ADR-0006) fills the link for plans whose generator left it empty. A link means the trigger belongs to the moment its secret comes out, not merely that a secret explains it (2026-10-31): with the broader "concerns a secret" wording, 3 of 4 triggers of a fresh act were tied to its climax secret and would have stayed hidden all act, although their actions were harmless reactions. `buildEpisodeSection` is the pre-tier full section, byte-for-byte including its header word (see the migration note under `lib/core/`), kept so existing chats' prompts do not change. `buildBackgroundSection` (2026-10-25) is the title under `=== BACKGROUND:` plus one sentence: "Runs off-screen. Leave it out of scenes — no hints, sounds or clues — unless the user's character goes to it or brings it up." No premise (a premise is a paragraph of the thread's pitch), no genre, no pressures, no lists; the arc's milestones stay in the beat check, and `showsPlanLists` already returns false for it, so it gets no plant-check lines. `buildPausedSection` (issue #3) is one line under `=== PAUSED:` — premise plus "pending, not being pursued right now"; the old "distant tension" wording is gone. `buildMilestoneSection` (act/saga, normal) renders `=== ACT: "<title>" ===` (or `SAGA`, from `TIER_TABLE.label`), a `GENRE:` line when the arc has a genre (ADR-0004; `buildEpisodeSection` prints it after its phase line), premise, every unfulfilled milestone's pressure under `STANDING PRESSURES`, and nothing else: no secrets, triggers or foreshadowing (2026-10-19). Those lists ask for a hint or a check every message, and a normal-focus saga carrying them pulled a superhero chat into its spy-thriller secrets. No `CURRENT PRESSURE`, no `PACING RULES`, no phase line, no `tone`/`directives`/`antiPatterns`: acts colour episodes, they do not carry their own guardrail block, and omitting the phase line keeps the section byte-identical between messages (77dbf33). `buildSpotlightSection` renders a spotlit episode as the plain episode section (spotlight changes nothing in the section; it only makes the arc the clock and orders it first) and a spotlit act/saga as the milestone section with the pressures block swapped for `BRING TO A HEAD:` + one trailer sentence ("Let these pressures intensify over the coming scenes, and let the world act on its own interests."), followed by the secrets under the shared `shouldShowSecret()` phase gating, triggers and foreshadowing. `buildMilestoneSection(arc, pressures, { withLists })` takes that block as an optional `{header, trailer}` and adds the lists only with `withLists: true`. No milestone is ever named as a target (ADR-0002).
- `clock.js` — `selectPacingClock(arcs)` returns the one episode whose count drives the stamps and the `ARC PACING` brake: the spotlit episode if any, else the first `normal` episode in storage order; paused episodes and all acts/sagas never qualify. `pauseArc(id)` / `resumeArc(id, focus)` / `spotlightArc(id)` are the arc manager's focus writers. `spotlightArc` keeps one arc in the spotlight: it resumes every other active spotlit arc into `normal`, then resumes the arc into `spotlight` (2026-10-25). Pause records `pausedAt = chat.length` (an already paused arc keeps its original freeze point). Resume adds `chat.length - pausedAt` to `messageStart` and to `lastFulfilledAt` (left absent on migrated arcs that never had it) and clears `pausedAt`, so the stamp number and the phase continue where they stopped; on an arc with `pausedAt == null` (never paused, or already resumed) it only writes `focus` — the arc manager routes normal ↔ spotlight changes through it too.
  - **No injected text may change per message — anywhere, including the tail.** `story_arc_plan` goes in at `IN_PROMPT`, ahead of the chat history and therefore inside the prefix an LLM provider caches. The plan text used to carry `Messages into arc: N` and `Do not advance … for at least N more messages`, both derived from `chat.length`, so every generation was a full cache write and zero cache read (found live 2026-08-30: `cache_read_input_tokens: 0`, 111,738 tokens rewritten per turn). Moving those counters past ST's Claude breakpoint (`cachingAtDepthForClaude` in `src/prompt-converters.js`) into the `IN_CHAT` depth-0 block did **not** fix it: measured again post-`85f469b` inside the 1h TTL, a chat with Story Arc active still read `cache_read_input_tokens: 0` while an identical chat without it cached normally. With this provider (nanogpt → `claude-opus-4-5-20251101:thinking`), Anthropic's documented 20-block lookback does not rescue a changing tail; every byte that occupied a position last turn must be identical this turn. So `buildPacingBlock()` no longer counts at all — it states the phase brake as a fixed arc-relative boundary (`phaseBoundaryMessage()`), which moves only when the phase does. The current count reaches the model through per-message stamps instead (see `stamping.js` below). The pacing block is emitted regardless of `autoTrack`; only the BEAT CHECK half is gated on it. The in-chat block is appended to the existing injection rather than added as a second one because the Claude converter counts system messages toward the depth, so each extra low-depth message pushes the breakpoint one real message further back.
- `stamping.js` — **how the exact counter survives the cache.** The model still needs "how far into this arc are we" on every generation, and one counter line anywhere is exactly the shape that breaks the prefix. The fix is to give every message its own counter: `buildStamp(arc, chatIndex)` returns `[Arc: message N of ~M]` where `N = chatIndex - arc.messageStart + 1` and `M = arc.estimatedLength` — a pure function of the index and fixed arc metadata, so message 67 reads "message 67 of ~80" this turn and every later turn. Old positions keep their bytes, only the appended tail is new, and the newest message carries the current number. `stampPromptMessages()` prepends the stamps on `CHAT_COMPLETION_PROMPT_READY`, mutating ST's outgoing messages array in place; stored chat (`chat[i].mes`) and the rendered UI are never touched. Details that matter:
  - **Only user messages are stamped** — half the tokens for the same pacing signal, and stamping the model's own past replies invites it to imitate the format and write `[Arc: message …]` into its prose. The cost is that the newest stamp lags on generations that follow an assistant message (Continue, or generating without typing): the model then reads the last *user* message's number, which can be a few behind. Accepted deliberately; the phase brake, not the exact count, is what enforces pacing.
  - **`focus` changes count as a lifecycle change.** The stamp comes from the pacing clock (`clock.js`), and `focus` defaults to `normal` for every new arc, so pausing or spotlighting an arc in the Arc Manager can hand every historical position a different arc's numbering. Same one-time cache miss as activating or deleting an arc, but a user hits this one far more often.
  - **Prompt entries are matched to chat indices by content suffix, not by position.** ST filters `is_system` messages out of `coreChat` (`public/script.js:4496`), `doChatInject` splices entries in, and other extensions add their own, so positions do not line up. An entry that matches nothing is skipped *without* consuming a chat index, so a foreign entry cannot shift every later number. If a regex script rewrote message text for the prompt, nothing matches and nothing is stamped — a no-op, never a wrong count.
  - **Arc lifecycle changes cost one cache miss.** Activating, completing or deleting an arc, or re-estimating its length, changes historical stamps. That is a few times per arc, and accepted.
  - **Other extensions' `generateRaw` calls fire the same event** (`public/script.js:4037`). The pass runs only on prompts containing `INJECTION_HEADER`, which only the real chat prompt carries.
  - **The plan section shows one beat and no ids.** The episode section carries a `CURRENT PRESSURE:` block holding the active beat's `pressure` text (falling back to `intention` for arcs planned before the field existed). Pending and locked beats are omitted entirely — no ids, no intentions, no teaser. Beat ids appear nowhere in the plan text at all. The old `CURRENT BEATS` list with `(NOW)`/`(upcoming)` markers turned the plan into a visible task list: live testing burned 7 of 10 non-optional beats in ~8 exchanges on an arc planned for 40 messages.
  - **Linger.** When an arc has no active beat (the gap between a completion and the next user message), the pressure block is replaced by a directive to develop consequences and introduce no new major developments.
  - `buildSignalDirective` always emits the continuation guard (never restart the scene, even when the last message is not the user's — RP presets like Celia wrap "the latest turn" at fixed depths, which mislabels the anchor when the user generates without input) and the confidentiality clause declaring the plan invisible scaffolding whose internals must not appear in any journal/summary/state-tracking block the preset requests. Both must survive linger, so neither is gated on having an active beat. The BEAT CHECK block and its marker lines are gated: they appear only while a beat is active, and each line is phrased as recognition of the past (`If the story has already brought this about — "<intention>" — output exactly: …`) with an explicit "these are not instructions, do not steer toward them". Earlier phrasings were read as objectives; a bare `:COMPLETE` token was read as status and forced the active beat into every reply
- `pacing.js` — `calculatePhase(arc)` computes beat-completion ratio and message-count ratio against `estimatedLength`, takes the minimum to get a conservative phase; `getPacingDirective(phase)` returns the directive string; `selectNonOptionalBeats(beats)` is the beat filter that phase, progress card and arc completion count; `shouldShowSecret(revealPhase, phase)` is the secret gate shared by the episode section and the spotlit milestone section (moved here from the episode section in 77dbf33 so both gate identically); `phaseBoundaryMessage(arc, phase)` returns the arc-relative message number where the phase ends — it does not read `chat.length`, which is what makes it safe to put in the prompt; `messagesUntilNextPhase(arc, phase)` turns the same boundary into a countdown for the progress card's "~N msgs to next phase" line, and is UI-only now. Both return `0` — not `NaN` — when the boundary cannot be computed, which is the case for arcs planned before `estimatedLength` and `messageStart` existed (e1bc69a)
- **Clue and trigger marks (2026-10-19).** Before this, nothing ever set `planted`, `fired` or `disclosed`: a 980-message chat showed 0 of each across 6 arcs, so every clue was sent as "TO PLANT" in every message and the model kept planting it. `buildSignalDirective` now adds a `PLANT CHECK:` block with one recognition line per unplanted clue (`:PLANTED`) and unfired trigger (`:FIRED`, quoting the trigger's action) of every arc whose section shows them (`showsPlanLists`: episodes not paused, acts and sagas in spotlight — the dispatch in `builder.js`). Secrets get no line, because it would have to state the secret right before the reply; they are marked by hand in the Arc Manager. Marks are **queued** in `chat_metadata.story_arc.pendingMarks`, not applied: a marked item leaves the plan and the plant check, and any changed byte is a full cache miss (rule above). `flushPendingMarks(messageIndex, promptChangesAnyway)` runs on every received message and applies the queue when a beat completed in that message (the prompt changes anyway) or when the oldest mark has waited `MARK_FLUSH_WINDOW` = 20 messages. Until then the item stays visible and a repeated marker for it is ignored (the queue is deduplicated). Any number of items may be marked per message; the one-beat-per-arc rule applies to beats only.
- `signals.js` — `parseSignals(text)` finds all `[ARC_SIGNAL:arcId:itemId:COMPLETE|PLANTED|FIRED]` tokens (the verb is returned as `verb`) anywhere in the message, bare or HTML-comment-wrapped (the directive asks for the comment form — ST's renderer hides it completely, even mid-stream; verified against `messageFormatting`: a custom tag leaves an empty `<p>`, an open/close tag leaks its inner text, a comment leaves nothing); `processSignalResults(signals, activeArcs, messageIndex)` marks signaled beats completed (`active` beats only, and at most one per arc per message — `pending` beats are not shown to the model at all, so a signal for one is a hallucinated or stale id, and an eager scene claiming two beats at once burns the arc's pace), stamps `arc.lastFulfilledAt = messageIndex` (the index `MESSAGE_RECEIVED` delivered, not `chat.length - 1` — see Gotchas; 23649df, 9c3e980), unlocks beats whose `unlockAfter` list is satisfied, marks arcs complete when all non-optional beats are done (27c3d17). It deliberately does **not** promote the next beat; `promoteNextBeats(arcs)` does that on `USER_MESSAGE_RENDERED`: for an episode it activates the first pending beat when none is active; for an act or saga it activates *every* pending milestone at once — validation already stores milestones `active`, so this only repairs an arc that arrived with pending ones (a re-plan merge, an old build) (77dbf33). Recording stays liberal in one direction on purpose: a completion signal is never refused for being too fast, because the signal arrives *after* the scene was written and refusing it would make the tracker disagree with the visible story. The brake is what the model can see, not what the bookkeeping accepts; `stripSignalsFromMessage()` removes tokens from both `chat[]` and the rendered DOM and trims the blank lines the marker leaves at message start; `scrubArcInternals(messageIndex, arcs)` mechanically removes leaked beat/arc ids from the saved message after marker parsing — the confidentiality clause steers the model, only the scrub guarantees it (RP presets with state-tracking blocks, e.g. Celia's `[Main-line]`, otherwise persist beat ids and next-beat agendas into history, where they steer later generations). Called with *all* arcs, not just active — past arcs' ids linger in journal recaps. Only underscore-containing ids are scrubbed; a plain-word id is indistinguishable from prose and harmless. The id list comes from the exported `arcInternalIds(arcs)` — arc ids plus beat, secret, clue and trigger ids; secret ids since 2026-10-30, after a narrator's OOC analysis printed one beside the secret's content — and the harvester uses the same list to keep such messages out of the planner's input

### lib/ui/

All user-facing views. No business logic — delegates to core/context/planning/injection.

- `settings-panel.js` — renders into the ST extension drawer; enable toggle, **"Generation profile" dropdown** (lists Connection Manager profiles from `extension_settings.connectionManager.profiles`, persists to `defaultConnectionProfile`, repopulates on mousedown so newly created profiles appear; empty option = "Current API" fallback — e65449d), "Plan Next Arc" / "Manage Arcs" buttons, and the progress container. It also owns the click handler for the progress widget's stall nudge (`.story-arc-stall-btn` → `showWizard(arcId)`, revise mode): the handler lives here rather than in `progress.js` because this file already imports the wizard and `progress.js` importing it would create a `progress ↔ wizard` cycle; and unlike the arc manager's Re-plan button there is no popup to close first (23649df). History note: the profile picker was claimed by the original docs long before it existed (VERIFY resolved 2026-08-28: never shipped until e65449d). The injection budget slider from the design spec remains unimplemented — only the per-chat `injectionBudget` key exists (read by `builder.js`); the unread global `defaultInjectionBudget` was removed.

- `wizard.js` — `showWizard(reviseArcId = null)`, multi-step planning popup: (1) show harvested context preview, (2) tier selector (default episode, from `TIER_TABLE`), a genre field (pre-filled from `latestGenre(getArcs())` for a new arc, from the arc on re-plan) and freeform direction input — stored as `arc.tier`, `arc.genre` and `arc.direction`, (3) live generation progress, (4) plan preview with accept/reject. **Revise mode** (e3b81d8): with `reviseArcId` set, `wizardState.reviseArc` holds the stored arc, step 2 is headed "Re-plan" with the tier pre-set and the selector limited to that tier or a larger one (`replanTiers` in `replan.js`, ADR-0003 amendment: re-plan never shrinks an arc), the direction pre-filled and editable **title** and **premise** fields; an emptied title or premise falls back to the stored value (an empty title is not a valid arc). `reviseArcWithEdits()` passes `{ ...arc, title, premise, direction, genre }` as `reviseArc` into `generateArc`, which merges (see "Re-plan"); step 4's button reads "Apply re-plan" and writes the merged arc back with `updateArc(arc.id, …)` instead of `saveArc`, so the id, the signal prefix and the progress card survive. Step 3 uses `createStepLog()`, an append-only log: each `onProgress` closes the running line (✓ plus elapsed seconds, ✗ when the next step is a retry) and appends a new one, while `onChunk` rewrites the running line's detail with the received char count, repainted at most every 250 ms.
- `arc-manager.js` — popup listing all arcs with status, tier and focus badges; a focus `<select>` (paused / background / normal / spotlight; background is not offered for an episode) wired to `clock.js` `pauseArc` / `spotlightArc` / `resumeArc` (choosing spotlight sends the previous spotlit arc back to normal); three spoiler groups per arc, Secrets, Clues and Triggers, each labelled with its count, its waiting reports and its done count (`buildPlanItemLists`, 2026-10-31). Each item is open, waiting (the model reported it and a mark is queued, hourglass with the message number) or done; waiting and open items come first, done ones after under their own heading. A click on an open item marks it done and on a done one sets it back (`togglePlanItem` in `arc-edit.js`; the toggle first drops a queued model mark for the item via `dropPendingMark`, so the flush cannot undo it; each toggle costs one cache miss); a click on a waiting item only drops the report and leaves it open. `buildReportsWaitingLine` puts "N reports waiting — applied with the next milestone or after 20 messages" on the arc card. Before this the single drawer showed a waiting item as open, and nothing explained why a queued mark would still close it later; a Re-plan button per active arc that closes the manager and then opens `showWizard(arcId)` (nested ST popups stack badly — same pattern as the wand menu); complete, abandon. A beat's status badge cycles it by hand, pending → active → completed → pending (a locked beat does not cycle); completing goes through `arc-edit.js` `completeBeat`, which unlocks a locked beat once all of its prerequisites are completed, the same rule as `processSignalResults`. Setting a completed beat back to pending does not lock its dependents again, and the toggle does not complete the arc. Each beat of an active arc has a pencil that opens an inline editor for `pressure` and `intention` ("Fulfilled when"). Save applies `arc-edit.js` `checkBeatEdit` — the validator's rules: intention never empty, pressure required on a milestone. Delete sits inside the editor and needs a second click (no nested confirm popup); `removeBeat` strips the id from every `unlockAfter` and sets a locked beat that waited for it to `pending` once its remaining prerequisites are all completed, because signal processing unlocks only when a prerequisite completes. Deleting the last beat is refused; deleting the last open non-optional beat completes the arc, the same rule as `processSignalResults`. Deleting the active episode beat leaves no active beat until the next user turn promotes one, as after a completion. Editing the active beat's pressure changes the `IN_PROMPT` plan text, so the next generation misses the provider cache once. **Edit arc** opens the whole active arc as JSON in the row. `applyArcEdit` refuses unparseable JSON, an empty `title` or `premise`, a non-list in any field the sections iterate over, an empty beat list, a non-positive `estimatedLength`, a beat without `id` or `unlockAfter` list, duplicate beat ids, and any beat that fails `checkBeatEdit` for the stored tier. It always restores `id`, `status`, `tier`, `focus`, `createdAt`, `messageStart`, `lastFulfilledAt` and `pausedAt` from the stored arc, because the pacing clock, signal matching and focus depend on them. Save goes through `storage.js` `replaceArc`, which replaces the stored arc object in place (a field deleted in the editor is gone), then `saveMetadata()`
- `wand-menu.js` — `registerWandMenuEntry()` appends a "Story Arc" item to ST's `#extensionsMenu` (the wand next to the chat bar) and `showWandPopup()` opens the quick-access popup: Plan Next Arc, Manage Arcs, and the active arcs' progress cards, all reusing `showWizard` / `showArcManager` / `renderProgressDisplay`. Setup rows (enable toggle, generation profile, arc preset) deliberately stay in the settings drawer, so the wand popup holds only the per-chat actions. Disabled extension shows a "disabled" note instead of dead buttons. Story Mode's Popper dropdown was not copied — nested ST popups stack badly, so this popup closes itself before opening the wizard or the manager (f4a0503). `showWandPopup` runs a `do…while` loop around the popup: when the sub-popup resolves, the wand popup is rebuilt and shown again, so several actions run without reopening the menu and the progress cards pick up whatever just changed (f754381)
- `progress.js` — compact widget showing beat list with status indicators (active / completed / pending / locked), injected near the ST message input. The count line reads `n/m beats` for episodes and `n/m milestones` for acts and sagas (77dbf33). Each card also carries a `~N msgs to next phase` line, rendered only while the message count is what holds the phase back — `calculatePhase()` takes the minimum of beat ratio and message ratio, so a full beat bar can still sit in an early phase and the reason was previously invisible. `0` (the beats are the limit, or the arc has no `estimatedLength`) and the `resolution` phase, which has nothing after it, both hide the line (e1bc69a). `isStalled(arc, chatLength)` is the pure stall rule behind the "May have drifted — re-plan?" nudge — see "Stall nudge" below (23649df)

## Arc Schema

The arc object stored in `chat_metadata.story_arc.arcs[]`:

```javascript
{
    id: string,              // UUID
    title: string,
    status: 'active' | 'completed' | 'abandoned',
    tier: 'episode' | 'act' | 'saga',   // size class, chosen at generation, only grown by re-plan (ADR-0001, ADR-0003 amendment)
    focus: 'paused' | 'background' | 'normal' | 'spotlight',  // prominence, set by hand; background: act/saga only
    createdAt: ISO8601,
    messageStart: number,    // chat.length when arc was created (for phase calculation);
                             // shifted forward on resume by the span the arc sat paused
    estimatedLength: number, // expected number of messages; clamped to TIER_TABLE[tier].lengthBand
    lastFulfilledAt: number, // chat index of the last fulfillment; = messageStart at planning,
                             // stamped by processSignalResults, shifted on resume (stall rule)
    pausedAt: number|null,   // chat.length when paused; null while not paused
    direction: string,       // the player's creative direction the arc was generated from;
                             // '' on arcs planned before 2026-09-16

    // Narrative identity
    premise: string,
    themes: string[],
    tone: string,
    directives: string[],    // "always do" rules for the AI
    antiPatterns: string[],  // "never do" rules

    // Beats — the structural spine. Scene beats on an episode, milestones on
    // an act or saga (same record shape; the tier decides how they are read)
    beats: [{
        id: string,
        pressure: string,    // the force the beat exerts BEFORE it happens — the only
                             // part the narrating AI ever sees. '' on pre-2026-08-29
                             // episodes; the episode section falls back to intention.
                             // Required on milestones (validation rejects an empty one)
        intention: string,   // the fulfillment condition: what has already happened on
                             // screen when the beat is complete (past tense). Shown only
                             // in the signal directive, never in the plan text
        flexibility: string, // how literally to interpret the intention
        urgency: 'when-ready' | 'soon' | 'urgent',
        status: 'pending' | 'active' | 'completed' | 'locked' | 'skipped',
                             // episode: one active at a time; act/saga: every
                             // unfulfilled milestone is active from planning on
        unlockAfter: string[], // beat IDs that must complete first; always [] on milestones
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

## Tiers and Focus

Multiple arcs can be active simultaneously. Tier owns an arc's shape, focus owns its prominence (ADR-0001, `CONTEXT.md`). The tier is chosen in the wizard at generation and only grown by re-plan (episode → act → saga, never smaller); the focus is set by hand in the Arc Manager at any time.

### Injection matrix — what `buildArcSection(arc)` picks

`builder.js` looks at focus first, then tier (`arc.tier || 'episode'`, so an arc without a tier is an episode):

| | Episode | Act / Saga |
|---|---|---|
| `paused` | `paused.js`: one line under `=== PAUSED:` — premise + "pending, not being pursued right now". No beat check line; clock frozen | same one line; no beat check |
| `background` | not offered (ADR-0001 amendment); re-plan never shrinks an act or saga into an episode (ADR-0003 amendment) | `background.js`: `=== BACKGROUND:` title + "Runs off-screen…" sentence. No premise, pressures or lists; milestones stay in the beat check; clock runs |
| `normal` | `episode.js`: full section (`CURRENT PRESSURE` of the one active beat, pacing rules, DO NOT, directives, gated secrets, triggers, foreshadowing). Pacing-clock candidate | `milestone.js`: `=== ACT:`/`SAGA:` header, premise, every unfulfilled milestone's pressure under `STANDING PRESSURES`. No secrets, triggers or foreshadowing, no brake, no clock, no phase line |
| `spotlight` | `spotlight.js` → the same full section, byte-identical; the arc **is** the pacing clock and is ordered first | `spotlight.js` → the milestone section with the pressures under `BRING TO A HEAD:` + one trailer sentence, then gated secrets, triggers, foreshadowing; ordered first so budget trimming never drops it. No milestone is named as a target (ADR-0002) |

Section order (`sectionRank`): spotlight first, then normal episodes, then everything else (normal acts and sagas, background, paused) — storage order within each group. The in-chat block is the same for every tier: `ARC PACING` names only the pacing clock; the beat check lists every `active` beat of every non-paused arc, which for an act or saga means every unfulfilled milestone. The phase (`calculatePhase`) feeds the brake boundary, secret gating and the progress card on an episode (the stamps do not depend on it); on an act or saga it feeds secret gating (spotlight only) and the progress card (phase label and the "~N msgs to next phase" line) only — `calculatePhase` itself is tier-blind.

### Milestones — activation and recognition

A milestone is an act's or saga's beat: unordered, all standing at once. `validateArcPlan` stores every milestone `active` with `unlockAfter: []`, so recognition can fire for any of them in any message from the first one on; `promoteNextBeats` keeps that invariant after a re-plan merge. The cap of one completion per arc per message still holds. A milestone is never shown to the model as its fulfillment (7ed5b1e, issue #13): the milestone and spotlight sections print only `pressure` and skip a milestone without one rather than substituting its intention, and `validateArcPlan` rejects an act or saga whose milestone lacks a `pressure` — one error per beat naming its id, through the same errors path the wizard already shows with Regenerate. The `pressure || intention` fallback inherited from pre-2026-08-29 episodes was removed here because it could print a past-tense fulfillment as a standing pressure, which under `BRING TO A HEAD` is exactly the named target ADR-0002 forbids. The episode fallback stays. The generator's tier block tells the model that a milestone's fulfillment names a *state* the story has reached, not a scene, so it can be recognised whatever route the story took.

### Pause — the clock freezes and shifts

`pauseArc(id)` writes `focus: 'paused'` and `pausedAt = chat.length` (an already paused arc keeps its original freeze point, so the span it sat out is never shortened). `resumeArc(id, focus)` on a paused arc adds `chat.length - pausedAt` to `messageStart` and to `lastFulfilledAt` and clears `pausedAt`, so the stamp number and the phase continue where they stopped: paused at chat length 100 on "message 12 of ~20", resumed at 115, the next user message still stamps "message 12" (pinned by `tests/test-clock.js`). On an arc with `pausedAt == null` it only writes `focus` — the Arc Manager routes every normal ↔ spotlight change through it too (b7bde8a). Shifting `messageStart` re-numbers every historical stamp: one prefix-cache miss, the same class as any focus change.

### Spotlight — the world moves, nothing is named

Spotlighting an episode changes nothing in its section; it makes that episode the pacing clock and orders it first. Spotlighting an act or saga moves its unfulfilled milestone pressures into the main block under `BRING TO A HEAD:` with the trailer "Let these pressures intensify over the coming scenes, and let the world act on its own interests." The obvious wording — "choose one of these and steer toward it" — is the goal instruction the 2026-08-29 pacing work found to be poison, so no milestone is ever named (ADR-0002). If live play shows spotlight is too soft, the next step is a tempo phrase ("within the next few scenes"), not a target; the trailer is a standalone sentence rather than a header parenthetical so that phrase is a one-line change (fcc104f).

### Live verification pending

The running SillyTavern instance loads the main checkout, so none of PRs #8–#14 was exercised in the browser. One manual pass on the test chat covers all of them:

1. **Tier selector and revise hand-off (#8):** open the Arc Manager, change an arc's focus with the `<select>`, click Re-plan → the wizard opens for that arc; plan a new arc with the tier selector.
2. **Pause/resume (#9):** pause an episode, write ~5 messages, resume, send a user message → the `[Arc: message N …]` stamp continues from where it stopped and the `ARC PACING` phase does not jump. Open a chat whose arc the migration set to paused (planned before tiers) → it renders `=== PAUSED:`; set it to normal and check the stamp number. The BEAT CHECK block omits the paused arc's beat while listing the active arc's.
3. **Re-plan (#10):** Re-plan an active episode with ≥2 completed beats → step 2 shows tier/direction/title/premise pre-filled; step 3 lists the kept completed beats first, then new beats, secrets include the originals; Apply re-plan → the arc keeps its id in the manager and the progress widget, the next user message promotes a new beat. Same with tier switched to act → milestones all active, no pacing brake. The console's phase 1 prompt shows `[BEING RE-PLANNED]`, phase 2 shows `== ARC SO FAR ==`.
4. **Act generation and injection (#11):** plan an act → 3–5 milestones, all active, no lock icons; the outgoing prompt contains `=== ACT: "…" ===` with a `STANDING PRESSURES` list and no `ARC PACING` line for that arc; a scene that fulfils one milestone completes it, the others stay active, the widget reads "1/n milestones".
5. **Spotlight (#12):** spotlight an act → the injected block starts with `BRING TO A HEAD:`, the milestone pressures, the trailer sentence, no intention text; with two episodes, spotlight the second → the `ARC PACING` line and the stamps switch to it.
6. **Stall nudge (#14):** an episode with its last fulfillment ≥ 11 messages back shows "May have drifted — re-plan?" in the settings drawer and the wand popup; clicking it opens the wizard pre-filled for that arc; a new fulfillment removes the nudge.

## Re-plan

Re-plan regenerates the unfulfilled part of an active arc from the story's current state, keeping its identity, its secrets and its fulfilled beats (ADR-0003, spec §3). Entry points: the Arc Manager's Re-plan button (closes the manager, then `showWizard(arcId)` — nested ST popups stack badly) and the stall nudge on the progress card (`showWizard(arcId)` directly, no popup to close).

| Step | What happens | Where |
|---|---|---|
| Wizard step 2 | tier pre-set, direction pre-filled, title and premise editable; untouched values kept verbatim | `wizard.js` revise mode |
| Phase 1 | existing-arcs list marks the arc `[BEING RE-PLANNED]`; the analyst is told not to report its unfulfilled beats as open threads | `generator.js` `formatExistingArcs`, `analyze-context.txt` |
| Phase 2 | `{{ARC_SO_FAR}}` block (premise, established secrets add-only, escalation, fulfilled beats as "already happened"); the arc is omitted from the existing-arcs list | `generator.js` `buildArcSoFar`, `generate-arc.txt` |
| Validate | as plan-new, with the tier chosen in the dialog | `validation.js` |
| Merge | `mergeReplan(reviseArc, generated)` inside `generateArc`, so step 3 reviews the merged arc and Regenerate re-merges | `replan.js` |
| Apply | "Apply re-plan" → `updateArc(arc.id, merged)`; the id, signal prefix and progress card survive | `wizard.js` |

**The merge keeps the situation and replaces the road:**

| Kept from the existing arc | Replaced by the generated plan |
|---|---|
| `id`, `createdAt`, `messageStart`, `pausedAt`, `lastFulfilledAt`, `focus`, `status` | `tier`, `estimatedLength` |
| `title`, `premise`, `direction` as edited in the dialog (the model's regenerated title/premise are ignored) | `directives`, `antiPatterns`, `tone`, `themes`, `escalation`, `characters` |
| every existing secret verbatim, incl. `disclosed`; generated secrets may only **add** | beats with status ≠ `completed` |
| beats with status `completed` | foreshadowing with `planted: false` |
| foreshadowing with `planted: true` | triggers with `fired: false` |
| triggers with `fired: true` | |

Details that matter: a generated secret whose trimmed, case-folded content equals an existing one is dropped (the block tells the model not to restate them, models do anyway); new beat/foreshadowing/trigger ids that collide with kept ids are suffixed `_2`, `_3`, … and `unlockAfter` references follow the rename (`withUniqueIds`); a new trigger's `secret` link follows its secret too, to the suffixed id or to the existing secret a restated one was dropped for, because a stale link would gate the trigger on the wrong secret's phase (2026-10-30); after the merge no episode beat is `active` — the next user turn promotes — while milestones are all set `active` at once. Neither input is mutated. Pinned by `tests/test-replan.js` (e3b81d8, b864ac1).

## Stall Nudge

A stall is the measurable sign of divergence: an episode going roughly three times its expected per-beat length without a fulfillment (`CONTEXT.md`). `isStalled(arc, chatLength)` in `progress.js`: episode only, not while paused, `chat.length - lastFulfilledAt > 3 × estimatedLength / nonOptionalBeatCount`. `lastFulfilledAt` is the chat index of the fulfilling message, so after N further messages the difference is N + 1: a 20-message episode with six non-optional beats nudges at N = 10 and not at N = 9 (pinned by `tests/test-stall.js`). A missing or `0` `lastFulfilledAt` counts from `messageStart` (`Math.max`), so a migrated episode is not nudged the moment it loads. Pausing does not count: resume shifts `lastFulfilledAt` by the paused span.

When it holds, the progress card shows "May have drifted — re-plan?" as a button that opens the wizard in revise mode for that arc. Nothing is injected — the nudge is player-facing only; the model is never told the arc stalled (23649df). Acts and sagas never stall: milestones cannot diverge.

## State Storage

### Global Settings (`extension_settings.story_arc`)
```javascript
{
    enabled: boolean,
    defaultConnectionProfile: string|null,
}
```

### Per-Chat State (`chat_metadata.story_arc`)
```javascript
{
    version: 1,
    arcs: ArcObject[],         // all arcs for this chat (active, completed, abandoned)
    settings: {
        injectionBudget: number,
        autoTrack: boolean,
    },
}
```

## SillyTavern Integration Points

| Integration | API | Purpose |
|------------|-----|---------|
| World Info | `getSortedEntries()` from `/scripts/world-info.js` | Read the chat/persona/character/global entries ST itself scans |
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
- **Do not migrate stored arcs to add `pressure`.** Arcs planned before 2026-08-29 have beats without the field; `buildEpisodeSection` (`builder.js`) falls back to `intention` and they keep working. A live arc in the owner's test chat depends on this.
- **`setExtensionPrompt` takes `(key, value, position, depth, scan, role, filter)`.** The original call passed seven positional args (an extra `0` before `scan`), shifting `role` into `scan` and the role constant into `filter` — it only worked because everything coerced to the intended values. Pinned by 27c3d17.
- **`generateQuietPrompt()` is not the alternative.** It routes through the full chat pipeline, which re-enters Story Arc's own `GENERATION_STARTED` / `MESSAGE_RECEIVED` handlers while a plan is being generated. Tried in 8787fea, reverted in a700465.
- **Non-streaming requests time out on large prompts.** The arc prompt arrives as one 24K+ char message and exceeds nano-gpt's ~38s non-streaming ceiling; normal chat escapes this only because its prompt is spread over many small messages. The request therefore sets `stream: true` and reassembles the SSE `data:` events, stopping at `[DONE]`. Pinned by a257d92.
- **The model name must come from `getChatCompletionModel(oai_settings)`.** `oai_settings.openai_model` is only correct for the OpenAI source — nanogpt keeps its model in `oai_settings.nanogpt_model`, so reading the field directly sent "gpt-5" to a backend that does not serve it. Pinned by ca2dfb8.
- **A 200 OK can still be an error.** Some backends return `{ error: … }` in a 200 body, and errors also turn up inside individual SSE chunks. Both paths throw instead of handing the body to the arc JSON parser, which otherwise reports it as a parse failure. Pinned by 3a14aa3.
- **The settings drawer needs ST's exact markup.** The header div must carry `inline-drawer-toggle` — ST binds its click handler to that class, not to `inline-drawer-header` — and without it the drawer silently never opens. Pinned by 1310dc7. Leave the styling to ST too: wrapper padding and a header border misalign the panel in the drawer list (a09887b).
- **Assistant-last histories make RP presets restart the scene.** Celia injects `<latest_turn_start>`/`<latest_turn_end>` wrappers at fixed IN_CHAT depths 1/0; when the user generates without typing (a normal way to advance the story), the wrappers label the model's *own last reply* as "the latest turn to answer", and GLM re-answered the last user message from scratch — three parallel takes of the same scene. The signal directive's continuation guard counters this at depth 0. Pinned by 8dbfdb1.
- **Every popup must unbind its click namespace when it resolves.** The handlers are delegated on `document`, so they outlive the popup's DOM. The wizard's `click.storyArcWizard` stayed bound after the wizard closed, and one click in the arc manager then fired both modules' `.story-arc-spoiler-toggle` handlers — the spoiler toggled twice and looked like nothing happened. The manager leaked the same way in reverse. Each popup now calls `$(document).off('click.<namespace>')` after `await popupPromise`. Pinned by 7945e3a; `wand-menu.js` follows the same pattern for `click.storyArcWandPopup`, and needs it more than the others because the popup is reopened in a loop.
- **`MESSAGE_RECEIVED`'s index is not always `chat.length - 1`.** `/sys at=N` emits the event with the index of the inserted message (`public/scripts/slash-commands.js:6006`); every other emission site (`script.js:6691,6716,6738,6781`, `group-chats.js:300`) does use the last index. `processSignalResults` therefore takes `messageIndex` from the handler instead of re-deriving it, so `lastFulfilledAt` points at the message that actually carried the marker. Pinned by 9c3e980.
- **Stored arcs are never re-validated.** The tier band clamp (episode 8–20) and the milestone rules apply at generation only; an existing episode with `estimatedLength: 40` keeps it, and re-plan replaces `estimatedLength` from the fresh generation. Reading the clamp as "no arc can have 40" is wrong for every arc planned before 2026-09-16 (77dbf33).
- **Never re-list the re-planned arc in Phase 2's existing arcs.** It sits in the `ARC SO FAR` block; the existing-arcs list carries "do not duplicate these", so listing it there too tells the model not to cover the arc's own ground. Phase 1 gets the `[BEING RE-PLANNED]` mark instead (e3b81d8).
- **Prompt clauses steer; only post-processing guarantees.** GLM pastes beat ids and next-beat agendas into Celia's `[Main-line]`/journal blocks even when told not to; because those blocks re-enter the prompt as history, the model ends up pacing the arc off its own agenda instead of the pacing rules. `scrubArcInternals` deletes the ids mechanically after every AI message — the confidentiality clause reduces the leakage, the scrub makes the identifiers unable to persist.

## Design Principles

1. **Context-first** — arc quality is bounded by context quality. Lorebook classification, chat trimming, and character harvesting are all weighted toward signal over noise.
2. **Narrative-first schema** — beats express *intention*, not script. Secrets, foreshadowing, and triggers give the AI creative latitude while keeping the arc on track.
3. **Conservative pacing** — phase advancement requires both beat completion and message count to exceed the threshold. The AI is explicitly told not to rush.
4. **Non-destructive** — read-only access to lorebook, chat history, and character data. Only `chat_metadata.story_arc` is written.
5. **Lean** — no bundler, no library, no file storage beyond `chat_metadata`. One module per responsibility. No features outside the core loop: harvest → plan → inject → track.
6. **Graceful degradation** — any single context source (lorebook, chat, character) is sufficient for generation. Empty sources produce placeholder text rather than errors.
