# StoryArc Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the StoryArc SillyTavern extension — an automated dungeon master that generates narrative plans from story context and injects them into the chat LLM's prompt.

**Architecture:** Five ES6 modules (core, context, planning, injection, ui) loaded by a central entry point (index.js). No bundler, no transpiler — vanilla JS served directly by SillyTavern's extension loader. State stored in `chat_metadata` (per-chat) and `extension_settings` (global). LLM communication via `generateRaw()` or Connection Manager.

**Tech Stack:** Vanilla JavaScript (ES6 modules), jQuery, SillyTavern Popup API, SillyTavern event system, CSS.

**Testing:** This project has no test framework. SillyTavern extensions are browser-loaded JS with no build step. Verification is done by loading the extension in a running SillyTavern instance and checking console output / UI behavior. Each task notes what to verify manually.

**Spec:** `docs/superpowers/specs/2026-05-23-storyarc-design.md`

**Reference extension:** `/opt/sillytavern/StoryMode` (structural patterns only)

---

## File Map

### Files to Create

| File | Responsibility |
|------|---------------|
| `lib/core/settings.js` | Settings load/save, defaults merging, per-chat state init |
| `lib/context/harvester.js` | Orchestrate context gathering from all sources |
| `lib/context/lorebook.js` | Fetch world info entries via client-side API + HTTP fallback |
| `lib/context/character.js` | Extract character card + persona data |
| `lib/context/chat-history.js` | Extract + truncate chat messages |
| `lib/injection/index.js` | Facade for injection module |
| `lib/injection/builder.js` | Build prompt injection text from active arcs |
| `lib/injection/pacing.js` | Phase calculation + pacing directive text |
| `lib/injection/signals.js` | Parse ARC_SIGNAL patterns, strip from messages |
| `lib/planning/generator.js` | Multi-phase LLM generation orchestration |
| `lib/planning/validation.js` | Parse + validate LLM output against arc schema |
| `lib/planning/storage.js` | Arc CRUD on chat_metadata |
| `lib/planning/templates.js` | Load prompt templates, fill placeholders |
| `lib/ui/settings-panel.js` | Extension drawer HTML + event handlers |
| `lib/ui/wizard.js` | Arc planning wizard popup (3-step) |
| `lib/ui/arc-manager.js` | Arc list + controls popup |
| `lib/ui/progress.js` | Compact progress display in drawer |
| `lib/css/wizard.css` | Wizard popup styles |
| `lib/css/arc-manager.css` | Arc manager popup styles |
| `lib/css/progress.css` | Progress bar / phase label styles |
| `lib/css/spoiler.css` | Spoiler toggle styles |
| `prompts/analyze-context.txt` | Phase 1 prompt template |
| `prompts/generate-arc.txt` | Phase 2 prompt template |
| `prompts/detail-pass.txt` | Phase 3 prompt template |
| ~~`prompts/build-injection.txt`~~ | Not created — injection built programmatically in `builder.js` |

### Files to Modify

| File | Changes |
|------|---------|
| `lib/core/constants.js` | Add full `defaultSettings`, `defaultPerChatSettings`, `ARC_PHASES`, schema helpers |
| `lib/core/index.js` | Re-export settings.js public API |
| `lib/context/index.js` | Re-export harvester public API |
| `lib/planning/index.js` | Re-export planning public API |
| `lib/ui/index.js` | Re-export UI public API |
| `lib/css/core.css` | Add CSS variables, base component styles |
| `style.css` | Add @import lines for new CSS modules |
| `index.js` | Replace TODOs with real event wiring, imports, handlers |
| `CLAUDE.md` | Update directory structure to include injection module |

---

## Task 1: Core Module — Constants, Settings, Schema

**Files:**
- Modify: `lib/core/constants.js`
- Create: `lib/core/settings.js`
- Modify: `lib/core/index.js`

This task establishes all shared constants, the arc schema defaults, and settings management. Everything else depends on this.

- [ ] **Step 1: Expand constants.js with full defaults and schema**

```javascript
// lib/core/constants.js

/**
 * @file Core constants for Story Arc extension
 * @module core/constants
 */

export const MODULE_NAME = 'story_arc';

/** Phases in order, with percentage ranges for pacing */
export const ARC_PHASES = {
    setup:       { min: 0,    max: 0.20, label: 'Setup' },
    development: { min: 0.20, max: 0.50, label: 'Development' },
    escalation:  { min: 0.50, max: 0.75, label: 'Escalation' },
    climax:      { min: 0.75, max: 0.90, label: 'Climax' },
    resolution:  { min: 0.90, max: 1.00, label: 'Resolution' },
};

/** Phase names in order for iteration */
export const PHASE_ORDER = ['setup', 'development', 'escalation', 'climax', 'resolution'];

/** Pacing directive text per phase */
export const PACING_DIRECTIVES = {
    setup: 'Plant seeds. Build atmosphere. No revelations. No confrontations.',
    development: 'Tensions grow. Complications deepen. Hints become patterns.',
    escalation: 'Stakes rise sharply. Confrontations can begin. Secrets start surfacing.',
    climax: 'Major beats resolve. Secrets revealed. Decisive moments.',
    resolution: 'Aftermath. Emotional processing. Seeds for the next arc.',
};

/** Default global extension settings */
export const defaultSettings = {
    enabled: false,
    defaultConnectionProfile: null,
    defaultInjectionBudget: 3000,
    defaultPacingStyle: 'moderate',
};

/** Default per-chat settings stored in chat_metadata.story_arc.settings */
export const defaultPerChatSettings = {
    connectionProfile: null,
    signalPrefix: '[ARC_SIGNAL',
    injectionBudget: 3000,
    autoTrack: true,
};

/** Default arc object (used when creating new arcs) */
export function createDefaultArc(overrides = {}) {
    return {
        id: crypto.randomUUID(),
        title: '',
        status: 'active',
        focus: 'foreground',
        createdAt: new Date().toISOString(),
        messageStart: 0,
        premise: '',
        themes: [],
        tone: '',
        directives: [],
        antiPatterns: [],
        secrets: [],
        foreshadowing: [],
        beats: [],
        escalation: '',
        triggers: [],
        characters: [],
        estimatedLength: 40,
        subArcs: [],
        ...overrides,
    };
}
```

- [ ] **Step 2: Create settings.js**

```javascript
// lib/core/settings.js

/**
 * @file Settings management for Story Arc
 * @module core/settings
 */

import { extension_settings, getContext } from '/scripts/extensions.js';
import { chat_metadata, saveMetadata } from '/script.js';
import { MODULE_NAME, defaultSettings, defaultPerChatSettings } from './constants.js';

/**
 * Load global extension settings, merging defaults for missing keys
 */
export function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = value;
        }
    }
}

/**
 * Get current global extension settings
 * @returns {object}
 */
export function getSettings() {
    return extension_settings[MODULE_NAME] || { ...defaultSettings };
}

/**
 * Check if the extension is enabled
 * @returns {boolean}
 */
export function isEnabled() {
    return getSettings().enabled === true;
}

/**
 * Initialize per-chat story_arc namespace in chat_metadata if missing.
 * Call this on CHAT_CHANGED and before any arc operations.
 */
export function ensureChatState() {
    if (!chat_metadata.story_arc) {
        chat_metadata.story_arc = {
            version: 1,
            arcs: [],
            settings: { ...defaultPerChatSettings },
        };
    }
    // Merge missing per-chat settings
    if (!chat_metadata.story_arc.settings) {
        chat_metadata.story_arc.settings = { ...defaultPerChatSettings };
    }
    for (const [key, value] of Object.entries(defaultPerChatSettings)) {
        if (chat_metadata.story_arc.settings[key] === undefined) {
            chat_metadata.story_arc.settings[key] = value;
        }
    }
}

/**
 * Get per-chat settings
 * @returns {object}
 */
export function getChatSettings() {
    ensureChatState();
    return chat_metadata.story_arc.settings;
}
```

- [ ] **Step 3: Update core/index.js facade**

```javascript
// lib/core/index.js

/**
 * @file Core module public API
 * @module core
 */

import { MODULE_NAME, defaultSettings, defaultPerChatSettings, ARC_PHASES, PHASE_ORDER, PACING_DIRECTIVES, createDefaultArc } from './constants.js';
export { MODULE_NAME, defaultSettings, defaultPerChatSettings, ARC_PHASES, PHASE_ORDER, PACING_DIRECTIVES, createDefaultArc };

import { loadSettings, getSettings, isEnabled, ensureChatState, getChatSettings } from './settings.js';
export { loadSettings, getSettings, isEnabled, ensureChatState, getChatSettings };
```

- [ ] **Step 4: Verify in browser**

Load SillyTavern, open browser console, check for:
- No import errors from Story Arc
- `[Story Arc] Extension loaded` in console
- No undefined/null errors from settings

- [ ] **Step 5: Commit**

```bash
git add lib/core/
git commit -m "feat(core): add settings management, arc schema defaults, phase constants"
```

---

## Task 2: Context Harvesting — Character + Persona

**Files:**
- Create: `lib/context/character.js`

Extracts character card data and user persona. Simplest context source — good starting point.

- [ ] **Step 1: Create character.js**

```javascript
// lib/context/character.js

/**
 * @file Character card and persona extraction
 * @module context/character
 */

import { characters, this_chid } from '/script.js';
import { getContext } from '/scripts/extensions.js';

/**
 * Get current character card data
 * @returns {{ name: string, description: string, personality: string, scenario: string } | null}
 */
export function getCharacterData() {
    if (this_chid === undefined || this_chid === null) {
        console.warn('[Story Arc] No character selected');
        return null;
    }
    const char = characters[this_chid];
    if (!char) return null;

    return {
        name: char.name || '',
        description: char.description || '',
        personality: char.personality || '',
        scenario: char.scenario || '',
    };
}

/**
 * Get user persona name and description
 * @returns {{ name: string, description: string }}
 */
export function getPersonaData() {
    const context = getContext();
    return {
        name: context.name1 || 'User',
        description: context.persona || '',
    };
}
```

- [ ] **Step 2: Verify — open console, import and call**

In the browser console after loading ST:
```javascript
// Check character data is accessible
console.log('Character:', characters[this_chid]?.name);
```

- [ ] **Step 3: Commit**

```bash
git add lib/context/character.js
git commit -m "feat(context): add character card and persona extraction"
```

---

## Task 3: Context Harvesting — Lorebook Adapter

**Files:**
- Create: `lib/context/lorebook.js`

Fetches world info entries. Tries client-side `getContext().worldInfo` first, falls back to HTTP API for full multi-book access.

- [ ] **Step 1: Create lorebook.js**

```javascript
// lib/context/lorebook.js

/**
 * @file Lorebook / World Info adapter
 * @module context/lorebook
 *
 * Fetches world info entries from all connected lorebooks.
 * Primary: getContext().worldInfo (client-side, fast)
 * Fallback: HTTP API /api/worldinfo/list + /get (full multi-book access)
 */

import { getContext } from '/scripts/extensions.js';

/**
 * @typedef {object} LorebookEntry
 * @property {string} comment - Display name / label
 * @property {string} content - The lorebook entry text
 * @property {string[]} key - Trigger keywords
 * @property {boolean} constant - Always active (not keyword-triggered)
 * @property {boolean} disable - Entry is disabled
 * @property {number} order - Sort order
 * @property {string} [world] - Which lorebook this came from
 */

/**
 * Fetch all enabled lorebook entries for the current chat.
 * @returns {Promise<LorebookEntry[]>}
 */
export async function fetchLorebookEntries() {
    // Try client-side context first
    const context = getContext();
    if (context.worldInfo && Array.isArray(context.worldInfo) && context.worldInfo.length > 0) {
        return filterAndSort(context.worldInfo);
    }

    // Fallback: HTTP API for full multi-book access
    console.log('[Story Arc] worldInfo not available via context, trying HTTP API');
    return await fetchViaHttpApi();
}

/**
 * Filter out disabled entries and sort by order
 * @param {LorebookEntry[]} entries
 * @returns {LorebookEntry[]}
 */
function filterAndSort(entries) {
    return entries
        .filter(e => !e.disable)
        .sort((a, b) => (a.order || 100) - (b.order || 100));
}

/**
 * Fetch lorebooks via ST's HTTP API
 * @returns {Promise<LorebookEntry[]>}
 */
async function fetchViaHttpApi() {
    try {
        const headers = { 'Content-Type': 'application/json' };
        const listResp = await fetch('/api/worldinfo/list', {
            method: 'POST', headers, body: JSON.stringify({}),
        });
        if (!listResp.ok) {
            console.warn('[Story Arc] Failed to list lorebooks:', listResp.status);
            return [];
        }
        const books = await listResp.json();
        const allEntries = [];

        for (const book of books) {
            const name = book.name || book;
            const getResp = await fetch('/api/worldinfo/get', {
                method: 'POST', headers, body: JSON.stringify({ name }),
            });
            if (!getResp.ok) continue;
            const data = await getResp.json();
            if (!data?.entries) continue;

            for (const [uid, entry] of Object.entries(data.entries)) {
                allEntries.push({ ...entry, world: name, uid: parseInt(uid) });
            }
        }

        return filterAndSort(allEntries);
    } catch (err) {
        console.error('[Story Arc] HTTP lorebook fetch failed:', err);
        return [];
    }
}

/**
 * Categorize lorebook entries into constants, arc summaries, and recent memories.
 * @param {LorebookEntry[]} entries - Filtered, sorted entries
 * @returns {{ constants: LorebookEntry[], arcSummaries: LorebookEntry[], recent: LorebookEntry[] }}
 */
export function categorizeEntries(entries) {
    const constants = [];
    const arcSummaries = [];
    const recent = [];

    for (const entry of entries) {
        if (entry.constant) {
            constants.push(entry);
        } else if (/\[ARC\s/i.test(entry.comment || '')) {
            arcSummaries.push(entry);
        } else {
            recent.push(entry);
        }
    }

    return { constants, arcSummaries, recent };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/context/lorebook.js
git commit -m "feat(context): add lorebook adapter with HTTP API fallback"
```

---

## Task 4: Context Harvesting — Chat History + Harvester Orchestrator

**Files:**
- Create: `lib/context/chat-history.js`
- Create: `lib/context/harvester.js`
- Modify: `lib/context/index.js`

- [ ] **Step 1: Create chat-history.js**

```javascript
// lib/context/chat-history.js

/**
 * @file Chat history extraction and truncation
 * @module context/chat-history
 */

import { chat } from '/script.js';

/**
 * Extract recent chat messages, truncated to a max count.
 * @param {number} [maxMessages=50] - Maximum messages to return
 * @returns {{ role: string, name: string, content: string }[]}
 */
export function getRecentChat(maxMessages = 50) {
    if (!chat || !chat.length) return [];

    const recent = chat.slice(-maxMessages);
    return recent.map(msg => ({
        role: msg.is_user ? 'user' : 'assistant',
        name: msg.name || (msg.is_user ? 'User' : 'Character'),
        content: msg.mes || '',
    }));
}

/**
 * Estimate token count using chars/4 heuristic
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}
```

- [ ] **Step 2: Create harvester.js**

```javascript
// lib/context/harvester.js

/**
 * @file Context harvesting orchestrator
 * @module context/harvester
 *
 * Gathers all story context for arc planning:
 * character, persona, lorebooks, chat history, existing arcs, user input.
 */

import { chat_metadata } from '/script.js';
import { getCharacterData, getPersonaData } from './character.js';
import { fetchLorebookEntries, categorizeEntries } from './lorebook.js';
import { getRecentChat, estimateTokens } from './chat-history.js';
import { ensureChatState } from '../core/settings.js';

/**
 * @typedef {object} HarvestedContext
 * @property {object|null} character - Character card data
 * @property {object} persona - User persona data
 * @property {{ constants: object[], arcSummaries: object[], recent: object[] }} lorebook
 * @property {object[]} chatHistory - Recent messages
 * @property {object[]} existingArcs - Currently active arc plans
 * @property {number} estimatedTokens - Rough token estimate of all context
 */

/**
 * Harvest all available context for arc planning.
 * @param {number} [chatDepth=50] - How many recent messages to include
 * @param {Set<string>} [excludeEntryIds] - Lorebook entry UIDs to exclude
 * @returns {Promise<HarvestedContext>}
 */
export async function harvestContext(chatDepth = 50, excludeEntryIds = new Set()) {
    // Fetch in parallel where possible
    const [lorebookEntries] = await Promise.all([
        fetchLorebookEntries(),
    ]);

    const character = getCharacterData();
    const persona = getPersonaData();
    // Filter out excluded entries
    const filteredEntries = excludeEntryIds.size > 0
        ? lorebookEntries.filter(e => !excludeEntryIds.has(String(e.uid)))
        : lorebookEntries;
    const lorebook = categorizeEntries(filteredEntries);
    const chatHistory = getRecentChat(chatDepth);

    ensureChatState();
    const existingArcs = (chat_metadata.story_arc?.arcs || [])
        .filter(a => a.status === 'active');

    // Estimate total tokens
    const parts = [
        character ? `${character.description}\n${character.personality}\n${character.scenario}` : '',
        persona.description,
        ...lorebook.constants.map(e => e.content),
        ...lorebook.arcSummaries.map(e => e.content),
        ...lorebook.recent.map(e => e.content),
        ...chatHistory.map(m => m.content),
    ];
    const totalText = parts.join('\n');

    return {
        character,
        persona,
        lorebook,
        chatHistory,
        existingArcs,
        estimatedTokens: estimateTokens(totalText),
    };
}
```

- [ ] **Step 3: Update context/index.js facade**

```javascript
// lib/context/index.js

/**
 * @file Context harvesting module public API
 * @module context
 */

import { harvestContext } from './harvester.js';
export { harvestContext };

import { getCharacterData, getPersonaData } from './character.js';
export { getCharacterData, getPersonaData };

import { fetchLorebookEntries, categorizeEntries } from './lorebook.js';
export { fetchLorebookEntries, categorizeEntries };

import { getRecentChat, estimateTokens } from './chat-history.js';
export { getRecentChat, estimateTokens };
```

- [ ] **Step 4: Verify — load extension, check console for import errors**

- [ ] **Step 5: Commit**

```bash
git add lib/context/
git commit -m "feat(context): add harvester, lorebook adapter, chat history, character extraction"
```

---

## Task 5: Prompt Templates

**Files:**
- Create: `prompts/analyze-context.txt`
- Create: `prompts/generate-arc.txt`
- Create: `prompts/detail-pass.txt`
- Create: `prompts/build-injection.txt`

These are the LLM prompt templates. They are the most important files in the extension — plan quality depends on them. Write them as detailed, opinionated novelist-style instructions.

- [ ] **Step 1: Create analyze-context.txt (Phase 1)**

This template goes in `prompts/analyze-context.txt`. It instructs the LLM to analyze the story state before generating an arc. The full content should cover:
- Instruction to read all provided context carefully
- Output format: JSON with fields for `storyState`, `activeThreads`, `characterDynamics`, `unresolvedTensions`, `worldState`, `narrativeOpportunities`
- Placeholders: `{{CHARACTER_DESCRIPTION}}`, `{{PERSONA}}`, `{{LOREBOOK_CONSTANTS}}`, `{{LOREBOOK_HISTORY}}`, `{{LOREBOOK_RECENT}}`, `{{CHAT_HISTORY}}`, `{{EXISTING_ARCS}}`

Write the full prompt template (typically 1000-2000 chars) that pushes the LLM to think deeply about narrative threads, not just summarize.

- [ ] **Step 2: Create generate-arc.txt (Phase 2)**

This is the creative core. Goes in `prompts/generate-arc.txt`. Must instruct the LLM to:
- Think like a novelist, not a quest designer
- Generate secrets with real answers (mysteries must have solutions)
- Plan foreshadowing deliberately (clues with targets)
- Create flexible beats (narrative intentions, not checkboxes)
- Include directives AND anti-patterns
- Write an escalation pattern
- Output valid JSON matching the arc schema
- Placeholders: `{{PHASE1_ANALYSIS}}`, `{{USER_DIRECTION}}`, `{{EXISTING_ARCS}}`

This template should be 2000-4000 chars — detailed and opinionated about narrative quality.

- [ ] **Step 3: Create detail-pass.txt (Phase 3)**

Goes in `prompts/detail-pass.txt`. Takes the Phase 2 outline and expands it:
- Add specificity to vague beats
- Generate additional foreshadowing
- Refine trigger conditions
- Ensure secrets have enough planned clues
- Placeholder: `{{PHASE2_OUTLINE}}`

- [ ] **Step 4: Note about build-injection.txt**

`prompts/build-injection.txt` is NOT created. The injection builder (`lib/injection/builder.js`) constructs the injection text programmatically via string concatenation rather than template substitution, because the injection logic is too complex for simple placeholders (conditional sections, beat gating, phase-dependent secret disclosure, token budget trimming). The spec's File Map lists it but `builder.js` does not use it — this is intentional.

- [ ] **Step 5: Commit**

```bash
git add prompts/
git commit -m "feat(prompts): add LLM prompt templates for arc analysis, generation, and injection"
```

---

## Task 6: Planning Module — Templates Loader + Validation

**Files:**
- Create: `lib/planning/templates.js`
- Create: `lib/planning/validation.js`

- [ ] **Step 1: Create templates.js**

```javascript
// lib/planning/templates.js

/**
 * @file Prompt template loading and placeholder substitution
 * @module planning/templates
 */

const PROMPTS_BASE_URL = new URL('../../prompts/', import.meta.url).href;

const templateCache = new Map();

const VALID_TEMPLATES = new Set([
    'analyze-context.txt',
    'generate-arc.txt',
    'detail-pass.txt',
]);

/**
 * Load a prompt template file
 * @param {string} filename - Template filename (must be in VALID_TEMPLATES)
 * @returns {Promise<string>}
 */
export async function loadTemplate(filename) {
    if (!VALID_TEMPLATES.has(filename)) {
        throw new Error(`[Story Arc] Invalid template: ${filename}`);
    }

    if (templateCache.has(filename)) {
        return templateCache.get(filename);
    }

    const url = `${PROMPTS_BASE_URL}${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`[Story Arc] Failed to load template ${filename}: ${response.status}`);
    }

    const text = await response.text();
    templateCache.set(filename, text);
    return text;
}

/**
 * Fill placeholders in a template string.
 * Placeholders use {{VARIABLE_NAME}} syntax.
 * @param {string} template - Template with placeholders
 * @param {Record<string, string>} variables - Key-value pairs to substitute
 * @returns {string}
 */
export function fillTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replaceAll(`{{${key}}}`, value || '');
    }
    return result;
}

/**
 * Clear the template cache (useful if templates are edited at runtime)
 */
export function clearTemplateCache() {
    templateCache.clear();
}
```

- [ ] **Step 2: Create validation.js**

```javascript
// lib/planning/validation.js

/**
 * @file Arc plan validation — parse LLM output and validate schema
 * @module planning/validation
 */

import { createDefaultArc } from '../core/constants.js';

/**
 * Parse LLM output as JSON. Handles common LLM formatting issues:
 * - Strips markdown code fences
 * - Finds JSON object in mixed text
 * @param {string} text - Raw LLM output
 * @returns {object|null} Parsed object or null if unparseable
 */
export function parseLlmJson(text) {
    if (!text) return null;

    // Strip markdown code fences
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

    // Try direct parse first
    try {
        return JSON.parse(cleaned);
    } catch {
        // Try to find a JSON object in the text
    }

    // Find first { and last } to extract JSON
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
        return null;
    }
}

/**
 * Validate and normalize a parsed arc plan.
 * Required: title, premise, beats (at least one).
 * Missing optional fields get defaults from createDefaultArc.
 * @param {object} raw - Parsed JSON from LLM
 * @returns {{ valid: boolean, arc: object|null, errors: string[] }}
 */
export function validateArcPlan(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object') {
        return { valid: false, arc: null, errors: ['Not a valid object'] };
    }

    if (!raw.title) errors.push('Missing required field: title');
    if (!raw.premise) errors.push('Missing required field: premise');
    if (!raw.beats || !Array.isArray(raw.beats) || raw.beats.length === 0) {
        errors.push('Missing required field: beats (must be non-empty array)');
    }

    if (errors.length > 0) {
        return { valid: false, arc: null, errors };
    }

    // Merge with defaults
    const arc = createDefaultArc({
        title: raw.title,
        premise: raw.premise,
        themes: ensureArray(raw.themes),
        tone: raw.tone || '',
        directives: ensureArray(raw.directives),
        antiPatterns: ensureArray(raw.antiPatterns || raw.anti_patterns),
        secrets: ensureArray(raw.secrets).map(normalizeSecret),
        foreshadowing: ensureArray(raw.foreshadowing).map(normalizeForeshadowing),
        beats: ensureArray(raw.beats).map(normalizeBeat),
        escalation: raw.escalation || '',
        triggers: ensureArray(raw.triggers).map(normalizeTrigger),
        characters: ensureArray(raw.characters),
        estimatedLength: raw.estimatedLength || raw.estimated_length || 40,
    });

    return { valid: true, arc, errors: [] };
}

function ensureArray(val) {
    if (Array.isArray(val)) return val;
    if (val) return [val];
    return [];
}

function normalizeBeat(beat, index) {
    return {
        id: beat.id || `beat_${index + 1}`,
        intention: beat.intention || beat.description || '',
        flexibility: beat.flexibility || '',
        urgency: beat.urgency || 'when-ready',
        status: beat.status || (index === 0 ? 'active' : 'pending'),
        unlockAfter: ensureArray(beat.unlockAfter || beat.unlock_after),
        phase: beat.phase || 'development',
        optional: beat.optional || false,
    };
}

function normalizeSecret(secret, index) {
    return {
        id: secret.id || `secret_${index + 1}`,
        content: secret.content || (typeof secret === 'string' ? secret : ''),
        revealPhase: secret.revealPhase || secret.reveal_phase || 'any',
        disclosed: false,
    };
}

function normalizeForeshadowing(fs, index) {
    return {
        id: fs.id || `foreshadow_${index + 1}`,
        clue: fs.clue || '',
        target: fs.target || '',
        planted: false,
    };
}

function normalizeTrigger(trigger, index) {
    return {
        id: trigger.id || `trigger_${index + 1}`,
        condition: trigger.condition || '',
        action: trigger.action || '',
        fired: false,
    };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/planning/templates.js lib/planning/validation.js
git commit -m "feat(planning): add template loader and arc plan validation"
```

---

## Task 7: Planning Module — Storage + Generator

**Files:**
- Create: `lib/planning/storage.js`
- Create: `lib/planning/generator.js`
- Modify: `lib/planning/index.js`

- [ ] **Step 1: Create storage.js**

```javascript
// lib/planning/storage.js

/**
 * @file Arc CRUD operations on chat_metadata
 * @module planning/storage
 */

import { chat_metadata, saveMetadata } from '/script.js';
import { ensureChatState } from '../core/settings.js';

/**
 * Get all arcs for the current chat
 * @returns {object[]}
 */
export function getArcs() {
    ensureChatState();
    return chat_metadata.story_arc.arcs || [];
}

/**
 * Get only active arcs
 * @returns {object[]}
 */
export function getActiveArcs() {
    return getArcs().filter(a => a.status === 'active');
}

/**
 * Get a specific arc by ID
 * @param {string} arcId
 * @returns {object|undefined}
 */
export function getArcById(arcId) {
    return getArcs().find(a => a.id === arcId);
}

/**
 * Save a new arc to chat_metadata
 * @param {object} arc
 */
export async function saveArc(arc) {
    ensureChatState();
    chat_metadata.story_arc.arcs.push(arc);
    await saveMetadata();
    console.log(`[Story Arc] Saved arc: ${arc.title}`);
}

/**
 * Update an existing arc in place
 * @param {string} arcId
 * @param {object} updates - Partial arc fields to merge
 */
export async function updateArc(arcId, updates) {
    const arcs = getArcs();
    const index = arcs.findIndex(a => a.id === arcId);
    if (index === -1) {
        console.warn(`[Story Arc] Arc not found: ${arcId}`);
        return;
    }
    Object.assign(arcs[index], updates);
    await saveMetadata();
}

/**
 * Delete an arc by ID
 * @param {string} arcId
 */
export async function deleteArc(arcId) {
    ensureChatState();
    chat_metadata.story_arc.arcs = chat_metadata.story_arc.arcs.filter(a => a.id !== arcId);
    await saveMetadata();
}
```

- [ ] **Step 2: Create generator.js**

```javascript
// lib/planning/generator.js

/**
 * @file Multi-phase LLM generation for arc plans
 * @module planning/generator
 */

import { generateRaw } from '/script.js';
import { chat } from '/script.js';
import { loadTemplate, fillTemplate } from './templates.js';
import { parseLlmJson, validateArcPlan } from './validation.js';
import { getChatSettings } from '../core/settings.js';

/**
 * @typedef {object} GenerationCallbacks
 * @property {(phase: string, message: string) => void} onProgress
 * @property {() => boolean} isCancelled
 */

/**
 * Generate an arc plan using multi-phase LLM generation.
 * @param {import('../context/harvester.js').HarvestedContext} context - Harvested context
 * @param {string} userDirection - User's creative direction text
 * @param {GenerationCallbacks} [callbacks] - Progress callbacks
 * @returns {Promise<{ arc: object|null, error: string|null }>}
 */
export async function generateArc(context, userDirection, callbacks = {}) {
    const { onProgress = () => {}, isCancelled = () => false } = callbacks;

    try {
        // Phase 1: Analysis
        onProgress('phase1', 'Analyzing story context...');
        const analysis = await runPhase1(context);
        if (isCancelled()) return { arc: null, error: 'Cancelled' };

        // Phase 2: Arc Outline
        onProgress('phase2', 'Generating arc outline...');
        const arcJson = await runPhase2(analysis, userDirection, context.existingArcs);
        if (isCancelled()) return { arc: null, error: 'Cancelled' };

        // Phase 3: Detail Pass (optional — run if userDirection requests depth)
        // Deferred to post-MVP. The template detail-pass.txt exists as a stub.
        // To enable: call runPhase3(arcJson) here and merge results.

        // Parse and validate
        const parsed = parseLlmJson(arcJson);
        if (!parsed) {
            // Retry once with emphasis on JSON
            onProgress('retry', 'Retrying with structured output...');
            const retryJson = await runPhase2(analysis, userDirection, context.existingArcs, true);
            const retryParsed = parseLlmJson(retryJson);
            if (!retryParsed) {
                return { arc: null, error: 'Failed to parse LLM output as JSON after retry' };
            }
            const retryResult = validateArcPlan(retryParsed);
            if (!retryResult.valid) {
                return { arc: null, error: `Validation failed: ${retryResult.errors.join(', ')}` };
            }
            retryResult.arc.messageStart = chat?.length || 0;
            return { arc: retryResult.arc, error: null };
        }

        const result = validateArcPlan(parsed);
        if (!result.valid) {
            return { arc: null, error: `Validation failed: ${result.errors.join(', ')}` };
        }

        // Set messageStart to current chat length
        result.arc.messageStart = chat?.length || 0;

        return { arc: result.arc, error: null };

    } catch (err) {
        console.error('[Story Arc] Generation failed:', err);
        return { arc: null, error: err.message };
    }
}

/**
 * Phase 1: Analyze story state
 */
async function runPhase1(context) {
    const template = await loadTemplate('analyze-context.txt');
    const prompt = fillTemplate(template, {
        CHARACTER_DESCRIPTION: formatCharacter(context.character),
        PERSONA: formatPersona(context.persona),
        LOREBOOK_CONSTANTS: formatEntries(context.lorebook.constants),
        LOREBOOK_HISTORY: formatEntries(context.lorebook.arcSummaries),
        LOREBOOK_RECENT: formatEntries(context.lorebook.recent),
        CHAT_HISTORY: formatChat(context.chatHistory),
        EXISTING_ARCS: formatExistingArcs(context.existingArcs),
    });

    return await callLlm(prompt);
}

/**
 * Phase 2: Generate arc outline
 */
async function runPhase2(analysis, userDirection, existingArcs, jsonEmphasis = false) {
    const template = await loadTemplate('generate-arc.txt');
    let prompt = fillTemplate(template, {
        PHASE1_ANALYSIS: analysis,
        USER_DIRECTION: userDirection || '(No specific direction provided — generate based on story context)',
        EXISTING_ARCS: formatExistingArcs(existingArcs),
    });

    if (jsonEmphasis) {
        prompt += '\n\nCRITICAL: Your response must be ONLY a valid JSON object. No prose, no markdown, no explanation. Start with { and end with }.';
    }

    return await callLlm(prompt);
}

/**
 * Call the LLM using generateRaw or Connection Manager
 */
async function callLlm(prompt) {
    const settings = getChatSettings();

    // TODO: Add Connection Manager support when UI for profile selection is built
    // For now, always use generateRaw with the current chat API
    const response = await generateRaw(prompt, '', false, true);
    return response;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatCharacter(char) {
    if (!char) return '(No character data available)';
    return `Name: ${char.name}\nDescription: ${char.description}\nPersonality: ${char.personality}\nScenario: ${char.scenario}`;
}

function formatPersona(persona) {
    if (!persona.name && !persona.description) return '(No persona data)';
    return `Name: ${persona.name}\nDescription: ${persona.description}`;
}

function formatEntries(entries) {
    if (!entries.length) return '(None)';
    return entries.map(e => {
        const label = e.comment || '(unnamed)';
        const keywords = Array.isArray(e.key) ? e.key.join(', ') : '';
        return `[${label}]${keywords ? ` (keywords: ${keywords})` : ''}\n${e.content}`;
    }).join('\n\n---\n\n');
}

function formatChat(messages) {
    if (!messages.length) return '(No chat history)';
    return messages.map(m => `${m.name}: ${m.content}`).join('\n\n');
}

function formatExistingArcs(arcs) {
    if (!arcs || !arcs.length) return '(No existing arcs)';
    return arcs.map(a => `[${a.focus.toUpperCase()}] "${a.title}" — ${a.premise}`).join('\n');
}
```

- [ ] **Step 3: Update planning/index.js facade**

```javascript
// lib/planning/index.js

/**
 * @file Arc planning module public API
 * @module planning
 */

import { generateArc } from './generator.js';
export { generateArc };

import { parseLlmJson, validateArcPlan } from './validation.js';
export { parseLlmJson, validateArcPlan };

import { getArcs, getActiveArcs, getArcById, saveArc, updateArc, deleteArc } from './storage.js';
export { getArcs, getActiveArcs, getArcById, saveArc, updateArc, deleteArc };

import { loadTemplate, fillTemplate, clearTemplateCache } from './templates.js';
export { loadTemplate, fillTemplate, clearTemplateCache };
```

- [ ] **Step 4: Commit**

```bash
git add lib/planning/
git commit -m "feat(planning): add arc storage, multi-phase LLM generator, template loader"
```

---

## Task 8: Injection Module — Pacing, Builder, Signals

**Files:**
- Create: `lib/injection/index.js`
- Create: `lib/injection/pacing.js`
- Create: `lib/injection/builder.js`
- Create: `lib/injection/signals.js`

- [ ] **Step 1: Create pacing.js**

```javascript
// lib/injection/pacing.js

/**
 * @file Phase calculation and pacing directives
 * @module injection/pacing
 */

import { chat } from '/script.js';
import { ARC_PHASES, PHASE_ORDER, PACING_DIRECTIVES } from '../core/constants.js';

/**
 * Calculate the current phase for an arc based on beat completion + message count.
 * Both conditions must be met to advance (takes the minimum).
 * @param {object} arc
 * @returns {{ phase: string, label: string, messageCount: number, beatRatio: number, messageRatio: number }}
 */
export function calculatePhase(arc) {
    const nonOptionalBeats = arc.beats.filter(b => !b.optional);
    const completedBeats = nonOptionalBeats.filter(b => b.status === 'completed');
    const beatRatio = nonOptionalBeats.length > 0
        ? completedBeats.length / nonOptionalBeats.length
        : 0;

    const currentMessage = chat?.length || 0;
    const messageCount = currentMessage - (arc.messageStart || 0);
    const messageRatio = arc.estimatedLength > 0
        ? messageCount / arc.estimatedLength
        : 0;

    const phaseFromBeats = ratioToPhase(beatRatio);
    const phaseFromMessages = ratioToPhase(messageRatio);

    // Take the minimum (earlier) phase — both conditions must be met
    const beatIndex = PHASE_ORDER.indexOf(phaseFromBeats);
    const msgIndex = PHASE_ORDER.indexOf(phaseFromMessages);
    const phase = PHASE_ORDER[Math.min(beatIndex, msgIndex)];

    return {
        phase,
        label: ARC_PHASES[phase].label,
        messageCount,
        beatRatio,
        messageRatio,
    };
}

/**
 * Convert a ratio (0-1) to a phase name
 * @param {number} ratio
 * @returns {string}
 */
function ratioToPhase(ratio) {
    for (const name of PHASE_ORDER) {
        const { min, max } = ARC_PHASES[name];
        if (ratio >= min && ratio < max) return name;
    }
    return 'resolution'; // ratio >= 1.0
}

/**
 * Get the pacing directive text for a phase
 * @param {string} phase
 * @returns {string}
 */
export function getPacingDirective(phase) {
    return PACING_DIRECTIVES[phase] || PACING_DIRECTIVES.development;
}

/**
 * Calculate how many messages remain before the next phase transition
 * @param {object} arc
 * @param {string} currentPhase
 * @returns {number}
 */
export function messagesUntilNextPhase(arc, currentPhase) {
    const phaseConfig = ARC_PHASES[currentPhase];
    if (!phaseConfig) return 0;
    const targetMessage = Math.floor(phaseConfig.max * arc.estimatedLength) + arc.messageStart;
    const currentMessage = chat?.length || 0;
    return Math.max(0, targetMessage - currentMessage);
}
```

- [ ] **Step 2: Create builder.js**

```javascript
// lib/injection/builder.js

/**
 * @file Build prompt injection text from active arcs
 * @module injection/builder
 */

import { calculatePhase, getPacingDirective, messagesUntilNextPhase } from './pacing.js';
import { getChatSettings } from '../core/settings.js';
import { estimateTokens } from '../context/chat-history.js';

/**
 * Build the complete prompt injection text from all active arcs.
 * Foreground arcs get full detail, background arcs get one-liners.
 * @param {object[]} arcs - Active arcs
 * @returns {string}
 */
export function buildInjection(arcs) {
    if (!arcs.length) return '';

    const foreground = arcs.filter(a => a.focus === 'foreground');
    const background = arcs.filter(a => a.focus === 'background');
    const settings = getChatSettings();

    const sections = ['[STORY ARC - NARRATIVE DIRECTION]\n'];

    for (const arc of foreground) {
        sections.push(buildForegroundSection(arc));
    }

    for (const arc of background) {
        sections.push(buildBackgroundSection(arc));
    }

    // Signal directive
    if (settings.autoTrack) {
        sections.push(buildSignalDirective(arcs));
    }

    sections.push('[END STORY ARC]');

    let injection = sections.join('\n');

    // Token management — trim if over budget
    const budget = settings.injectionBudget || 3000;
    if (estimateTokens(injection) > budget) {
        injection = trimInjection(injection, budget, foreground, background);
    }

    return injection;
}

/**
 * Build detailed section for a foregrounded arc
 */
function buildForegroundSection(arc) {
    const { phase, label, messageCount } = calculatePhase(arc);
    const pacing = getPacingDirective(phase);
    const remaining = messagesUntilNextPhase(arc, phase);

    const lines = [];
    lines.push(`=== FOREGROUNDED: "${arc.title}" ===`);
    lines.push(`[Phase: ${label} | Messages into arc: ${messageCount} | Pacing: Do not rush]\n`);

    if (arc.premise) {
        lines.push(`PREMISE: ${arc.premise}\n`);
    }
    if (arc.tone) {
        lines.push(`TONE: ${arc.tone}\n`);
    }

    // Active beats only (not locked, not completed)
    const visibleBeats = arc.beats.filter(b => b.status === 'active' || b.status === 'pending');
    if (visibleBeats.length) {
        lines.push('CURRENT BEATS:');
        for (const beat of visibleBeats) {
            const marker = beat.status === 'active' ? '(NOW)' : '(upcoming)';
            lines.push(`- ${marker} ${beat.intention}`);
        }
        lines.push('');
    }

    // Secrets (filtered by phase)
    const visibleSecrets = arc.secrets.filter(s =>
        !s.disclosed && shouldShowSecret(s.revealPhase, phase)
    );
    if (visibleSecrets.length) {
        lines.push('SECRETS (guard these carefully — do not reveal directly):');
        for (const secret of visibleSecrets) {
            lines.push(`- ${secret.content}`);
        }
        lines.push('');
    }

    // Foreshadowing
    const unplanted = arc.foreshadowing.filter(f => !f.planted);
    if (unplanted.length) {
        lines.push('FORESHADOWING TO PLANT:');
        for (const fs of unplanted) {
            lines.push(`- ${fs.clue} (foreshadows: ${fs.target})`);
        }
        lines.push('');
    }

    // Triggers
    const unfired = arc.triggers.filter(t => !t.fired);
    if (unfired.length) {
        lines.push('TRIGGERS (check narrative conditions each message):');
        for (const trigger of unfired) {
            lines.push(`- IF ${trigger.condition} → ${trigger.action}`);
        }
        lines.push('');
    }

    // Pacing rules
    lines.push('PACING RULES:');
    lines.push(`- You are in ${label.toUpperCase()} phase. ${pacing}`);
    if (remaining > 0) {
        lines.push(`- Do not advance to the next phase for at least ${remaining} more messages.`);
    }
    lines.push('- If tempted to resolve something — add a complication instead.');
    lines.push('');

    // Anti-patterns
    if (arc.antiPatterns.length) {
        lines.push('DO NOT:');
        for (const ap of arc.antiPatterns) {
            lines.push(`- ${ap}`);
        }
        lines.push('');
    }

    // Directives
    if (arc.directives.length) {
        lines.push('DIRECTIVES:');
        for (const d of arc.directives) {
            lines.push(`- ${d}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Build one-liner section for a backgrounded arc
 */
function buildBackgroundSection(arc) {
    return `=== BACKGROUNDED: "${arc.title}" ===\n${arc.premise || arc.title}. Keep this present as distant tension. Do not advance plot beats for this arc.\n`;
}

/**
 * Build the signal directive telling the AI how to signal beat completion
 */
function buildSignalDirective(arcs) {
    const activeBeats = [];
    for (const arc of arcs) {
        for (const beat of arc.beats.filter(b => b.status === 'active')) {
            activeBeats.push({ arcId: arc.id.slice(0, 8), beatId: beat.id });
        }
    }

    if (!activeBeats.length) return '';

    const lines = [
        'BEAT COMPLETION SIGNALS:',
        'When a narrative beat has been meaningfully fulfilled, append this signal',
        'at the very end of your message, after all story content:',
        '',
    ];
    for (const { arcId, beatId } of activeBeats) {
        lines.push(`  [ARC_SIGNAL:${arcId}:${beatId}:COMPLETE]`);
    }
    lines.push('');
    lines.push('Only signal when the beat\'s INTENTION has been met. If uncertain, do not signal.');
    lines.push('');

    return lines.join('\n');
}

/**
 * Check if a secret should be shown given the current phase
 */
function shouldShowSecret(revealPhase, currentPhase) {
    if (revealPhase === 'any') return true;
    const phaseOrder = ['setup', 'development', 'escalation', 'climax', 'resolution'];
    return phaseOrder.indexOf(currentPhase) >= phaseOrder.indexOf(revealPhase);
}

/**
 * Trim injection to fit token budget
 */
function trimInjection(injection, budget, foreground, background) {
    // Strategy: rebuild without optional sections
    // 1. Remove background arcs entirely if over budget
    // 2. Remove completed beats
    // 3. Remove planted foreshadowing
    // For now, use a simple truncation approach
    const chars = budget * 4; // reverse of token estimate
    if (injection.length > chars) {
        console.warn(`[Story Arc] Injection trimmed from ${injection.length} to ${chars} chars`);
        return injection.slice(0, chars) + '\n[END STORY ARC]';
    }
    return injection;
}
```

- [ ] **Step 3: Create signals.js**

```javascript
// lib/injection/signals.js

/**
 * @file Parse and handle ARC_SIGNAL patterns in AI messages
 * @module injection/signals
 */

import { chat } from '/script.js';
import { getArcById, updateArc } from '../planning/storage.js';

/** Regex to match [ARC_SIGNAL:arcId:beatId:COMPLETE] */
const SIGNAL_PATTERN = /\[ARC_SIGNAL:([^:]+):([^:]+):COMPLETE\]/g;

/**
 * @typedef {object} ParsedSignal
 * @property {string} arcId - Short arc ID prefix
 * @property {string} beatId - Beat ID slug
 * @property {string} fullMatch - The full matched string
 */

/**
 * Parse ARC_SIGNAL patterns from a message
 * @param {string} messageText
 * @returns {ParsedSignal[]}
 */
export function parseSignals(messageText) {
    if (!messageText) return [];

    const signals = [];
    let match;
    const regex = new RegExp(SIGNAL_PATTERN.source, 'g');
    while ((match = regex.exec(messageText)) !== null) {
        signals.push({
            arcId: match[1],
            beatId: match[2],
            fullMatch: match[0],
        });
    }
    return signals;
}

/**
 * Strip ARC_SIGNAL patterns from a message's displayed text.
 * Modifies the chat message in-place (display only).
 * @param {number} messageIndex
 */
export function stripSignalsFromMessage(messageIndex) {
    if (!chat || !chat[messageIndex]) return;

    const msg = chat[messageIndex];
    const original = msg.mes || '';
    const cleaned = original.replace(SIGNAL_PATTERN, '').trimEnd();

    if (cleaned !== original) {
        msg.mes = cleaned;
        // Update the displayed message in the DOM
        const messageBlock = $(`#chat .mes[mesid="${messageIndex}"] .mes_text`);
        if (messageBlock.length) {
            messageBlock.html(messageBlock.html().replace(SIGNAL_PATTERN, ''));
        }
    }
}

/**
 * Process signals: find matching arcs/beats, update status, unlock gated beats.
 * @param {ParsedSignal[]} signals
 * @param {object[]} activeArcs
 * @returns {{ updated: boolean, completedBeats: string[] }}
 */
export async function processSignalResults(signals, activeArcs) {
    let updated = false;
    const completedBeats = [];

    for (const signal of signals) {
        // Find the arc (match by ID prefix)
        const arc = activeArcs.find(a => a.id.startsWith(signal.arcId));
        if (!arc) {
            console.warn(`[Story Arc] Signal referenced unknown arc: ${signal.arcId}`);
            continue;
        }

        // Find the beat
        const beat = arc.beats.find(b => b.id === signal.beatId);
        if (!beat) {
            console.warn(`[Story Arc] Signal referenced unknown beat: ${signal.beatId}`);
            continue;
        }

        if (beat.status !== 'active') {
            console.warn(`[Story Arc] Signal for non-active beat: ${signal.beatId} (status: ${beat.status})`);
            continue;
        }

        // Mark beat as completed
        beat.status = 'completed';
        completedBeats.push(signal.beatId);
        updated = true;
        console.log(`[Story Arc] Beat completed: "${beat.intention}" in "${arc.title}"`);

        // Unlock gated beats
        for (const otherBeat of arc.beats) {
            if (otherBeat.status === 'locked' && otherBeat.unlockAfter.includes(signal.beatId)) {
                const allUnlocked = otherBeat.unlockAfter.every(
                    reqId => arc.beats.find(b => b.id === reqId)?.status === 'completed'
                );
                if (allUnlocked) {
                    otherBeat.status = 'pending';
                    console.log(`[Story Arc] Beat unlocked: "${otherBeat.intention}"`);
                }
            }
        }

        // Check if arc is complete (all non-optional beats done)
        const remaining = arc.beats.filter(b => !b.optional && b.status !== 'completed');
        if (remaining.length === 0) {
            arc.status = 'completed';
            console.log(`[Story Arc] Arc completed: "${arc.title}"`);
        }

        await updateArc(arc.id, { beats: arc.beats, status: arc.status });
    }

    return { updated, completedBeats };
}
```

- [ ] **Step 4: Create injection/index.js facade**

```javascript
// lib/injection/index.js

/**
 * @file Injection module public API
 * @module injection
 */

import { buildInjection } from './builder.js';
export { buildInjection };

import { calculatePhase, getPacingDirective } from './pacing.js';
export { calculatePhase, getPacingDirective };

import { parseSignals, stripSignalsFromMessage, processSignalResults } from './signals.js';
export { parseSignals, stripSignalsFromMessage, processSignalResults };
```

- [ ] **Step 5: Commit**

```bash
git add lib/injection/
git commit -m "feat(injection): add prompt builder, pacing engine, signal parser"
```

---

## Task 9: CSS Modules

**Files:**
- Modify: `lib/css/core.css`
- Create: `lib/css/spoiler.css`
- Create: `lib/css/wizard.css`
- Create: `lib/css/arc-manager.css`
- Create: `lib/css/progress.css`
- Modify: `style.css`

- [ ] **Step 1: Update core.css with variables and base styles**

Expand `lib/css/core.css` with CSS custom properties and base `.story-arc-*` styles. Include variables for colors, spacing, and the ST dark theme palette. Add base styles for buttons, inputs, and layout containers.

- [ ] **Step 2: Create spoiler.css**

Style the spoiler toggle component: `.story-arc-spoiler`, `.story-arc-spoiler-toggle` (clickable header with expand/collapse indicator), `.story-arc-spoiler-content` (hidden by default, shown on toggle). Include a subtle warning style when expanded.

- [ ] **Step 3: Create wizard.css**

Style the 3-step wizard popup: step indicators, context review list, direction text area, review sections with spoiler toggles, action buttons. Follow ST's modal/popup visual patterns.

- [ ] **Step 4: Create arc-manager.css**

Style the arc list: arc rows with status badges, focus indicators, progress bars, action buttons. Active/completed/abandoned visual states.

- [ ] **Step 5: Create progress.css**

Style the compact progress display: progress bar fills, phase labels, arc titles, foreground/background visual distinction.

- [ ] **Step 6: Update style.css with imports**

```css
/* style.css */
@import url('./lib/css/core.css');
@import url('./lib/css/spoiler.css');
@import url('./lib/css/wizard.css');
@import url('./lib/css/arc-manager.css');
@import url('./lib/css/progress.css');
```

- [ ] **Step 7: Commit**

```bash
git add lib/css/ style.css
git commit -m "feat(css): add styles for spoiler toggles, wizard, arc manager, progress display"
```

---

## Task 10: UI — Settings Panel + Progress Display

**Files:**
- Create: `lib/ui/settings-panel.js`
- Create: `lib/ui/progress.js`

- [ ] **Step 1: Create settings-panel.js**

Build the extension drawer content with:
- Enable/disable toggle checkbox
- Connection Manager profile selector (dropdown, populated dynamically)
- Injection budget slider (1000-5000, step 500)
- "Plan Next Arc" button
- "Manage Arcs" button
- Progress display container (populated by progress.js)

Template should be a function returning an HTML string. Event handlers use namespaced jQuery (`.storyArc`). Follow the ST pattern: `$(document).on('click.storyArc', '#story-arc-plan-btn', handler)`.

Export: `renderSettingsPanel()` returns HTML string, `setupSettingsPanelEvents()` wires handlers.

- [ ] **Step 2: Create progress.js**

Compact progress display for the settings drawer:
- For each active arc: title, progress bar (completed/total non-optional beats), phase label
- Foreground arcs prominent, background arcs condensed
- Click handler opens arc manager
- Export: `renderProgressDisplay(arcs)` returns HTML string, `updateProgress()` re-renders in place.

- [ ] **Step 3: Commit**

```bash
git add lib/ui/settings-panel.js lib/ui/progress.js
git commit -m "feat(ui): add settings panel and progress display"
```

---

## Task 11: UI — Arc Planning Wizard

**Files:**
- Create: `lib/ui/wizard.js`

This is the largest UI component. It's a 3-step popup dialog.

- [ ] **Step 1: Build the wizard framework**

Create `lib/ui/wizard.js` with:

- `showWizard()` — main entry point, async function that:
  1. Calls `harvestContext()` and shows a loading indicator
  2. Creates a Popup with the Step 1 (context review) content
  3. Manages step navigation within the popup

- Step 1 HTML: context summary table, expandable lorebook sections with checkboxes, token count, "Next" button
- Step 2 HTML: large textarea for creative direction, optional arc type dropdown, "Generate" button
- Step 3 HTML: generated plan display with spoiler toggles, edit buttons, "Regenerate" / "Activate" buttons

- [ ] **Step 2: Wire Step 1 → Step 2 navigation**

"Next" button replaces popup content with Step 2. Store excluded lorebook entry IDs in a local variable.

- [ ] **Step 3: Wire Step 2 → Generation → Step 3**

"Generate" button:
1. Shows loading state with phase progress messages
2. Calls `generateArc(context, userDirection, { onProgress })`
3. On success: replaces popup content with Step 3 (plan review)
4. On failure: shows error with retry button

- [ ] **Step 4: Wire Step 3 activation**

"Activate" button:
1. Calls `saveArc(arc)` to persist
2. Closes the popup
3. Calls `updateProgress()` to refresh the drawer

"Regenerate" button:
1. Goes back to Step 2 generation with same inputs

- [ ] **Step 5: Wire inline editing**

Each section in Step 3 has an "Edit" button that toggles between display and textarea. On save, the arc object is updated in-place before activation.

- [ ] **Step 6: Commit**

```bash
git add lib/ui/wizard.js
git commit -m "feat(ui): add 3-step arc planning wizard"
```

---

## Task 12: UI — Arc Manager

**Files:**
- Create: `lib/ui/arc-manager.js`

- [ ] **Step 1: Create arc-manager.js**

Build the arc manager popup:

- `showArcManager()` — opens a Popup listing all arcs
- Each arc row: title, status badge (active/completed/abandoned), focus toggle (foreground/background), progress bar, phase label
- Action buttons per arc: Edit (opens inline editable view with spoiler toggles), Complete, Abandon
- Active arcs at top, completed/abandoned collapsed at bottom
- Focus toggle: clicking switches between foreground/background, calls `updateArc()` and rebuilds injection
- Complete button: marks all beats done, sets status to completed
- Abandon button: sets status to abandoned
- Edit: expands the arc into a detailed view with spoiler toggles, same as wizard Step 3 but for an existing arc. Editable fields save via `updateArc()`.

- [ ] **Step 2: Wire manual beat override**

In the expanded edit view, each beat has a checkbox. Checking/unchecking toggles the beat's status between completed and active/pending. Updates arc via `updateArc()`.

- [ ] **Step 3: Commit**

```bash
git add lib/ui/arc-manager.js
git commit -m "feat(ui): add arc manager popup with edit, focus toggle, manual override"
```

---

## Task 13: UI Facade + Index.js Event Wiring

**Files:**
- Modify: `lib/ui/index.js`
- Modify: `index.js`

This ties everything together.

- [ ] **Step 1: Update ui/index.js facade**

```javascript
// lib/ui/index.js

/**
 * @file UI module public API
 * @module ui
 */

import { renderSettingsPanel, setupSettingsPanelEvents } from './settings-panel.js';
export { renderSettingsPanel, setupSettingsPanelEvents };

import { showWizard } from './wizard.js';
export { showWizard };

import { showArcManager } from './arc-manager.js';
export { showArcManager };

import { renderProgressDisplay, updateProgress } from './progress.js';
export { renderProgressDisplay, updateProgress };
```

- [ ] **Step 2: Rewrite index.js entry point**

Replace the TODO stubs in `index.js` with real event wiring. Key handler implementations:

```javascript
import { loadSettings, isEnabled, ensureChatState } from './lib/core/index.js';
import { getActiveArcs } from './lib/planning/index.js';
import { buildInjection } from './lib/injection/index.js';
import { parseSignals, stripSignalsFromMessage, processSignalResults } from './lib/injection/index.js';
import { renderSettingsPanel, setupSettingsPanelEvents } from './lib/ui/index.js';
import { updateProgress } from './lib/ui/index.js';
import {
    eventSource, event_types, chat, chat_metadata, saveMetadata,
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles,
} from '/script.js';

async function onGenerationStarted() {
    if (!isEnabled()) return;
    const arcs = getActiveArcs();
    if (!arcs.length) return;
    const injection = buildInjection(arcs);
    setExtensionPrompt(
        'story_arc_plan', injection,
        extension_prompt_types.IN_PROMPT, 0, 0, false,
        extension_prompt_roles.SYSTEM,
    );
}

async function onMessageReceived(messageIndex) {
    if (!isEnabled()) return;
    const message = chat[messageIndex];
    if (!message?.mes) return;

    const signals = parseSignals(message.mes);
    if (signals.length) {
        stripSignalsFromMessage(messageIndex);
        const activeArcs = getActiveArcs();
        await processSignalResults(signals, activeArcs);
        updateProgress();
        await saveMetadata();
    }
}

function onChatChanged() {
    ensureChatState();
    updateProgress();
}
```

Wire these in the jQuery ready handler:
```javascript
jQuery(async () => {
    loadSettings();
    // Insert settings panel HTML into ST's extension drawer
    $('#extensions_settings2').append(renderSettingsPanel());
    setupSettingsPanelEvents();

    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    ensureChatState();
    updateProgress();
    console.log('[Story Arc] Extension loaded');
});
```

- [ ] **Step 3: Verify full extension load**

Load SillyTavern with the extension:
- Settings panel appears in extension drawer
- Enable toggle works
- "Plan Next Arc" button opens wizard (even if wizard content is basic)
- No console errors
- Switching chats triggers `onChatChanged` (check console log)

- [ ] **Step 4: Commit**

```bash
git add lib/ui/index.js index.js
git commit -m "feat: wire entry point with event handlers, settings panel, full module integration"
```

---

## Task 14: Documentation Updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CODEINDEX.md`
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update CLAUDE.md**

Update the Directory Structure section to include:
- `lib/injection/` module (index.js, builder.js, pacing.js, signals.js)
- `lib/core/settings.js`
- All new files in `lib/context/`, `lib/planning/`, `lib/ui/`
- `prompts/` directory with template files

- [ ] **Step 2: Update CODEINDEX.md**

Update the file tree, module dependency graph, and feature-to-file mapping to reflect the implemented structure.

- [ ] **Step 3: Update ARCHITECTURE.md**

Update to reflect the 5-module architecture, narrative-first arc schema, multi-arc support, and prompt injection with pacing controls.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CODEINDEX.md ARCHITECTURE.md
git commit -m "docs: update architecture, code index, and CLAUDE.md for implemented structure"
```

---

## Summary

| Task | Module | Key Deliverable |
|------|--------|----------------|
| 1 | core | Constants, settings, arc schema defaults |
| 2 | context | Character + persona extraction |
| 3 | context | Lorebook adapter (client-side + HTTP fallback) |
| 4 | context | Chat history + harvester orchestrator |
| 5 | prompts | LLM prompt templates (4 files) |
| 6 | planning | Template loader + arc validation |
| 7 | planning | Storage CRUD + multi-phase LLM generator |
| 8 | injection | Pacing engine + injection builder + signal parser |
| 9 | css | All stylesheet modules |
| 10 | ui | Settings panel + progress display |
| 11 | ui | Arc planning wizard (3-step popup) |
| 12 | ui | Arc manager popup |
| 13 | integration | UI facade + index.js event wiring |
| 14 | docs | CLAUDE.md, CODEINDEX.md, ARCHITECTURE.md updates |
