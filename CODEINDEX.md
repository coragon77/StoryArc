# Code Index

File structure and module dependencies. For quick reference, see [CLAUDE.md](./CLAUDE.md). For system design, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Directory Structure

```
StoryArc/
+-- index.js                 # Entry point, UI setup, event wiring
+-- style.css                # Import hub for CSS modules
+-- manifest.json            # SillyTavern extension manifest
+-- .gitignore               # Git ignore rules
+-- CLAUDE.md                # AI coding assistant reference
+-- ARCHITECTURE.md          # System design documentation
+-- CODEINDEX.md             # This file
+-- ST-EXTENSION-PATTERNS.md # SillyTavern extension API reference
+-- data/                    # Static data files (loaded at runtime)
+-- prompts/                 # LLM prompt templates
+-- lib/
    +-- core/                # Constants, settings, shared state
    |   +-- index.js         # Re-exports: MODULE_NAME, defaultSettings
    |   +-- constants.js     # MODULE_NAME, defaultSettings
    +-- context/             # Context harvesting (lorebook, chat, summaries)
    |   +-- index.js         # Module description (stub)
    +-- planning/            # Arc generation, validation, storage
    |   +-- index.js         # Module description (stub)
    +-- ui/                  # Settings panel, wizard, progress display
    |   +-- index.js         # Module description (stub)
    +-- css/                 # Stylesheets
        +-- core.css         # Base extension styles
```

## Module Dependencies

```
lib/core/
+-- constants.js (no deps)

lib/context/
+-- index.js (stub - will import from /script.js, /scripts/world-info.js)

lib/planning/
+-- index.js (stub - will import from core/, context/, /script.js)

lib/ui/
+-- index.js (stub - will import from core/, planning/)

index.js (orchestrates all, imports from /script.js, /scripts/extensions.js)
```

## Key Files by Feature

| Feature | Primary File | Supporting Files |
|---------|-------------|------------------|
| Extension entry | `index.js` | `lib/core/constants.js` |
| Context harvesting | `lib/context/` | (TBD) |
| Arc planning | `lib/planning/` | `prompts/` |
| UI | `lib/ui/` | `lib/css/` |
| Settings | `index.js` | `lib/core/constants.js` |
