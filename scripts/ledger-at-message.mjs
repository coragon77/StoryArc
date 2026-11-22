/**
 * The knowledge ledger of a chat file as it stood after one message, for the
 * scripts that rebuild what the tracker or the narrator got at a message
 * (rebuild-knowledge-block.mjs, replay-extraction.mjs).
 *
 * Holder entries, character details, scenes and meetings from later
 * messages are left out, and a fact left with no holder goes, unless it is
 * public. An entry from the user (at: null) survives every cut, as it
 * survives every rollback. A ledger from before the meetings gets its
 * scenes as meetings, as its next update would. The cut is approximate:
 * retractions, merges and hand edits made later are not undone.
 */

/**
 * Cut a stored ledger back to the message `ledgerIndex`.
 * @param {object} storedLedger - `chat_metadata.story_arc.knowledge` from the chat file
 * @param {number} ledgerIndex - The last message the cut ledger covers
 * @returns {{ledger: object, scene: object, meetingsFromScenes: boolean}}
 */
export function ledgerAtMessage(storedLedger, ledgerIndex) {
    const isKept = entry => entry.at === null || entry.at === undefined || entry.at <= ledgerIndex;
    const facts = storedLedger.facts
        .map(fact => ({ ...fact, holders: fact.holders.filter(isKept) }))
        .filter(fact => fact.holders.length > 0 || fact.public);
    const characters = storedLedger.characters.map(character => {
        if (!character.details) return character;
        const details = {};
        for (const [kind, history] of Object.entries(character.details)) {
            const keptHistory = history.filter(isKept);
            if (keptHistory.length > 0) details[kind] = keptHistory;
        }
        return { ...character, details };
    });
    const scenes = [...(storedLedger.sceneHistory || []), storedLedger.scene].filter(scene => scene.at !== null && isKept(scene));
    const scene = scenes.at(-1) || { at: null, present: [] };
    const meetings = storedLedger.meetings
        ? storedLedger.meetings.filter(isKept)
        : scenes.filter(keptScene => keptScene.present.length >= 2);

    const ledger = { ...storedLedger, characters, facts, scene, meetings };
    return { ledger, scene, meetingsFromScenes: !storedLedger.meetings };
}
