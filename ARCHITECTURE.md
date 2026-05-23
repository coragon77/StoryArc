# Architecture

System design for Story Arc. For quick reference, see [CLAUDE.md](./CLAUDE.md). For file index, see [CODEINDEX.md](./CODEINDEX.md).

## High-Level Data Flow

```
User clicks "Plan Next Arc"
       |
       v
Context Harvesting (lib/context/)
  +-- Read lorebook/world info entries
  +-- Read recent chat messages or summaries
  +-- Optionally: user provides a text description
  +-- Combine into a structured context document
       |
       v
Arc Planning (lib/planning/)
  +-- Build LLM prompt with harvested context
  +-- Send to LLM (via generateRaw or ConnectionManager)
  +-- Parse structured arc plan from response
  +-- Validate plan structure
  +-- Store plan in chat_metadata.story_arc
       |
       v
Prompt Injection (lib/core/ or lib/planning/)
  +-- On GENERATION_STARTED event
  +-- Read active arc plan from chat_metadata
  +-- Build injection text (current beat, next goals, tone guidance)
  +-- Call setExtensionPrompt() to inject into AI context
       |
       v
Progress Tracking (lib/core/)
  +-- On MESSAGE_RECEIVED event
  +-- Check if story beats have been hit (signal-based or heuristic)
  +-- Update beat progress in chat_metadata
  +-- Refresh UI to show current position
       |
       v
UI Display (lib/ui/)
  +-- Settings panel in ST sidebar
  +-- Arc planning wizard/dialog
  +-- Active arc progress display
  +-- Beat checklist with status indicators
```

## Module Responsibilities

### lib/core/
- `constants.js` -- MODULE_NAME, defaults, configuration
- Extension settings management (global config)
- Per-chat state management (active arc, progress)
- Prompt injection logic (reading plan, building injection text)
- Event handlers for ST events (GENERATION_STARTED, MESSAGE_RECEIVED, etc.)

### lib/context/
- **Lorebook harvesting** -- read World Info entries, filter relevant ones, format for LLM
- **Chat harvesting** -- read recent messages or summarized history
- **Summary harvesting** -- pull from ST's summarization extension if available
- **User input** -- accept freeform text describing current state and desired direction
- **Context assembly** -- combine all sources into a structured document with token budget

### lib/planning/
- **Prompt construction** -- build the arc generation prompt from context + templates
- **LLM communication** -- send prompt, handle response, retry on failure
- **Plan parsing** -- extract structured arc plan from LLM JSON output
- **Plan validation** -- verify plan has required fields, sensible structure
- **Plan storage** -- save/load arc plans from chat_metadata

### lib/ui/
- **Settings panel** -- extension enable/disable, configuration options
- **Planning wizard** -- step-by-step UI for initiating arc planning
- **Progress display** -- show active arc beats, current position, completion %
- **Controls** -- manual beat advance, arc reset, re-plan

## State Storage

### Global Settings (`extension_settings.story_arc`)
```javascript
{
    enabled: true,
    // Configuration options TBD
}
```

### Per-Chat State (`chat_metadata.story_arc`)
```javascript
{
    activePlan: {
        // The current arc plan (structure TBD during development)
        premise: "...",
        beats: [
            { title: "...", description: "...", status: "pending" | "complete" | "skipped" }
        ],
        contextSnapshot: "..."  // The context used to generate this plan
    },
    previousPlans: [],  // History of completed arcs (optional)
}
```

## SillyTavern Integration Points

| Integration | API | Purpose |
|------------|-----|---------|
| Lorebook/World Info | `world_info` import or `context.worldInfo` | Read story state |
| Chat messages | `chat` import | Read recent history |
| Prompt injection | `setExtensionPrompt()` | Guide AI narration |
| LLM calls | `generateRaw()` or `ConnectionManagerRequestService` | Generate arc plans |
| Per-chat persistence | `chat_metadata` + `saveMetadata()` | Store arc plans |
| Global settings | `extension_settings` + `saveSettingsDebounced()` | Store config |
| Events | `eventSource.on(event_types.*)` | React to chat events |
| UI popups | `Popup` class | Dialogs and wizards |

## Design Principles

1. **Context-first** -- the quality of the arc plan depends entirely on the quality of the context harvested. Invest heavily in context harvesting.
2. **Lean** -- no features beyond the core loop (harvest -> plan -> inject -> track). No library, no cover art, no file storage beyond chat_metadata.
3. **Non-destructive** -- never modify the user's lorebook, chat history, or other extensions' data. Read-only access to context sources.
4. **Graceful degradation** -- if lorebook is empty, still work with chat history. If chat is short, still work with user description. Any single context source should be sufficient.
