/**
 * Story Arc Extension for SillyTavern
 * Plans new story arcs for existing long-running stories using lorebook,
 * chat history, and summaries as context.
 */
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    chat,
    chat_metadata,
    saveMetadata,
} from '/script.js';

import {
    extension_settings,
    getContext,
} from '/scripts/extensions.js';

import { MODULE_NAME, loadSettings, isEnabled, ensureChatState } from './lib/core/index.js';
import { getArcs, getActiveArcs } from './lib/planning/index.js';
import { buildInjection, buildSignalInjection, stampPromptMessages } from './lib/injection/index.js';
import { parseSignals, stripSignalsFromMessage, processSignalResults, scrubArcInternals, promoteNextBeats } from './lib/injection/index.js';
import { renderSettingsPanel, setupSettingsPanelEvents, registerWandMenuEntry } from './lib/ui/index.js';
import { updateProgress } from './lib/ui/index.js';

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Before each LLM call: inject active arc plans into the prompt.
 */
async function onGenerationStarted() {
    // Always set the prompt, empty when disabled or no active arcs —
    // otherwise a previously set injection would linger after the last
    // arc completes or the extension is turned off.
    const arcs = isEnabled() ? getActiveArcs() : [];
    const injection = arcs.length ? buildInjection(arcs) : '';
    setExtensionPrompt(
        'story_arc_plan',
        injection,
        extension_prompt_types.IN_PROMPT,
        0,
        false,
        extension_prompt_roles.SYSTEM,
    );

    // Signal directive goes in-chat near the generation point — models
    // ignore it when it sits far back in the system prompt.
    const signalInjection = arcs.length ? buildSignalInjection(arcs) : '';
    setExtensionPrompt(
        'story_arc_signals',
        signalInjection,
        extension_prompt_types.IN_CHAT,
        0,
        false,
        extension_prompt_roles.SYSTEM,
    );
}

/**
 * Last stop before the request goes out: stamp each user message in the
 * outgoing prompt with its own arc counter.
 *
 * ST fires this after squashing system messages and hands us the very array it
 * then sends (openai.js:1616-1623), so in-place mutation reaches the wire and
 * nothing re-merges afterwards. Stored chat and the displayed chat are
 * untouched. Dry runs are token-counting passes and must be left alone.
 * @param {{ chat: Array<object>, dryRun: boolean }} eventData
 */
function onChatCompletionPromptReady(eventData) {
    if (eventData?.dryRun || !isEnabled()) return;
    const arcs = getActiveArcs();
    if (!arcs.length) return;
    stampPromptMessages(eventData.chat, arcs);
}

/**
 * After the AI responds: parse ARC_SIGNAL patterns, strip them from display,
 * and update beat statuses accordingly.
 */
async function onMessageReceived(messageIndex) {
    if (!isEnabled()) return;

    const message = chat[messageIndex];
    if (!message?.mes) return;

    const activeArcs = getActiveArcs();
    const signals = parseSignals(message.mes);
    if (signals.length) {
        stripSignalsFromMessage(messageIndex);
        await processSignalResults(signals, activeArcs, messageIndex);
        updateProgress();
        await saveMetadata();
    }

    // After marker parsing: mechanically remove any plan identifiers the
    // model leaked into journals/trackers — the directive alone can't
    // guarantee it, and leaked ids feed back into later generations.
    // All arcs, not just active: past arcs' ids linger in journal recaps.
    scrubArcInternals(messageIndex, getArcs());
}

/**
 * After the user sends a message: activate the next beat in any arc that has
 * none. Promotion waits for the user's turn so the AI cannot chain its own
 * aftermath prose into the next objective — the player reacts to a development
 * before the model learns what comes after it.
 *
 * MESSAGE_RECEIVED only fires for AI messages; user messages fire
 * USER_MESSAGE_RENDERED (same event Story Mode counts rounds on).
 */
async function onUserMessageRendered() {
    if (!isEnabled()) return;

    const promoted = await promoteNextBeats(getActiveArcs());
    if (promoted) {
        updateProgress();
        await saveMetadata();
    }
}

/**
 * When the user switches to a different chat: re-init per-chat state
 * and refresh the progress display.
 */
function onChatChanged() {
    ensureChatState();
    updateProgress();
}

// ─── Extension Entry Point ──────────────────────────────────────────────────

jQuery(async () => {
    loadSettings();

    // Render settings panel into ST's extensions drawer
    $('#extensions_settings2').append(renderSettingsPanel());
    setupSettingsPanelEvents();

    // Add the Story Arc entry to the wand menu next to the chat bar
    registerWandMenuEntry();

    // Register SillyTavern event listeners
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Initialize state for current chat
    ensureChatState();
    updateProgress();

    console.log('[Story Arc] Extension loaded');
});
