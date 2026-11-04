# StoryArc act drift: rulings, re-plan and the nudge

**Status:** open · **Opened / last verified:** 2026-11-04 · **Scale:** four chapters, several sessions; the specs come from an Opus session

This is a goals document, not a spec; chapters go through the normal spec/plan workflow.

## Why

Stefan's purpose for StoryArc, in his words (2026-11-04): a tool that solves problems with SillyTavern roleplay "which can't really be solved via the preset":

1.  Plot thread adherence and foreshadowing. "Without an external system to keep the chat on track, it will just vibe with me and then the plot meanders and goes nowhere."
2.  Pacing. "If I tell the plot I want to the LLM it SPEEDRUNS it - because it has no real sense of time and wants to converge on a 'solution'. Thats good for coding and very bad for storytelling."
3.  Suspense. "Sometimes I don't want the resolution in advance and want the Plothread to surprise me (StoryArc does this very well currently)."
4.  Anti-omniscience. "Regardless of what you prompt, Argon or Opus keep spoiling secrets because the lose track in a longform RP."

The problem, in his words: "StoryArc works ok so far - but it does no see my rulings." He steers the story with out-of-character lines in the chat. Summaryception hides those lines within a few dozen messages. StoryArc injects the arc plan into every message. So the plan outlives the rulings.

In the Paragon chat the act "Streets of the Jackpot Siren" was planned at message 2118 with "sidekick rides with Gabriel (Aegis)" in its premise. Stefan ruled at 2406 that Aegis is not her defender, and again at 2622. The premise kept that sentence until Stefan re-planned the act on 2026-11-04, 258 messages after the first ruling. He found out why only by interrogating the narrator out of character. The narrator blamed the act. He repeated other rulings the same way: comics, not police procedural (2408, 2658); Sundown is a mentor, not a partner (2642, 2654, 2660). At 2476: "I am more exhausted with having to explain over and over what kind of world".

The first fix of 2026-11-04 moved beat recognition into the knowledge extraction (`docs/plans/2026-11-04-beat-recognition-in-extraction-design.md`, ADR-0008). It took the fulfillments out of the narrator's prompt. It did not touch the plan's deafness to rulings. The re-plan nudge never showed for the act either, because the stall rule is episode-only.

A plan that keeps the story on a track the player has closed turns the adherence tool, problem 1 above, against him. That is the cost of leaving this alone. The experience Stefan wants: "it should recognize that the chat has drifted and a replan should fix this. That should be the user experience." And: "This is kinda ok, if I demand a Story Shift its ok that I need to replan an arc. But I want the extension to notice that something is amiss and print the 'needs replanning'."

## Scope

In scope, four chapters:

1.  The knowledge extraction notices an out-of-character ruling that contradicts an active arc's plan. The arc stores the ruling in the player's words. The progress card shows it, quoting the player, with a re-plan button.
2.  A re-plan consumes the stored rulings without retyping and proposes a new premise from them, shown to the player for acceptance.
3.  Title and premise are editable in the Arc Manager, outside the spoiler drawer, without the JSON editor and without a re-plan.
4.  The stall counter applies to acts and sagas, and a re-plan resets the clock. With the knowledge tracker off, this is the only signal.

Out of scope:

| Not in this work | Why, and where it belongs |
|---|---|
| A general notebook of world and character rules | Stefan: "Degrading the extension to just a notebook kinda defeats its point?" Rules like "Gabriel is not a dom" or "Wards are 18 and younger" are for the preset, the character card and Summaryception |
| Capturing new direction | "Expand the world. Introduce NEW characters." contradicts no plan, so it is not noticed. New direction stays the player's to type at re-plan; see the Decided entry on story shifts |
| Printing anti-patterns, or the stored rulings, to the narrator for acts in normal focus | Open question |
| Pruning secrets that re-plans accumulate | Open question |
| The preset and Summaryception's NPC agendas | They push the narrator independently of StoryArc |
| The plan-check misses and the cast-list glitches seen in the live re-plans | Parked observations, recorded under Facts |

Records this work changes:

| Record | Change |
|---|---|
| ADR-0003 | A re-plan proposes the premise anew |
| ADR-0008 | Its consequences say the extraction does not see the plan |
| Glossary: Divergence | "Cannot happen to milestones" no longer holds |
| Glossary: Stall | The rule covers acts and sagas |
| ADR-0001 | Only if the open question on anti-patterns is answered yes |

## Facts a new session must not re-derive

| Fact | Detail and how it was checked |
|---|---|
| What an act in normal focus injects | Title, the GENRE line, PREMISE, and every open milestone's pressure. Nothing else: no tone, directives, anti-patterns, secrets, triggers or foreshadowing. Those print for episodes, and for acts and sagas only in spotlight. The plant check prints no trigger or clue lines for a normal-focus act either. Read in `lib/injection/builder.js` (the milestone section, the lists rule, the signal directive), 2026-11-04 |
| What a re-plan keeps | Title, premise and direction verbatim; the premise the model regenerates is discarded (`lib/planning/replan.js`). The wizard pre-fills the premise and the direction in editable fields on re-plan, in plain view (`lib/ui/wizard.js`, step 2). The handoff's claim that direction can be filled only before planning was wrong |
| How the premise can be changed today | The JSON editor in the Arc Manager, which takes the whole arc as JSON and so shows the plan (`lib/planning/arc-edit.js`), or a re-plan. No field edit exists. Checked 2026-11-04 |
| What the re-plan planner sees | The last 50 messages (`harvestContext` default), hidden messages included; messages carrying an arc id, the injection header or a signal marker are dropped. At 2664 messages the window starts near 2614, so the rulings at 2406 and 2408 are outside it. The plan check (ADR-0006) sees the last ten story messages and the Phase 1 analysis |
| The stall rule | Episode-only (`isStalled` in `lib/ui/progress.js`), justified by the glossary's "Divergence ... Cannot happen to milestones". Under the episode formula the Street act (estimated length 90, last fulfillment at 2225, chat at 2664) has an allowance of about 68 against 439 elapsed: it would have lit near 2293 and never gone out. Computed 2026-11-04 |
| What a re-plan does to the clock | Nothing. `messageStart` and `lastFulfilledAt` are untouched and no re-plan timestamp is written. Read from the Paragon chat file after both re-plans of 2026-11-04 (2118 and 2225 unchanged) |
| The knowledge extraction | One call after each reply (`updateInterval` default 1, `lib/core/constants.js`), reading the messages since its last update. It sees the ledger's characters and facts, the arcs' secrets, and the active beats' fulfillments by id. It does not see a premise or a pressure (ADR-0008, Consequences). It already treats out-of-character lines as corrections: they teach characters nothing, fulfil nothing, and can retract a fact. It skips hidden (`is_system`) messages, in five places in `lib/knowledge/ledger.js`. Read 2026-11-04 |
| The window constraint | At interval 1 one extraction window is one exchange: the player's message and the reply. Stefan's rulings often come as a dialogue: "Stop the RP and report back", the narrator's options, then his pick in the next message ("Option one", "Lets go with 3", "Yes"). The pick arrives in the window after the options. A spec has to say how a bare pick is read, or accept that only rulings stated in full are caught |
| Stefan's out-of-character lines | Bracket form `[OOC: ...]`, usually at the start of his message, sometimes after in-character text. Most are scene-level: rewrite, stop and report back, no hoodie. Direction-level since 2118: 2406 and 2408 (Aegis is not her defender, expand the world, lean into comics), 2416, 2464 and 2510 (Stern must not solve everything in advance), 2622 (Aegis again), 2642, 2654 and 2660 (Sundown is a mentor, not a trained partner), 2658 ("Further direction for the scenes from now on ... More Superhero comics please"). He repeats a ruling two or three times. Read from the chat file, read-only, 2026-11-04 |
| Hidden messages | 430 of the 464 messages since 2200 are hidden (`is_system`), by Summaryception. The narrator sees 34 messages from that span. The three quoted rulings are hidden now. Not checked: whether the extraction read them while they were new; the interval of 1 makes it likely. Not checked: when Summaryception hides a message |
| Other systems that push the narrator | Summaryception attaches NPC agendas with tasks to 209 messages since 2200 (`extra.summaryception_continuity`). The `<narrative_mode>` and `<plot_momentum>` blocks the narrator blamed are not StoryArc's. Re-planning fixes StoryArc's voice only |
| Live evidence: two re-plans of the Street act | Stefan ran them on 2026-11-04 at 12:37 and 12:55 in Paragon, with the rulings typed into the direction field and the premise edited by hand. Both times the planner produced directives and anti-patterns that restate the rulings: Sundown protects and instructs and never barks sidekick orders, no police procedural, populate the world. No new pressure mentions Gabriel. The second re-plan put the Sundown ruling into a pressure, which the narrator reads; the "comics, not procedural" ruling lives only in an anti-pattern, which it does not. Every new fulfillment was one on-screen moment (4 of 4, then 5 of 5, one soft each run). The plan check tied one trigger per run and left one trigger per run untied that shows a secret's visible effect; harmless in normal focus, visible in spotlight. Each re-plan added two secrets (five, then seven), add-only per ADR-0003; pruning needs the JSON editor. Cast-list glitches: Priya's surname changed from Mehta to Patel; a new character shares a first name with one existing character and a surname with two others. The planner follows the rulings it receives; they did not reach it before only because of the harvest window and the kept premise |
| Chats | Paragon (`.../data/default-user/chats/Paragon -Superhero RPG-/Paragon -Superhero RPG- - 2026-10-07@22h27m51s377ms.jsonl`) is the real story: never a test chat, never written to. The Amy chat is the disposable test chat. The tracker is on in Paragon (`autoTrack` true, a 261-fact ledger); its update interval was not read |
| Verification environment | GitHub Actions runs `./tests/run.sh` (node:test, about 1 s, 812 tests) on every push to main and every PR. Local runs cover what a change touches. Live checks run in the SillyTavern instance at 127.0.0.1:8008, in the Amy chat only. One `/code-review` pass, timeboxed; reviewer subagents may run on sonnet. Push only on Stefan's go |
| Session records | The discussion ran in an Opus session and a Fable session on 2026-11-04. Its handoff is `/tmp/claude-handoff-storyarc-act-drift.md`; the agreed rulings are in the two sessions' `decisions.md` files under `/tmp/claude-1000/-opt-sillytavern-StoryArc/`. All three are volatile; the Decided section below is the durable copy |

## Decided

| Decision | Stefan's words, 2026-11-04 |
|---|---|
| The extension notices; the player re-plans | "This is kinda ok, if I demand a Story Shift its ok that I need to replan an arc. But I want the extension to notice that something is amiss and print the 'needs replanning'." |
| The user experience is drift noticed, re-plan as the fix | Handoff: "it should recognize that the chat has drifted and a replan should fix this. That should be the user experience." |
| Scope: the arc remembers what the player overruled, and only that | "sounds good", to the proposal "contradiction noticed in the extraction, the counter unlocked for acts and sagas as the cheap backstop, and a re-plan that can rewrite the pitch from what it was told" and to the scope line "the arc remembers what you overruled, and only that" |
| Not a notebook | "Degrading the extension to just a notebook kinda defeats its point?" |
| No extra LLM call per reply | Handoff: "We allready got lots of small calls - is that really necessary?" And: "I don't want to have a diagnostics chat with the main llm every two responses." |
| Editing the arc JSON is not a fix path | Handoff: "the user should be able to fix them easily (and thats means directly editing the json via the editor is not a valid option)" |
| Hand-marking beats is not a recognition path | Handoff, recorded in ADR-0008: "The goal is to reduce fiddling with the system - so a requirement for the user to hand mark stuff as completed defeats the purpose of the extension" |
| Typing rulings into the re-plan fields is a workaround, not the path | "I wrote the rulings you mentioned into the replan fields but yes, thats a workaround." |
| With the tracker off, no rulings are captured and the counter is the only signal | Part of the proposal answered with "sounds good" |
| The specs come from an Opus session | "Write a goals document - I'll have an Opus session produce the spec." |

## Open questions

- Should acts and sagas in normal focus print their anti-patterns, or the stored rulings, to the narrator? Owner: Stefan. Unblocked by the Street act experiment: the next time the narrator ignores a ruling that sits in the plan's anti-patterns but not in its pressures. Touches ADR-0001.
- Should a re-plan be able to drop secrets that a previous re-plan added? Owner: Stefan. Unblocked by play after chapter 3 exists: whether rerolls used as edits still happen.
- How is a bare pick such as "Option one" read as a ruling when it arrives in the window after the narrator's options? Owner: the spec of chapter 1.
- Which arc stores a ruling that contradicts more than one active arc? Owner: the spec of chapter 1.

## Living rules

- Check off a chapter when its last ticket closes, with a dated completion line under it.
- Append dated entries to the status log below. Never rewrite history; supersede this document with a companion or handover document.
- Kickoff-brief contract. A chapter brief carries the rows below and nothing that lets a chapter skip the spec, plan and review cycle.

| A chapter brief carries | Detail |
|---|---|
| The chapter row | With its `done =` |
| The Decided entries | With their attribution |
| The standing constraints | The verification environment; Paragon is never a test chat; no extra LLM call; no JSON editing as a fix path; the spoiler rule: the player's words may be shown, the plan's never |
| The pointers | This document, ADR-0001, ADR-0003, ADR-0006, ADR-0007, ADR-0008, the 2026-11-04 design note, the glossary |
| The current measured state | From the Facts table |
| Never | A task list (the tickets' job); code or model sketches (the spec's job) |

Status log:

- 2026-11-04: opened after the discussion in an Opus session and a Fable session. Stefan re-planned the Street act twice with the rulings typed by hand. The Street act experiment is running.
- 2026-11-04: all chapters are implemented on `integration/act-drift-npc-names` as tickets #37–#49, with a review fix pass on top. Not merged into main and not live-checked; no chapter is ticked until its last ticket closes.

## Chapters

Ordering: C1 before C2, because C2 consumes what C1 stores. C3 is independent and smallest, and comes before C4 so that rerolls used as edits stop early. C4 last, so that live checks of C1 are not confused with the counter. Later chapters TBD after the Street act experiment; see Open questions.

- [ ] **C1. Noticing** — the knowledge extraction reports an out-of-character ruling that contradicts an active arc's plan; the arc stores it in the player's words; the progress card shows it with a re-plan button. With the tracker off, nothing.
  - done = in the Amy test chat, an out-of-character line that contradicts an active act's premise produces the card line quoting it after the next extraction, a scene-level out-of-character line produces none, and the narration prompt is unchanged by this chapter. ADR-0008 amended.
- [ ] **C2. Re-plan consumes the rulings** — the stored rulings reach the planner without retyping, and the re-plan proposes a new premise from them, shown for acceptance.
  - done = a re-plan of an arc with a stored ruling shows a proposed premise that follows the ruling before the arc is stored, the player accepts or edits it there, the accepted premise is stored, and the plan check still runs. ADR-0003 amended.
- [ ] **C3. Title and premise edit in the Arc Manager** — outside the spoiler drawer, without the JSON editor and without a re-plan.
  - done = the premise of an active arc can be changed in the Arc Manager without seeing its beats, secrets or triggers, and the next prompt carries the new text.
- [ ] **C4. The counter for acts and sagas** — the stall nudge for milestones, with a re-plan resetting the clock. The backstop for chats with the tracker off and for a plan nobody plays.
  - done = an act past its allowance without a fulfillment shows the nudge, a freshly re-planned act shows none, and the glossary's Divergence and Stall entries match the rule.
