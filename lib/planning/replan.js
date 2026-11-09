/**
 * @file Re-plan merge — keep the situation, replace the road
 * @module planning/replan
 *
 * Merges a freshly generated plan into an existing active arc per ADR-0003
 * and the design spec §3 merge table: identity, revealed secrets, closed
 * beats, planted foreshadowing and fired triggers are kept; everything else,
 * the unrevealed secrets included, comes from the generated plan, with
 * colliding ids suffixed `_2`. `applyReplan`
 * turns the accepted merged arc into the arc to store.
 */

import { TIER_TABLE } from '../core/constants.js';
import { checkTitleAndPremise } from './arc-edit.js';
import { isBeatOpen } from '../core/settings.js';

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
 * title. The model's premise is carried beside the stored one as
 * `proposedPremise`, a transient proposal: the narrator's premise does not
 * change until the player chooses in step 3, and applyReplan removes the
 * proposal (ADR-0003).
 *
 * A secret not yet revealed (not `disclosed`) is planned again with the rest
 * of the road: the planner keeps, rewrites or drops it, and one it keeps or
 * rewrites under its old id replaces the stored one, so the planted clues
 * targeting `secret:<id>` and the fired triggers linked to it stay attached.
 * An unrevealed secret the plan leaves out is gone; a kept clue or trigger
 * that pointed at it points at no known secret, which nothing reads as a
 * link (isTriggerShown shows such a trigger, fired ones are never printed).
 * Neither input is mutated.
 *
 * @param {object} existing - The stored arc being re-planned (with dialog edits applied)
 * @param {object} generated - The validated arc from a fresh generation
 * @returns {object} The merged arc
 */
export function mergeReplan(existing, generated) {
    // A skipped milestone is closed like a completed one: kept, never re-planned.
    const keptBeats = existing.beats
        .filter(beat => !isBeatOpen(beat))
        .map(withoutRoadInRecord);
    const keptForeshadowing = existing.foreshadowing.filter(clue => clue.planted);
    const keptTriggers = existing.triggers.filter(trigger => trigger.fired);

    // Episode beats wait for the next user turn to promote one; milestones
    // (act/saga) are all active at once (spec §1).
    const newBeatStatus = generated.tier === 'episode' ? 'pending' : 'active';
    const { items: newBeats, renamed } = withUniqueIds(generated.beats, keptBeats);
    for (const beat of newBeats) {
        beat.status = newBeatStatus;
        beat.unlockAfter = (beat.unlockAfter || []).map(id => renamed[id] || id);
    }

    // A revealed secret is kept as it is. Every other secret is road: the
    // generated plan's secrets replace them, and one that keeps an old id
    // stays the secret its planted clues and fired triggers point at (ADR-0003).
    // A generated secret that restates a revealed one is dropped.
    const revealedSecrets = existing.secrets.filter(secret => secret.disclosed);
    const revealedIdByContent = new Map(revealedSecrets.map(secret => [secret.content.trim().toLowerCase(), secret.id]));
    const plannedSecrets = generated.secrets.filter(secret => !revealedIdByContent.has(secret.content.trim().toLowerCase()));
    const { items: newSecrets, renamed: renamedSecrets } = withUniqueIds(plannedSecrets, revealedSecrets);
    const { items: newForeshadowing } = withUniqueIds(generated.foreshadowing, keptForeshadowing);
    const { items: uniqueTriggers } = withUniqueIds(generated.triggers, keptTriggers);

    // A new trigger's secret link follows its secret: to the suffixed id on a
    // collision with a revealed secret, or to the revealed secret a restated
    // one was dropped for. A stale link would gate the trigger on the wrong
    // secret's phase.
    const mergedSecretIds = {};
    for (const secret of generated.secrets) {
        const restatedId = revealedIdByContent.get(secret.content.trim().toLowerCase());
        mergedSecretIds[secret.id] = restatedId || renamedSecrets[secret.id] || secret.id;
    }
    const newTriggers = uniqueTriggers.map(trigger =>
        trigger.secret ? { ...trigger, secret: mergedSecretIds[trigger.secret] || trigger.secret } : trigger
    );

    return {
        ...existing,
        proposedPremise: generated.premise,
        tier: generated.tier,
        estimatedLength: generated.estimatedLength,
        // World facts replace directives and anti-patterns (ADR-0009): a
        // re-plan is the conversion, and the generated lists are empty.
        worldFacts: generated.worldFacts,
        directives: generated.directives,
        antiPatterns: generated.antiPatterns,
        tone: generated.tone,
        themes: generated.themes,
        escalation: generated.escalation,
        characters: generated.characters,
        secrets: [...revealedSecrets, ...newSecrets],
        beats: [...keptBeats, ...newBeats],
        foreshadowing: [...keptForeshadowing, ...newForeshadowing],
        triggers: [...keptTriggers, ...newTriggers],
    };
}

/**
 * Copy a kept completed beat without the parts of its completion record
 * (planning/beat-completion.js) that undo the old road: the beats it
 * unlocked and whether it completed the arc. Those name beats the re-plan
 * replaced, or an arc state its new road no longer has; a rollback across
 * the re-plan would otherwise lock a regenerated beat that reuses an old
 * id, or reopen the new road. The message reference and the earlier
 * lastFulfilledAt stay, so the rollback still reopens the beat itself and
 * sets lastFulfilledAt back. A beat without a record is kept as it is.
 * @param {object} beat - A completed beat of the stored arc
 * @returns {object}
 */
function withoutRoadInRecord(beat) {
    if (!beat.completion) return beat;
    const { unlocked, arcCompleted, ...messageReference } = beat.completion;
    return { ...beat, completion: messageReference };
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
    const taken = new Set(kept.map(keptItem => keptItem.id));
    const renamed = {};
    const copies = items.map(item => {
        let id = item.id;
        for (let suffix = 2; taken.has(id); suffix++) {
            id = `${item.id}_${suffix}`;
        }
        if (id !== item.id) renamed[item.id] = id;
        taken.add(id);
        return { ...item, id };
    });
    return { items: copies, renamed };
}

/**
 * Apply an accepted re-plan: turn the checked merged arc into the arc to
 * store. The wizard's "Apply re-plan" stores what this returns, and the
 * rules of applying a re-plan live here, where a test reaches them.
 *
 * The premise is the player's choice in step 3 (ADR-0003): the current
 * premise, the proposal, or either as edited. It is stored trimmed, and the
 * transient proposal is never stored. A blank premise is refused with the
 * JSON editor's message. `chatLength` is the chat length at apply, the
 * moment of the re-plan.
 *
 * The re-plan stamps `chatLength` as replannedAt, where the stall count
 * (isStalled) restarts. It is a field of its own, read only by the stall
 * rule: lastFulfilledAt keeps its one meaning, so a completion rolled back
 * after the re-plan cannot move the count before it. messageStart, and with
 * it the phase and secret gating, is not touched.
 *
 * The rulings are built from the stored arc's rulings as they are at
 * apply, not from the merged arc, which is the wizard's copy from Generate:
 * the knowledge extraction may have stored a ruling, and a deletion removed
 * or moved one, while the wizard was open. So:
 * - the rulings the player removed in step 2 are dropped; only the player
 *   removes one (ADR-0003);
 * - the rulings the generation saw (on the merged arc, matched by id and
 *   text, since a new ruling can take a deleted one's id) are answered:
 *   each gets answeredAt, so the progress card's ruling line goes out, and
 *   one answered before keeps its mark and reaches every later re-plan;
 * - a ruling stored after Generate stays open: the planner never saw it;
 * - a ruling gone from the stored arc stays gone.
 * Each kept ruling is the stored one, so its message index is current. An
 * arc from before rulings (no stored list) stores none.
 *
 * The result is a deep copy, so the input is never mutated and the stored
 * arc shares nothing with the wizard's review copy.
 * @param {object} merged - The checked merged arc (mergeReplan, then the plan check)
 * @param {number} chatLength - chat.length when the player applies the re-plan
 * @param {{ premise?: string, removedRulingIds?: string[], storedRulings?: object[] }} [choice] - The
 *   premise as chosen and edited in step 3, the ids of the rulings removed in
 *   step 2, and the stored arc's rulings at apply (absent on an arc from before
 *   rulings)
 * @returns {{ arc: object|null, error: string|null }} The arc to store, or why not
 */
export function applyReplan(merged, chatLength, choice = {}) {
    const error = checkTitleAndPremise(merged.title, choice.premise);
    if (error) return { arc: null, error };

    const arc = structuredClone(merged);
    arc.premise = String(choice.premise).trim();
    delete arc.proposedPremise;
    arc.replannedAt = chatLength;
    delete arc.rulings;
    if (Array.isArray(choice.storedRulings)) {
        const removedRulingIds = choice.removedRulingIds || [];
        const seenRulings = merged.rulings || [];
        const keptRulings = structuredClone(choice.storedRulings)
            .filter(ruling => !removedRulingIds.includes(ruling.id));
        for (const ruling of keptRulings) {
            const generationSawIt = seenRulings.some(seen => seen.id === ruling.id && seen.text === ruling.text);
            if (generationSawIt && ruling.answeredAt === undefined) ruling.answeredAt = chatLength;
        }
        arc.rulings = keptRulings;
    }
    return { arc, error: null };
}
