/**
 * @file Re-plan merge — keep the situation, replace the road
 * @module planning/replan
 *
 * Merges a freshly generated plan into an existing active arc per ADR-0003
 * and the design spec §3 merge table: identity, secrets, fulfilled beats,
 * planted foreshadowing and fired triggers are kept; everything else comes
 * from the generated plan, with colliding ids suffixed `_2`.
 */

import { TIER_TABLE } from '../core/constants.js';

/**
 * Tiers a re-plan may choose: the arc's own tier or a larger one. An episode
 * can grow into an act or saga; an arc never shrinks, because its fulfilled
 * milestones have no form as ordered scene beats (ADR-0003 amendment).
 * @param {string} [tier='episode'] - The arc's current tier
 * @returns {string[]} Tier keys, smallest first
 */
export function replanTiers(tier = 'episode') {
    const tiers = Object.keys(TIER_TABLE);
    // An unknown tier counts as episode, like everywhere else
    const start = Math.max(tiers.indexOf(tier), 0);
    return tiers.slice(start);
}

/**
 * Merge a generated plan into the arc it re-plans.
 *
 * `existing` carries title, premise and direction as edited in the wizard —
 * the caller passes a copy with those three fields already replaced, so this
 * function keeps them from `existing` and ignores the model's regenerated
 * title and premise. Neither input is mutated.
 *
 * @param {object} existing - The stored arc being re-planned (with dialog edits applied)
 * @param {object} generated - The validated arc from a fresh generation
 * @returns {object} The merged arc
 */
export function mergeReplan(existing, generated) {
    const keptBeats = existing.beats.filter(b => b.status === 'completed');
    const keptForeshadowing = existing.foreshadowing.filter(f => f.planted);
    const keptTriggers = existing.triggers.filter(t => t.fired);

    // Episode beats wait for the next user turn to promote one; milestones
    // (act/saga) are all active at once (spec §1).
    const newBeatStatus = generated.tier === 'episode' ? 'pending' : 'active';
    const { items: newBeats, renamed } = withUniqueIds(generated.beats, keptBeats);
    for (const beat of newBeats) {
        beat.status = newBeatStatus;
        beat.unlockAfter = (beat.unlockAfter || []).map(id => renamed[id] || id);
    }

    // Secrets are add-only: a generated secret that restates an existing one
    // (the model was shown them in the arc-so-far block) is dropped.
    const knownContents = new Set(existing.secrets.map(s => s.content.trim().toLowerCase()));
    const addedSecrets = generated.secrets.filter(s => !knownContents.has(s.content.trim().toLowerCase()));

    return {
        ...existing,
        tier: generated.tier,
        estimatedLength: generated.estimatedLength,
        directives: generated.directives,
        antiPatterns: generated.antiPatterns,
        tone: generated.tone,
        themes: generated.themes,
        escalation: generated.escalation,
        characters: generated.characters,
        secrets: [...existing.secrets, ...withUniqueIds(addedSecrets, existing.secrets).items],
        beats: [...keptBeats, ...newBeats],
        foreshadowing: [...keptForeshadowing, ...withUniqueIds(generated.foreshadowing, keptForeshadowing).items],
        triggers: [...keptTriggers, ...withUniqueIds(generated.triggers, keptTriggers).items],
    };
}

/**
 * Copy `items`, suffixing every id that collides with a kept id (or an
 * earlier new one) with `_2`, `_3`, ... Returns the renames so references
 * (`unlockAfter`) can follow.
 * @param {object[]} items - New items from the generated plan
 * @param {object[]} kept - Items whose ids are already taken
 * @returns {{ items: object[], renamed: Object<string, string> }}
 */
function withUniqueIds(items, kept) {
    const taken = new Set(kept.map(k => k.id));
    const renamed = {};
    const copies = items.map(item => {
        let id = item.id;
        for (let n = 2; taken.has(id); n++) {
            id = `${item.id}_${n}`;
        }
        if (id !== item.id) renamed[item.id] = id;
        taken.add(id);
        return { ...item, id };
    });
    return { items: copies, renamed };
}
