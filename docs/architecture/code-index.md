# Code Index

File structure and module dependencies. For quick reference, see [CLAUDE.md](./CLAUDE.md). For system design, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Directory Structure

```
StoryArc/
├── index.js                    # Entry point, UI setup, event wiring
├── style.css                   # CSS import hub
├── manifest.json               # SillyTavern extension manifest
├── .gitignore                  # Git ignore rules
├── CLAUDE.md                   # AI coding assistant reference
├── ARCHITECTURE.md             # System design documentation
├── CODEINDEX.md                # This file
├── ST-EXTENSION-PATTERNS.md    # SillyTavern extension API reference
├── prompts/
│   ├── analyze-context.txt     # Phase 1 prompt: analyze harvested context into story state
│   ├── generate-arc.txt        # Phase 2 prompt: produce JSON arc plan from analysis
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
│   │   │                       #   getActiveArcs(), getArcById(), updateArc(), deleteArc()
│   │   ├── generator.js        # generateArc(context, userDirection, callbacks) —
│   │   │                       #   two-phase LLM generation with retry logic
│   │   ├── validation.js       # parseLlmJson() — strips fences, extracts JSON;
│   │   │                       #   validateArcPlan() — schema check + normalization
│   │   ├── storage.js          # CRUD on chat_metadata.story_arc.arcs:
│   │   │                       #   getArcs(), getActiveArcs(), getArcById(),
│   │   │                       #   saveArc(), updateArc(), deleteArc()
│   │   └── templates.js        # loadTemplate(name), fillTemplate(template, vars)
│   ├── injection/
│   │   ├── index.js            # Facade — re-exports buildInjection(),
│   │   │                       #   parseSignals(), processSignalResults()
│   │   ├── builder.js          # buildInjection(arcs) — assembles full prompt injection
│   │   │                       #   text from foreground/background arcs, respects token budget
│   │   ├── pacing.js           # calculatePhase(arc), getPacingDirective(phase),
│   │   │                       #   messagesUntilNextPhase(arc, phase)
│   │   └── signals.js          # parseSignals(text) — extracts [ARC_SIGNAL:…:COMPLETE] tokens;
│   │                           #   processSignalResults() — marks beats complete, unlocks
│   │                           #   gated beats, marks arcs complete;
│   │                           #   stripSignalsFromMessage() — removes tokens from display
│   ├── ui/
│   │   ├── index.js            # Facade — re-exports renderSettingsPanel(),
│   │   │                       #   openWizard(), openArcManager(), renderProgress()
│   │   ├── settings-panel.js   # renderSettingsPanel() — extension drawer HTML,
│   │   │                       #   enable toggle, connection profile, budget controls
│   │   ├── wizard.js           # openWizard() — multi-step arc planning popup:
│   │   │                       #   context preview → user direction → generation progress
│   │   ├── arc-manager.js      # openArcManager() — arc list popup: view, activate,
│   │   │                       #   deactivate, delete, foreground/background toggle
│   │   └── progress.js         # renderProgress() — compact beat status display
│   │                           #   injected into ST sidebar
│   └── css/
│       ├── core.css            # CSS custom properties, base layout
│       ├── spoiler.css         # Spoiler toggle (hidden arc content)
│       ├── wizard.css          # Wizard popup layout and step indicators
│       ├── arc-manager.css     # Arc list, beat rows, status badges
│       └── progress.css        # Compact sidebar progress widget
├── tests/
│   ├── run.sh                  # Node.js test runner (node:test)
│   ├── smoke.sh                # HTTP smoke tests against live ST instance
│   ├── setup.js                # Registers ESM loader before test files load
│   ├── loader.js               # Custom ESM loader — intercepts ST imports, returns mocks
│   ├── mocks/
│   │   └── st-mocks.js         # Mock exports for /script.js, /scripts/extensions.js, etc.
│   └── test-core.js            # Tests: validation, pacing, signals (pure logic)
└── docs/
    └── goals/GOALS.md          # High-level feature goals
```

## Module Dependencies

```
lib/core/
├── constants.js  (no external deps)
└── settings.js   (imports: constants.js, /scripts/extensions.js, /script.js)

lib/context/
├── lorebook.js      (imports: /scripts/world-info.js or SillyTavern.getContext())
├── character.js     (imports: /script.js)
├── chat-history.js  (imports: /script.js)
└── harvester.js     (imports: lorebook.js, character.js, chat-history.js, planning/storage.js)

lib/planning/
├── templates.js   (no ST deps — fetch only)
├── validation.js  (imports: core/constants.js)
├── storage.js     (imports: core/settings.js, /script.js)
└── generator.js   (imports: templates.js, validation.js, core/settings.js, /script.js)

lib/injection/
├── pacing.js   (imports: core/constants.js, /script.js)
├── signals.js  (imports: planning/storage.js, /script.js)
└── builder.js  (imports: pacing.js, core/settings.js, context/chat-history.js)

lib/ui/
├── progress.js      (imports: planning/storage.js, injection/pacing.js)
├── settings-panel.js (imports: core/settings.js, /scripts/extensions.js)
├── wizard.js        (imports: context/harvester.js, planning/generator.js,
│                              planning/storage.js, /scripts/popup.js)
└── arc-manager.js   (imports: planning/storage.js, /scripts/popup.js)

index.js  (imports: core/, ui/, injection/, planning/storage.js,
                    /script.js, /scripts/extensions.js)
```

## Key Files by Feature

| Feature | Primary File | Supporting Files |
|---------|-------------|------------------|
| Extension entry | `index.js` | `lib/core/constants.js`, `lib/core/settings.js` |
| Context harvesting | `lib/context/harvester.js` | `lorebook.js`, `character.js`, `chat-history.js` |
| Arc generation | `lib/planning/generator.js` | `templates.js`, `validation.js`, `prompts/` |
| Arc storage | `lib/planning/storage.js` | `lib/core/settings.js` |
| Prompt injection | `lib/injection/builder.js` | `pacing.js`, `signals.js` |
| Phase/pacing | `lib/injection/pacing.js` | `lib/core/constants.js` |
| Signal tracking | `lib/injection/signals.js` | `lib/planning/storage.js` |
| Planning wizard | `lib/ui/wizard.js` | `lib/context/`, `lib/planning/` |
| Arc manager | `lib/ui/arc-manager.js` | `lib/planning/storage.js` |
| Progress display | `lib/ui/progress.js` | `lib/injection/pacing.js` |
| Settings panel | `lib/ui/settings-panel.js` | `lib/core/settings.js` |
| Styles | `style.css` | `lib/css/*.css` |
