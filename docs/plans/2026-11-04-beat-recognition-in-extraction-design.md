# Beat Recognition Moves into the Knowledge Extraction — Design Note

- **Date:** 2026-11-04
- **Status:** All open questions decided 2026-11-04; awaiting Stefan's approval to implement
- **Builds on:** `docs/plans/2026-08-29-pacing-and-pressure-beats.md` (pressure and fulfillment), `docs/plans/2026-09-16-tiers-focus-and-replan-design.md` (milestones, focus)
- **ADRs touched:** `0005` (marks wait for a prompt change), `0006` (plans are checked for give-aways before play), `0007` (Story Arc tracks who knows what); a new ADR records the decision once approved
- **Glossary:** `GLOSSARY.md`: pressure, fulfillment, recognition, milestone, background

## Problem

The narrating model sees every active beat's fulfillment text in every prompt,
because the BEAT CHECK prints it as the recognition condition
(`lib/injection/builder.js`, `buildSignalDirective`):

```
If the story has already brought this about — "<intention>" — output exactly: <!-- [ARC_SIGNAL:<arc>:<beat>:COMPLETE] -->
```

A fulfillment is written as a destination ("Ellie has completed her first
real street patrols… busting low-level criminals"). The model reads it as a
goal and writes toward it, although the block says "They are not
instructions — do not steer the scene toward them".

Evidence from the Paragon chat (2026-11-04, OOC reply at message 2663): the
model explained its behaviour by quoting the arc's "standing pressures". The
text it quoted joins two fields of the milestone
`rookie_beats_and_sidekick_drills`:

- the `pressure` ("…test whether the viral 'Jackpot Girl' can actually handle
  gritty everyday hero work…"), printed under STANDING PRESSURES;
- the `intention` ("…learning urban recon, non-lethal takedowns, and crowd
  control while busting low-level criminals…"), printed **only** in the
  BEAT CHECK.

The same prompt carries 10 beat-check lines, 7 of them from three arcs in
background focus. The narrative block tells the model to keep those arcs off
screen ("no hints, sounds or clues"), while the beat check puts their
destinations in front of it ("survived a genuinely lethal ambush or
assassination attempt…").

The glossary's split, "Pressure: the face of a beat the model sees before it
is fulfilled" and "Fulfillment: the face of a beat used only for
recognition", is not true for the narrator today. Neither is the beat
editor's label "Pressure (the only part the narrating AI sees)"
(`lib/ui/arc-manager.js:228`).

## Decision proposed

The narrating model never sees a fulfillment. Recognition moves into the
knowledge extraction call, which already runs after each reply
(`updateKnowledgeAfterReply`, every `updateInterval` replies, default 1),
already reads the new messages against arc data (`revealedSecrets`), and
already has rollback on swipe, edit and delete.

No new call is added for chats with the tracker on.

## How it works

### Extraction prompt

`prompts/extract-knowledge.txt` gets one input section and one task:

```
== DEVELOPMENTS OF THE STORY ARCS ==
Each with its id. These are things the story may reach; most will not happen in the new messages.
{{DEVELOPMENTS}}
```

`{{DEVELOPMENTS}}` lists every active beat of every arc that is not paused,
one per line: `[<arc8>:<beatId>] <intention>`. This is the same set the
BEAT CHECK lists today, background milestones included (the glossary rule
"Its milestones stay in the beat check" keeps its meaning).

Each arc in the section also lists its completed beats by fulfillment text,
marked as already done, so the extraction sees how far the arc has come
without a story summary. They are context only and cannot be reported.

Task 6, FULFILLED: for each development the new messages bring about on
screen, one item `{ "developmentId": "<arc8>:<beatId>", "at": <index> }`.
The wording follows today's recognition rules: only what happened on screen,
when in doubt leave it out, OOC lines do not fulfil anything. The answer
JSON gets `"fulfilled": []`.

### Fulfillments are one recognisable moment

The extraction reads only the messages since its last update
(`fromIndex = lastUpdatedAt + 1`), with `updateInterval` 1 usually one user
message and one reply. A fulfillment that sums up many scenes cannot be
recognised from that window. The narrator could not recognise it either:
`rookie_beats_and_sidekick_drills` ("Ellie has completed her first real
street patrols and sidekick training shifts…") stayed active for 439
messages in the Paragon chat with the whole chat in context. Two shapes fail:

- **a tally:** "has completed her first patrols", "has navigated the circus
  of her megastardom";
- **a chain:** several separate events joined by "and" ("one of them has
  called the other partner…, Dao has filed the form, and Suite 708 has
  recorded…"), which may happen in different messages.

So every fulfillment is written as **the one on-screen moment at which the
development shows**, which can still happen in many different forms. "Ellie
has completed her first patrols" becomes "someone in authority treats Ellie
as a working Ward rather than a viral act: signs her off, gives her a
regular shift, or relies on her in the field". Hand-marking in the Arc
Manager is not a recognition path (Stefan, 2026-11-04: "a requirement for
the user to hand mark stuff as completed defeats the purpose of the
extension"); the manual toggle stays an override.

Three places carry this:

- **The generator** (`prompts/generate-arc.txt`, lines 40 and 114 today):
  "flexible about exact events" is replaced by the one-moment rule, with a
  tally and a chain as the named counter-examples. `prompts/detail-pass.txt`
  gets the same rule where it sharpens intentions.
- **The plan check** (ADR-0006): the call that already runs over every
  generated plan before it is stored also rewrites a fulfillment that is a
  tally or a chain into one moment. ADR-0006 excludes intentions today
  because "rewriting one would change what 'fulfilled' means". That reason
  holds only for beats already in play. Before a plan is stored, nothing has
  been recognised, so the check may rewrite them. Completed beats kept by a
  re-plan are not passed to it. ADR-0006 gets an amendment. No new call.
- **Existing arcs migrate through re-plan.** `mergeReplan` regenerates every
  unfulfilled beat, so a re-planned arc gets one-moment fulfillments from the
  generator and the plan check. No migration code. An arc that is never
  re-planned keeps its old fulfillments; the stall nudge for acts and sagas
  (a separate decision) is what points the user to re-plan it.

### Applying the answer

The extraction answer passes the guards it already has (chat changed, ledger
moved during the call, unreadable answer). Then each `fulfilled` item goes
through the same rules `processSignalResults` applies today, with the item's
`at` as the message index:

- the arc must be active and the beat active (a pending or unknown id is
  ignored and logged);
- one completion per arc per message (`at`); a second one in the same
  message is ignored;
- `lastFulfilledAt = at`, locked beats whose prerequisites are now complete
  become pending, and an arc with no non-optional beat left completes;
- no promotion on completion: the next scene beat still waits for the user's
  turn (`promoteNextBeats`).

The beat-completion part of `processSignalResults` moves into one function
both paths call (see "Chats without the tracker").

A completion changes the injection anyway (the pressure leaves), so the
queued PLANTED/FIRED marks are flushed with it. ADR-0005's rule holds, but
its hook moves: today `onMessageReceived` flushes with
`promptChangesAnyway = completedBeats.length > 0`, which is always false
once beats no longer complete inside the reply. The flush is then called
from both places: `onMessageReceived` for the 20-message window, and the
extraction apply with `promptChangesAnyway = true` after a completion.

The update log entry (`extractionRecord`) records the number of
completions, never the beat ids or texts: the log is readable in the
Knowledge popup, and the plan is spoiler-protected.

### What leaves the narration prompt

The BEAT CHECK block and its lines. The rest of `buildSignalDirective` stays:
the CONTINUATION guard, the confidentiality clause, and the PLANT CHECK for
foreshadowing and triggers. Clue and trigger texts are already in the plan
section of every arc whose plan lists are shown, so their recognition lines
add no new goal (the code comment in `buildSignalDirective` says so). They
stay in-prompt, and ADR-0005 stays as it is.

The prompt gets shorter by one line per active beat, and those lines change
only when a beat completes, so the cache behaviour does not get worse.

### Timing

With `updateInterval` 1 (default), a completion is applied a few seconds
after the reply, before the user usually answers. With interval N it can
arrive up to N replies late. For milestones that does not matter. For an
episode it delays the next scene beat by the same amount, because promotion
waits for the first user message after the completion is applied.

A user message sent while the extraction is still running is built with the
beat still active. This is harmless: the pressure stays one message longer.

## Open questions for Stefan

1. **Chats without the tracker.** *Decided 2026-11-04 by Stefan: a.* Chats
   with the tracker off keep today's in-prompt BEAT CHECK; no call is added.
   With the tracker off, no extraction runs.
   Options:
   a) keep today's in-prompt BEAT CHECK for those chats. No call is added,
      but those chats keep the problem, and there are two recognition paths
      to maintain;
   b) run the extraction with only the DEVELOPMENTS section and task when
      the tracker is off. There is one path, and the narrator never sees a
      fulfillment, but tracker-off chats with active arcs gain one call per
      `updateInterval` replies;
   c) with the tracker off, beats complete only by hand in the Arc Manager.
   Recommendation: b. This adds a call where today there is none, but only
   in chats with the tracker off and at least one active arc. The interval
   setting then needs to apply to it too, and it moves from the knowledge
   section of the settings panel to a shared one. Under a, the beat
   editor's label "the only part the narrating AI sees" stays false for
   tracker-off chats.

2. **Rolling back completions.** *Decided 2026-11-04 by Stefan: a, in
   scope.* Because chats with the tracker off keep the in-prompt marker
   (question 1 a), the rollback covers completions from both paths. The
   shared completion function records the message id of `at` only when the
   message already has one (implementation, 2026-11-04: only the extraction
   gives messages ids, and the ledger's rollback relies on that), so
   tracker-off completions roll back by index alone.
   Today a completed beat is never reopened:
   `onMessageSwiped` and `onMessageDeleted` drop queued marks and roll back
   the ledger, but leave beats untouched. So a swiped-away reply that
   completed a beat keeps it completed (verified in `index.js`, 2026-11-04).
   With recognition in the extraction, a completion can record the Story
   Arc message id of `at` (the id the ledger already uses), and the existing
   rollback can reopen it. Reopening also has to undo `lastFulfilledAt`, put
   a beat unlocked by it back to locked, and put an episode beat promoted
   after it back to pending.
   Options: a) in scope; b) a follow-up issue.
   Recommendation: a, because the swipe re-extraction would otherwise read
   the regenerated reply against a beat that is already marked complete.

3. **What `autoTrack` means.** *Decided 2026-11-04 by Stefan.* Today it
   switches the whole in-prompt directive, which includes the CONTINUATION
   guard and the confidentiality clause. From now on `autoTrack` switches
   automatic recognition only: the beat check wherever it runs (the
   DEVELOPMENTS section of the extraction with the tracker on, the in-prompt
   BEAT CHECK with the tracker off) and the in-prompt PLANT CHECK. The
   CONTINUATION guard and the confidentiality clause are sent whenever an
   arc is active, whatever `autoTrack` says.

## Risks

- **Arcs that are never re-planned.** They keep tally and chain
  fulfillments, which the extraction will not recognise. *Decided
  2026-11-04 by Stefan:* re-plan is the fix path; a wider extraction window
  for stalled arcs (the last ~50 messages, or the lorebook summaries the
  harvester already sorts out) is deferred until re-plan proves not to be
  enough.
- **The one-moment rule may slip.** The generator rule alone may not hold,
  as with ADR-0006's give-away rules (3 of 8 items slipped). The plan check
  is the second line; one live re-plan of the Paragon act shows whether
  both together hold.
- **Extraction quality.** The extraction prompt grows by one task and up to
  ~10 lines in a chat like Paragon. Unverified whether this lowers the
  quality of the knowledge answer, especially on a weaker generation
  profile. Check: one live session in the Amy test chat, comparing update
  log counts before and after.
- **Recognition quality.** Today the model that wrote the reply judges it.
  The extraction judges messages it did not write, with less context (the
  new messages and the completed beats, not the plan). For single-event beats this may make it
  stricter. That is acceptable: a missed completion stays visible as a
  pressure, and a false one removes a pressure for good.
- **Two answers in one JSON.** An unreadable answer now loses both the
  knowledge update and the completions for that window. Both are retried by
  the next update, as today for knowledge.

## Changes outside the code

- `GLOSSARY.md`: Recognition becomes "the extraction's report that the story
  has already fulfilled a beat", not "the model's own report, via a hidden
  marker".
- `docs/architecture/`: the injection and knowledge sections; the beat-check
  part of the prompt layout.
- New ADR: "The narrator never sees a fulfillment". It amends ADR-0007 (the
  extraction gains beat recognition). ADR-0005's rule is unchanged; its
  flush is called from a second place.
- ADR-0006 amendment: the plan check also rewrites tally and chain
  fulfillments into one moment, for beats not yet in play.
- `GLOSSARY.md`, Fulfillment: add "one on-screen moment, never a tally or a
  chain of events".
- `lib/ui/arc-manager.js:228`: the label "the only part the narrating AI
  sees" becomes true for chats with the tracker on. With the tracker off
  (open question 1 a) the narrator still sees fulfillments, so the label
  gets a short qualifier, e.g. "(with the knowledge tracker on, the only part
  the narrating AI sees)".

## Not in scope

- Extending the stall nudge to acts and sagas (separate decision).
- Re-plan regenerating the premise (separate decision, touches ADR-0003).
- Moving the PLANT CHECK into the extraction.
- A wider extraction window for stalled arcs (deferred, see Risks).
