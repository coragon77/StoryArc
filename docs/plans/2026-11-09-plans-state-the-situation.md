# Plans State the Situation — Implementation Plan (Parts B and C)

- **Date:** 2026-11-09
- **Status:** Shipped 2026-11-09: Part B in PR #85, Part C in PR #86. Approved for implementation by Stefan, 2026-11-09: "yes, write the plan and run the test".
- **Design:** `docs/plans/2026-11-09-plans-state-the-situation-design.md`, ADR-0009
- **Goals:** `docs/goals/keeping-the-story-on-track.md`, chapters C2 and C3

## Decisions this plan builds on

From the design note, all ruled by Stefan:

1. A plan states the situation, never how to narrate. Tone, directives and anti-patterns are no longer sent to the narrator; new plans carry `worldFacts`; a re-plan is the conversion (no separate call).
2. World facts go into act and saga sections too, not only episodes: at most about three short lines. Ruled conditional on a test; the test passed (below).
3. The Arc Manager notice appears only on episodes that carry directives, anti-patterns or tone. Wording: "Its directives, rules and tone are no longer sent to the narrator. Re-plan it to give it world facts instead." No clear button.
4. Secret rewrites come from the plan check (a `secret` rewrite kind). On a re-plan, a rewrite of a secret the arc already had is a proposal the player takes or keeps in step 3; a secret the plan itself adds is rewritten directly. Revealed or disclosed secrets are never rewritten.
5. Players whose preset says little about style lose an episode's tone and directives. Accepted. Rejected alternative: a setting that sends tone to the narrator anyway.

## Test that decided point 2 (Amy chat, 2026-11-09)

Condition C of the ranking test (contract-clause premise and pressures, no rule elsewhere; 3 of 3 failed), with one world fact printed in the act section through a temporary builder patch:

```text
WORLD FACTS (true in this story; keep every scene consistent with them):
- Amy's employer cannot make her work outside her shifts: it can only ask, reward or withhold favours.
```

Result: 0 of 3 failed (swipes 12-14 of reply 54). Mara, each time: "management doesn't have the teeth to force an off-roster pull"; "management can't force a soul past their rostered hours"; "Nobody makes you clock in off-hours … purely voluntary". Perks and a threat to freeze favour credits remained, which the rubric allows. The header wording above is the one tested; keep it.

Side observation, unexplained and outside the rubric: in all three replies Greg Masters' daughter appeared (the Amy ledger has an old "Ellie Masters" record), and in two the narrator gave Steve's line to her. None of the twelve earlier swipes of the same message had her.

## Part B — world facts; the style fields leave the prompt

### B1. Data and validation

- `lib/core/constants.js`: `createDefaultArc` gets `worldFacts: []`. The schema comment lists it next to `directives` and `antiPatterns`, which stay as stored fields.
- `lib/planning/validation.js`: `validateArcPlan` reads `raw.worldFacts` with `ensureArray`, drops blanks, like `directives`.
- `lib/planning/arc-edit.js`: `worldFacts` joins `ARRAY_ARC_FIELDS`.
- `lib/planning/generator.js`: `renamePlanTexts` (the rename pass of the plan check) also reaches `worldFacts`.

### B2. Generation

- `prompts/generate-arc.txt`: the schema asks for `worldFacts` (two to five plain statements of what is true in this arc's world that the story must keep: what is possible, who holds what power, what a character or faction wants, believes or knows) in place of `directives` and `antiPatterns`. The guidelines state the boundary from ADR-0009 with one example of each side ("SWORD cannot compel a volunteer Ward" is a world fact; "keep the tone light" is not). `tone`, `themes` and `escalation` stay in the schema for the planner's own use. The FINAL CHECKLIST gets one line: no world fact says how to narrate.
- `prompts/detail-pass.txt` gets the same rule (not loaded by the template loader; kept in step).
- `lib/planning/replan.js`: `mergeReplan` takes `worldFacts` from the generated plan; `directives` and `antiPatterns` become the generated lists, empty for new plans.

### B3. Plan check

- `prompts/check-plan.txt`: a `== WORLD FACTS ==` block (`{{WORLD_FACTS}}`, one line per fact with its index). Step 2 also rewrites a world fact that says how to narrate into a statement of fact, or drops it with an empty `text`.
- `buildPlanCheckVariables` fills it; `applyPlanCheck` learns `kind: "worldFact"` with the index as `id`: a text replaces, an empty text drops, an unknown index is ignored with a warning.

### B4. Injection

- `lib/injection/builder.js`, `buildEpisodeSection`: the `TONE:` line, the anti-pattern block and the directive block go; the `WORLD FACTS` block (tested header above) takes their place.
- `buildMilestoneSection` (normal and spotlight): the same block after the premise, as tested. At most the first three world facts are printed; the rest stay stored (decision 2).
- Background and paused sections: unchanged.
- The trim (`trimToBudget`) drops only list items under the `SECRETS`, `TRIGGERS` and `FORESHADOWING TO PLANT` headers (`TRIMMABLE_LIST_HEADER`), so world-fact lines are never trimmed, like the directive lines they replace.
- Every chat's plan text changes once: one cache miss, then stable.

### B5. Arc Manager notice

- `lib/ui/arc-manager.js`, the warning line of an active arc: an episode whose `directives`, `antiPatterns` or `tone` is non-empty and that has no `worldFacts` list at all (planned before world facts; a fresh or re-planned episode with an empty list gets none, code review 2026-11-09) shows the notice of decision 3. Acts and sagas never sent those fields and get no notice.

### B6. Tests

- Builder: episode in every focus prints no `TONE:`, no directive or anti-pattern text, and the world facts; act and saga print the world facts in normal and spotlight focus, at most three; background and paused print none; an arc without world facts prints no block.
- Validation and `applyArcEdit` on `worldFacts`; `mergeReplan` takes them from the generated plan; `applyPlanCheck` applies a world-fact rewrite and a drop and ignores an unknown index; `renamePlanTexts` renames inside a world fact.
- The notice: shown for an old episode, not for an act with directives, not for an episode with world facts.
- Literal-text tests that pin the episode section (`tests/test-builder.js`, and any other test that asserts its `DO NOT:`, `DIRECTIVES:` or `TONE:` lines) are updated to the new section, never loosened.

## Part C — the plan check proposes secret rewrites

### C1. Plan check

- `prompts/check-plan.txt`, step 2: a secret that is not revealed and states someone forcing a character through a power they would not hold in a setting like this one (the same test as for pressures) gets a rewrite with `kind: "secret"`, keeping what the secret is and still explaining every planted clue that points at it. The clues are listed under each secret (`{{SECRETS}}` lines gain their planted clues).
- `applyPlanCheck`: for a secret in `revealableSecretIds` (one the arc being re-planned already had), the rewrite is stored as `proposedContent` on the secret and not applied; for any other secret it replaces `content` directly. A disclosed secret is never touched, a proposal identical to the stored text is dropped.

### C2. Re-plan wizard, step 3

- `lib/ui/wizard.js`: next to the premise choice, one fieldset per secret carrying `proposedContent`: the stored text, the proposal, the planted clues that point at it, and a choice of keep or take (radio, like the premise choice). Nothing changes without the player's choice; the default is keep.
- `lib/planning/replan.js`, `applyReplan`: takes `choice.secretChoices` (`{ [secretId]: 'take' | 'keep' }`), replaces `content` for each taken one, and deletes `proposedContent` from every secret, as it deletes `proposedPremise`.
- The knowledge ledger needs nothing: it holds no copy of an unrevealed secret.

### C3. Docs and tests

- ADR-0003 amendment, as drafted in the design note.
- Tests: `applyPlanCheck` stores a proposal for a revealable secret, applies directly for a new one, ignores a disclosed one and an identical proposal; `applyReplan` takes and keeps per choice and always removes `proposedContent`.

## Order and verification

1. B1-B3 (data, generation, plan check), then B4-B6 (injection, notice, tests), on one branch in a worktree; PR.
2. Part C on its own branch after B is merged: it depends on the plan check's shape from B3.
3. Per part: `bash tests/run.sh`, `/code-review`, and a live check in the Amy chat. For B, plan a fresh act and a fresh episode and read their injected sections; re-plan an old episode and see the notice go. For C, re-plan an arc with a secret in the wrong register and take one proposal, keep another.
4. Docs per part: `architecture.md` (builder sections, plan check, re-plan), `code-index.md`, `GLOSSARY.md` (world fact), the goals document's chapter lines.

## Not in this plan

The view of everything Story Arc sends (#83), standing rulings, stance, cleaning up a correction, editing meetings (#82).
