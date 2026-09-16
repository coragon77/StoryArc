# Code Index

- **Coverage:** `index.js`, `lib/`, `prompts/`, `tests/`, `style.css`, `manifest.json`
- **Last Updated:** 2026-09-16

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
│   ├── analyze-context.txt     # Phase 1 prompt: analyze harvested context into story state
│   ├── generate-arc.txt        # Phase 2 prompt: produce JSON arc plan from analysis;
│   │                           #   asks for both faces of each beat (pressure +
│   │                           #   fulfillment) plus breather beats and unresolved
│   │                           #   threads; renders enabled arc directives as a
│   │                           #   STANDING CONSTRAINTS section
│   └── detail-pass.txt         # Phase 3 prompt: expand beats and foreshadowing (deferred)
├── lib/
│   ├── core/
│   │   ├── index.js            # Facade — re-exports MODULE_NAME, settings, constants
│   │   ├── constants.js        # MODULE_NAME, defaultSettings, defaultPerChatSettings,
│   │   │                       #   ARC_PHASES, PHASE_ORDER, PACING_DIRECTIVES,
│   │   │                       #   createDefaultArc()
│   │   └── settings.js         # loadSettings(), getSettings(), isEnabled(),
│   │                           #   ensureChatState(), getChatSettings()
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
│   │   │                       #   validateArcPlan() — schema check + normalization,
│   │   │                       #   incl. the optional `pressure` field per beat
│   │   │                       #   (stored arcs are not migrated)
│   │   ├── storage.js          # CRUD on chat_metadata.story_arc.arcs:
│   │   │                       #   getArcs(), getActiveArcs(), getArcById(),
│   │   │                       #   saveArc(), updateArc(), deleteArc()
│   │   ├── tier-block.js       # buildTierBlock(tier) → {{TIER_BLOCK}} — stub, returns ''
│   │   ├── arc-so-far.js       # buildArcSoFar(arc) → {{ARC_SO_FAR}} — stub, returns ''
│   │   ├── replan.js           # mergeReplan(existing, generated) — stub, returns generated
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
│   │   │   │                   #   content lists last. Header still reads FOREGROUNDED
│   │   │   ├── paused.js       # buildPausedSection(arc) — one-line premise as distant
│   │   │   │                   #   tension. Header still reads BACKGROUNDED
│   │   │   ├── milestone.js    # buildMilestoneSection(arc) — act/saga in normal focus;
│   │   │   │                   #   stub: falls through to the paused one-liner
│   │   │   ├── spotlight.js    # buildSpotlightSection(arc) — episode → episode section;
│   │   │   │                   #   act/saga stub: falls through to the paused one-liner
│   │   │   └── signal-directive.js  # buildSignalDirective(arcs) — continuation guard,
│   │   │                       #   confidentiality clause, BEAT CHECK (moved unchanged)
│   │   ├── clock.js            # selectPacingClock(arcs) — spotlit episode, else first
│   │   │                       #   normal episode; never paused, never act/saga;
│   │   │                       #   pauseArc(id) / resumeArc(id, focus) — stubs that only
│   │   │                       #   write focus (clock freeze/shift come with the focus ticket)
│   │   ├── pacing.js           # calculatePhase(arc), getPacingDirective(phase),
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
│   │                           #   processSignalResults() — marks ACTIVE beats complete
│   │                           #   (max one per arc per message), unlocks gated beats,
│   │                           #   marks arcs complete; does NOT promote;
│   │                           #   promoteNextBeats(arcs) — activates the next pending beat,
│   │                           #   called on USER_MESSAGE_RENDERED (one user turn later);
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
│   │   │                       #   dropdown), plan/manage buttons, progress container
│   │   ├── wand-menu.js        # registerWandMenuEntry() — adds a "Story Arc" item to
│   │   │                       #   #extensionsMenu (the wand next to the chat bar);
│   │   │                       #   showWandPopup() reopens itself after the wizard or
│   │   │                       #   the manager resolves, so the progress cards rebuild;
│   │   │                       #   says the extension is disabled instead of offering
│   │   │                       #   dead buttons
│   │   ├── wizard.js           # openWizard() — multi-step arc planning popup:
│   │   │                       #   context preview → user direction → generation view
│   │   │                       #   (append-only step log with elapsed times, live
│   │   │                       #   streamed-chars ticker, active profile name);
│   │   │                       #   unbinds its click namespace when the popup resolves
│   │   ├── arc-manager.js      # openArcManager() — arc list popup: view, activate,
│   │   │                       #   deactivate, delete, foreground/background toggle;
│   │   │                       #   unbinds its click namespace when the popup resolves
│   │   └── progress.js         # renderProgress() — compact beat status display
│   │                           #   injected into ST sidebar; shows "~N msgs to next
│   │                           #   phase" only while the message count holds the phase
│   │                           #   back, never in resolution
│   └── css/
│       ├── core.css            # CSS custom properties, base layout
│       ├── spoiler.css         # Spoiler toggle (hidden arc content)
│       ├── wizard.css          # Wizard popup layout, step indicators, generation
│       │                       #   step log and streamed-chars ticker
│       ├── arc-manager.css     # Arc list, beat rows, status badges
│       └── progress.css        # Compact sidebar progress widget, incl. the
│                               #   "msgs to next phase" line
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
│   │                           #   pressure w/ intention fallback, linger) + signal
│   │                           #   directive (recognition phrasing, linger survival)
│   │                           #   + section order and line-boundary trimming
│   │                           #   + prefix-cache stability (IN_PROMPT and in-chat
│   │                           #   blocks byte-identical as messages accumulate)
│   ├── test-stamping.js        # Tests: buildStamp purity + stampPromptMessages
│   │                           #   (numbering, old positions unchanged as the chat
│   │                           #   grows, foreign-entry and rewritten-text handling)
│   ├── test-generator.js       # Tests: isRetryableError (retryable vs. fail-fast)
│   ├── test-pacing.js          # Tests: phase calculation + pacing directives +
│   │                           #   messagesUntilNextPhase (boundary offset, missing
│   │                           #   estimatedLength/messageStart)
│   ├── test-signals.js         # Tests: signal parsing + processSignalResults
│   │                           #   (active-only completion, one per arc per message,
│   │                           #   locked-beat rejection) + promoteNextBeats
│   │                           #   + scrubArcInternals
│   ├── test-templates.js       # Tests: template loading + {{KEY}} substitution
│   └── test-validation.js      # Tests: parseLlmJson + validateArcPlan
└── docs/
    ├── architecture/
    │   ├── architecture.md     # System design documentation
    │   ├── code-index.md       # This file
    │   └── st-extension-patterns.md
    │                           # SillyTavern extension API reference
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
├── tier-block.js  (no deps — stub)
├── arc-so-far.js  (no deps — stub)
├── replan.js      (no deps — stub)
├── arc-preset.js  (imports: core/settings.js, /script.js, /scripts/extensions.js,
│                   /scripts/preset-manager.js, /scripts/utils.js)
└── generator.js   (imports: templates.js, validation.js, arc-preset.js,
                    tier-block.js, arc-so-far.js, core/settings.js, /script.js;
                    dynamic imports: /scripts/openai.js, /scripts/extensions/shared.js)

lib/injection/
├── pacing.js   (imports: core/constants.js, /script.js)
├── clock.js    (imports: planning/storage.js)
├── stamping.js (imports: clock.js, core/constants.js, /script.js)
├── signals.js  (imports: planning/storage.js, /script.js)
├── sections/   (episode.js imports pacing.js; spotlight.js and milestone.js
│                import episode.js / paused.js; paused.js, signal-directive.js: no deps)
└── builder.js  (imports: pacing.js, clock.js, sections/*, core/settings.js,
                 context/chat-history.js)

lib/ui/
├── progress.js      (imports: planning/storage.js, injection/pacing.js)
├── settings-panel.js (imports: core/constants.js, core/settings.js, planning/index.js,
│                              wizard.js, arc-manager.js, /script.js,
│                              /scripts/extensions.js, /scripts/popup.js)
├── wizard.js        (imports: context/harvester.js, planning/generator.js,
│                              planning/storage.js, core/constants.js, /scripts/popup.js)
├── wand-menu.js     (imports: core/settings.js, planning/storage.js, progress.js,
│                              wizard.js, arc-manager.js, /scripts/popup.js)
└── arc-manager.js   (imports: planning/storage.js, injection/clock.js, core/constants.js,
                               wizard.js, /scripts/popup.js)

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
| Prompt injection | `lib/injection/builder.js` | `sections/*.js`, `clock.js`, `pacing.js`, `signals.js` |
| Pacing clock (stamps + brake) | `lib/injection/clock.js` | `stamping.js`, `builder.js` |
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
