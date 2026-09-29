# AGENTS.md

Quick reference for coding agents (Claude Code, pi, Mistral Vibe) when working with this repository.

## Project Overview

Story Arc is a SillyTavern extension that plans new story arcs for existing, long-running stories. Unlike Story Mode (which plans stories from scratch), Story Arc harvests context from the current chat -- lorebook entries, chat history, summaries -- and uses it to generate structured arc plans that continue the existing narrative.

**Core Problem:** Long-running RP stories (1000+ messages) lose narrative direction. Users need a way to plan the next arc while respecting everything that has already happened.

**Core Solution:** Context harvesting + LLM-powered arc planning + prompt injection for guided narration.

## Feature Goals

1. **Context Harvesting** -- pull story state from lorebook, chat history, and summaries
2. **Arc Planning** -- LLM generates a structured arc plan (beats/turning points) based on harvested context
3. **Prompt Injection** -- inject the active arc plan into SillyTavern's prompt pipeline to guide the AI
4. **Progress Tracking** -- track which beats have been hit as the story progresses

## Documentation

**Read [docs/claude/onboarding.md](./docs/claude/onboarding.md) first (blocking).**
It holds the context-trigger routing table — which doc to read for which task —
plus the verification gate and behavioral rules. The routing table there is the
sole routing artifact; do not duplicate it here.

## Tech Stack

- **Language:** Vanilla JavaScript (ES6 modules, no TypeScript)
- **UI:** jQuery + raw DOM manipulation (SillyTavern standard)
- **Build:** None -- no bundler, no transpiler. Files loaded directly by ST's extension loader
- **Modules:** ES6 `import`/`export` served as-is
- **Styling:** Plain CSS via `@import` in `style.css`
- **Templates:** HTML as template literal strings in JS
- **Storage:** SillyTavern `chat_metadata` for per-chat state, `extension_settings` for global config

## Directory Structure

```
StoryArc/
├── index.js                    # Entry point, UI setup, event wiring
├── style.css                   # CSS import hub
├── manifest.json               # SillyTavern extension manifest
├── prompts/
│   ├── analyze-context.txt     # Phase 1: story state analysis
│   ├── generate-arc.txt        # Phase 2: arc outline generation
│   └── detail-pass.txt         # Phase 3: detail expansion
├── lib/
│   ├── core/
│   │   ├── index.js            # Facade
│   │   ├── constants.js        # MODULE_NAME, defaults, phases, schema
│   │   └── settings.js         # Settings load/save, per-chat state
│   ├── context/
│   │   ├── index.js            # Facade
│   │   ├── harvester.js        # Orchestrates context gathering
│   │   ├── lorebook.js         # World info adapter
│   │   ├── character.js        # Character card + persona
│   │   └── chat-history.js     # Chat message extraction
│   ├── planning/
│   │   ├── index.js            # Facade
│   │   ├── generator.js        # Multi-phase LLM generation
│   │   ├── validation.js       # JSON parsing + schema validation
│   │   ├── storage.js          # Arc CRUD on chat_metadata
│   │   ├── tier-block.js       # {{TIER_BLOCK}} per tier for the generate template
│   │   ├── arc-so-far.js       # {{ARC_SO_FAR}} block for re-planning
│   │   ├── replan.js           # mergeReplan: keep the situation, replace the road
│   │   └── templates.js        # Prompt template loader
│   ├── injection/
│   │   ├── index.js            # Facade
│   │   ├── builder.js          # Dispatcher: one section per arc by (tier, focus)
│   │   ├── sections/           # episode, milestone, paused, spotlight, signal-directive
│   │   ├── clock.js            # Pacing clock selection, pauseArc/resumeArc
│   │   ├── stamping.js         # Per-message arc counters on the outgoing prompt
│   │   ├── pacing.js           # Phase calculation + directives
│   │   └── signals.js          # ARC_SIGNAL parsing + processing
│   ├── ui/
│   │   ├── index.js            # Facade
│   │   ├── settings-panel.js   # Extension drawer content
│   │   ├── wizard.js           # Arc planning wizard popup
│   │   ├── arc-manager.js      # Arc list + controls popup
│   │   └── progress.js         # Compact progress display
│   └── css/
│       ├── core.css            # Variables, base styles
│       ├── spoiler.css         # Spoiler toggle styles
│       ├── wizard.css          # Wizard popup styles
│       ├── arc-manager.css     # Arc manager styles
│       └── progress.css        # Progress display styles
├── tests/
│   ├── run.sh                  # Node.js test runner
│   ├── smoke.sh                # HTTP smoke tests
│   ├── setup.js                # ESM loader registration
│   ├── loader.js               # Custom loader for ST import mocking
│   ├── mocks/
│   │   └── st-mocks.js         # Mock SillyTavern globals
│   └── test-*.js               # Test files
└── docs/
    ├── architecture/           # Subsystem docs (drift-tracked, Coverage headers)
    ├── claude/                 # onboarding.md (routing table) + canon guidelines
    ├── plans/                  # Dated design specs + implementation plans
    └── goals/GOALS.md          # Long-horizon goals
```

## Code Patterns

### Accessing SillyTavern Context and Globals

**Use proper imports, NOT `window.getContext()`:**

```javascript
// Character data and current character
import { characters, this_chid } from '/script.js';

// Group chat data
import { groups, selected_group } from '/scripts/group-chats.js';

// Chat messages
import { chat } from '/script.js';

// Extension context (for settings and saveChat)
import { getContext } from '/scripts/extensions.js';

// Extension settings persistence
import { extension_settings } from '/scripts/extensions.js';

// Per-chat metadata (persists with chat file)
import { chat_metadata, saveMetadata } from '/script.js';

// Prompt injection
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '/script.js';

// LLM generation
import { generateRaw } from '/script.js';

// Popup API
import { Popup, POPUP_TYPE, POPUP_RESULT } from '/scripts/popup.js';
```

### SillyTavern Events

```javascript
import { eventSource, event_types } from '/script.js';

// Key events for this extension:
eventSource.on(event_types.GENERATION_STARTED, ...)    // Before LLM call - inject prompts
eventSource.on(event_types.USER_MESSAGE_RENDERED, ...) // User sent message - update progress
eventSource.on(event_types.MESSAGE_RECEIVED, ...)      // AI responded - check for signals
eventSource.on(event_types.CHAT_CHANGED, ...)          // Different chat loaded - reload state
```

### Prompt Injection

```javascript
// Inject text into the AI's prompt.
// Signature: (key, value, position, depth, scan, role, filter)
setExtensionPrompt(
    'story_arc_plan',           // Unique identifier
    promptText,                 // The text to inject ('' clears it)
    extension_prompt_types.IN_PROMPT,  // Position type (IN_PROMPT or IN_CHAT)
    0,                          // Depth (for IN_CHAT: messages from the end)
    false,                      // Not a scan
    extension_prompt_roles.SYSTEM      // Role
);
```

### World Info / Lorebook Access

```javascript
// Access world info entries for the current chat
// SillyTavern stores world info in a global that can be imported:
import { world_info } from '/scripts/world-info.js';

// Or via the extension context:
const context = getContext();
const worldInfo = context.worldInfo; // Array of world info entries
```

### Per-Chat State Storage

```javascript
// Store arc plan data per-chat (persists when chat is saved)
if (!chat_metadata.story_arc) {
    chat_metadata.story_arc = {};
}
chat_metadata.story_arc.activePlan = planData;
saveMetadata();

// Read it back
const plan = chat_metadata.story_arc?.activePlan;
```

### Connection Manager (for dedicated API profiles)

```javascript
// Use a specific API profile for arc generation (separate from chat)
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';

// maxTokens: pass undefined to let the profile preset's response length apply
const result = await ConnectionManagerRequestService.sendRequest(
    profileId,
    messages,
    maxTokens,
    { stream: false, extractData: true }
);
const text = result.content || '';
// With { stream: true } it instead returns an AsyncGenerator factory —
// see docs/architecture/st-extension-patterns.md
```

### SillyTavern Popup API

```javascript
const popup = new Popup(html, POPUP_TYPE.TEXT, 'Title', {
    okButton: false,
    cancelButton: false,
    wide: true,
    large: true,
    allowVerticalScrolling: true,
});
```

### Document-Level Event Delegation

For dynamic content (popups, panels), use namespaced events:

```javascript
$(document).off('click.storyArc');
$(document).on('click.storyArc', '[data-action]', function(e) {
    if (!$(this).closest('.story-arc-container').length) return;
    // Handle event
});
```

### Facade Pattern

Each `lib/*/index.js` re-exports the public API for that module:

```javascript
// Preferred - import from facade
import { harvestContext } from './lib/context/index.js';

// Also OK - direct import
import { harvestFromLorebook } from './lib/context/lorebook.js';
```

### Re-export Pattern

When extracting functions to separate files, use import-then-export:

```javascript
// CORRECT - creates local binding
import { harvestContext } from './harvester.js';
export { harvestContext };

// WRONG - no local binding (breaks if used elsewhere in the file)
export { harvestContext } from './harvester.js';
```

## Code Style

- JSDoc comments (`/**`)
- `async function functionName(paramName)` format
- Template literals for HTML
- jQuery for DOM manipulation
- Async/await throughout
- Console logs with `[Story Arc]` prefix

## Reference: Story Mode Extension

This project was scaffolded using [Story Mode](https://github.com/Prompt-And-Circumstance/StoryMode) as a reference for SillyTavern extension patterns. A local copy is available at `/opt/sillytavern/StoryMode`. Story Mode is a mature, well-structured ST extension that handles:
- Blueprint-based story planning (from scratch)
- Signal-based scene progression
- Prompt injection for narrative guidance
- File-backed storage via ST's File API

Key differences from Story Mode:
- **Story Arc** plans arcs for EXISTING stories; Story Mode plans from scratch
- **Story Arc** harvests context from lorebook/chat; Story Mode uses wizard input
- **Story Arc** is intentionally lean -- no library, no cover art, no PNG storage
- **Story Arc** focuses on one thing: "where are we?" -> "what happens next?" -> "guide the AI"

## Agent skills

### Issue tracker

Issues live in GitHub (github.com/coragon77/StoryArc, private), driven with `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.
