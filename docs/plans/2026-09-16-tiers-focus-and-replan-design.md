# Tiers, Focus and Re-plan — Design Spec

- **Date:** 2026-09-16
- **Status:** Approved for implementation
- **Decided by:** Stefan (grilling session of 2026-09-16)
- **Builds on:** `docs/plans/2026-08-29-pacing-and-pressure-beats.md` (pressure beats, hidden roadmap, promotion gating); GOALS.md goal 4 (episode/act/saga tiers)
- **ADRs:** `docs/adr/0001` (tier owns shape, focus owns prominence), `0002` (spotlight never names a target), `0003` (re-plan keeps the situation, replaces the road)
- **Glossary:** `CONTEXT.md` — use its terms (tier, milestone, pressure, fulfillment, recognition, focus, pacing clock, stall)

## Problem

Live play: a ~40-message plan diverged after two fulfilled beats. From beat
three on, every remaining scene beat assumed a world state the story no
longer had, so recognition could never fire and the arc was dead.

Three root causes, none of them "the beats were too specific":

1. **Every arc is one shape.** The generator produces only ordered
   scene-level beats. A "defeat the big bad" arc gets the same shape as a
   guild mission, and a linear scene path over 1000 messages is guaranteed
   to be left behind.
2. **`focus` conflates shape and prominence.** `foreground | background`
   decides both how beats are presented and whether the model pursues the
   arc now. Backgrounding a scene-level plan strands its beats; foregrounding
   a long arc would run milestones through scene machinery.
3. **No way back.** When an arc diverges, the only options are abandoning it
   or playing toward beats that cannot happen. The 2026-08-29 spec parked
   "mid-arc revision" as the answer; it is unbuilt.

## Rejected alternatives (do not re-litigate)

- **Vaguer beats.** Brings back the slop the pressure/fulfillment split
  fixed: vague pressure gives the model nothing to write, vague fulfillment
  lets it claim completion anywhere. Specificity is not the defect,
  linearity is.
- **Keep foreground/background as-is** and let tiers interpret them. See
  ADR-0001.
- **Derive focus from tier and drop the manual switch.** Loses pausing for
  a tangent and pushing the world story. See ADR-0001.
- **Spotlight picks a milestone to drive toward.** See ADR-0002.
- **Model judges secrets as contradicted on re-plan.** See ADR-0003.
- **Migrate old background arcs to `act`.** Their beats are ordered scenes;
  presenting them as milestones is the mismatch that started this. All old
  arcs become episodes.
- **Per-arc pacing stamps** for concurrent episodes. Doubles prompt noise
  for a rare case; the spotlight picks the clock instead.
- **Re-plan without phase 1.** Only phase 1 reads the chat, and knowing
  where the story went is the point of re-planning.

## Design

### 1. Tier — chosen at generation, owns the shape

`arc.tier ∈ { episode, act, saga }`. Selected in the wizard's Direction
step (default `episode`), stored on the arc, changed only by re-plan.

| | Episode | Act | Saga |
|---|---|---|---|
| Length band (messages, both sides) | 8–20 | 60–150 | 400–1500 |
| Beats | 5–8 ordered **scene beats**, `unlockAfter` allowed | 3–5 unordered **milestones**, no `unlockAfter` | 2–4 unordered milestones |
| Beat activation | one `active`, rest hidden, promotion on next user turn (unchanged) | all unfulfilled milestones `active` at once | same |
| Recognition | active beat's fulfillment line in the beat check (unchanged) | every unfulfilled milestone gets a fulfillment line; cap of one completion per arc per message stays | same |
| Injection (`normal` focus) | full section as today (`CURRENT PRESSURE`, pacing rules, DO NOT, directives, secrets, triggers, foreshadowing) | premise + every unfulfilled milestone **pressure** as standing weather; secrets/triggers/foreshadowing per phase gating as today; **no** brake, **no** clock | same |
| Pacing brake + stamps | yes (pacing clock) | no | no |
| Phase (`calculatePhase`) | brake, stamps, secret gating, widget | secret gating and widget label only | same |

The "Do not advance plot beats for this arc" sentence in the background
section is deleted: milestones complete by recognition.

**Generator:** `prompts/generate-arc.txt` gets a `{{TIER_BLOCK}}`
substitution (same mechanism as `{{ARC_DIRECTIVES}}`) carrying the row
above for the chosen tier: beat count, "scene beat" vs "milestone"
wording, length band, and for act/saga: no `unlockAfter`, no
scene-specific fulfillment, `revealPhase` means "which stretch of the
arc". One template, three blocks; separate templates would drift.

**Validation:** `tier` normalized with default `episode`; `unlockAfter`
stripped for act/saga; `estimatedLength` clamped to the tier band.

### 2. Focus — set by hand, owns prominence

`arc.focus ∈ { paused, normal, spotlight }`. The arc manager's focus
button becomes a three-way choice. "Foreground"/"background" disappear
from code, UI and docs.

| Focus | Episode | Act / Saga |
|---|---|---|
| `normal` | full section; pacing-clock candidate | standing pressure line(s) |
| `paused` | one line: premise + "pending, not being pursued right now"; no beat check; clock frozen | same one line; no beat check |
| `spotlight` | full section; **is** the pacing clock; ordered first | milestone pressures moved into the main block under `BRING TO A HEAD:` with one sentence asking the pressures to intensify in the coming scenes and the world to act on its interests. **No milestone is named as a target** (ADR-0002). Ordered before episodes so budget trimming never drops it. Beat check unchanged. |

**Clock freeze:** on pause, `arc.pausedAt = chat.length`. On resume,
`arc.messageStart += chat.length - arc.pausedAt`; `pausedAt` cleared.
`lastFulfilledAt` (section 4) shifted by the same amount. Shifting
`messageStart` changes every historical stamp: one prefix-cache miss,
already accepted for focus changes in `stamping.js`.

**Pacing clock selection** (`stamping.js`, `buildPacingBlock`): the
spotlit episode if any, else the first `normal` episode in storage order.
Paused episodes and all acts/sagas are never the clock.

**Migration** (once, in `ensureChatState` or on first `getArcs`): arcs
without `tier` get `tier: 'episode'`; `focus: 'foreground'` → `normal`,
`'background'` → `paused` (with `pausedAt = chat.length` at migration).
The dead `subArcs` field is dropped from `createDefaultArc` in passing.

### 3. Re-plan — the wizard in revise mode

Entry points: a **Re-plan** button per active arc in the arc manager, and
the stall nudge (section 4). Both open the existing 3-step wizard with
`wizardState.reviseArcId` set.

- **Context step:** unchanged (re-harvest, lorebook include/exclude).
- **Direction step:** tier selector pre-set to `arc.tier`; direction
  textarea pre-filled with `arc.direction`; **title** and **premise**
  fields shown and editable, kept verbatim if untouched (ADR-0003).
- **Generation:** all three phases. Phase 1's existing-arcs list marks the
  arc `[BEING RE-PLANNED]` so its unfulfilled beats are not reported as
  open threads. Phase 2 gets an `== ARC SO FAR ==` block: premise,
  secrets, escalation, and every fulfilled beat's fulfillment text marked
  "already happened". Phase 3 unchanged.
- **Merge** (`validation.js`, new `mergeReplan(existing, generated)`):

  | Kept from existing | Replaced by generated |
  |---|---|
  | `id`, `createdAt`, `messageStart`, `pausedAt`, `lastFulfilledAt`, `focus`, `status` | `tier`, `estimatedLength` |
  | `title`, `premise`, `direction` (as edited in the dialog) | `directives`, `antiPatterns`, `tone`, `themes`, `escalation`, `characters` |
  | `secrets` (generated list may only **add**; existing entries kept verbatim incl. `disclosed`) | beats with status ≠ `completed` |
  | beats with status `completed` | foreshadowing with `planted: false` |
  | foreshadowing with `planted: true` | triggers with `fired: false` |
  | triggers with `fired: true` | |

  New beat/foreshadowing/trigger ids that collide with kept ids are
  suffixed (`_2`). The arc stays `active`, keeps its id, so signal
  prefixes and the widget keep working. After merge, no beat is `active`;
  the next user turn promotes (episode) or all milestones are set
  `active` immediately (act/saga).

- **Persist `direction`:** `saveArc` path stores the wizard's direction
  text on new arcs from now on. Old arcs have `''`.

### 4. Stall nudge — episodes only

`arc.lastFulfilledAt` = chat index of the last fulfillment; set to
`messageStart` at planning/re-plan, updated in `processSignalResults`,
shifted on resume from pause.

Stall = `chat.length - lastFulfilledAt` exceeds
`3 × estimatedLength / nonOptionalBeatCount`. Evaluated in
`updateProgress()`; not while paused; never for act/saga.

When stalled, the progress widget shows a line "May have drifted —
re-plan?" that is a button opening the wizard in revise mode for that arc.
Nothing is injected; the nudge is player-facing only.

## Out of scope (recorded)

- `STALE` signal emitted by the model. Model-emitted signals are the least
  reliable part of the pipeline; revisit only if the nudge proves too slow.
- Tempo phrase for spotlight ("within the next few scenes"). Add only if
  live play shows spotlight is too soft (ADR-0002).
- Arc reordering in the manager. Spotlight covers clock selection.
- Quick-episode wizard path (GOALS.md goal 4). The tier selector with
  default `episode` is most of it; a shorter direction field can follow.

## Touched files

| File | Change |
|---|---|
| `lib/core/constants.js` | `tier`, new `focus` values, `direction`, `pausedAt`, `lastFulfilledAt`; drop `subArcs`; tier table (bands, beat counts) |
| `lib/core/settings.js` or `lib/planning/storage.js` | one-time migration of `tier`/`focus` |
| `lib/planning/validation.js` | normalize `tier`; strip `unlockAfter` for milestones; clamp length; `mergeReplan` with id de-collision |
| `lib/planning/generator.js` | `TIER_BLOCK`; `ARC SO FAR` block; `[BEING RE-PLANNED]` mark; revise entry point |
| `prompts/generate-arc.txt` | `{{TIER_BLOCK}}`, `{{ARC_SO_FAR}}` placeholders and wording |
| `prompts/analyze-context.txt` | honour the re-plan mark in existing arcs |
| `lib/injection/builder.js` | sections keyed by tier × focus; milestone section; paused line; `BRING TO A HEAD` block; section ordering |
| `lib/injection/stamping.js`, `builder.js` `buildPacingBlock` | pacing-clock selection |
| `lib/injection/signals.js` | all-milestones-active for act/saga; `lastFulfilledAt` |
| `lib/ui/wizard.js` | tier selector; revise mode (prefill title/premise/direction/tier) |
| `lib/ui/arc-manager.js` | three-way focus with pause/resume clock shift; Re-plan button; tier badge |
| `lib/ui/progress.js` | milestone count label; stall nudge button |
| `lib/css/*` | tier badge, three-way focus, nudge |
| `tests/test-*.js` | validation (tier, merge, de-collision), signals (milestones), pacing-clock selection, stall threshold, pause shift |
| `docs/architecture/*.md`, `docs/goals/GOALS.md` | tier/focus vocabulary; goal 4 marked in progress |

## Verification

- `bash tests/run.sh` is the gate (node:test + mocked ST imports). No CI
  yet; the PR body carries the run output.
- Live check on the running SillyTavern instance for: an act's milestone
  pressures appearing as weather, spotlight block wording, pause/resume
  keeping the stamp number, re-plan producing a merged arc with kept
  fulfilled beats. Follow the chat-identity guard in the handoff rules.
