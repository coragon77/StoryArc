# Pacing Enforcement + Pressure Beats — Design Spec

- **Date:** 2026-08-29
- **Status:** Approved for implementation
- **Decided by:** Stefan (design discussion, session of 2026-08-29)
- **Builds on:** commits 8dbfdb1 (continuation guard + hidden markers), e4fad27 (confidentiality clause + scrubArcInternals)

## Problem

Live testing (Amy chat, glm-5.2:thinking + Celia V5.4 preset) showed the arc
tracker running far ahead of the intended pace: 7 of 10 non-optional beats
completed in ~8 exchanges on an arc planned for ~40 messages. Root causes,
all verified live:

1. **The injection exposes the full roadmap.** `buildForegroundSection`
   lists every pending beat with id and intention as `(upcoming)`. The model
   treats a visible plan as a task list and drives toward it.
2. **Multi-beat jumps.** `processSignalResults` accepts completions for
   `pending` beats, so one eager scene can burn 2-3 beats at once.
3. **Outcome-phrased beats are solvables.** A beat written as an outcome
   ("Amy reveals the virus") is completed in one scene and parroted into
   dialogue (exposition-head effect). This is an LLM training artifact:
   models are trained to complete visible goals ("solve"), but stories must
   meander and leave threads open.

Prompt-side pacing ("Do not advance to the next phase for at least N more
messages") is already injected and was demonstrably ignored. The fix must be
mechanical where possible.

## Rejected alternatives (do not re-litigate)

- **Refusing too-fast completions in `processSignalResults`:** the signal
  arrives after the scene was written; refusal makes the tracker disagree
  with the visible story and re-arms the marker instruction (loop).
  Recording stays liberal — bookkeeping must reflect what happened on screen.
- **Message-budget promotion hold (mechanical clock):** rejected by Stefan —
  scenes must react to the roleplay, not a round counter. A clock detaches
  the plan from an unforeseen story direction. StoryMode's round-based mode
  is explicitly NOT the model to follow; its *scene-scoped visibility* is.

## Design — four changes

### 1. Hide pending beats (information hiding)

`buildForegroundSection` shows **only the active beat**. Pending and locked
beats are omitted entirely — no ids, no intentions, no teaser. The model
cannot race toward objectives it cannot see.

- Foreshadowing is unaffected: `FORESHADOWING TO PLANT` entries already
  carry the clues; the model never needed beat visibility for foreshadowing.
- Secrets already do phased revelation via `shouldShowSecret` — beats were
  the one list dumped in full.
- A StoryMode-style one-line purpose teaser for the next beat was discussed
  and deferred (YAGNI). Add later only if transitions feel abrupt in play.

### 2. Pressure/fulfillment beat split (starve the solver)

Each beat gets two faces:

- **`pressure`** (new field): how the beat manifests as a *force* in the
  scene before it happens — weather, not a destination. Example: "The virus
  symptoms are getting harder to hide; Wolfram's audits are closing in."
  No completion state, nothing to solve.
- **`intention`** (existing field, semantics sharpened): the fulfillment
  condition — what has already happened on screen when the beat is complete.
  Written in past-tense/recognition form.

Presentation:

- The **plan injection** (`buildForegroundSection`) shows the active beat as
  a `CURRENT PRESSURE:` block containing only the `pressure` text — **no
  beat id, no `(NOW)` marker**. The id is no longer needed there (less
  leakage surface for the scrub to catch).
- The **beat-check directive** (`buildSignalDirective`) carries id +
  fulfillment, phrased as recognition of the past, never as an instruction
  to bring it about. Per-beat line becomes approximately:
  `If the story has already brought this about — "<intention>" — output exactly: <!-- [ARC_SIGNAL:<arcPrefix>:<beatId>:COMPLETE] -->`
  Keep the existing CONTINUATION, BEAT CHECK framing, and confidentiality
  clause; adjust the BEAT CHECK prose to match (it may no longer reference
  "(NOW) in CURRENT BEATS" since ids/NOW no longer appear there).

Generation:

- `prompts/generate-arc.txt` asks for both fields per beat, with the
  pressure/fulfillment distinction explained (pressure = force felt before;
  intention = past-tense condition observable on screen).
- `lib/planning/validation.js` normalizes: `pressure` optional string,
  default `''`.
- **Backward compatibility:** existing arcs (e.g. the live Amy arc) have no
  `pressure`. Builder falls back to `intention` when `pressure` is empty.
  Do not migrate stored arcs.

### 3. One completion per AI message, active-only

In `processSignalResults`:

- Accept completions **only for `active` beats** (drop the `pending`
  acceptance). With hiding, the model no longer knows pending ids anyway;
  this is the mechanical backstop.
- Process **at most one completion per arc per message** (first valid
  signal wins; log ignored extras). Per-arc, not global — two independent
  arcs may each legitimately complete a beat in the same message.

### 4. Promotion on the next user turn (reactive gap, not a clock)

After a completion, the next pending beat is **not** promoted in the same
handler. The arc is left with no active beat. Promotion happens when the
next **user** message lands:

- New function (signals.js or a small new module): `promoteNextBeats(arcs)`
  — for every active arc with no `active` beat and at least one `pending`
  beat, promote the first pending beat to `active`; persist via `updateArc`.
  It doubles as a repair for stalled arcs.
- `index.js` registers a handler on the user-message event
  (`event_types.MESSAGE_SENT` or `USER_MESSAGE_RENDERED` — pick whichever
  fires reliably once per user message; check StoryMode's round counter
  handler for the precedent, it deliberately counts only user messages) that
  calls `promoteNextBeats(getActiveArcs())`, then `updateProgress()` and
  `saveMetadata()` when anything changed.
- Effect: the AI's aftermath prose and empty-input continues cannot chain
  into the next objective; the player always reacts to a development before
  the model learns what comes next. This gate cannot stall — the next user
  message always promotes.

**Linger state:** while an arc has no active beat and is not completed, the
plan injection replaces the `CURRENT PRESSURE` block with a linger
directive, approximately: "Develop the consequences of recent events. Let
characters breathe and react. Do not introduce new major developments this
scene." Keep it gentle — it must not clash with an urgent on-screen
situation. `buildSignalInjection` emits no per-beat marker lines during
linger (no active beats), but the CONTINUATION guard and confidentiality
clause must still be injected whenever an active arc exists — do not let
them disappear during linger.

## Explicitly out of scope (recorded for later)

- **Beat skip signal** (StoryMode's `@@SKIP:N@@`) for beats invalidated by
  player actions.
- **Mid-arc revision** — when the story leaves the plan, remaining beats
  are wrong, not late: re-harvest context, regenerate remaining beats, keep
  completed ones.
- **Tier structure** (episode/act/saga) — see GOALS.md; the background-arc
  pressure upgrade belongs there, NOT in this change. `buildBackgroundSection`
  stays as-is for now.
- Retroactive scrub of pre-existing chat messages (handled separately; the
  user has since cleaned the affected chats manually).

## Accepted consequence

With no budget brake, an arc "planned for 40 messages" can finish faster if
the model keeps fulfilling beats and the player plays along. That is
correct under the reactive philosophy: `estimatedLength` feeds the advisory
phase wording only; the real pace is set by the player's turns.
`lib/injection/pacing.js` is untouched by this change.

## Touched files

| File | Change |
|------|--------|
| `lib/injection/builder.js` | Active-beat-only plan section as CURRENT PRESSURE (pressure w/ intention fallback); linger directive; recognition phrasing + id-free plan section; signal directive prose update |
| `lib/injection/signals.js` | Active-only acceptance; one completion per arc per message; no immediate promotion; new `promoteNextBeats()` |
| `lib/injection/index.js` | Export `promoteNextBeats` |
| `index.js` | User-message handler → `promoteNextBeats` + progress + save |
| `lib/planning/validation.js` | Normalize `pressure` field |
| `prompts/generate-arc.txt` | Request pressure + past-tense fulfillment per beat; breather-beat and open-thread guidance (see below) |
| `tests/test-signals.js` | Update: active-only, per-arc cap, no immediate promotion, `promoteNextBeats` |
| `tests/test-validation.js` | `pressure` normalization |
| `docs/architecture/architecture.md`, `code-index.md` | Data flow + module descriptions |

## Generator prompt additions (part of this change)

While editing `generate-arc.txt` for the beat split, also add:

- **Breather beats:** the plan must include beats whose pressure is a quiet
  scene, a tangent, or a character moment with zero plot advancement.
- **Open threads:** some introduced threads must remain deliberately
  unresolved at arc end (they seed the next arc — an arc that ties
  everything off is a defect for a continuing story).

## Verification

- Test harness: `bash tests/run.sh` (node:test + custom ESM loader mocking
  ST imports; currently 67/67). There is no CI — the local run is the
  gate. Do not rebuild CI locally beyond running this script.
- Live verification against the running SillyTavern instance is possible
  but optional for this change; the logic is covered by the mocked tests.
  If done, follow the hard rules in the handoff doc (chat-identity guard).
