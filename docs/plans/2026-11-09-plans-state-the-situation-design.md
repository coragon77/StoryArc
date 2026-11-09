# Plans State the Situation, Never How to Narrate — Design Note

- **Date:** 2026-11-09
- **Status:** Rulings by Stefan 2026-11-08/09. Part A shipped (planner and plan-check prompts, 7630f2b; the GENRE line, PR #84). Part B (world facts, the style fields leave the prompt) and Part C (a re-plan rewrites unrevealed secrets) are designed here and await approval to implement.
- **Builds on:** `docs/plans/2026-09-16-tiers-focus-and-replan-design.md` (sections by tier and focus, re-plan merge)
- **ADRs touched:** `0003` (re-plan keeps the situation, replaces the road), `0004` (genre binds generation), `0006` (plans are checked before play); new `0009` (a plan states the situation, never how to narrate)
- **Glossary:** `GLOSSARY.md`: genre, pressure, premise, re-plan

## Problem

A plan is written by a model, and it is in the narrator's prompt every turn for
the length of the arc. When its wording is wrong, the story follows the wording.
Three failures in one session of the Paragon chat (2026-11-08):

- Message 3023: Vasquez, an ally since the October 14 scene, tied her help to a
  vault keycard and a blood match ("on one condition"), and walked off when
  Ellie refused.
- Message 3051: Sofia, the Ward team's lead, produced a "SWORD Parahuman
  Registry" form and ordered an adult Defender around.
- Message 3069: Tanya, a PR coordinator, held a signed agreement in front of
  Ellie to pull her out of school.

What reached the narrator from the active acts (rebuilt from the chat file;
acts at normal focus print only GENRE, PREMISE and STANDING PRESSURES):

- The Gilded Pedestal: `GENRE: Superhero drama, echi/hentai, action, non-con,
  comedy, corruption, sexual deviancy, intrigue and backstabbing, political
  thriller.`; a premise promising "institutional exploitation" and "legal
  traps"; four pressures of 40 to 60 words that staged scenes.
- Rolling with the Punches: a pressure naming "Staff Sergeant Carver", a
  military rank in a story where SWORD is not the military.

The arcs' directives and anti-patterns, including "let the social entrapment,
legal paperwork, and backstage seduction simmer", never reached the narrator:
those fields are printed only in the episode section (`buildEpisodeSection`).
The preset, the Author's Note and Summaryception's continuity block pushed the
same way; this note is about Story Arc's share.

## Test (Amy chat, 2026-11-09)

One scene (Steve: "You're off tonight, right, Amy? No shifts?", Mara present),
a test act at normal focus, three replies per condition, the same preset and
model as Paragon. A reply fails if anyone uses a contract, an order or an
authority they do not hold to make Amy work.

| Condition | Plan wording | GENRE line | Ranking line | Explicit rule at depth 1 | Fail |
|---|---|---|---|---|---|
| A | contract clauses | yes | no | yes | 0/3 |
| C | contract clauses | yes | no | no | 3/3 |
| D | contract clauses | no | yes | no | 3/3 |
| E | lever and cost | yes | no | no | 0/3 |

- The plan's own wording decides it: 6 of 6 fail with contract-clause wording
  and no rule, 0 of 3 with lever-and-cost wording, the same GENRE line present.
- The ranking line ("the narration instructions and the facts the story has
  already established outrank it") and removing the GENRE line changed
  nothing (D = C). With nothing established to defer to, the plan is the only
  voice on the subject.
- An explicit narration rule at depth 1 beats bad plan wording (A).

Afterwards the extended plan check (Part A) was run on the contract-clause arc:
twice it rewrote all three pressures and the trigger into lever and cost, and
on a military arc whose direction makes orders real it left everything alone.
Its first version left the contract arc alone too, because its exception let
the premise establish the authority; the premise now establishes none. Its
second version rested on the direction and rewrote legitimate garrison orders
when the direction was one line (see Risks); the third, judging by the setting,
passed all five calls.

Small samples, one model, one scene. The direction is clear, the size is not
measured. Full record: the session's `amy-test/RESULTS.md`, folded in here.

## Decisions (Stefan)

1. A plan says what is true in the world: what is possible, who holds what
   power, what a character or faction wants, believes or knows. It never says
   how to narrate: tone, pacing, emphasis, how a character comes across, what
   to show or leave out. Character portrayal stays with the player's material;
   a change the arc itself causes ("Kendra no longer trusts Ellie with squad
   business") is situation. Story Arc's own code-written text (pacing, phase,
   section headers) is not affected: the risk is unreviewed planner text.
2. Genre, tone and other style settings steer generation only and never reach
   the narrator. ("The style should not influence the main chat … its only to
   steer what and how the arc gets generated.")
3. New plans carry one `worldFacts` list in place of `directives` and
   `antiPatterns`. The old fields are no longer sent to the narrator for any
   arc. Re-planning an arc is its conversion; no separate conversion call.
4. A re-plan offers to rewrite unrevealed secrets: same id, holders and reveal
   phase, old and new side by side, the player chooses. Revealed secrets stay.
   Amends ADR-0003 (secrets were add-only).
5. A trigger action or clue describes what happens or what can be noticed: a
   consequence the world allows, stated as lever and cost; no tone, no pacing,
   no portrayal.
6. Fixes are story-agnostic: nothing assumes where a player keeps their rules.
7. The ranking line was to be tested first. It was, and showed no effect: it is
   not shipped.

## Part A — shipped

- `prompts/generate-arc.txt`: the leverage rule (b2a6b11) now also covers the
  premise; a FINAL CHECKLIST line; trigger actions and clues state
  consequences, never tone, pacing or portrayal (7630f2b).
- `prompts/detail-pass.txt`: the leverage rule (b2a6b11). The template loader
  does not load this file; it is kept in step with the planner.
- `prompts/check-plan.txt`: step 2 also rewrites a pressure or trigger action in
  which someone forces a character through a contract, clause, paperwork, an
  order, a disciplinary threat or a chain of command that a person in their place
  would not hold in a setting like this one; the direction or the story can grant
  more, the premise never (7630f2b, exception reworded after the thin-direction
  test).
- `lib/injection/builder.js`: no `GENRE:` line in any section (PR #84,
  ADR-0004 amendment).

## Part B — world facts; the style fields leave the prompt

### Data

- `worldFacts: string[]` on the arc, next to `directives` and `antiPatterns`
  (`createDefaultArc` in `constants.js`). Missing on stored arcs: read as empty.
- `directives`, `antiPatterns` and `tone` stay stored and editable in the Arc
  Manager's JSON editor; they are no longer printed for the narrator.
- `validateArcPlan` accepts `worldFacts` as a list of strings (wraps a string,
  drops blanks), like the other list fields; `applyArcEdit` lists it in
  `ARRAY_ARC_FIELDS`.

### Generation

- `generate-arc.txt` asks for `worldFacts` instead of `directives` and
  `antiPatterns`: two to five plain statements of what is true in this arc's
  world that the story needs kept ("SWORD cannot compel a volunteer Ward",
  "magic cannot raise the dead in Greymoor"), under the boundary of decision 1,
  with one example each of a world fact and of a style line that is not one.
  `tone` stays in the schema: the planner uses it to shape the pressures.
- `check-plan.txt` gets `{{WORLD_FACTS}}` and rewrites a world fact that is a
  style instruction into a statement of fact, or drops it (an empty `text`).
  `applyPlanCheck` learns `kind: "worldFact"` with the item's index as id.
- `mergeReplan` takes `worldFacts` from the generated plan; `directives` and
  `antiPatterns` of a re-planned arc become the generated (empty) lists.

### Injection

- `buildEpisodeSection`: `TONE`, the anti-pattern block and the directive block
  go; a `WORLD FACTS:` block takes their place.
- `buildMilestoneSection` (normal and spotlight): a `WORLD FACTS:` block after
  the premise. Acts and sagas carried no directives before, so this adds text
  to their sections (open question 1).
- Background and paused sections: unchanged.

### Arc Manager

- An arc whose `directives`, `antiPatterns` or `tone` is non-empty and whose
  `worldFacts` is empty shows one line under its warnings: "Directives, rules
  and tone are no longer sent to the narrator. Re-plan the arc to give it world
  facts." No button: the re-plan is the existing one.
- The release note says the same.

### Tests

- Episode, act, saga in every focus: no `TONE:`, no directive or anti-pattern
  text, world facts printed where decided, nothing for background and paused.
- `validateArcPlan` and `applyArcEdit` on `worldFacts`; `mergeReplan` takes
  them from the generated plan; `applyPlanCheck` applies a world-fact rewrite
  and a drop, ignores an unknown index.
- The Arc Manager notice: shown for an old arc, not for one with world facts.

## Part C — a re-plan rewrites unrevealed secrets

- The re-plan's outline call already sees the arc so far (`buildArcSoFar`). It
  is asked for `secretRewrites: [{ id, content }]`, a rewrite of each
  unrevealed secret whose text breaks the leverage rule or decision 1, keeping
  what the secret is; it may return none.
- Step 3 of the re-plan wizard shows each proposed rewrite next to the stored
  text, with the planted clues that point at the secret, and a choice per
  secret: keep or take the rewrite. Nothing changes without the player.
- `mergeReplan` (or `applyReplan`) replaces `content` only; `id`, `holders`,
  `revealPhase` and `disclosed` stay. A revealed or disclosed secret is never
  rewritten, and a rewrite must still explain every planted clue that targets it.
- The knowledge ledger holds no copy of an unrevealed secret (a fact is created
  only at the reveal, linked by `{ arcId, secretId }`), so the rewrite touches
  no ledger entry.
- ADR-0003 amendment, to add when Part C ships: "A re-plan may also propose new
  wording for secrets not yet revealed; the player takes or keeps each, and its
  id, holders and reveal phase stay. Secrets that came out are never rewritten."

## Open questions for Stefan

1. World facts in act and saga sections too (recommended: yes, a world fact is
   situation like the premise), or episodes only, where directives were?
2. The Arc Manager notice wording, and whether it also offers to clear the old
   fields.
3. Part C: one more output of the re-plan's outline call (recommended: no extra
   call), or a separate call per re-plan?
4. Players whose preset says little about style lose the tone and directives an
   episode used to carry. Stefan's genre ruling points that way ("its only to
   steer what and how the arc gets generated"), but the trade-off itself was
   not confirmed. If accepted, record "a setting that injects the tone anyway"
   as the rejected alternative.

## Risks

- Found and fixed 2026-11-09: the plan check's first exception for real
  authority rested on the author's direction or the story, and a fresh plan's
  check gets no story messages. With a thin direction ("Amy's next arc at the
  frontier garrison.") it rewrote a garrison's legitimate orders, the
  court-martial and the stockade into "her standing at the garrison", in 2 of 2
  calls. The exception now asks whether a person in that place holds the power
  in a setting like this one (an officer commands soldiers, an employer does
  not own an employee's free time, a volunteer body cannot compel), and the
  premise still grants nothing. Rerun: thin-direction military arc 0 of 2
  rewritten, explicit-direction military arc 0 of 1, contract-clause arc
  rewritten 2 of 2. The judgment now rests on the model's sense of the
  setting; a setting with unusual powers needs them in the direction.

- World facts become the next place for style: the planner writes "keep it
  tense" as a world fact. The plan check's world-fact step is the guard; a live
  run on a fresh plan checks it.
- An episode planned before Part B loses its tone and directives at once. That
  is the decision, and the Arc Manager notice says why.
- Each arc's injected text changes once when Part B ships: one cache miss per
  chat, then stable.

## Not in scope

The view of everything Story Arc sends (#83), standing rulings, stance,
cleaning up a correction, editing meetings (#82).
