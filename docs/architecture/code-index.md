# Code Index

- **Coverage:** `index.js`, `lib/`, `prompts/`, `tests/`, `style.css`, `manifest.json`
- **Last Updated:** 2026-09-17

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
│   └── detail-pass.txt         # Phase 3 prompt: expand beats and foreshadowing (deferred)
├── lib/
│   ├── core/
│   │   ├── index.js            # Facade — re-exports MODULE_NAME, settings, constants
│   │   ├── constants.js        # MODULE_NAME, INJECTION_HEADER, defaultSettings,
│   │   │                       #   defaultPerChatSettings, ARC_PHASES, PHASE_ORDER,
│   │   │                       #   PACING_DIRECTIVES, TIER_TABLE (label, beatKind,
│   │   │                       #   beatCount, lengthBand per tier), ARC_FOCUS,
│   │   │                       #   createDefaultArc()
│   │   └── settings.js         # loadSettings(), getSettings(), isEnabled(),
│   │                           #   ensureChatState() (runs migrateArc() over arcs
│   │                           #   stored before tiers existed — see the migration
│   │                           #   note in architecture.md), getChatSettings()
│   ├── context/
│   │   ├── index.js            # Facade — re-exports harvestContext()
│   │   ├── harvester.js        # harvestContext() — orchestrates all context sources,
│   │   │                       #   returns HarvestedContext object
│   │   ├── lorebook.js         # harvestLorebook() — reads World Info entries,
│   │   │                       #   classifies into constants / arcSummaries / recent
│   │   ├── character.js        # harvestCharacter() — character card fields + user persona
│   │   └── chat-history.js     # harvestChatHistory() — recent messages with token budget,
│   │                           #   estimateTokens()
│   ├── planning/
│   │   ├── index.js            # Facade — re-exports generateArc(), saveArc(), getArcs(),
│   │   │                       #   getActiveArcs(), getArcById(), updateArc(), deleteArc(),
│   │   │                       #   ARC_PRESET_NAME, createArcPreset(),
│   │   │                       #   collectArcDirectives(), readActiveArcDirectives()
│   │   ├── generator.js        # generateArc(context, userDirection, callbacks, { tier, reviseArc }) —
│   │   │                       #   two-phase LLM generation with retry logic; stamps
│   │   │                       #   tier, direction, messageStart, lastFulfilledAt;
│   │   │                       #   passes { tier } into validateArcPlan; on re-plan
│   │   │                       #   returns mergeReplan(reviseArc, arc);
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
│   │   │                       #   callbacks report steps and streamed chars
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
│   │   │                       #   saveArc(), updateArc(), deleteArc()
│   │   ├── tier-block.js       # buildTierBlock(tier) → {{TIER_BLOCK}}: "== TIER: … =="
│   │   │                       #   with beat kind, beat count, length band and the
│   │   │                       #   milestone rules, all from TIER_TABLE
│   │   ├── arc-so-far.js       # buildArcSoFar(arc) → {{ARC_SO_FAR}} on re-plan: premise,
│   │   │                       #   secrets (add-only), escalation, fulfilled beats as
│   │   │                       #   "already happened"; '' for null (plan-new)
│   │   ├── replan.js           # mergeReplan(existing, generated) — spec §3 merge:
│   │   │                       #   keeps identity, edited title/premise/direction,
│   │   │                       #   secrets (add-only, content-deduped), completed
│   │   │                       #   beats, planted foreshadowing, fired triggers;
│   │   │                       #   replaces the rest; withUniqueIds() suffixes
│   │   │                       #   colliding ids _2, _3, … and renames unlockAfter refs
│   │   └── templates.js        # loadTemplate(name), fillTemplate(template, vars)
│   ├── injection/
│   │   ├── index.js            # Facade — re-exports buildInjection(), buildSignalInjection(),
│   │   │                       #   parseSignals(), stripSignalsFromMessage(),
│   │   │                       #   processSignalResults(), scrubArcInternals(),
│   │   │                       #   promoteNextBeats(), stampPromptMessages()
│   │   ├── builder.js          # buildInjection(arcs) — dispatcher keyed by (tier, focus):
│   │   │                       #   one section per arc from sections/, spotlight first,
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
│   │   ├── sections/
│   │   │   ├── episode.js      # buildEpisodeSection(arc) — the full section: premise,
│   │   │   │                   #   tone, active beat as CURRENT PRESSURE (pressure,
│   │   │   │                   #   falling back to intention), no beat ids; linger
│   │   │   │                   #   directive when no beat is active; guardrails first,
│   │   │   │                   #   content lists last. Header word kept from before
│   │   │   │                   #   tiers for byte-identity (architecture.md, migration)
│   │   │   ├── paused.js       # buildPausedSection(arc) — one line under PAUSED: premise
│   │   │   │                   #   + "pending, not being pursued right now"
│   │   │   ├── milestone.js    # buildMilestoneSection(arc, pressures?) — act/saga:
│   │   │   │                   #   === ACT/SAGA: header, premise, unfulfilled milestone
│   │   │   │                   #   pressures under STANDING PRESSURES (header + trailer
│   │   │   │                   #   swappable; pressure only, never the fulfillment —
│   │   │   │                   #   a pressure-less milestone is skipped), gated
│   │   │   │                   #   secrets/triggers/foreshadowing; no
│   │   │   │                   #   pacing rules, no phase line
│   │   │   ├── spotlight.js    # buildSpotlightSection(arc) — episode → episode section;
│   │   │   │                   #   act/saga → milestone section under BRING TO A HEAD
│   │   │   │                   #   + one trailer sentence, no milestone named
│   │   │   └── signal-directive.js  # buildSignalDirective(arcs) — continuation guard,
│   │   │                       #   confidentiality clause, BEAT CHECK listing every
│   │   │                       #   active beat (all unfulfilled milestones on an
│   │   │                       #   act/saga); paused arcs get no recognition lines
│   │   ├── clock.js            # selectPacingClock(arcs) — spotlit episode, else first
│   │   │                       #   normal episode; never paused, never act/saga; feeds
│   │   │                       #   stamping.js;
│   │   │                       #   pauseArc(id) freezes the clock (pausedAt = chat.length);
│   │   │                       #   resumeArc(id, focus) shifts messageStart/lastFulfilledAt
│   │   │                       #   by the paused span, no-op on the clock if never paused
│   │   ├── pacing.js           # calculatePhase(arc), getPacingDirective(phase),
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
│   │   └── signals.js          # parseSignals(text) — extracts [ARC_SIGNAL:…:COMPLETE] tokens
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
│   │   ├── index.js            # Facade — re-exports renderSettingsPanel(),
│   │   │                       #   setupSettingsPanelEvents(), showWizard(),
│   │   │                       #   showArcManager(), updateProgress(),
│   │   │                       #   registerWandMenuEntry()
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
│   │   │                       #   badges, three-way focus <select> (paused / normal /
│   │   │                       #   spotlight via clock.js), Re-plan (closes, then opens
│   │   │                       #   showWizard(arcId)), complete, abandon; unbinds the whole
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
│   ├── test-lorebook.js        # Tests: categorizeEntries (World Info classification)
│   ├── test-arc-preset.js      # Tests: pinned preset keys, directive entry defaults
│   │                           #   and round-trip through a re-create, preset/profile
│   │                           #   creation and overwrite handling
│   ├── test-builder.js         # Tests: plan-section beat visibility (active-only,
│   │                           #   pressure w/ intention fallback, linger) + dispatch
│   │                           #   by tier × focus + signal directive (recognition
│   │                           #   phrasing, linger survival, paused arcs skipped)
│   │                           #   + section order and line-boundary trimming
│   │                           #   + prefix-cache stability (IN_PROMPT and in-chat
│   │                           #   blocks byte-identical as messages accumulate)
│   ├── test-clock.js           # Tests: selectPacingClock (spotlit episode, else first
│   │                           #   normal; never paused/act/saga) + pauseArc/resumeArc
│   │                           #   clock freeze and shift (stamp number continues)
│   ├── test-migration.js       # Tests: migrateArc on arcs stored before tiers +
│   │                           #   ensureChatState running it once
│   ├── test-replan.js          # Tests: mergeReplan (kept vs. replaced fields, secrets
│   │                           #   add-only, id de-collision, tier change) +
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
│   ├── test-generator.js       # Tests: isRetryableError (retryable vs. fail-fast)
│   ├── test-pacing.js          # Tests: phase calculation + pacing directives +
│   │                           #   messagesUntilNextPhase (boundary offset, missing
│   │                           #   estimatedLength/messageStart)
│   ├── test-signals.js         # Tests: signal parsing + processSignalResults
│   │                           #   (active-only completion, one per arc per message,
│   │                           #   locked-beat rejection) + promoteNextBeats
│   │                           #   + milestones (all active, any order)
│   │                           #   + scrubArcInternals
│   ├── test-templates.js       # Tests: template loading + {{KEY}} substitution
│   └── test-validation.js      # Tests: parseLlmJson + validateArcPlan incl. tier
│                               #   (default, milestone activation, band clamp,
│                               #   pressure-less milestone rejected)
├── CONTEXT.md                  # Glossary — the words for tier, focus, beats, recognition
└── docs/
    ├── adr/                    # Decision records 0001–0003 (tier/focus split,
    │                           #   spotlight names no target, re-plan keeps the situation)
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
├── lorebook.js      (imports: /scripts/world-info.js or SillyTavern.getContext())
├── character.js     (imports: /script.js)
├── chat-history.js  (imports: /script.js)
└── harvester.js     (imports: lorebook.js, character.js, chat-history.js, planning/storage.js)

lib/planning/
├── templates.js   (no ST deps — fetch only)
├── validation.js  (imports: core/constants.js)
├── storage.js     (imports: core/settings.js, /script.js)
├── tier-block.js  (imports: core/constants.js)
├── arc-so-far.js  (no deps)
├── replan.js      (no deps)
├── arc-preset.js  (imports: core/settings.js, /script.js, /scripts/extensions.js,
│                   /scripts/preset-manager.js, /scripts/utils.js)
└── generator.js   (imports: templates.js, validation.js, arc-preset.js,
                    tier-block.js, arc-so-far.js, replan.js, core/settings.js, /script.js;
                    dynamic imports: /scripts/openai.js, /scripts/extensions/shared.js)

lib/injection/
├── pacing.js   (imports: core/constants.js, /script.js)
├── clock.js    (imports: planning/storage.js, /script.js)
├── stamping.js (imports: clock.js, core/constants.js, /script.js)
├── signals.js  (imports: planning/storage.js, /script.js)
├── sections/   (episode.js imports pacing.js; milestone.js imports pacing.js,
│                core/constants.js; spotlight.js imports episode.js, milestone.js;
│                paused.js, signal-directive.js: no deps)
└── builder.js  (imports: pacing.js, clock.js, sections/*, core/settings.js,
                 core/constants.js, context/chat-history.js)

lib/ui/
├── progress.js      (imports: planning/storage.js, injection/pacing.js, /script.js)
├── settings-panel.js (imports: core/constants.js, core/settings.js, planning/index.js,
│                              wizard.js, arc-manager.js, /script.js,
│                              /scripts/extensions.js, /scripts/popup.js)
├── wizard.js        (imports: context/index.js, planning/index.js (generateArc,
│                              saveArc, updateArc, getArcById), core/settings.js,
│                              core/constants.js, progress.js, /script.js,
│                              /scripts/extensions.js, /scripts/popup.js)
├── wand-menu.js     (imports: core/settings.js, planning/storage.js, progress.js,
│                              wizard.js, arc-manager.js, /scripts/popup.js)
└── arc-manager.js   (imports: planning/storage.js, injection/pacing.js, injection/clock.js,
                               core/settings.js, core/constants.js, progress.js,
                               wizard.js, /script.js, /scripts/popup.js)

index.js  (imports: core/, ui/, injection/, planning/storage.js,
                    /script.js, /scripts/extensions.js)
```

## Key Files by Feature

| Feature | Primary File | Supporting Files |
|---------|-------------|------------------|
| Extension entry | `index.js` | `lib/core/constants.js`, `lib/core/settings.js` |
| Context harvesting | `lib/context/harvester.js` | `lorebook.js`, `character.js`, `chat-history.js` |
| Arc generation | `lib/planning/generator.js` | `templates.js`, `validation.js`, `arc-preset.js`, `prompts/` |
| Arc preset + profile | `lib/planning/arc-preset.js` | `lib/ui/settings-panel.js`, `lib/planning/generator.js` (`formatArcDirectives`) |
| Arc storage | `lib/planning/storage.js` | `lib/core/settings.js` |
| Prompt injection | `lib/injection/builder.js` | `sections/*.js`, `pacing.js`, `signals.js` |
| Tier (shape at generation) | `lib/planning/validation.js` | `lib/planning/tier-block.js`, `lib/core/constants.js` (`TIER_TABLE`), `prompts/generate-arc.txt` |
| Milestones (act/saga injection + recognition) | `lib/injection/sections/milestone.js` | `sections/signal-directive.js`, `signals.js` (`promoteNextBeats`) |
| Focus: pause / resume | `lib/injection/clock.js` | `sections/paused.js`, `lib/ui/arc-manager.js` |
| Focus: spotlight | `lib/injection/sections/spotlight.js` | `clock.js`, `builder.js` (`sectionRank`, `buildPacingBlock`) |
| Pacing clock (stamps + brake) | `lib/injection/clock.js` | `stamping.js`, `builder.js` |
| Re-plan | `lib/planning/replan.js` | `arc-so-far.js`, `generator.js` (`formatExistingArcs`), `lib/ui/wizard.js` (revise mode), `prompts/analyze-context.txt` |
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
