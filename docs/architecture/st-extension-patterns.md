# SillyTavern Extension Patterns

- **Coverage:** `index.js`, `lib/`
- **Last Updated:** 2026-08-30

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

The primary way extensions influence AI behavior. The real signature
(`public/script.js:8926`) is `(key, value, position, depth, scan, role,
filter)` — six meaningful args, no separate "position priority" slot. Story
Arc's original call passed seven positional args and only worked because the
misaligned values coerced correctly (fixed in `27c3d17`):

```javascript
setExtensionPrompt(
    'unique_id',                       // String identifier (use MODULE_NAME prefix)
    promptText,                        // The text to inject
    extension_prompt_types.IN_PROMPT,  // Where: IN_PROMPT (system area) or IN_CHAT
    0,                                 // Depth: for IN_CHAT, messages from the end
    false,                             // Scan (false = not a scan prompt)
    extension_prompt_roles.SYSTEM      // Role (SYSTEM/USER/ASSISTANT)
);

// Remove injection: set the value to '' with the same key
setExtensionPrompt('unique_id', '', extension_prompt_types.IN_PROMPT, 0);
```

**Position determines compliance, not just placement.** An instruction the
model must *act on* (e.g. Story Arc's beat-signal markers) is reliably ignored
at IN_PROMPT and even at IN_CHAT depth 1 — GLM 5.2 reasoned about the beats in
its chain-of-thought and still skipped the marker. IN_CHAT depth 0 (the last
message before generation) produced compliance (`27c3d17`). Reserve that slot
for short directives; bulk context belongs at IN_PROMPT.

## Mutating the Outgoing Prompt (CHAT_COMPLETION_PROMPT_READY)

`setExtensionPrompt` can only *add* blocks. To change the chat messages
themselves on their way out — without touching stored chat or the UI — hook
`event_types.CHAT_COMPLETION_PROMPT_READY` and mutate the array in place.

```javascript
eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
    if (eventData?.dryRun) return;              // token-counting pass, not a real send
    for (const message of eventData.chat) { /* mutate message.content in place */ }
});
```

Verified in ST source (2026-08-30, this install):

- `public/scripts/openai.js:1616-1623` — `const chat = chatCompletion.getChat();`
  then `emit(CHAT_COMPLETION_PROMPT_READY, { chat, dryRun })` and `return [chat, …]`.
  The array handed to the handler **is** the one returned, and
  `public/script.js:5285-5303` puts it straight into `generate_data.prompt`. So
  in-place mutation reaches the wire. This path does **not** read `eventData.chat`
  back, so replacing the array (`eventData.chat = [...]`) is silently ignored here
  — mutate, do not reassign.
- `getChat()` (`openai.js:3805-3820`) rebuilds fresh `{role, content, …}` objects
  from the prompt collection, so mutating them cannot corrupt ST's own state.
- `squash_system_messages` runs at `openai.js:1608-1610`, **before** the event.
  Nothing re-merges or re-orders afterwards.
- `dryRun` is a real payload field and must be honoured — dry runs happen for
  token counting and would otherwise double the work and skew counts.
- `public/script.js:4030-4039` — `generateRaw()` emits the *same* event
  (`{ chat: prompt, dryRun: false }`) for chat-completion utility calls from any
  extension, and there it *does* read `eventData.chat` back. A handler meant for
  the real chat prompt needs its own discriminator; Story Arc checks for its
  `INJECTION_HEADER` in the prompt.

Prompt entries do **not** line up positionally with `chat[]`: `coreChat` is
`chat.filter(x => !x.is_system …)` (`public/script.js:4496`), `doChatInject`
splices entries in (`:4745`), and a jailbreak may be appended as a user message
(`:4757`). Match by content instead — ST strips `\r` and may prepend
`${name}: ` (`setOpenAIMessages`, `openai.js:570-615`), so the stored `mes` is a
*suffix* of the prompt content, not equal to it.

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

### Direct backend call (Story Arc's no-profile fallback)

`callBackendDirectly()` in `lib/planning/generator.js` posts to the same
endpoint `generateRaw` ends at, with a minimal body. The pattern is lifted from
SillyTavern-MemoryBooks, which works against providers where `generateRaw`
502s (`a14ae32`). Since `e65449d` this is only the fallback for when no
Connection Manager profile is configured — the preferred route is
`ConnectionManagerRequestService` below:

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

The fallback's `max_tokens` comes from `oai_settings.openai_max_tokens` (the
current API's response-length setting). The hardcoded 4096 that used to sit
here was a debugging-session leftover — owner's word, 2026-08-28 — and was
replaced when Connection Manager support landed (`e65449d`).

### ConnectionManagerRequestService (what Story Arc uses when a profile is set)

Lives at `public/scripts/extensions/shared.js:392`. Routes through
`context.ChatCompletionService.processRequest` with a controlled payload — NOT
the `generateRaw` path, so none of the extra-field 502s above apply.

```javascript
const { ConnectionManagerRequestService } = await import('/scripts/extensions/shared.js');

// Streaming (Story Arc's callViaProfile): returns an AsyncGenerator factory
const streamFactory = await ConnectionManagerRequestService.sendRequest(
    profileId,     // Connection Manager profile id (extension_settings.connectionManager.profiles[].id)
    messages,      // Array of {role, content} — or a plain string (wrapped as one user message)
    undefined,     // maxTokens — see below
    { stream: true },
);
let text = '';
for await (const chunk of streamFactory()) text = chunk.text;

// Non-streaming: returns ExtractedData — the reply is in .content
const result = await ConnectionManagerRequestService.sendRequest(
    profileId, messages, maxTokens, { stream: false, extractData: true });
const text2 = result.content;
```

Behavior verified against ST source (`custom-request.js`, 2026-08-29):

- **`maxTokens: undefined` lets the profile preset's response length win.**
  `createRequestData` deletes undefined payload keys, then
  `presetToGeneratePayload` merges the preset under the payload — an absent
  `max_tokens` falls through to the preset value; a number overrides it.
  (Requires `includePreset: true`, which is the default.)
- **Errors are wrapped**: failures rethrow as `Error('API request failed',
  { cause })` — the provider's actual message is in `err.cause.message`, so
  retry-matching on `err.message` alone sees nothing (`e65449d` matches both).
- A profile without a preset sends no `max_tokens` at all; most providers
  then apply their own default.

## Creating Presets and Connection Profiles Programmatically

What Story Arc's "Create arc preset" button does (`lib/planning/arc-preset.js`).
Verified against ST source and live, 2026-08-29. The preset it writes is a fixed
key set (`ARC_PRESET_SETTINGS`), not derived from a base preset; the only preset
read back is the *previous* arc preset, whose directive entries survive a
re-create (`9cd3c5b`).

```javascript
import { getPresetManager } from '/scripts/preset-manager.js';

const presetManager = getPresetManager('openai');       // null if Chat Completion is not the active API
const previous = presetManager.getCompletionPresetByName(ARC_PRESET_NAME);
await presetManager.savePreset('New Preset', settings, { skipUpdate: true });
```

- **`savePreset` without `skipUpdate` switches the user's live preset.** It
  calls `updateList`, which does `$(select).val(...).trigger('change')` on ST's
  preset dropdown — the newly saved preset becomes the *selected* one, so the
  roleplay preset the user is chatting with is swapped out from under them.
  Always pass `{ skipUpdate: true }` from an extension.
- **`skipUpdate: true` also means the preset is not registered in memory**, so
  `getCompletionPresetByName` misses it and `presetToGeneratePayload` silently
  falls back to the live chat settings until ST is reloaded. Register it by
  hand — `getPresetList()` returns the live `{presets, preset_names}`
  references, so pushing the settings and setting `preset_names[name] = index`
  is enough (that is `updateList` minus the selection change).
- **`getCompletionPresetByName` logs `console.error` on a miss.** For an
  existence check read `getPresetList().preset_names` instead. `getAllPresets()`
  is not equivalent: it reads the option *texts* of ST's dropdown, which lag
  behind when the preset was registered by hand.
- **Never call `savePreset(name)` without a settings object for `openai`.** It
  falls back to `getPresetSettings(name)`, whose `getSettingsByApiId` switch has
  no `openai` case — it hits `default:`, warns `Unknown API ID openai` and
  returns `{}`, so the preset file is overwritten with an empty object. (Learned
  by destroying a preset this way, 2026-08-29.) Chat completion presets have
  their own save path: `saveOpenAIPreset(name, oai_settings)` in `openai.js`,
  which is what the `#update_oai_preset` button calls. Always pass explicit
  settings.
- **Prompt entries survive a preset round trip.** `prompts` and `prompt_order`
  are both in `settingsToUpdate` (`openai.js:377`), so ST's own save writes them
  and `Object.assign(openai_settings[value], presetBody)` makes them readable by
  name immediately. Toggling a prompt in the prompt manager writes
  `enabled` into the *live* `oai_settings.prompt_order` and calls
  `saveSettingsDebounced()` — the preset file only changes when the user saves
  the preset.
- **The prompt order the UI edits is `character_id: 100001`.** `openai.js`
  configures the prompt manager with `promptOrder: { strategy: 'global',
  dummyId: 100001 }`; presets can carry stale orders under other ids.
- **Connection profiles are plain objects** in
  `extension_settings.connectionManager.profiles`, and they pin a preset **by
  name** (`profile.preset`). `/profile-create` snapshots the *current live
  settings*, so it cannot pin a preset the user has not selected; cloning an
  existing profile and overwriting `id`, `name` and `preset` avoids touching
  live settings at all. Connection Manager does not re-render on external
  pushes — the new profile appears in its own dropdown only after a reload.

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

### Wand Menu Entry

The wand next to the chat bar is a plain DOM list at `#extensionsMenu`. An
extension appends its own row and binds a namespaced delegated handler to it —
`registerWandMenuEntry()` in `lib/ui/wand-menu.js` (`f4a0503`):

```javascript
$('#extensionsMenu').append(`
    <div id="story_arc_wand_button" class="list-group-item flex-container flexGap5 interactable" title="...">
        <i class="fa-solid fa-compass"></i><span>Story Arc</span>
    </div>`);
$(document).on('click.storyArcWand', '#story_arc_wand_button', showWandPopup);
```

`list-group-item flex-container flexGap5 interactable` is what ST's own menu
rows carry. Story Mode drives a Popper dropdown from its entry; Story Arc opens
a `Popup` instead.

**Nested ST popups stack badly.** The wizard and the arc manager are `Popup`s
themselves, so the wand popup calls `popup.complete(0)` and awaits its own
`show()` promise *before* opening the chosen one (`f4a0503`). Since `f754381`
the whole popup body sits in a `do … while (openAfterClose)` loop, so the wand
popup comes back when the sub-popup resolves — rebuilt, which also refreshes
the progress cards with whatever the wizard or manager just changed.

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

Unbind again when the popup that owns the handlers closes, not only before
rebinding. A namespace left bound after its popup is gone still fires on
matching selectors elsewhere: the wizard's and the arc manager's
`.story-arc-spoiler-toggle` handlers both ran on one click in the manager,
toggling the spoiler twice — visually a no-op. Every Story Arc popup now calls
`$(document).off('click.<its namespace>')` once its `show()` promise resolves
(`7945e3a`).

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
- **ST's renderer hides HTML comments, so machine markers can be wrapped in
  one.** Bare `[ARC_SIGNAL:…]` markers were visible in the message while it
  streamed. Asking the model for `<!-- [ARC_SIGNAL:…] -->` instead makes them
  invisible in rendered output; `SIGNAL_PATTERN` in `lib/injection/signals.js`
  keeps the `<!--` / `-->` optional so messages written before the change still
  parse (`8dbfdb1`).
- **Never ask the model for machine-readable markers at the END of its reply.**
  Whenever the response hits the preset's token cap, the tail is exactly what
  truncation removes — the marker dies every time on chatty models that write
  to the cap. Ask for markers on the FIRST line instead; parse them anywhere
  (`27c3d17`).
