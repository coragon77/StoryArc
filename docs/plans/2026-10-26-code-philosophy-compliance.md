# Code-philosophy compliance B1–B7 — implementation plan

**Date:** 2026-10-26
**Branch:** `refactor/code-philosophy-compliance`
**Source:** the baseline code-philosophy review of 2026-10-26, section B
("rule-compliance themes") of its merged findings.

## Goal

Bring the production code (`index.js`, `lib/**`; not `tests/`) in line with
the code-philosophy themes B1–B7. This is a refactor: **the extension's
behaviour does not change.** Every test stays green without being edited,
apart from the mock additions named below.

## Themes

| # | Theme |
|---|---|
| B1 | No one- or two-letter names, arrow parameters and loop variables included. Only `id` is exempt; `ms` is not (`delayMs` or `milliseconds`). |
| B2 | A computed value is not built inline in a call argument or a return: name it on the line before. Inside a template literal, a `.map(...).join('')` or a `JSON.stringify` counts as such a value; `${escapeHtml(namedValue)}` does not. |
| B3 | The tier fallback `arc.tier \|\| 'episode'` and `\|\| TIER_TABLE.act`. |
| B4 | Local copies of SillyTavern's `escapeHtml` and `delay`. |
| B5 | The arc lookup reimplemented instead of `getArcById`; arc replacement done in UI glue. |
| B6 | Repeated unnamed rules: the non-optional beat filter, `arc.messageStart \|\| 0`, the refresh after every write in the Arc Manager, the spoiler group markup in the Arc Manager, the plan-list rendering in `episode.js` and `milestone.js`. |
| B7 | File order follows the domain flow: functions in the order the process runs, a helper right after its first caller. |

## Rulings that bind this work

- The single-caller file layout stays: `lib/injection/sections/*`,
  `lib/planning/tier-block.js`, `arc-so-far.js` and `lib/context/*` are not
  merged into their callers.
- A helper sits right after its first caller.
- Domain terms come from `GLOSSARY.md`. Renaming "signal" (`signals.js`,
  `parseSignals`, the `[ARC_SIGNAL:…]` marker) is out of scope, as is the rest
  of the glossary drift.
- A write on a read path that the architecture doc documents gets a decision
  comment at the write site, not a redesign.

## Decisions made for this plan

- **B3 and the `messageStart` default are named, not dropped.** Ten tests
  promise that an arc without a tier is an episode and that a missing
  `messageStart` counts as 0. `arcTier(arc)` and `arcMessageStart(arc)` in
  `core/settings.js`, right after `migrateArc`, state each rule once.
  `checkBeatEdit(tier, …)` keeps its own fallback: it takes a tier string at
  the user boundary, and its JSDoc states the rule.
- **`milestone.js` reads `TIER_TABLE[arc.tier]` directly.** An unknown tier
  would now throw instead of printing the act label. No code path produces
  such an arc.
- **B5 is limited to the lookup and the replace.** `getArcById` serves every
  Arc Manager lookup, and `replaceArc(storedArc, arc)` in `storage.js` holds the
  JSON editor's replace. The other ways an arc change is persisted stay as they
  are, because unifying them would change when saves happen. `queueMark` and
  `dropPendingMark` get a JSDoc line saying that the caller saves.
- **Plan lists** (secrets, triggers, foreshadowing) are rendered by one
  function exported from `sections/episode.js` and imported by
  `sections/milestone.js`. Its output is byte-identical to today's.
- **The non-optional filter** is `selectNonOptionalBeats(beats)` in
  `injection/pacing.js`.
- **B4:** the UI imports `escapeHtml` and `delay` from `/scripts/utils.js`.
  ST's `escapeHtml` also escapes `'` as `&#39;`, which displays the same.
  `tests/mocks/st-mocks.js` gains both functions so the test loader resolves
  the import.

## Step 1 — foundation (done, `d4cce0d`)

Shared helpers and all their call sites, in one commit before the parallel
work: `arcTier`, `arcMessageStart`, `selectNonOptionalBeats`, `replaceArc`,
`getArcById` in the Arc Manager, the decision comments in `getArcs` and
`getChatSettings`, and the mock additions.

## Step 2 — parallel work, one owner per file

| Owner | Files | Themes |
|---|---|---|
| injection | `lib/injection/**` | B1, B2, B6 plan lists, B7, the caller-saves JSDoc lines |
| planning | `lib/planning/**` | B1, B2, B7 |
| popups | `lib/ui/arc-manager.js`, `lib/ui/wizard.js` | B1, B2, B4, B6 refresh and spoiler group, B7 |
| core-context-entry | `index.js`, `lib/core/**`, `lib/context/**`, `lib/ui/progress.js`, `lib/ui/settings-panel.js`, `lib/ui/wand-menu.js`, `lib/ui/index.js` | B1, B2, B4, B7 |

Each owner works in its own git worktree off the foundation commit.

**Commit discipline.** Per owner: first the B1–B6 commit(s), then one B7
commit that only moves code. `git diff --color-moved=dimmed-zebra HEAD~1`
must show nothing but moved blocks for the B7 commit.

**Behaviour safety.** Naming a value the line before must not change what is
evaluated: an operand of `&&`, `||`, `?.` or `? :` that runs only on one
branch stays on that branch. No export is renamed or removed. A site whose
fix would change behaviour is reported, not changed.

## Step 3 — merge, docs, verification

1. Rebase each owner branch onto the branch in turn and fast-forward.
2. Update `docs/architecture/architecture.md` and `code-index.md` for the new
   helpers (one owner: the orchestrator).
3. `bash tests/run.sh` green after every step.
4. StrykerJS before/after in a scratch copy: the number of surviving mutants
   must not rise. The config does not mutate `lib/ui/**`, `generator.js`,
   `templates.js` or `lib/context/*`, so it says nothing about those files.
5. One `/code-review` pass against this plan.
6. A live check in SillyTavern on the Amy test chat: Arc Manager (lookup,
   JSON edit save, beat toggle, delete, spoiler toggle), wizard open and step
   navigation, progress card, settings drawer, wand menu. One generation at
   most.
7. `graphify update .`
