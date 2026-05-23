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
import { getActiveArcs } from './lib/planning/index.js';
import { buildInjection } from './lib/injection/index.js';
import { parseSignals, stripSignalsFromMessage, processSignalResults } from './lib/injection/index.js';
import { renderSettingsPanel, setupSettingsPanelEvents } from './lib/ui/index.js';
import { updateProgress } from './lib/ui/index.js';

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Before each LLM call: inject active arc plans into the prompt.
 */
async function onGenerationStarted() {
    if (!isEnabled()) return;

    const arcs = getActiveArcs();
    if (!arcs.length) return;

    const injection = buildInjection(arcs);
    setExtensionPrompt(
        'story_arc_plan',
        injection,
        extension_prompt_types.IN_PROMPT,
        0,
        0,
        false,
        extension_prompt_roles.SYSTEM,
    );
}

/**
 * After the AI responds: parse ARC_SIGNAL patterns, strip them from display,
 * and update beat statuses accordingly.
 */
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

    // Register SillyTavern event listeners
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Initialize state for current chat
    ensureChatState();
    updateProgress();

    console.log('[Story Arc] Extension loaded');
});
