# StoryArc Onboarding

## Project Overview

Story Arc is a SillyTavern extension that plans new story arcs for existing,
long-running RP stories. It harvests context from the current chat (lorebook,
chat history, character card), generates a structured arc plan via LLM, injects
the active plan into ST's prompt pipeline, and tracks beat progress through
AI-emitted signals. It acts as an automated dungeon master — plans are secret
from the user by default.

**Tech stack:** Vanilla JavaScript (ES6 modules, no build step), jQuery,
plain CSS. Runs browser-side inside SillyTavern's extension loader. Storage via
ST `chat_metadata` (per-chat) and `extension_settings` (global).

**Key packages:**

- `lib/core/` — constants, settings, per-chat state initialization
- `lib/context/` — harvests story state from lorebook / character / chat history
- `lib/planning/` — multi-phase LLM generation, validation, arc CRUD, prompt templates
- `lib/injection/` — builds prompt injections, pacing phases, ARC_SIGNAL tracking
- `lib/ui/` — settings panel, planning wizard, arc manager, progress widget

------------------------------------------------------------------------

## Verification Gate (BLOCKING)

Before writing any code:

- [ ] Read `docs/claude/coding-guidelines.md` — house code style

You **CANNOT** claim work is done until you have completed:

- [ ] `superpowers:requesting-code-review` — review against the plan, or against
      the request if no plan exists
- [ ] `superpowers:verification-before-completion` — verify it actually works

This half is not optional. Every time, every size.

**Design specs and implementation plans** go in `docs/plans/` using
`YYYY-MM-DD-<topic>-design.md` for designs and `YYYY-MM-DD-<topic>.md` for
implementation plans. Do not use any other location.

------------------------------------------------------------------------

## Context-Triggered Documentation (MANDATORY)

Before exploring code, you **MUST** read the relevant documentation (blocking):

| When doing... | Read FIRST (blocking) |
|---|---|
| Writing any code | `docs/claude/coding-guidelines.md` |
| Any debugging | `docs/claude/debugging-protocol.md` |
| Model/code analysis | `docs/claude/code-analysis.md` |
| Arc generation, planning wizard, LLM pipeline, JSON validation, arc schema, beats, phases, pacing, ARC_SIGNAL tracking, prompt injection, the tier × focus injection matrix, milestones, pausing (clock shift), spotlight, re-plan merge, stall nudge | `docs/architecture/architecture.md` |
| Finding files, module dependencies, "where does X live" | `docs/architecture/code-index.md` |
| Naming a domain concept (tier, focus, milestone, pressure, re-plan, stall), or a change that touches a recorded decision | `CONTEXT.md` (glossary) and `docs/adr/` |
| SillyTavern API integration — `setExtensionPrompt`, `generateRaw`, events, popups, world info, `chat_metadata`, connection profiles, extension loading | `docs/architecture/st-extension-patterns.md` |

**This is not optional.** Only explore code if the documentation is insufficient
after reading the relevant docs.

------------------------------------------------------------------------

## Behavioral Rules

### Ask Questions — Don't Assume

If unclear, ASK before proceeding — in plain chat prose (the owner dislikes the
`AskUserQuestion` widget; never use it in this project).

### Fix Only What Is Requested

This extension was built in a single day of AI-assisted development; the owner
is still rebuilding a detailed understanding of the implementation. Fix ONLY
what is explicitly requested. No unauthorized "improvements." Ask permission
before any additional changes.

### Never Mask Issues with Logging

**FORBIDDEN:** adding logging while leaving bugs unfixed. **REQUIRED:** fix the
root cause first.

### Debugging

Use `superpowers:systematic-debugging` for any bug or unexpected behaviour.
For patterns specific to this stack see `debugging-protocol.md` in this
directory. Note: that file's canon content is Django-oriented; the
StoryArc-specific reality is browser-side JS — debug via the browser console of
the running ST instance and `[Story Arc]`-prefixed console logs.

### Documentation Accretion

When a session working in a subsystem learns something the doc does not say —
a gotcha, a rationale, a mechanism that surprised you — write it into that doc
in the same session, while it is verified and fresh. Bump `Last Updated`. If
you touched code outside the doc's coverage globs while doing work this doc
routes, extend the globs.

Accretion needs no review gate. A session that just debugged the subsystem is
writing down freshly verified reality, and friction there is what kills the
habit. The drift report catches the mechanical slips.

### No Automatic Agreement

The user can be wrong. Your job is independent technical analysis.

### Never Attribute a Test Failure Without a Baseline

Calling a failure "pre-existing", "unrelated to my change" or "environmental" is
a **claim**, not an observation. Before making it, either run the same suite at
the base commit or re-run it on a known-clean checkout — and quote that output.
A wrong attribution is worse than reporting the raw failure, because the reader
stops looking and now believes something false about the codebase.

### Project Rules

- Tests cover pure logic only (validation, pacing, signals, templates); ST
  integration is verified by reloading the live ST instance manually.
- StoryArc is symlinked into the ST instance at
  `/opt/LLMS/silly_tavern/SillyTavern-Launcher/SillyTavern/public/scripts/extensions/third-party/StoryArc`
  — edits here are live in ST on next page reload, no deploy step.
- Reference implementation: Story Mode extension at `/opt/sillytavern/StoryMode`.

------------------------------------------------------------------------

## Documentation Index

### Architecture (`docs/architecture/`)

- `architecture.md` — system design, data flow, arc schema, phase system, signal protocol
- `code-index.md` — file structure and module dependency graph
- `st-extension-patterns.md` — SillyTavern extension API reference (working patterns)

### Claude-Specific (`docs/claude/`)

- `coding-guidelines.md` — house code style for AI-written code
- `debugging-protocol.md` — stack-specific debugging patterns
- `code-analysis.md` — large codebase handling

### Plans and Goals (`docs/`)

- `plans/` — design specs and implementation plans (`YYYY-MM-DD-<topic>.md`)
- `goals/` — long-horizon goal documents

------------------------------------------------------------------------

## Essential Commands

``` bash
./tests/run.sh        # unit tests (node:test + custom ESM loader mocking ST imports)
./tests/smoke.sh      # HTTP smoke tests against the live ST instance
```

------------------------------------------------------------------------

## Testing Guidelines

Unit tests run under Node's built-in `node:test` with a custom ESM loader
(`tests/loader.js`) that intercepts SillyTavern imports (`/script.js`,
`/scripts/extensions.js`, …) and returns mocks from `tests/mocks/st-mocks.js`.
Only pure logic functions are testable this way — anything touching the DOM or
live ST state needs the running ST instance. Adding a new ST import to a module
under test requires a matching mock export, or the loader run fails at import
resolution.

------------------------------------------------------------------------

## Localization

English throughout — code, docs, UI strings, prompts.

------------------------------------------------------------------------

## Communication Style

Be direct and concise. Avoid excessive praise. Focus on facts and solutions.
