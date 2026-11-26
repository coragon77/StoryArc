# An Arc's Plan Stays Inside Its Plot Thread — Implementation Plan

- **Date:** 2026-11-26
- **Design:** `docs/plans/2026-11-26-plan-thread-design.md`. Spec #97 is the source of that design; this plan records how the work was cut and what each ticket delivered.
- **Decision:** ADR-0011. Glossary: Backdrop, Link, Foreign part, Gate.
- **Verification environment:**
  - Locally, `bash tests/run.sh` (node:test with the ST import mocks) on every branch.
  - GitHub Actions runs the same suite on push to main only.
  - One review gate on the integration branch at the end, in three fix passes.
  - The live check in the test chat is #107 and needs the owner's go. It has not run yet.

## Where the work happened

Each ticket was built in its own git worktree, on a branch cut from the integration branch `feature/97-plan-thread`, and was merged back into it. Behaviour changes were built test-first against the real prompt templates and a fake model. Among the tickets, only the records ticket (#100) wrote the ADR and the glossary; the review fix passes later added the glossary entries Foreign part and Gate. Every ticket updated the architecture docs it touched.

## The tickets

The tickets and their blocking edges, as filed:

| Ticket | Title | Blocked by |
|---|---|---|
| #98 | The wizard's questions stop asking how another thread fits the arc | none |
| #99 | Prefactor: build the wizard's generation options in one place | none |
| #100 | Records: ADR for plans staying inside their thread, ADR-0006 amendment, glossary | none |
| #101 | The outline keeps a plan inside its own plot thread | none |
| #102 | Prefactor: the plan check's story, secret settling, clue matcher and beat promotion helper | none |
| #103 | An episode re-plan writes only the scenes that remain | none |
| #104 | The "Keep this arc to itself" checkbox | #99, #101 |
| #105 | The plan check judges a plan against its thread | #102, #101, #104 |
| #106 | The plan check removes beats, secrets and triggers of another thread | #105 |
| #107 | Architecture doc and live check for plans staying inside their thread | #98, #103, #104, #106 |

### What each delivered

- **#98: the questions.** `ask-questions.txt` rule 7: the questions never ask whether or how another plot thread's events should be part of the arc, and never offer them as a suggested answer. Where or when the arc plays may still be asked.
- **#99: prefactor.** `buildGenerationOptions(state, analysis, authorAnswers)` in `wizard.js` serves Generate, Plan the arc, Regenerate and Retry. `reviseArcWithEdits` takes the same options, so an option the Direction step gains is added once. The wizard suite's fake jQuery reads a checkbox. No behaviour change.
- **#100: records.** ADR-0011. The amendments to ADR-0006 and ADR-0010. The glossary entries Backdrop and Link, and the thread sentence in Episode and Scene beat.
- **#101: the outline.** `formatThreadBlock` fills `{{THREAD_BLOCK}}` in `generate-arc.txt`. The four passages that asked for intersecting arcs are rewritten, and the episode tier block says "one plot thread". The Prompts popup explains a missing `{{THREAD_BLOCK}}`.
- **#102: prefactor of the plan check.** Four refactors, ahead of #105 and #106:
  - The analysis and the re-plan story (`ReplanStory`) reach the check apart, so a new plan's analysis can reach it without switching on the revealed-secrets task.
  - `settleEarlierSecrets` settles the earlier secrets on its own.
  - The clue matcher is a function of its own, for planted and unplanted clues.
  - `activateFirstPendingBeat` (`arc-edit.js`) is the beat promotion helper, used by `promoteNextBeats`.
- **#103: the episode re-plan count.** `buildArcSoFar(arc, tier)` words the count rule per beat kind of the tier the arc is re-planned to: "only the scenes that remain" for an episode, milestones for an act or saga. An episode growing into an act gets the milestone rule, with its played scenes outside the count.
- **#104: the checkbox.** "Keep this arc to itself" on the Direction step:
  - on for every new arc and never prefilled from the newest arc;
  - a re-plan shows the stored value;
  - off, the outline says "A link may be planned" and the arc stores `allowLinks: true`;
  - a re-plan kept to itself drops a stored `allowLinks`.
- **#105: the check judges the thread.**
  - The check gets the thread block in its check form, the other running arcs, and the analysis on a new plan under a heading of its own.
  - Its step 5 rewrites a pressure that names another thread's force.
  - It rewrites a premise that asks a second thread's question, and `applyPlanCheck` applies that only on a new plan with a direction.
- **#106: the check removes foreign parts.**
  - The answer gains `foreign`, which `removeForeignParts` applies under guards: open beats only, no beat at all when the removal would leave no open beat, revealed or clued secrets kept, fired triggers kept.
  - `generateArc` returns `removedParts`, and the wizard's step log shows the count, never the parts.
  - On a re-plan the check sees the wizard's premise as the "Author's premise", which states the thread with a blank direction.
- **#107: docs and the live check.** The "Plot Thread" section of `architecture.md`, the code index, and these two files. The live check is still open.

## Review fix passes

One review gate ran on the integration branch, in three passes.

- **First pass:**
  - A removed beat takes its unplanted `beat:<id>` clues with it.
  - The check reads one re-plan signal.
  - The thread block and step 5 say that people are shared: a part is foreign by what happens in it, never by who is in it.
  - Each removal is logged by kind and id only.
  - `updateArc` deletes a field given as `undefined`, so the wizard no longer reaches into the stored arc.
  - The Prompts popup explains a missing `ANALYSIS_BLOCK` and `EXISTING_ARCS`.
  - The glossary gains Foreign part, and the docs say what `removedParts` counts.
- **Second pass:**
  - The removal keeps every beat when no open non-optional beat would stay.
  - An earlier secret stored as disclosed is never removed.
  - Step 4 of the check is TRIGGER GATES, answered as `gates`, with the legacy `links` still read.
  - `allowLinks` is set or deleted on the merged arc after `mergeReplan`.
  - `isReplan` (`replanStory !== null`) is derived once in `runPlanCheck` and passed to `applyPlanCheck` as its own argument.
  - `replan.js` exports `growsFromEpisode`, shared by the merge and `buildArcSoFar`.
  - `otherRunningArcsOf` has no silent default.
  - The question and check prompts no longer say "storyline"; they say "plot thread" or "line of the story".
- **Third pass:**
  - `growsFromEpisode` reads an unknown target tier as an episode, so the outline and the merge agree.
  - The glossary gains Gate.
  - The plan check's purpose text uses the shared `planningPurpose`.

The suite stood at 2222 passing at the end.

## Still open

The live check of #107 needs the owner's go. It covers four points:

1. An episode planned beside a busy act with the box on: no foreign beat, a premise with only its own question, no secret about the act's people, and no question about how the act fits.
2. The same with the box off.
3. An episode re-plan with most beats done: count the new beats.
4. The step log's removed-parts count where the check removed something.

The results go on #97, which closes once they hold.
