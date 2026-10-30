# Code Index

- **Coverage:** `index.js`, `lib/`, `prompts/`, `tests/`, `style.css`, `manifest.json`
- **Last Updated:** 2026-10-30

File structure and module dependencies. For quick reference, see [CLAUDE.md](../../CLAUDE.md). For system design, see [architecture.md](./architecture.md).

## Directory Structure

```
StoryArc/
├── index.js                    # Entry point, UI setup, event wiring
├── style.css                   # CSS import hub
├── manifest.json               # SillyTavern extension manifest
├── .gitignore                  # Git ignore rules
├── CLAUDE.md                   # AI coding assistant reference
├── prompts/
│   ├── analyze-context.txt     # Phase 1 prompt: analyze harvested context into story state;
│   │                           #   explains the [BEING RE-PLANNED] mark on existing arcs
│   ├── generate-arc.txt        # Phase 2 prompt: produce JSON arc plan from analysis;
│   │                           #   asks for both faces of each beat (pressure +
│   │                           #   fulfillment) plus breather beats and unresolved
│   │                           #   threads; {{TIER_BLOCK}} sets beat kind, count and
│   │                           #   length band ("Scene beats only" tags the episode-only
│   │                           #   guidelines); {{ARC_SO_FAR}} on re-plan; renders enabled
│   │                           #   arc directives as a STANDING CONSTRAINTS section
│   ├── check-plan.txt          # Phase 3 prompt: plan check — rewrite give-away triggers
│   │                           #   and pressures, list revealed secrets (re-plan),
│   │                           #   link triggers to secrets; answers JSON (ADR-0006)
│   └── detail-pass.txt         # Old detail-pass draft (not loaded)
├── lib/
│   ├── core/
│   │   ├── constants.js        # MODULE_NAME, INJECTION_HEADER, defaultSettings,
│   │   │                       #   defaultPerChatSettings, ARC_PHASES, PHASE_ORDER,
│   │   │                       #   PACING_DIRECTIVES, TIER_TABLE (label, beatKind,
│   │   │                       #   beatCount, lengthBand per tier), ARC_FOCUS,
│   │   │                       #   createDefaultArc()
│   │   └── settings.js         # loadSettings(), getSettings(), isEnabled(),
│   │                           #   ensureChatState() (runs migrateArc() over arcs
│   │                           #   stored before tiers existed — see the migration
│   │                           #   note in architecture.md), getChatSettings(),
│   │                           #   arcTier(arc), arcMessageStart(arc) — the tier and
│   │                           #   messageStart fallbacks, named once
│   ├── context/
│   │   ├── harvester.js        # harvestContext() — orchestrates all context sources,
│   │   │                       #   returns HarvestedContext object;
│   │   │                       #   selectStoryMessages() (private) drops messages
│   │   │                       #   naming plan ids, the injection header or markers;
│   │   │                       #   fetchLorebookEntries(), filterAndSort(),
│   │   │                       #   categorizeEntries() — read World Info entries,
│   │   │                       #   classify into constants / arcSummaries / recent;
│   │   │                       #   getCharacterData(), getPersonaData() (private) —
│   │   │                       #   character card fields + user persona
│   │   └── chat-history.js     # harvestChatHistory() — recent messages with token budget,
│   │                           #   estimateTokens()
│   ├── planning/
│   │   ├── generator.js        # generateArc(context, userDirection, callbacks, { tier, reviseArc, genre }) —
│   │   │                       #   two-phase LLM generation with retry logic; stamps
│   │   │                       #   tier, direction, genre, messageStart, lastFulfilledAt;
│   │   │                       #   formatGenreBlock(genre, phase) fills {{GENRE_BLOCK}}
│   │   │                       #   in both phases (ADR-0004);
│   │   │                       #   passes { tier } into validateArcPlan; on re-plan
│   │   │                       #   merges with mergeReplan(reviseArc, arc), then
│   │   │                       #   runPlanCheck() (Phase 3) with the exported
│   │   │                       #   buildPlanCheckVariables() / applyPlanCheck();
│   │   │                       #   formatExistingArcs(arcs, reviseArcId) marks the
│   │   │                       #   re-planned arc in phase 1, omits it in phase 2;
│   │   │                       #   callViaProfile() streams via
│   │   │                       #   ConnectionManagerRequestService when a profile
│   │   │                       #   is set; callBackendDirectly() POSTs
│   │   │                       #   /api/backends/chat-completions/generate and
│   │   │                       #   reads the SSE stream (fallback, bypasses
│   │   │                       #   generateRaw); isRetryableError(detail) — empty
│   │   │                       #   responses and gateway/timeout errors retry,
│   │   │                       #   auth/model errors fail fast;
│   │   │                       #   formatArcDirectives() renders the enabled
│   │   │                       #   preset directives into Phase 2;
│   │   │                       #   callbacks report steps and streamed chars;
│   │   │                       #   buildTierBlock(tier) → {{TIER_BLOCK}}: "== TIER: … =="
│   │   │                       #   with beat kind, beat count, length band and the
│   │   │                       #   milestone rules, all from TIER_TABLE;
│   │   │                       #   buildArcSoFar(arc) → {{ARC_SO_FAR}} on re-plan: premise,
│   │   │                       #   secrets (add-only), escalation, fulfilled beats as
│   │   │                       #   "already happened"; '' for null (plan-new);
│   │   │                       #   loadTemplate(name), fillTemplate(template, vars)
│   │   ├── arc-preset.js       # ARC_PRESET_NAME, ARC_PRESET_SETTINGS (fixed ~18-key
│   │   │                       #   barebones preset — no derivation from a base
│   │   │                       #   preset), ARC_PROMPT_ENTRIES (adult-content off,
│   │   │                       #   genre on), buildArcPresetSettings(),
│   │   │                       #   buildArcProfile(),
│   │   │                       #   createArcPreset(baseProfileId, confirmOverwrite);
│   │   │                       #   collectArcDirectives()/readActiveArcDirectives()
│   │   │                       #   read enabled directive prompt entries back out
│   │   ├── validation.js       # parseLlmJson() — strips fences, extracts JSON;
│   │   │                       #   validateArcPlan(raw, { tier }) — schema check +
│   │   │                       #   normalization: tier defaults to episode (the
│   │   │                       #   wizard's tier wins over the model's echo);
│   │   │                       #   milestones (act/saga) all active, unlockAfter
│   │   │                       #   stripped, non-empty pressure required; estimatedLength
│   │   │                       #   clamped to TIER_TABLE[tier].lengthBand; optional
│   │   │                       #   `pressure` per episode beat (stored arcs are
│   │   │                       #   not migrated or re-validated)
│   │   ├── storage.js          # CRUD on chat_metadata.story_arc.arcs:
│   │   │                       #   getArcs(), getActiveArcs(), getArcById(),
│   │   │                       #   saveArc(), updateArc(), replaceArc(stored, arc),
│   │   │                       #   deleteArc();
│   │   │                       #   latestGenre(arcs) — wizard default for a new arc
│   │   ├── arc-edit.js         # applyArcEdit(stored, json) — Edit arc save checks;
│   │   │                       #   checkBeatEdit(tier, edit) — validator's rules for a
│   │   │                       #   hand edit; removeBeat(beats, id) — drops the id from
│   │   │                       #   unlockAfter and unlocks beats with nothing left open
│   │   └── replan.js           # mergeReplan(existing, generated) — spec §3 merge:
│   │                           #   keeps identity, edited title/premise/direction,
│   │                           #   secrets (add-only, content-deduped), completed
│   │                           #   beats, planted foreshadowing, fired triggers;
│   │                           #   replaces the rest; withUniqueIds() suffixes
│   │                           #   colliding ids _2, _3, … and renames unlockAfter refs;
│   │                           #   replanTiers(tier) — the tiers a re-plan may pick:
│   │                           #   same or larger, never smaller (wizard selector)
│   ├── injection/
│   │   ├── builder.js          # buildInjection(arcs) — dispatcher keyed by (tier, focus):
│   │   │                       #   one section per arc (private builders below), spotlight first,
│   │   │                       #   then normal episodes, then the rest; respects token
│   │   │                       #   budget. buildSignalInjection(arcs) — separate injection
│   │   │                       #   (IN_CHAT depth 0): ARC PACING phase brake for the
│   │   │                       #   pacing clock (clock.js) always,
│   │   │                       #   continuation guard + confidentiality when autoTrack,
│   │   │                       #   BEAT CHECK + markers only while a beat is active.
│   │   │                       #   Every line here must be byte-identical from message
│   │   │                       #   to message within a phase — the block sits at the end
│   │   │                       #   of the prompt and any churn costs the whole cached
│   │   │                       #   prefix. The per-message counters live on the messages
│   │   │                       #   themselves (stamping.js).
│   │   │                       #   Sections are assembled guardrails-first with the
│   │   │                       #   content lists last (secrets, triggers, foreshadowing),
│   │   │                       #   and trimToBudget() drops whole trailing lines plus
│   │   │                       #   any header left without items
│   │   │                       #   Private section builders, picked by buildArcSection():
│   │   │                       #   buildEpisodeSection(arc) — the full section: premise,
│   │   │                       #   tone, active beat as CURRENT PRESSURE (pressure,
│   │   │                       #   falling back to intention), no beat ids; linger
│   │   │                       #   directive when no beat is active; guardrails first,
│   │   │                       #   content lists last. Header word kept from before
│   │   │                       #   tiers for byte-identity (architecture.md, migration);
│   │   │                       #   pushPlanLists(lines, arc, phase) — secrets,
│   │   │                       #   triggers, foreshadowing; buildMilestoneSection reuses it;
│   │   │                       #   buildPausedSection(arc) — one line under PAUSED: premise
│   │   │                       #   + "pending, not being pursued right now";
│   │   │                       #   buildBackgroundSection(arc) — act/saga: title under
│   │   │                       #   BACKGROUND: + "Runs off-screen…" sentence; no
│   │   │                       #   premise, no pressures (beats stay in the beat check);
│   │   │                       #   buildMilestoneSection(arc, pressures?) — act/saga:
│   │   │                       #   === ACT/SAGA: header, premise, unfulfilled milestone
│   │   │                       #   pressures under STANDING PRESSURES (header + trailer
│   │   │                       #   swappable; pressure only, never the fulfillment —
│   │   │                       #   a pressure-less milestone is skipped), gated
│   │   │                       #   secrets/triggers/foreshadowing; no
│   │   │                       #   pacing rules, no phase line;
│   │   │                       #   buildSpotlightSection(arc) — episode → episode section;
│   │   │                       #   act/saga → milestone section under BRING TO A HEAD
│   │   │                       #   + one trailer sentence, no milestone named;
│   │   │                       #   buildSignalDirective(arcs) — continuation guard,
│   │   │                       #   confidentiality clause, BEAT CHECK listing every
│   │   │                       #   active beat (all unfulfilled milestones on an
│   │   │                       #   act/saga); paused arcs get no recognition lines;
│   │   │                       #   PLANT CHECK with :PLANTED / :FIRED lines for the
│   │   │                       #   clues and triggers the arc's section shows
│   │   │                       #   (showsPlanLists(arc) decides which arcs show them)
│   │   ├── clock.js            # selectPacingClock(arcs) — spotlit episode, else first
│   │   │                       #   normal episode; never paused, never act/saga; feeds
│   │   │                       #   stamping.js;
│   │   │                       #   pauseArc(id) freezes the clock (pausedAt = chat.length);
│   │   │                       #   resumeArc(id, focus) shifts messageStart/lastFulfilledAt
│   │   │                       #   by the paused span, no-op on the clock if never paused;
│   │   │                       #   spotlightArc(id) — one arc in the spotlight, the
│   │   │                       #   previous spotlit arc goes back to normal
│   │   ├── pacing.js           # calculatePhase(arc), selectNonOptionalBeats(beats),
│   │   │                       #   getPacingDirective(phase),
│   │   │                       #   shouldShowSecret(revealPhase, phase) — secret gate
│   │   │                       #   shared by the episode and milestone sections;
│   │   │                       #   phaseBoundaryMessage(arc, phase) — arc-relative
│   │   │                       #   message number where the phase ends (chat-length
│   │   │                       #   independent, safe to put in the prompt);
│   │   │                       #   messagesUntilNextPhase(arc, phase) — same boundary as
│   │   │                       #   a countdown, progress card only. Both return 0
│   │   │                       #   (not NaN) for arcs without estimatedLength or
│   │   │                       #   messageStart
│   │   ├── stamping.js         # buildStamp(arc, chatIndex) — "[Arc: message N of ~M]",
│   │   │                       #   a pure function of the index and fixed arc metadata;
│   │   │                       #   stampPromptMessages(promptChat, arcs) — prepends the
│   │   │                       #   stamp to every user message in the OUTGOING prompt
│   │   │                       #   array on CHAT_COMPLETION_PROMPT_READY. Stored chat
│   │   │                       #   and the UI are never touched. Entries are matched to
│   │   │                       #   chat indices by content suffix, not position
│   │   └── signals.js          # parseSignals(text) — extracts [ARC_SIGNAL:…:COMPLETE|PLANTED|FIRED] tokens;
│   │                           #   PLANTED/FIRED are queued in pendingMarks and applied by
│   │                           #   flushPendingMarks(messageIndex, promptChangesAnyway);
│   │                           #   dropPendingMark() for the Arc Manager's hand toggle
│   │                           #   (bare or HTML-comment-wrapped);
│   │                           #   processSignalResults(signals, arcs, messageIndex) —
│   │                           #   marks ACTIVE beats complete (max one per arc per
│   │                           #   message), stamps lastFulfilledAt = messageIndex,
│   │                           #   unlocks gated beats, marks arcs complete; does NOT
│   │                           #   promote;
│   │                           #   promoteNextBeats(arcs) — episode: activates the next
│   │                           #   pending beat; act/saga: activates every pending
│   │                           #   milestone; called on USER_MESSAGE_RENDERED (one
│   │                           #   user turn later);
│   │                           #   stripSignalsFromMessage() — removes tokens + blank-line residue;
│   │                           #   scrubArcInternals() — deletes leaked beat/arc ids from message
│   ├── ui/
│   │   ├── settings-panel.js   # renderSettingsPanel() — extension drawer HTML:
│   │   │                       #   enable toggle, generation profile dropdown
│   │   │                       #   (Connection Manager profiles), 'Create arc preset'
│   │   │                       #   button (handleCreateArcPreset(), no base-preset
│   │   │                       #   dropdown), plan/manage buttons, progress container;
│   │   │                       #   setupSettingsPanelEvents() also wires the stall
│   │   │                       #   nudge (.story-arc-stall-btn → showWizard(arcId))
│   │   ├── wand-menu.js        # registerWandMenuEntry() — adds a "Story Arc" item to
│   │   │                       #   #extensionsMenu (the wand next to the chat bar);
│   │   │                       #   showWandPopup() reopens itself after the wizard or
│   │   │                       #   the manager resolves, so the progress cards rebuild;
│   │   │                       #   says the extension is disabled instead of offering
│   │   │                       #   dead buttons
│   │   ├── wizard.js           # showWizard(reviseArcId?) — multi-step arc planning popup:
│   │   │                       #   context preview → tier selector + direction →
│   │   │                       #   generation view (append-only step log with elapsed
│   │   │                       #   times, live streamed-chars ticker, active profile
│   │   │                       #   name) → review. Revise mode: tier/direction/title/
│   │   │                       #   premise pre-filled, reviseArcWithEdits() feeds
│   │   │                       #   generateArc, "Apply re-plan" writes via updateArc;
│   │   │                       #   unbinds its click namespace when the popup resolves
│   │   ├── arc-manager.js      # showArcManager() — arc list popup: status/tier/focus
│   │   │                       #   badges, focus <select> (paused / background / normal
│   │   │                       #   / spotlight via clock.js; no background for an
│   │   │                       #   episode), Re-plan (closes, then opens
│   │   │                       #   showWizard(arcId)), complete, abandon; per beat an
│   │   │                       #   inline editor (pressure + intention, delete with a
│   │   │                       #   second click) and an Edit arc JSON editor (via
│   │   │                       #   arc-edit.js); unbinds the whole
│   │   │                       #   .storyArcManager namespace when the popup resolves
│   │   └── progress.js         # renderProgressDisplay() — compact beat status display
│   │                           #   injected into ST sidebar; "n/m beats" or "n/m
│   │                           #   milestones"; shows "~N msgs to next phase" only
│   │                           #   while the message count holds the phase back,
│   │                           #   never in resolution; isStalled(arc, chatLength) —
│   │                           #   the stall rule behind the "May have drifted —
│   │                           #   re-plan?" button (episodes only, not while paused)
│   └── css/
│       ├── core.css            # CSS custom properties, base layout, badges incl.
│       │                       #   the tier badge
│       ├── spoiler.css         # Spoiler toggle (hidden arc content)
│       ├── wizard.css          # Wizard popup layout, step indicators, tier row and
│       │                       #   hint, generation step log and streamed-chars ticker
│       ├── arc-manager.css     # Arc list, beat rows, status badges
│       └── progress.css        # Compact sidebar progress widget, incl. the
│                               #   "msgs to next phase" line and the stall nudge
├── tests/
│   ├── run.sh                  # Node.js test runner (node:test)
│   ├── smoke.sh                # HTTP smoke tests against live ST instance
│   ├── setup.js                # Registers ESM loader before test files load
│   ├── loader.js               # Custom ESM loader — intercepts ST imports, returns mocks
│   ├── mocks/
│   │   └── st-mocks.js         # Mock exports for /script.js, /scripts/extensions.js, etc.
│   ├── test-core.js            # Tests: core/constants (phases, defaults, arc factory)
│   ├── test-lorebook.js        # Tests: fetchLorebookEntries (filter/sort), categorizeEntries
│   ├── test-arc-preset.js      # Tests: pinned preset keys, directive entry defaults
│   │                           #   and round-trip through a re-create, preset/profile
│   │                           #   creation and overwrite handling
│   ├── test-builder.js         # Tests: plan-section beat visibility (active-only,
│   │                           #   pressure w/ intention fallback, linger) + dispatch
│   │                           #   by tier × focus + signal directive (recognition
│   │                           #   phrasing, linger survival, paused arcs skipped)
│   │                           #   + section order and line-boundary trimming
│   │                           #   + triggers tied to a secret (hidden until shown)
│   │                           #   + prefix-cache stability (IN_PROMPT and in-chat
│   │                           #   blocks byte-identical as messages accumulate)
│   ├── test-arc-edit.js        # Tests: applyArcEdit (kept fields, save checks) +
│   │                           #   checkBeatEdit (empty intention, milestone
│   │                           #   pressure) + removeBeat (unlockAfter cleanup, unlock)
│   ├── test-background.js      # Tests: background focus — section text, no premise or
│   │                           #   pressures, beat check kept, no plant check, never the
│   │                           #   clock, resume shift, migration untouched, re-plan
│   ├── test-clock.js           # Tests: selectPacingClock (spotlit episode, else first
│   │                           #   normal; never paused/act/saga) + pauseArc/resumeArc
│   │                           #   clock freeze and shift (stamp number continues) +
│   │                           #   spotlightArc (previous spotlit arc back to normal)
│   ├── test-migration.js       # Tests: migrateArc on arcs stored before tiers +
│   │                           #   ensureChatState running it once
│   ├── test-replan.js          # Tests: mergeReplan (kept vs. replaced fields, secrets
│   │                           #   add-only, id de-collision, tier change) + replanTiers +
│   │                           #   buildArcSoFar + formatExistingArcs mark
│   ├── test-spotlight.js       # Tests: spotlit act/saga BRING TO A HEAD block (no
│   │                           #   milestone named, ordered first), spotlit episode
│   │                           #   byte-identical, brake follows the clock
│   ├── test-stall.js           # Tests: isStalled threshold (hand-computed boundary),
│   │                           #   never for paused/act/saga, migrated arcs,
│   │                           #   lastFulfilledAt set on fulfillment and shifted on
│   │                           #   resume, nudge rendering
│   ├── test-stamping.js        # Tests: buildStamp purity + stampPromptMessages
│   │                           #   (numbering, old positions unchanged as the chat
│   │                           #   grows, foreign-entry and rewritten-text handling,
│   │                           #   stamps follow the spotlit episode)
│   ├── test-tier.js            # Tests: buildTierBlock per tier, milestone section
│   │                           #   (normal focus; pressure-less milestone skipped),
│   │                           #   progress widget milestone label
│   ├── test-generator.js       # Tests: isRetryableError (retryable vs. fail-fast);
│   │                           #   generateArc stream routes, plan check applied or
│   │                           #   skipped on an unreadable answer
│   ├── test-plan-check.js      # Tests: applyPlanCheck (scope, revealed on re-plan
│   │                           #   only, links, echoed IF line) + buildPlanCheckVariables
│   ├── test-harvester.js       # Tests: harvestContext drops messages with plan ids,
│   │                           #   the injection header or markers, keeps OOC direction
│   ├── test-genre.js           # Tests: formatGenreBlock, {{GENRE_BLOCK}} slots in both
│   │                           #   templates, GENRE: line per section, latestGenre,
│   │                           #   mergeReplan keeps the edited genre
│   ├── test-pacing.js          # Tests: phase calculation + pacing directives +
│   │                           #   messagesUntilNextPhase (boundary offset, missing
│   │                           #   estimatedLength/messageStart)
│   ├── test-marks.js           # Tests: PLANTED/FIRED parsing, PLANT CHECK lines per
│   │                           #   tier/focus, queue keeps the prompt byte-identical
│   │                           #   until flush, flush rules, togglePlanItem
│   ├── test-signals.js         # Tests: signal parsing + processSignalResults
│   │                           #   (active-only completion, one per arc per message,
│   │                           #   locked-beat rejection) + promoteNextBeats
│   │                           #   + milestones (all active, any order)
│   │                           #   + scrubArcInternals (incl. secret ids)
│   ├── test-templates.js       # Tests: template loading + {{KEY}} substitution
│   └── test-validation.js      # Tests: parseLlmJson + validateArcPlan incl. tier
│                               #   (default, milestone activation, band clamp,
│                               #   pressure-less milestone rejected)
├── CONTEXT.md                  # Glossary — the words for tier, focus, beats, recognition
└── docs/
    ├── adr/                    # Decision records 0001–0006 (tier/focus split,
    │                           #   spotlight names no target, re-plan keeps the situation,
    │                           #   genre binds generation, marks wait for a prompt change,
    │                           #   plans are checked for give-aways)
    ├── architecture/
    │   ├── architecture.md     # System design documentation
    │   ├── code-index.md       # This file
    │   └── st-extension-patterns.md
    │                           # SillyTavern extension API reference
    ├── claude/                 # onboarding.md (routing table) + canon guidelines
    ├── plans/                  # Dated design specs and implementation plans
    └── goals/GOALS.md          # High-level feature goals
```

The three architecture docs moved out of the repo root into `docs/architecture/`
(docs reorganization 2026-08-28, outside git history).

## Module Dependencies

```
lib/core/
├── constants.js  (no external deps)
└── settings.js   (imports: constants.js, /scripts/extensions.js, /script.js;
                   ensureChatState() runs migrateArc() over stored arcs)

lib/context/
├── chat-history.js  (imports: /script.js)
└── harvester.js     (imports: chat-history.js, planning/storage.js,
                      injection/signals.js arcInternalIds, core/constants.js, /script.js,
                      /scripts/extensions.js, /scripts/world-info.js getSortedEntries)

lib/planning/
├── validation.js  (imports: core/constants.js)
├── storage.js     (imports: core/settings.js, /script.js)
├── arc-edit.js    (imports: core/constants.js)
├── replan.js      (imports: core/constants.js)
├── arc-preset.js  (imports: core/settings.js, /script.js, /scripts/extensions.js,
│                   /scripts/preset-manager.js, /scripts/utils.js)
└── generator.js   (imports: validation.js, arc-preset.js, replan.js, core/settings.js,
                    core/constants.js, /script.js, /scripts/utils.js;
                    dynamic imports: /scripts/openai.js, /scripts/extensions/shared.js,
                    /scripts/sse-stream.js; templates are fetched from prompts/)

lib/injection/
├── pacing.js   (imports: core/constants.js, core/settings.js, /script.js)
├── clock.js    (imports: planning/storage.js, core/settings.js, /script.js)
├── stamping.js (imports: clock.js, core/constants.js, core/settings.js, /script.js)
├── signals.js  (imports: planning/storage.js, core/settings.js, pacing.js, /script.js)
└── builder.js  (imports: pacing.js, clock.js, core/settings.js,
                 core/constants.js, context/chat-history.js)

lib/ui/
├── progress.js      (imports: planning/storage.js, injection/pacing.js,
│                              core/settings.js, /script.js, /scripts/utils.js)
├── settings-panel.js (imports: core/constants.js, core/settings.js,
│                              planning/arc-preset.js, wizard.js, arc-manager.js,
│                              /script.js, /scripts/extensions.js, /scripts/popup.js)
├── wizard.js        (imports: context/harvester.js, planning/generator.js,
│                              planning/storage.js, planning/replan.js,
│                              core/settings.js, core/constants.js, progress.js,
│                              /scripts/extensions.js, /scripts/popup.js,
│                              /scripts/utils.js)
├── wand-menu.js     (imports: core/settings.js, planning/storage.js, progress.js,
│                              wizard.js, arc-manager.js, /scripts/popup.js,
│                              /scripts/utils.js)
└── arc-manager.js   (imports: planning/storage.js, planning/arc-edit.js,
                               injection/signals.js, injection/pacing.js,
                               injection/clock.js, core/settings.js,
                               core/constants.js, progress.js, wizard.js,
                               /scripts/popup.js, /scripts/utils.js)

index.js  (imports: core/settings.js, planning/storage.js, injection/builder.js,
                    injection/stamping.js, injection/signals.js,
                    ui/settings-panel.js, ui/wand-menu.js, ui/progress.js,
                    /script.js)
```

## Key Files by Feature

| Feature | Primary File | Supporting Files |
|---------|-------------|------------------|
| Extension entry | `index.js` | `lib/core/constants.js`, `lib/core/settings.js` |
| Context harvesting | `lib/context/harvester.js` (`fetchLorebookEntries`, `categorizeEntries`, `getCharacterData`, `getPersonaData`) | `chat-history.js` |
| Arc generation | `lib/planning/generator.js` (`loadTemplate`, `fillTemplate`) | `validation.js`, `arc-preset.js`, `prompts/` |
| Arc preset + profile | `lib/planning/arc-preset.js` | `lib/ui/settings-panel.js`, `lib/planning/generator.js` (`formatArcDirectives`) |
| Arc storage | `lib/planning/storage.js` | `lib/core/settings.js` |
| Prompt injection | `lib/injection/builder.js` (`buildArcSection` and the section builders) | `pacing.js`, `signals.js` |
| Tier (shape at generation) | `lib/planning/validation.js` | `lib/planning/generator.js` (`buildTierBlock`), `lib/core/constants.js` (`TIER_TABLE`), `prompts/generate-arc.txt` |
| Milestones (act/saga injection + recognition) | `lib/injection/builder.js` (`buildMilestoneSection`) | `builder.js` (`buildSignalDirective`), `signals.js` (`promoteNextBeats`) |
| Focus: pause / resume | `lib/injection/clock.js` | `builder.js` (`buildPausedSection`), `lib/ui/arc-manager.js` |
| Focus: background | `lib/injection/builder.js` (`buildBackgroundSection`) | `lib/ui/arc-manager.js` (no background for episodes), `lib/planning/replan.js` (`replanTiers`: re-plan never shrinks an act or saga into an episode) |
| Focus: spotlight | `lib/injection/builder.js` (`buildSpotlightSection`, `sectionRank`, `buildPacingBlock`) | `clock.js` |
| Pacing clock (stamps + brake) | `lib/injection/clock.js` | `stamping.js`, `builder.js` |
| Re-plan | `lib/planning/replan.js` | `generator.js` (`buildArcSoFar`, `formatExistingArcs`), `lib/ui/wizard.js` (revise mode), `prompts/analyze-context.txt` |
| Stall nudge | `lib/ui/progress.js` (`isStalled`) | `lib/ui/settings-panel.js` (click handler), `lib/injection/signals.js` (`lastFulfilledAt`) |
| Tier/focus migration | `lib/core/settings.js` (`migrateArc`) | `lib/planning/storage.js` |
| Phase/pacing | `lib/injection/pacing.js` | `lib/core/constants.js` |
| Signal tracking | `lib/injection/signals.js` | `lib/planning/storage.js` |
| Beat promotion / pacing brake | `lib/injection/signals.js` (`promoteNextBeats`) | `index.js` (`USER_MESSAGE_RENDERED`), `builder.js` |
| Planning wizard | `lib/ui/wizard.js` | `lib/context/`, `lib/planning/` |
| Arc manager | `lib/ui/arc-manager.js` | `lib/planning/storage.js`, `lib/injection/clock.js`, `wizard.js` |
| Progress display | `lib/ui/progress.js` | `lib/injection/pacing.js` |
| Wand-menu entry | `lib/ui/wand-menu.js` | `lib/ui/progress.js`, `wizard.js`, `arc-manager.js`, `index.js` |
| Settings panel | `lib/ui/settings-panel.js` | `lib/core/settings.js`, `lib/planning/arc-preset.js` |
| Styles | `style.css` | `lib/css/*.css` |
