/**
 * The knowledge tracker (ADR-0007): who knows which fact, and how they
 * learned it. The ledger lives at chat_metadata.story_arc.knowledge; its
 * shape is documented at createEmptyKnowledgeLedger in core/constants.js.
 */

// ─── Drop from message N ───

/**
 * Take back what the ledger learned from message `firstGoneIndex` on: the
 * user regenerated, swiped or deleted the messages it came from, or loaded a
 * branch that ends before them. Removes every holder entry learned at that
 * message or later, and every fact this leaves without holders. A holder
 * entered by the user (`at: null`) is never removed, so its fact stays.
 * Same pattern as dropPendingMarksFrom for the queued marks.
 * Does not save: the caller saves, and only when this returns true.
 * @param {object} ledger - The chat's knowledge ledger, changed in place
 * @param {number} firstGoneIndex - Index of the first message that is gone
 * @returns {boolean} True when anything in the ledger changed
 */
export function dropKnowledgeFrom(ledger, firstGoneIndex) {
    let changed = false;

    const remainingFacts = [];
    for (const fact of ledger.facts) {
        const remainingHolders = fact.holders.filter(holder => holder.at === null || holder.at < firstGoneIndex);
        if (remainingHolders.length === fact.holders.length) {
            remainingFacts.push(fact);
            continue;
        }
        changed = true;
        // Only the dropped messages taught this fact: the story no longer contains it.
        if (remainingHolders.length === 0) continue;
        fact.holders = remainingHolders;
        remainingFacts.push(fact);
    }
    ledger.facts = remainingFacts;

    // The scene came from a dropped message: nobody is known to be present.
    if (ledger.scene.at !== null && ledger.scene.at >= firstGoneIndex) {
        ledger.scene = { at: null, present: [] };
        changed = true;
    }

    // The ledger now covers only the messages before firstGoneIndex, so the
    // next update reads from there on.
    if (ledger.lastUpdatedAt !== null && ledger.lastUpdatedAt >= firstGoneIndex) {
        const lastKeptIndex = firstGoneIndex - 1;
        ledger.lastUpdatedAt = lastKeptIndex >= 0 ? lastKeptIndex : null;
        changed = true;
    }

    if (changed) {
        console.log(`[Story Arc] Dropped knowledge learned from message #${firstGoneIndex} on`);
    }
    return changed;
}
