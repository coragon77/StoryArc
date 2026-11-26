# An Arc's Plan Stays Inside Its Plot Thread — Design Note

- **Date:** 2026-11-26
- **Status:** Built on the integration branch `feature/97-plan-thread` in tickets #98–#106; `docs/plans/2026-11-26-plan-thread.md` records how. Live check 2026-11-26 in the test chat (#107): an episode planned beside a busy act, with the box on and off, kept every beat, pressure, premise and secret inside its own plot thread, and the questions asked nothing about the other threads. An episode re-plan with five of seven beats closed wrote three new beats. Re-plans of an old arc with a mixed premise: with a blank direction the stored premise defines the thread and the mix stays (the known gap); with a direction naming the arc's own thread the questions and the proposed premise were clean, and after the planted-clue change the plan check removed another thread's secret whose clue was already planted, its planted clue kept, while the arc's own secret with a planted clue stayed. Not seen live: the step log's removed-parts count (the review step replaces the generation view as soon as the check finishes), and a removed secret taking a gated, unfired trigger with it (unit tests only).
- **Spec:** GitHub issue #97, the source of this design. This note records what shipped and where it differs from the spec's text.
- **Builds on:** ADR-0010 (an arc is one plot thread), ADR-0006 (the plan check), ADR-0003 (a re-plan keeps the situation)
- **ADRs:** `0011` (new): an arc's plan stays inside its plot thread, and hidden links are the player's choice. `0006` is amended: the check also removes parts of another thread, gets the analysis on a new plan, and may rewrite a planner-written premise, for the thread rule only. `0010` is amended to point at 0011.
- **Glossary:** `GLOSSARY.md`: Backdrop, Link, Foreign part and Gate are new; Episode and Scene beat carry one sentence on the thread.
- **Architecture:** `docs/architecture/architecture.md`, section "Plot Thread"

## Problem

A live chat ran a short personal episode beside a friend's rise to fame, and the friend's story had no arc of its own. The planner gave the episode:

- two of seven scene beats whose fulfillment was an event of the friend's story;
- a climax beat that waited on both;
- a premise that asked the friend's question beside the episode's own;
- a secret and a trigger about the friend's antagonist.

The tracker stopped after three of the seven beats. It was waiting for the other thread's events in the form the planner had pictured. For about 165 messages the narrator was sent the other thread's pressure under the episode's name.

Three things in the prompts led there:

- The outline prompt asked for intersecting arcs ("create something that intersects", "multi-thread").
- The wizard's question call asked how the episode should "balance with" the other thread.
- Nothing told the planner the episode was one plot thread. ADR-0010 said so only for milestones.

A second, smaller problem: a re-plan of an episode asked for the tier's full 5–8 new scene beats, even with two scenes left.

## The rule

An arc's plan stays inside its own plot thread, at every tier. It is not a setting.

- **The thread** is what the direction, the author's answers and, on a re-plan, the rulings name. With a blank direction on a new arc, the planner picks one thread and names it in the premise. On a re-plan with a blank direction, the premise the wizard passes in names it.
- **Backdrop** is everything else going on in the story, whether or not it has an arc. It may supply where and when a beat plays, never what happens in it. An event the direction or an answer names is backdrop, unless the text says its outcome is part of this arc.
- **Always:**
  - a fulfillment is a step of this thread, and no beat waits on another thread's event;
  - a pressure names a force of this thread;
  - the premise asks this thread's question only;
  - a secret, trigger or clue is about this arc's own people and things.
- **People are shared.** A part belongs to a thread by what happens in it, never by who is in it. This was added in the first review pass: a breather with a character who also belongs to another arc stays.
- **World facts and the character list** are not narrowed.
- **The test the model gets:** take the other thread out of the story. Every beat must still be fulfillable, and every secret must still be about this arc's own people.

The rule is written once, in `formatThreadBlock(allowLinks, prompt)` (`lib/planning/generator.js`). It fills `{{THREAD_BLOCK}}` in `generate-arc.txt` and in `check-plan.txt`. The two forms differ only in the closing line. The block says "plot thread" throughout, because the prompts also use "threads" for loose ends.

The outline's four passages that asked for the opposite now say that the running arcs own their threads:

- the framing of the running arcs;
- principle 8, now "ITS OWN PLOT THREAD, NOT ANOTHER ARC'S";
- its checklist line;
- the length guidance.

The tier block's episode branch says "one plot thread". The questions prompt has a static rule 7: never ask whether or how another thread's events belong to the arc. Where or when the arc plays may still be asked. The analysis prompt is unchanged.

## The setting: "Keep this arc to itself"

A **link** is a secret that ties this arc's own people or things to another thread. It is the player's choice, set by one checkbox on the wizard's Direction step.

- **On, the default for every new arc:** the thread block says "No link".
- **Off:** it says "A link may be planned". The planner may plan one link or none, and the player is not told which. Either way a link is a fact about this arc's own people. It lives only in a secret and its clues and triggers, and no beat depends on it.
- **Stored** as `allowLinks: true` only when links are allowed. An arc without the field is kept to itself, so no migration is needed.
- **Not prefilled** from the newest arc, unlike genre and themes.
- **On a re-plan** the box shows the stored value. `generateArc` sets or deletes the field on the merged arc from the run's option.
- **"Apply re-plan"** passes `allowLinks: undefined` for an arc kept to itself. `updateArc` now deletes a field given as `undefined`; before, it merged with `Object.assign`.
- **No Arc Manager control.** Changing the box does not re-ask the questions.

## The check

The plan check (ADR-0006) is the second line, still one call. It gets three new inputs:

- the thread block in its check form;
- the other running arcs, under `== RUNNING ARCS (other plot threads) ==`;
- on a new plan, the story analysis under `== STORY ANALYSIS ==`. That heading leaves the revealed-secrets task off. On a re-plan the analysis stays in the STORY SO FAR block.

Without the analysis the check could not have seen the case above, because no arc held the other thread.

Step 5, PLOT THREAD, judges the plan against the thread:

- **What counts as foreign:** a part is foreign when it is an event of another thread, or a secret about its people, with nothing of this arc's subject in it. When in doubt, the part stays.
- **Two limits on the top rule** ("never rewrite what carries out the premise, direction or answers"):
  - an answer naming another thread's events as the stage shields no beat whose fulfillment is one of them;
  - a planner-written premise makes no foreign part the arc's own.
- **A pressure** that names another thread's force is rewritten.
- **A foreign beat, secret or trigger** is listed in the answer's new `foreign` list.
- **A premise** that asks a second thread's question is rewritten only on a new plan with a non-blank direction. It is never rewritten with a blank direction or on a re-plan.
- **On a re-plan** the check sees the proposal as the premise. Under it is the "Author's premise", the premise the wizard passed in, and step 5 names that one as the thread.
- **One re-plan signal:** `isReplan = replanStory !== null`, derived once in `runPlanCheck` and passed to `applyPlanCheck` as its own argument.

The check's earlier step 4 tied a trigger to one of the arc's own secrets and was called LINKS. It is now TRIGGER GATES, answered as `gates`, so that "link" has one meaning (GLOSSARY "Gate"). The legacy `links` key is still read when `gates` is missing, for an older edited prompt.

## The guards

`removeForeignParts` applies the `foreign` list in code. It runs after the disclosure is settled and before the renames.

- **A beat** is removed only while open, through `removeBeat`, so its id leaves every prerequisite list.
  - No beat is removed when the removal would leave no open non-optional beat. The spec said "every open beat"; the review tightened it, since recognition ends an arc whose non-optional beats are all closed. That case is logged.
  - A removed beat takes its unplanted `beat:<id>` clues with it. A planted one stays.
  - An episode whose active beat went gets its first pending beat active.
- **A secret** is removed only when:
  - it is not disclosed;
  - it is not among the revealed ids or the ids the knowledge ledger saw come out;
  - it is not an earlier secret stored as disclosed (marked revealed by hand), whatever the revealed list says;
  - it is not an earlier secret of a re-plan whose answer has no revealed list.

  A planted clue or a fired trigger pointing at it does not keep it (decided 2026-11-26 under the owner's delegation, open to the owner's veto, after the live check's run 4). The owner's ruling it rests on, 2026-11-26, verbatim: "I do not want to have to manually \"fix\" problems - the extension should assist in the RP and not have me debug and fix its mistakes manually" — so a foreign secret is not left for the player to delete by hand in the plan editor. The planted clue and the fired trigger stay stored. It takes its unfired triggers and unplanted clues with it. The planner may not drop such a secret: the ARC SO FAR block still tells it to keep or rewrite a secret with planted clues or fired triggers, and `mergeReplan` brings back one the plan left out, so the foreign judgement is the check's alone, behind these guards and logged. A first version let the planner drop it; the review reverted that, since nothing guarded the planner's drop. A later re-plan never gives a new secret the id an orphaned planted clue or fired trigger points at.
- **A trigger** is removed only while unfired.
- **Ignored:** unknown ids, kinds and wrong shapes. A plan may end below its tier's minimum beat count.
- **On failure:** a failed or unreadable check keeps the plan as generated.

Declined in the review of the planted-clue change (2026-11-26):

- **A fired trigger no longer protects a foreign secret.** A trigger's action never discloses its secret by design, and the narrator is told so. Whether a secret came out stays the revealed list's and the ledger's job, as for any secret without triggers. No new risk class.
- **The arc's own secret with planted clues is protected only by the check's judgement.** That is the decision itself, open to the owner's veto; the removal log names every removed id.
- **An unfired generated trigger pointing at a secret the planner dropped** is shown ungated. That is older than this change; it is filed as a follow-up, not fixed here.

**What the player sees.** The wizard's step log closes the plan check's line with a count: "Plan checked, N parts of other plot threads removed". The parts are never shown. The count covers beats, secrets and triggers, so a removed secret's triggers count and clues do not. The console logs each removed part by kind and id, never with the plan's text, and each part named foreign that a guard kept, with the guard's reason.

## Episode re-plan count

A re-plan of an episode now gets the count rule that acts and sagas had: what already happened counts toward the tier's beat count, and the planner writes only the scenes that remain, at least one. The rule is worded per beat kind of the tier the arc is re-planned to. `growsFromEpisode` (`replan.js`) decides growth for both the outline and the merge, and reads an unknown target tier as an episode.

## Prompts popup

The new placeholders change the built-in text of the outline and check prompts. An edit saved before this change shows "built-in changed", and the placeholder check names the missing placeholders. The warning has its own sentence for `THREAD_BLOCK`, `ANALYSIS_BLOCK` and `EXISTING_ARCS`.

## Out of scope

As in spec #97:

- episode beats played out of order still stall an episode;
- an episode's message clock counts messages spent on other threads;
- the pacing rule "if tempted to resolve something, add a complication instead" still prints in every phase;
- repairing an arc in a live chat (a re-plan is the route);
- what the narrator is sent;
- the analysis prompt;
- a formal hierarchy between arcs;
- options chosen in play dropping out of the plan;
- an Arc Manager control for the setting.

Two items stayed open after the last review, and were filed apart from #97 or left as they were:

- **Filed as a separate ticket:** a secret revealed by hand can still be rewritten and un-marked by a re-plan's check. That is behaviour from before #97.
- **Left as it is:** the saga tier's "storyline" wording. It predates #97 and the glossary's Saga entry uses it.

## Open to the owner's veto

The spec made these decisions itself:

- the check may rewrite a planner-written premise;
- the questions stop asking about overlap;
- the checkbox always starts on;
- the step log shows a count;
- there is no Arc Manager control;
- the check gets the analysis on a new plan;
- the guards on removal, in part. The owner ruled on two of them on 2026-11-26 (recorded in the ADR-0006 amendment): no beat is removed when the removal would leave no open non-optional beat, and a secret stored as disclosed is never removed, whatever the revealed list says. He ruled the gate rename the same day (TRIGGER GATES, `gates`, a legacy `links` still read). The rest stays open: open beats only, and a fired trigger is never removed.
- that a planted clue or a fired trigger no longer protects a secret of another plot thread, at the check only; the planner's re-plan block still keeps it (2026-11-26, after the live check's run 4; ADR-0003 and ADR-0006 amendments).
