# StoryArc: sagas planned as sagas, focus defined by what the player wants

**Status:** open · **Opened / last verified:** 2026-11-22 · **Scale:** three chapters, several sessions

This is a goals document, not a spec; chapters go through the normal spec/plan workflow.

Related goals documents: `docs/goals/keeping-the-story-on-track.md` (what plan text may say) and `docs/goals/act-drift-and-rulings.md` (noticing drift, re-plan). This document covers the shape of a saga plan and the meaning of the focus levels; neither of the others does.

## Why

In the Aegis chat the saga "Bedside Manner and Unmeasured Miracles" kept characters knowing what they could not know. Damon Alverez's recovery was a secret. From message 387 to 425, these characters knew about it within an hour:

- a flyer fresh off the roof pad;
- a Risk auditor;
- a captain on the phone;
- two senior heroes.

Stefan corrected it out of character at 388, 390, 412, 420, 422, 424 and 426: "Damon left TODAY. And suddenly everyone knows? REALLY?" and "I know you are being pushed to continue the story but you need to factor in time - we can't speedrun this."

His diagnosis, 2026-11-21: "What an arc does works very well for an episode or maybe an act. But if you read the wording of the Saga - its too specific and I had to replan already because the story drifts easily. I think the prompts need to change - a saga prompt must tell the model to construct the beats differently. The planning is too narrow and when the direction does not align with the story, the Arc forces the model to adhere - which the model translates into messages that do not make sense in the context of the story."

A saga lasts 400 to 1,500 messages. A pressure written for the next few scenes is sent for a hundred messages or more, and when the story has moved on, the narrator bends the story to the plan. The cost is the one Stefan named on 2026-11-09 in `keeping-the-story-on-track.md`: every correction pulls him out of the story.

The focus levels have the same defect at a different place. Today they are defined by how much of the narrator's attention an arc gets, and the tier only changes the label. Stefan redefined them on 2026-11-22 by what he wants from the arc right now (see Decided). The code disagrees with those meanings in three places (see Facts).

## Scope

In:

- A test, without code, of whether the saga's text drives the leaks.
- Planning rules for sagas only: what a saga's milestones, pressures, premise and world facts may be.
- What each focus level sends, recognises and clocks, per tier, derived from Stefan's meanings.

Out:

| Not in this work | Why, and where it belongs |
|---|---|
| Planning rules for episodes and acts | Stefan: "What an arc does works very well for an episode or maybe an act." |
| The player's preset, card and Author's Note | His calls (`keeping-the-story-on-track.md`, Scope). Stefan edited the Aegis card and note on 2026-11-21 |
| Detecting world facts the story has outgrown | Not now (Decided); Open question |
| Reporting a reply that breaks a world fact | Stefan: "you don't have to report it seperately." |
| Changing stored sagas | They stay untouched until Stefan re-plans them (Decided) |
| A formal arc-owns-arc hierarchy | `docs/goals/GOALS.md`, goal 4: resisted until recognition proves insufficient |

## Facts a new session must not re-derive

| Fact | Detail and how it was checked |
|---|---|
| Act and saga get the same planning rules | `buildTierBlock` in `lib/planning/generator.js` gives both the same milestone rules word for word. Only the scale sentence differs: "the overarching storyline of this whole roleplay, such as bringing down the big bad" against "one leg of the larger story". Read 2026-11-21 |
| The saga was first meant to be coarser | `docs/goals/GOALS.md`, goal 4: "Same milestone mechanism, coarser: fewer milestones, each a state the story reaches." The ADR-0001 amendment of 2026-11-12 gave sagas 3–7 milestones like acts, after a Paragon re-plan with a five-step direction |
| Every plan reads the same chat window | `harvestContext(chatDepth = 50)` in `lib/context/harvester.js`, called without an argument from `lib/ui/wizard.js`. A saga planned or re-planned sees the same last 50 messages as an act. Read 2026-11-21 |
| The Aegis pressure was a forecast | The saga was re-planned at message 348. The pressure "Damon Alverez's sudden recovery draws skeptical scrutiny from coworkers and supervisors…" was written then. The recovery happens on screen at 362–363, after Stefan's out-of-character line at 338 said Damon should walk "by the end of the day/tomorrow". Read from the chat file 2026-11-21 |
| Stored sagas are shaped like acts | All ten stored acts and sagas were read from the chat files on 2026-11-21. Sovereign's Gilded Orbit has five of six pressures in the form "Jonathan Hawke does X". The Kept Girl Theory is a chain of events (taunts, isolation, being treated as bought goods, retaliation, fallout). The Aegis saga's milestones are events (the Angel uniform issued, Sledge's trap, a reckoning with named officials). The Age of Tentacles (Transform the World) has world-scale pressures |
| What each focus sends today | Read in `lib/injection/builder.js`, 2026-11-22. Paused: `=== PAUSED: ===` with the whole premise and "pending, not being pursued right now". Background (acts and sagas): the title and one sentence, with no premise, world facts or pressure. Normal: the premise, every world fact and the current milestone's pressure under `STANDING PRESSURE`. Spotlight (act or saga): `BRING TO A HEAD:` with "Let this pressure intensify over the coming scenes, and let the world act on its own interests", plus secrets, triggers and foreshadowing. Spotlight on an episode changes no text; it only makes the episode the pacing clock |
| Paused sends more than background | Follows from the row above |
| Nothing ends a spotlight | `lib/injection/clock.js` sets `spotlitAt`. A spotlit arc returns to normal only when another arc is spotlit. Read 2026-11-22 |
| How world facts are kept | Written at planning, checked once by the plan check, carried by a re-plan. They can be edited only through the Arc Manager's JSON editor (`lib/planning/arc-edit.js`); premise and pressures have field edits. Stefan ruled JSON editing out as a fix path (`act-drift-and-rulings.md`, Decided) |
| What the knowledge extraction sees of the plans | The developments (fulfilments) and, for the OVERRULED step, each arc's premise and pressures (`prompts/extract-knowledge.txt`, step 7). It does not see world facts. Read 2026-11-22. `act-drift-and-rulings.md` still says the extraction sees no premise or pressure; that row is out of date |
| The leaks came after the two wording fixes | Commit cc4dd91 (2026-11-21, 13:24 UTC) narrowed public facts and gave the pressure's "line in passing" only to characters who could know. Messages 407–425 were written from 19:58 UTC on. The rebuilt knowledge block for 424 lists Damon's recovery as "known only to" seven characters, none of them Roman DeLuca (`scripts/rebuild-knowledge-block.mjs`) |
| World facts that worked as licences or went stale | World fact 4 ("R. Ilyas has taken a personal interest in Ellie Masters") preceded Ilyas walking in at 423. World fact 5 ("Branka Kovač and … Callum Hale supervise … auxiliary evaluations") contradicts the ledger fact that Ellie answers only to Hale under Form 88-C, which was Stefan's complaint at 376. DeLuca at 425 broke world fact 4's first clause ("senior licensed heroes overlook Class Zero support staff") |
| The leak is now in the accepted story | The tracker stored the orderly's gossip at 407 as fact f374. Koster's warning that "every sector captain … is going to be ringing your extension before lunch" is in the accepted message 415. Prompt changes do not undo either; the test starts from a branch at 406 |
| The player's stack pushes events too | Preset "Writer's Block Unlimited v3 Release - Argon (Custom)", model `google/gemini-4-carbon` on OpenRouter (`settings.json`, 2026-11-22). Its enabled prompts include "Active (Responses are allowed to progress past input)": "Characters pursue their own aims and events continue whether or not the POV character drives them". They also include "Energetic" ("move events quickly"), "Enhanced World" and "Better Side Characters". "Anti-Omniscience" is enabled as well and did not stop the leaks |
| Test text for C1 | Approved by Stefan with "go", 2026-11-22. Premise: "Ellie Masters joined Aegis Central to become a hero, but her protective gift scrambles every measurement, so she works Class Zero medical support while she waits for a re-evaluation. Her power turns male desire and intimate contact into euphoria for her and rapid healing for her patients. Can she earn a real hero role on her own terms, with a power nobody can measure and a body that reacts on autopilot to every appreciative look?" Current pressure: "Aegis trusts only what it can measure, and Ellie's gift refuses measurement, so every healing she performs proves little on paper." World facts, as rules only: (1) Leaving the Class Zero-Provisional pool forfeits an applicant's eligibility for a hero license. (2) Ellie's power reacts strongly to male desire when she wears hyperfeminine or sexualized clothes; in civilian clothes she moves through daily life normally. (3) Intimate skin-to-skin contact and sexual release with Ellie speed cellular and nerve regeneration in injured patients, and after she climaxes a temporary luck aura surrounds her. (4) Ellie keeps final say over whom she treats and how far any intimate care goes; nobody at Aegis can order her to. (5) Senior licensed heroes treat Class Zero support staff as interchangeable background personnel |
| Chats | Aegis: `.../data/default-user/chats/Aegis Central Internship System (Open)/Aegis Central Internship System (Superhero Sim) - 2026-11-17@22h12m23s996ms.jsonl`, 428 messages on 2026-11-22. It is Stefan's story: the test runs in a branch only. The Amy chat is the disposable test chat. Paragon is never a test chat |
| Verification environment | GitHub Actions runs `./tests/run.sh` on every push to main. Local runs cover what a change touches. Live checks run in the SillyTavern instance at 127.0.0.1:8008. One `/code-review` pass. Commits go to main directly (no PR) |
| Session records | Discussion of 2026-11-21 and 2026-11-22. Its decisions file, `/tmp/claude-1000/-opt-sillytavern-StoryArc/d8a31b14-7ced-49ed-8c79-28e892977c36/scratchpad/decisions.md`, is volatile; the Decided section below is the durable copy |

## Decided

| Decision | Stefan's words |
|---|---|
| A saga needs its own planning rules | "a saga prompt must tell the model to construct the beats differently" (2026-11-21) |
| Focus is defined by what the player wants from the arc right now, for every tier | "Paused = 'Remove it for now'; Background = 'I don't want to deal with this now but its there'; Spotlight = 'Move the arc along now'" (2026-11-22) |
| Normal means "it's part of the story, let it develop" | "1 yes", to that sentence (2026-11-22) |
| A reply that breaks a world fact is not reported on the card | "no to your question - you don't have to report it seperately." (2026-11-22) |
| The recommendation package of 2026-11-22, items 1–5 below | "go" (2026-11-22). He had asked for it: "give me recommendations instead of asking me for every small decision" |

The package Stefan approved:

1.  **Test first, without code.** Branch the Aegis chat at 406, apply the C1 test text (Facts), and play 15–20 turns. If the leaks continue with a clean saga, the preset is the main driver and the redesign drops in priority.
2.  **Saga planning rules, for sagas only:**
    - Milestones are stages of where the protagonist stands, not plot events.
    - Pressures are forces in the setting, not single people or events.
    - World facts are rules of the setting only.
    - Everything the narrator reads passes the test: still true and playable 200 messages on, whatever happens in between, without anyone learning anything new.
    - The player's specifics (in Aegis: Angel, the field uniform, Hale's sponsorship) go into milestone intentions, which the narrator never sees.
    - The standing-pressure header stays as it is. Content changes first, and the header forks only if a test demands it.
3.  **Focus levels:**
    - Paused sends nothing.
    - Background keeps the world facts for sagas only; acts in background stay title-only; episodes still have no background.
    - Normal stays as it is.
    - Spotlight on an act or saga ends on its own when the current milestone is fulfilled and returns to normal. Its text stays; ADR-0002 names a tempo phrase as the next step if spotlight proves too soft.
    - Spotlight on an episode stays as it is.
4.  **Not now:** a detector for world facts the story has outgrown. Stored sagas stay untouched until re-planned.
5.  **Record it as a goals document** with three chapters: test, saga planning, focus semantics.

## Open questions

| Question | Owner | Unblocked by |
|---|---|---|
| Is a detector needed for world facts the story has outgrown? Any design must keep a broken rule in the prompt: at 425 the narrator broke world fact 4, and dropping that fact would have removed the rule before the rewrite | Stefan | The first saga world fact that goes stale after C2 is live |
| Should a saga plan or re-plan read more of the chat than the last 50 messages? | The C2 spec | C2's spec work |
| What happens to the stored sagas that are shaped like acts (Sovereign's Gilded Orbit, The Kept Girl Theory)? | Stefan | C2 shipping |
| How much of the leaking comes from the preset? | Stefan | C1's result |
| Does spotlight on a saga need a tempo phrase (ADR-0002)? | Stefan | Live play after C3 |

## Living rules

- Check off a chapter when its last ticket closes, with a dated completion line under it.
- Append dated entries to the status log below. Never rewrite history; supersede this document with a companion or handover document.
- A chapter brief carries:
  - the chapter row with its `done =`;
  - the Decided entries with their attribution;
  - the standing constraints: the verification environment, Paragon is never a test chat, Aegis is tested only in a branch, no extra LLM call per reply, no JSON editing as a fix path for the player;
  - the pointers: this document, ADR-0001, ADR-0002, ADR-0009, ADR-0010, `keeping-the-story-on-track.md`, `act-drift-and-rulings.md`, the glossary;
  - the current measured state, from the Facts table.
- A chapter brief carries no task list (the tickets' job), no code or model sketches (the spec's job), and no wording that lets a chapter skip its spec, plan and review cycle.

Status log:

- 2026-11-22: opened after the discussion of 2026-11-21 and 2026-11-22. Stefan approved the recommendation package with "go".

## Chapters

Order: C1 first, because its result decides whether C2 and C3 are worth building. C2 before C3, because background's world facts are safe only once saga world facts are rules only.

- [ ] **C1. The test** — branch the Aegis chat at 406, apply the test text from Facts, play 15–20 turns.
  - done = the status log records the branch name, the number of narrator replies played under the test text, and the message numbers of every reply in which a character uses knowledge the knowledge block does not give them.
- [ ] **C2. Saga planning rules** — the planner and the plan check apply the saga rules from Decided, item 2.
  - done = two sagas freshly planned in the Amy chat each have milestones that name no single event. No pressure names a non-protagonist character or a single event. Every world fact states a rule, not a situation. The unit tests pin the saga rule fragments literally.
- [ ] **C3. Focus semantics** — the injection follows Decided, item 3; ADR-0001 and the glossary entries Focus, Paused, Background and Spotlight are amended.
  - done = unit tests with literal expected sections show: a paused arc sends nothing, a saga in background sends its world facts and no premise or pressure, an act in background sends its title line only, and a spotlit act or saga is back in normal focus after its current milestone is fulfilled. A live check in the Amy chat shows the same for one spotlit act.

Later chapters TBD after C1.
