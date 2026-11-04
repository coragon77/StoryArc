/**
 * @file The knowledge tracker's status line in the settings drawer
 * @module ui/knowledge-status
 *
 * A file of its own, against the house default, because a second file
 * really calls it: index.js, the settings panel and the Knowledge popup all
 * refresh the line, and the popup cannot import settings-panel.js, which
 * opens the popup, without an import cycle.
 */

import { isKnowledgeTrackerEnabled, getKnowledgeLedger } from '../core/settings.js';

/**
 * Show in the status line at which message the current chat's knowledge
 * ledger was last updated, or that the tracker is off or the ledger empty.
 * While characters carry a name clash, the line adds how many and a button
 * that opens the Knowledge popup.
 * Called on setup, when the switch changes and on CHAT_CHANGED; whoever
 * updates the ledger calls it too. No-op while the panel is absent.
 */
export function updateKnowledgeStatus() {
    const $status = $('#story-arc-knowledge-status');
    if (!$status.length) return;

    if (!isKnowledgeTrackerEnabled()) {
        $status.text('Knowledge tracker is off.');
        return;
    }
    const ledger = getKnowledgeLedger();
    const updateLine = ledger.lastUpdatedAt === null
        ? 'Ledger is empty: not updated yet.'
        : `Ledger last updated at message #${ledger.lastUpdatedAt}.`;
    const flaggedCount = ledger.characters.filter(character => character.nameClash).length;
    if (flaggedCount === 0) {
        $status.text(updateLine);
        return;
    }
    // Only fixed text and a number: nothing to escape.
    const namesToCheck = flaggedCount === 1 ? '1 new name to check' : `${flaggedCount} new names to check`;
    $status.html(`${updateLine} ${namesToCheck} `
        + '<button type="button" class="menu_button story-arc-knowledge-names-btn">Open Knowledge</button>');
}
