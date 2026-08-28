# SillyTavern Extension Patterns

Reference for SillyTavern extension development, extracted from the Story Mode extension codebase. This documents the actual working patterns, not the ST docs.

## Extension Loading

SillyTavern extensions are browser-side ES6 modules:
- Live in `SillyTavern/data/default-user/extensions/[extension-name]/`
- `manifest.json` declares entry point, CSS, metadata
- `index.js` is loaded as an ES6 module by ST's extension loader
- No build step -- files served directly
- CSS loaded via `style.css` referenced in manifest (use `@import` for sub-files)

## manifest.json

```json
{
    "display_name": "Extension Name",
    "loading_order": 17,
    "requires": [],
    "optional": [],
    "js": "index.js",
    "css": "style.css",
    "author": "author",
    "version": "0.1.0",
    "homePage": ""
}
```

## Core Imports

### From /script.js (main SillyTavern)
```javascript
import {
    eventSource,           // Event emitter for ST events
    event_types,           // Enum of event type strings
    saveSettingsDebounced, // Debounced save of extension_settings
    setExtensionPrompt,   // Inject text into AI prompt
    extension_prompt_types,// Position types for injection
    extension_prompt_roles,// Role types (SYSTEM, USER, etc.)
    chat,                  // Array of chat messages
    chat_metadata,         // Per-chat persistent metadata object
    saveMetadata,          // Save chat_metadata to disk
    generateRaw,           // Make raw LLM call with custom prompt
    addOneMessage,         // Add a message to the chat UI
    characters,            // Array of all characters
    this_chid,             // Current character index
} from '/script.js';
```

### From /scripts/extensions.js
```javascript
import {
    extension_settings,    // Global extension settings object
    getContext,            // Get extension context (saveChat, etc.)
} from '/scripts/extensions.js';
```

### From /scripts/group-chats.js
```javascript
import { groups, selected_group } from '/scripts/group-chats.js';
// selected_group !== null means we're in a group chat
```

### From /scripts/popup.js
```javascript
import { callGenericPopup, Popup, POPUP_TYPE, POPUP_RESULT } from '/scripts/popup.js';

// POPUP_TYPE values: TEXT, CONFIRM, INPUT
// Options: okButton, cancelButton, wide, large, allowVerticalScrolling
```

### From /scripts/extensions/shared.js
```javascript
// For using Connection Manager API profiles
import { ConnectionManagerRequestService } from '/scripts/extensions/shared.js';
```

## Event System

```javascript
// Register event handler
eventSource.on(event_types.CHAT_CHANGED, async () => {
    // Chat switched - reload per-chat state
});

eventSource.on(event_types.GENERATION_STARTED, async () => {
    // About to call LLM - inject prompts now
});

eventSource.on(event_types.USER_MESSAGE_RENDERED, async (mesId) => {
    // User sent a message - update progress tracking
});

eventSource.on(event_types.MESSAGE_RECEIVED, async (mesId) => {
    // AI responded - check for signals/beats
});
```

## Prompt Injection

The primary way extensions influence AI behavior:

```javascript
setExtensionPrompt(
    'unique_id',                       // String identifier (use MODULE_NAME prefix)
    promptText,                        // The text to inject
    extension_prompt_types.IN_PROMPT,  // Where to inject
    0,                                 // Position (0 = highest priority)
    0,                                 // Depth (0 = always active)
    false,                             // Scan (false = not a scan prompt)
    extension_prompt_roles.SYSTEM      // Role (SYSTEM/USER/ASSISTANT)
);

// Remove injection
setExtensionPrompt('unique_id', '', extension_prompt_types.IN_PROMPT, 0);
```

## Settings Persistence

```javascript
// Global settings (extension_settings) - persist across all chats
extension_settings[MODULE_NAME] = { key: 'value' };
saveSettingsDebounced();

// Per-chat settings (chat_metadata) - persist with this specific chat
chat_metadata[MODULE_NAME] = { key: 'value' };
saveMetadata();
```

## LLM Calls

### generateRaw (simple)
```javascript
const response = await generateRaw(prompt, '', false, false, signal);
// Returns raw text response
```

### ConnectionManager (dedicated profile)
```javascript
const result = await ConnectionManagerRequestService.sendRequest(
    profileId,     // API profile ID string
    messages,      // Array of {role, content} messages
    maxTokens,     // Max tokens for response
    { stream: false, extractData: true }
);
const text = result.text || result.content || '';
```

## World Info / Lorebook Access

```javascript
// The world_info module provides access to lorebook data
// Exact import path may vary by ST version - verify at development time
// Common approaches:

// Via extension context
const context = getContext();
// context may expose worldInfo depending on ST version

// Via direct import (if available)
// import { world_info } from '/scripts/world-info.js';

// Via the SillyTavern API endpoint
// GET /api/worldinfo/get
```

**Important:** Verify the exact lorebook access pattern against your SillyTavern version. The API has evolved across versions. The safest approach is to check what Story Mode or other extensions use in the same ST installation.

## UI Patterns

### Settings Panel
Extensions add their settings panel to the ST sidebar. The HTML is typically loaded from a template or built as a template literal string in JS.

### jQuery DOM
SillyTavern uses jQuery extensively. Follow the convention:
```javascript
jQuery(async () => {
    // Extension initialization
    const settingsHtml = `<div id="my-settings">...</div>`;
    $('#extensions_settings').append(settingsHtml);
});
```

### Namespaced Events (for dynamic content)
```javascript
$(document).off('click.myExtension');
$(document).on('click.myExtension', '.my-selector', function(e) {
    // Handle click
});
```

## File Storage (if needed)

SillyTavern provides a File API for persistent storage beyond chat_metadata:

```javascript
// Write file
await fetch('/api/files/upload', {
    method: 'POST',
    body: formData,  // FormData with file
});

// Read file
const response = await fetch('/api/files/get?name=filename');

// Files stored in: data/default-user/user/files/
// Limitation: flat directory only (no subdirectories)
```

**For Story Arc:** Start with `chat_metadata` for arc plan storage. Only use File API if plans need to persist independently of chats or be shared across chats.

## CSS Loading

SillyTavern loads CSS from the path specified in `manifest.json`. Use `@import` statements in the main CSS file to load sub-files:

```css
/* style.css */
@import url('./lib/css/core.css');
@import url('./lib/css/wizard.css');
```

Do NOT use `import './file.css'` in JavaScript -- ST doesn't support CSS module imports in JS.
