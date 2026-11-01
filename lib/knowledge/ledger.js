/**
 * Story Arc - Knowledge ledger
 *
 * The knowledge tracker's process (ADR-0007): which character knows which
 * fact, and how they learned it. The ledger shape is documented at
 * createEmptyKnowledgeLedger in lib/core/constants.js.
 */

// ─── Apply an extraction answer ───

/**
 * Apply a parsed extraction answer to the ledger and return the new ledger.
 *
 * Answer shape:
 *
 *     present: [name]
 *     newCharacters: [{ name, aliases: [name] }]
 *     learned: [{ factId | text, public, who: [name], how: 'witnessed' | 'told',
 *                 toldBy: name | null, at: messageIndex }]
 *
 * New characters are added first, so the rest of the answer can name them.
 * Names are matched case-insensitively against names and aliases. A learned
 * item with a known fact id adds holders to that fact; one with text creates
 * a fact. Names that are neither known nor new, and unknown fact ids, are
 * ignored. `present` replaces the scene, and lastUpdatedAt becomes the
 * message index.
 *
 * @param {object} ledger - The current ledger; not changed
 * @param {object} answer - The parsed extraction answer
 * @param {number} messageIndex - The last message the answer covers
 * @returns {object} The updated ledger
 */
export function applyExtractionAnswer(ledger, answer, messageIndex) {
    const characters = ledger.characters.map(character => ({ ...character, aliases: [...character.aliases] }));
    const facts = ledger.facts.map(fact => ({ ...fact, holders: [...fact.holders] }));

    const newCharacters = Array.isArray(answer.newCharacters) ? answer.newCharacters : [];
    for (const newCharacter of newCharacters) {
        const name = String(newCharacter?.name || '').trim();
        if (!name || findCharacterId(characters, name)) continue;
        const aliases = Array.isArray(newCharacter.aliases)
            ? newCharacter.aliases.map(alias => String(alias || '').trim()).filter(Boolean)
            : [];
        characters.push({ id: nextLedgerId('c', characters), name, aliases });
    }

    const learned = Array.isArray(answer.learned) ? answer.learned : [];
    for (const item of learned) {
        const who = Array.isArray(item?.who) ? item.who : [];
        const holderIds = [];
        for (const name of who) {
            const characterId = findCharacterId(characters, name);
            if (characterId && !holderIds.includes(characterId)) holderIds.push(characterId);
        }
        if (holderIds.length === 0) continue;

        let fact;
        if (item.factId) {
            fact = facts.find(candidate => candidate.id === item.factId);
            if (!fact) continue;
        } else {
            const text = String(item.text || '').trim();
            if (!text) continue;
            fact = { id: nextLedgerId('f', facts), text, public: item.public === true, holders: [] };
            facts.push(fact);
        }

        const how = item.how === 'told' ? 'told' : 'witnessed';
        const toldBy = how === 'told' ? findCharacterId(characters, item.toldBy) : null;
        // An index outside the covered messages would escape the rollback
        // from message N on, so it falls back to the answer's own index.
        const at = Number.isInteger(item.at) && item.at >= 0 && item.at <= messageIndex ? item.at : messageIndex;
        for (const characterId of holderIds) {
            if (fact.holders.some(holder => holder.characterId === characterId)) continue;
            fact.holders.push({ characterId, how, toldBy, at });
        }
    }

    const present = [];
    const presentNames = Array.isArray(answer.present) ? answer.present : [];
    for (const name of presentNames) {
        const characterId = findCharacterId(characters, name);
        if (characterId && !present.includes(characterId)) present.push(characterId);
    }

    return {
        ...ledger,
        characters,
        facts,
        scene: { at: messageIndex, present },
        lastUpdatedAt: messageIndex,
    };
}

/**
 * Find the character a name refers to, by name or alias, ignoring case.
 * @param {Array} characters - The ledger's characters
 * @param {string} name - A name as the extraction wrote it
 * @returns {string|null} The character's id, or null for an unknown name
 */
function findCharacterId(characters, name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    const character = characters.find(candidate =>
        candidate.name.toLowerCase() === wanted
        || candidate.aliases.some(alias => alias.toLowerCase() === wanted));
    return character ? character.id : null;
}

/**
 * The next free id of a ledger list: the prefix and one more than the highest
 * number in use, so a new id never collides with an entry still in the list,
 * even after a rollback dropped some. Short ids keep the extraction prompt small.
 * @param {string} prefix - 'c' for characters, 'f' for facts
 * @param {Array} entries - The list the id is for
 * @returns {string}
 */
function nextLedgerId(prefix, entries) {
    let highest = 0;
    for (const entry of entries) {
        const match = new RegExp(`^${prefix}(\\d+)$`).exec(String(entry.id));
        if (match) highest = Math.max(highest, Number(match[1]));
    }
    return `${prefix}${highest + 1}`;
}
