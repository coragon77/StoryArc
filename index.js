/**
 * Story Arc Extension for SillyTavern
 * Plans new story arcs for existing long-running stories using lorebook,
 * chat history, and summaries as context.
 */
import {
    eventSource,
    event_types,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    chat,
    saveMetadata,
} from '/script.js';

import { loadSettings, isEnabled, ensureChatState } from './lib/core/settings.js';
import { getArcs, getActiveArcs } from './lib/planning/storage.js';
import { buildInjection, buildSignalInjection } from './lib/injection/builder.js';
import { stampPromptMessages } from './lib/injection/stamping.js';
import { injectKnowledgeBlock, updateKnowledgeAfterReply, rollBackKnowledgeFrom, updateKnowledgeAfterSwipe, updateKnowledgeAfterEdit } from './lib/knowledge/ledger.js';
import { parseSignals, stripSignalsFromMessage, processSignalResults, flushPendingMarks, dropPendingMarksFrom, scrubArcInternals, promoteNextBeats } from './lib/injection/signals.js';
import { reopenCompletionsFrom } from './lib/planning/beat-completion.js';
import { renderSettingsPanel, setupSettingsPanelEvents, updateKnowledgeStatus } from './lib/ui/settings-panel.js';
import { registerWandMenuEntry } from './lib/ui/wand-menu.js';
import { updateProgress } from './lib/ui/progress.js';

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Before each LLM call: inject active arc plans and the knowledge block into the prompt.
 */
async function onGenerationStarted() {
    injectStoryArcPrompts();
}

/**
 * Set every Story Arc prompt from the current chat and arc state: the arc
 * plan, the in-chat signal directive and the knowledge block. Before each
 * generation, and again after messages were deleted (onMessageDeleted),
 * because a regenerate deletes the old reply only after GENERATION_STARTED.
 * Exported for the tests.
 */
export function injectStoryArcPrompts() {
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

    // Who knows what, in-chat at depth 1 — empty while the tracker is off.
    injectKnowledgeBlock();
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
    let completedBeats = [];
    if (signals.length) {
        stripSignalsFromMessage(messageIndex);
        ({ completedBeats } = await processSignalResults(signals, activeArcs, messageIndex));
        updateProgress();
        await saveMetadata();
    }

    // Every message, not only signalled ones: the wait window can run out on
    // a message without markers.
    const promptChangesAnyway = completedBeats.length > 0;
    await flushPendingMarks(messageIndex, promptChangesAnyway);

    // After marker parsing: mechanically remove any plan identifiers the
    // model leaked into journals/trackers — the directive alone can't
    // guarantee it, and leaked ids feed back into later generations.
    // All arcs, not just active: past arcs' ids linger in journal recaps.
    const allArcs = getArcs();
    scrubArcInternals(messageIndex, allArcs);

    // After signal processing, so the extraction reads the reply without its
    // markers. Not awaited: ST waits for its listeners, and the extraction
    // must not hold up the next generation.
    refreshKnowledgeStatusWhenChanged(updateKnowledgeAfterReply(messageIndex), 'Knowledge update failed:');
}

/**
 * Wait for a knowledge update the caller does not await, then refresh the
 * settings panel's status line when it changed the ledger, and the progress
 * display when it completed or reopened beats (the extraction recognises
 * beats with the tracker on). A failure is logged, never thrown into ST's
 * event loop.
 * @param {Promise<{ledgerChanged: boolean, beatsChanged: boolean}>} knowledgeUpdate
 * @param {string} failureText - Log text for a failed update
 */
function refreshKnowledgeStatusWhenChanged(knowledgeUpdate, failureText) {
    knowledgeUpdate
        .then(({ ledgerChanged, beatsChanged }) => {
            if (ledgerChanged) updateKnowledgeStatus();
            if (beatsChanged) updateProgress();
        })
        .catch(err => console.warn(`[Story Arc] ${failureText}`, err));
}

/**
 * After the user sends a message: activate the next beat in any arc that has
 * none. Promotion waits for the user's turn so the AI cannot chain its own
 * aftermath prose into the next pressure — the player reacts to a development
 * before the model learns what comes after it.
 *
 * MESSAGE_RECEIVED only fires for AI messages; user messages fire
 * USER_MESSAGE_RENDERED (same event Story Mode counts rounds on).
 */
async function onUserMessageRendered() {
    if (!isEnabled()) return;

    const activeArcs = getActiveArcs();
    const promoted = await promoteNextBeats(activeArcs);
    if (promoted) {
        updateProgress();
        await saveMetadata();
    }
}

/**
 * After messages were deleted, including the last reply before a
 * regeneration: ST passes the new chat length, so every message from that
 * index on is gone, and so is what its queued marks report, the beats it
 * completed and what the knowledge ledger learned from it. A completion
 * from a message deleted in the middle of the chat goes by its message id.
 * Then the prompts are set again from the state after the deletion.
 * Exported for the tests.
 * @param {number} chatLength - Chat length after the deletion
 */
export async function onMessageDeleted(chatLength) {
    const marksDropped = dropPendingMarksFrom(chatLength);
    const completionsReopened = reopenCompletionsFrom(chatLength);
    if (completionsReopened) updateProgress();
    if (marksDropped || completionsReopened) await saveMetadata();
    if (await rollBackKnowledgeFrom(chatLength)) updateKnowledgeStatus();

    // A regenerate fires GENERATION_STARTED, where the prompts are built,
    // while the old reply is still in the chat, and deletes that reply only
    // after (script.js, Generate). ST awaits each MESSAGE_DELETED listener
    // before it assembles the prompt, so the rebuild runs here, inside the
    // handler and after the drops and rollbacks above: the new reply's prompt
    // shows the reopened beats, the rolled-back knowledge and the chat
    // length without the deleted reply.
    injectStoryArcPrompts();
}

/**
 * When the user swipes a reply: the shown text is replaced, so its queued
 * marks, the beats it completed and what the knowledge ledger learned from
 * it no longer match the story. ST awaits this handler before it generates
 * a new swipe, so the new reply's prompt shows the reopened beats; the new
 * reply arrives through MESSAGE_RECEIVED and queues its own marks,
 * completions and knowledge update. Switching to an existing swipe
 * re-extracts that message's knowledge; its markers were stripped when it
 * arrived, so the in-prompt path does not complete its beats again.
 * @param {number} messageIndex - Index of the swiped message
 */
async function onMessageSwiped(messageIndex) {
    const swipedIndex = Number(messageIndex);
    const marksDropped = dropPendingMarksFrom(swipedIndex);
    // Before the knowledge rollback below, which takes the swiped message's
    // message id; on a swipe the index rule reopens the completion anyway.
    const completionsReopened = reopenCompletionsFrom(swipedIndex);
    if (completionsReopened) updateProgress();
    if (marksDropped || completionsReopened) await saveMetadata();
    // Not awaited: the re-extraction must not hold up the swipe. The drop
    // inside runs before the first await, so a new swipe's reply update
    // always sees the rolled-back ledger.
    refreshKnowledgeStatusWhenChanged(updateKnowledgeAfterSwipe(swipedIndex), 'Knowledge rollback after a swipe failed:');
}

/**
 * After the user edited a message: re-extract what the knowledge ledger
 * learned from that message, keeping everything learned after it, and the
 * beats completed at it (reopened first, see updateKnowledgeAfterEdit).
 * Not awaited, like the update after a reply.
 * @param {number} messageIndex - Index of the edited message
 */
function onMessageEdited(messageIndex) {
    refreshKnowledgeStatusWhenChanged(updateKnowledgeAfterEdit(Number(messageIndex)), 'Knowledge update after an edit failed:');
}

/**
 * When the user switches to a different chat: re-init per-chat state
 * and refresh the progress display and the knowledge tracker status line.
 * ST copies the chat metadata whole when it branches, so the beats completed
 * past the loaded chat's end are reopened and the knowledge ledger drops
 * what it learned there.
 */
async function onChatChanged() {
    ensureChatState();
    if (reopenCompletionsFrom(chat.length)) await saveMetadata();
    updateProgress();
    await rollBackKnowledgeFrom(chat.length);
    updateKnowledgeStatus();
}

// ─── Extension Entry Point ──────────────────────────────────────────────────

jQuery(async () => {
    loadSettings();

    // Render settings panel into ST's extensions drawer
    const settingsPanelHtml = renderSettingsPanel();
    $('#extensions_settings2').append(settingsPanelHtml);
    setupSettingsPanelEvents();

    // Add the Story Arc entry to the wand menu next to the chat bar
    registerWandMenuEntry();

    // Register SillyTavern event listeners
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
    eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
    eventSource.on(event_types.MESSAGE_SWIPED, onMessageSwiped);
    eventSource.on(event_types.MESSAGE_EDITED, onMessageEdited);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Initialize state for current chat
    ensureChatState();
    updateProgress();

    console.log('[Story Arc] Extension loaded');
});
