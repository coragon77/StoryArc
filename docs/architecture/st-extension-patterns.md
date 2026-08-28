# SillyTavern Extension Patterns

- **Coverage:** `index.js`, `lib/`
- **Last Updated:** 2026-08-28

Reference for SillyTavern extension development, extracted from the Story Mode extension codebase. This documents the actual working patterns, not the ST docs. Coverage points at this repo's ST-facing code: the doc's claims rot when commits change *which* ST APIs StoryArc calls — and also when SillyTavern itself changes, which git here cannot see.

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
    generateRaw,           // Make raw LLM call — takes ONE options object (see LLM Calls)
    getRequestHeaders,     // Auth/CSRF headers for direct fetch() to ST's own API
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

Takes a **single options object**. The positional form is deprecated — ST still
accepts it but logs a `console.trace` (`script.js:4123-4126`) — and the
positional example previously documented here,
`generateRaw(prompt, '', false, false, signal)`, passed `signal` into the
`systemPrompt` slot (`42bce4a`):

```javascript
const response = await generateRaw({ prompt, systemPrompt, responseLength: 4096 });
// Returns raw text response
```

Four things about `generateRaw` cost real debugging time, and together they
pushed Story Arc off it for arc planning:

- **It runs in "quiet" mode, and quiet mode disables streaming.** The provider
  must produce the entire response before sending anything back, which times
  out on large generations. `quietToLoud: true` was added to keep streaming on
  (`d064dc3`), and three hours later judged ineffective — "generateRaw *always*
  uses quiet mode" — which is why `generateQuietPrompt` was tried next
  (`8787fea`).

  ST's source settles which of the two was right: `generateRawData` always
  calls `sendOpenAIRequest('quiet', …)` (`public/script.js:4077`) and passes
  `quietToLoud` only on to `createRawPrompt` (`public/script.js:4010`), while
  streaming is decided by `const stream = settings.stream_openai && type !==
  'quiet' && …` (`public/scripts/openai.js:2767`). So `quietToLoud: true` does
  **not** restore streaming for `generateRaw` — `d064dc3`'s rationale was
  wrong, `8787fea`'s was right. (verified 2026-08-28)
- **A string `prompt` is wrapped as a single user message** for OpenAI-type
  sources. A 22K char template therefore arrived as one massive user message
  beside a 92 char system prompt, and API proxies answered 502. Instructions
  belong in `systemPrompt`, with a short user message as the trigger
  (`602da5a`).
- **Without an explicit `responseLength`, no `max_tokens` reaches the API**
  (`a700465`).
- **It sends many extra fields** — `include_reasoning`, `reasoning_effort`,
  `type`, `stop`, `logit_bias` among others — and some providers 502 on that
  request shape (`a14ae32`).

`generateQuietPrompt({ quietPrompt, quietToLoud: true, skipWIAN: true })`
streams and `skipWIAN` keeps world info and the author's note out of the prompt
(`8787fea`) — but it runs the **full chat pipeline**, including the calling
extension's own `GENERATION_STARTED` / `MESSAGE_RECEIVED` handlers. For an
extension that both generates and listens, that is a feedback loop. Story Arc
tried it and backed out the same day (`a700465`).

### Direct backend call (what Story Arc uses)

`callBackendDirectly()` in `lib/planning/generator.js` posts to the same
endpoint `generateRaw` ends at, with a minimal body. The pattern is lifted from
SillyTavern-MemoryBooks, which works against providers where `generateRaw`
502s (`a14ae32`):

```javascript
const { oai_settings, getChatCompletionModel } = await import('/scripts/openai.js');

const res = await fetch('/api/backends/chat-completions/generate', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
        messages, model: getChatCompletionModel(oai_settings),
        temperature, max_tokens,
        chat_completion_source: oai_settings.chat_completion_source,
        stream: true,
        // custom_url: oai_settings.custom_url — forwarded when set
    }),
});
```

- **Model name:** `getChatCompletionModel(oai_settings)` resolves the model
  field belonging to the *active* `chat_completion_source`.
  `oai_settings.openai_model` is only right for the OpenAI source — nanogpt
  keeps its model in `oai_settings.nanogpt_model` (`ca2dfb8`).
- **Streaming:** `stream: true`, then collect the SSE chunks yourself — `data: `
  prefixed lines, `[DONE]` terminator, text in
  `choices[0].delta.content`. Non-streaming requests to nanogpt time out around
  38s on 24K+ char prompts; ordinary chat escapes this only because its prompt
  is spread over many small messages (`a257d92`).

The hardcoded `max_tokens: 4096` in `callBackendDirectly()` is a
debugging-session leftover, not a decision — owner's word, 2026-08-28: it is
unwanted, and arc generation should take its response length from the
connection profile once Connection Manager support (the TODO in
`generator.js`) is wired. (INTENT resolved 2026-08-28)

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

The drawer markup is not decorative. ST binds its expand/collapse handler to
`.inline-drawer-toggle`, so the header needs **both** classes or the drawer
simply never opens (`1310dc7`):

```html
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b><i class="fa-solid fa-compass"></i> Story Arc</b>
        <div class="inline-drawer-icon fa-solid interactable down fa-circle-chevron-down" tabindex="0" role="button"></div>
    </div>
    <div class="inline-drawer-content" style="display: none;">...</div>
</div>
```

`interactable` plus `tabindex`/`role` on the icon is what ST's own drawers
carry for keyboard access. Style only `.inline-drawer-content`: padding on the
wrapper or a `border-bottom` on the header misaligns the panel against the
other extensions in `#extensions_settings2`, which inherit ST's defaults
(`a09887b`).

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

## Gotchas

- **A 200 OK is not proof of success.** Some backends answer with status 200 and
  an `{ error: ... }` object in the body — or, when streaming, inside an SSE
  chunk. Parsing that as the expected payload produces a confusing downstream
  failure instead of the provider's actual message, so check for `error` before
  parsing (`3a14aa3`, `a257d92`).
- **Every 502 here had a different cause.** Four separate fixes landed against
  the same symptom: request shape (one huge user message, `602da5a`), extra
  request fields (`a14ae32`), missing `max_tokens` (`a700465`) and a proxy
  timeout that only streaming solves (`a257d92`). A 502 from a chat-completions
  proxy says nothing about which of these it is.
- **Keeping a generation out of the chat UI appears to cost you streaming.**
  `generateRaw`'s quiet mode and streaming are entangled, and a provider that
  streams fine in normal chat will time out on the same prompt sent quietly
  (`d064dc3`) — see [LLM Calls](#llm-calls) for the ST source that confirms
  quiet mode forces streaming off.
- **Missing the `inline-drawer-toggle` class fails silently.** The panel renders
  correctly and does nothing on click, because ST's handler is bound to a class
  the markup never had (`1310dc7`).
