# StoryArc: sagas planned as sagas, focus defined by what the player wants

**Status:** open · **Opened / last verified:** 2026-11-22 · **Scale:** five chapters, several sessions

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

Stefan named his three biggest problems on 2026-11-22: "pacing and omniscience problems btw. are the two biggest problems I'm noticing in my roleplays. Well and tonal clashes." C1 scores every reply on all three.

After C1 he named the goal behind all of it, 2026-11-22: "the biggest problem is that the LLM does something I either miss or try to fix by rewrites and OOC and the error keeps popping up like a whack-a-mole. Furthermore the model goes out of its way to adhere to the rules but breaks story quality in order to do it - like killing a scene early or shoving in a beat that just does not fit. My main goal for this whole extension was Story quality and I want it to improve it, not degrade it."

The checks after C1 found Story Arc behind both halves of that (Facts): the tracker keeps what a rewrite rejected, and plan items get shoved into scenes.

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
| Stored sagas are shaped like acts | The nine active or completed sagas were read from the chat files on 2026-11-21. Sovereign's Gilded Orbit has five of six pressures in the form "Jonathan Hawke does X". The Kept Girl Theory is a chain of events (taunts, isolation, being treated as bought goods, retaliation, fallout). The Aegis saga's milestones are events (the Angel uniform issued, Sledge's trap, a reckoning with named officials). The Age of Tentacles (Transform the World) has world-scale pressures |
| What each focus sends today | Read in `lib/injection/builder.js`, 2026-11-22. Paused: `=== PAUSED: ===` with the whole premise and "pending, not being pursued right now". Background (acts and sagas): the title and one sentence, with no premise, world facts or pressure. Normal: the premise, every world fact and the current milestone's pressure under `STANDING PRESSURE`. Spotlight (act or saga): `BRING TO A HEAD:` with "Let this pressure intensify over the coming scenes, and let the world act on its own interests", plus secrets, triggers and foreshadowing. Spotlight on an episode changes no text; it only makes the episode the pacing clock |
| Paused sends more than background | Follows from the row above |
| Nothing ends a spotlight on its own | `lib/injection/clock.js` sets `spotlitAt`. A spotlit arc returns to normal only when the player changes its focus or spotlights another arc. Read 2026-11-22 |
| How world facts are kept | Written at planning, checked once by the plan check, carried by a re-plan. They can be edited only through the Arc Manager's JSON editor (`lib/planning/arc-edit.js`); premise and pressures have field edits. Stefan ruled JSON editing out as a fix path (`act-drift-and-rulings.md`, Decided) |
| What the knowledge extraction sees of the plans | The developments (fulfilments) and, for the OVERRULED step, each arc's premise and pressures (`prompts/extract-knowledge.txt`, step 7). It does not see world facts. Read 2026-11-22. `act-drift-and-rulings.md` still says the extraction sees no premise or pressure; that row is out of date |
| The leaks came after the two wording fixes | Commit cc4dd91 (2026-11-21, 13:24 UTC) narrowed public facts and gave the pressure's "line in passing" only to characters who could know. Messages 407–425 were written from 19:58 UTC on. The rebuilt knowledge block for 424 lists Damon's recovery as "known only to" seven characters, none of them Roman DeLuca (`scripts/rebuild-knowledge-block.mjs`) |
| World facts that worked as licences or went stale | World fact 4 ("R. Ilyas has taken a personal interest in Ellie Masters") preceded Ilyas walking in at 423. World fact 5 ("Branka Kovač and … Callum Hale supervise … auxiliary evaluations") contradicts the ledger fact that Ellie answers only to Hale under Form 88-C, which was Stefan's complaint at 376. DeLuca at 425 broke world fact 4's first clause ("senior licensed heroes overlook Class Zero support staff") |
| The leak is now in the accepted story | The tracker stored the orderly's gossip at 407 as fact f374. Koster's warning that "every sector captain … is going to be ringing your extension before lunch" is in the accepted message 415. Prompt changes do not undo either; the test starts from a branch at 406 |
| The story before 406 already carries some spread | Hale told Ellie that routing Damon's clearance "puts Ellie's provisional number on paper outside Ward Two". Tessa relayed that the rumour has reached Sub-Bay Two. Tessa told change-of-shift that Damon ditched his bedpan after one locked block with Ellie. In 405 patrolmen slow down outside Office 2-C. So a leak in the branch does not by itself point at the preset |
| Baseline: the original 407–425 | Eight narrator story replies (407, 409, 411, 415, 417, 419, 423, 425), sent under the old saga text. Clear leaks, where a character uses knowledge the block does not give them: 407 (the orderly's gossip, Kovač's three rookies asking for "miracle hands"), 423 (Ilyas asks Ellie to "work that magic of yours"), 425 (DeLuca: "Fourth Floor swears badge eight-eight-four just put Hardpoint back on the street"). Replies that spread the news through the clearance paperwork the story had set up: 409, 411, 415, 417, 419. The split is the session's reading of the replies (2026-11-22), not Stefan's |
| Only one pressure was rewritten | The test changed the pressure of `angel_field_sponsorship`, the current milestone. Four later milestones keep their old pressures. If a milestone completes or is skipped during the test, an old pressure goes out (for example "Escalating sabotage emergencies…") |
| The player's stack pushes events too | Preset "Writer's Block Unlimited v3 Release - Argon (Custom)", model `google/gemini-4-carbon` on OpenRouter (`settings.json`, 2026-11-22). Its enabled prompts include "Active (Responses are allowed to progress past input)": "Characters pursue their own aims and events continue whether or not the POV character drives them". They also include "Energetic" ("move events quickly"), "Enhanced World" and "Better Side Characters". "Anti-Omniscience" is enabled as well and did not stop the leaks |
| Test text for C1 | Approved by Stefan with "go", 2026-11-22. Premise: "Ellie Masters joined Aegis Central to become a hero, but her protective gift scrambles every measurement, so she works Class Zero medical support while she waits for a re-evaluation. Her power turns male desire and intimate contact into euphoria for her and rapid healing for her patients. Can she earn a real hero role on her own terms, with a power nobody can measure and a body that reacts on autopilot to every appreciative look?" Current pressure: "Aegis trusts only what it can measure, and Ellie's gift refuses measurement, so every healing she performs proves little on paper." World facts, as rules only: (1) Leaving the Class Zero-Provisional pool forfeits an applicant's eligibility for a hero license. (2) Ellie's power reacts strongly to male desire when she wears hyperfeminine or sexualized clothes; in civilian clothes she moves through daily life normally. (3) Intimate skin-to-skin contact and sexual release with Ellie speed cellular and nerve regeneration in injured patients, and after she climaxes a temporary luck aura surrounds her. (4) Ellie keeps final say over whom she treats and how far any intimate care goes; nobody at Aegis can order her to. (5) Senior licensed heroes treat Class Zero support staff as interchangeable background personnel |
| Chats | Aegis: `.../data/default-user/chats/Aegis Central Internship System (Open)/Aegis Central Internship System (Superhero Sim) - 2026-11-17@22h12m23s996ms.jsonl`, 428 messages on 2026-11-22. It is Stefan's story: the test runs in a branch only. The Amy chat is the disposable test chat. Paragon is never a test chat |
| Verification environment | GitHub Actions runs `./tests/run.sh` on every push to main. Local runs cover what a change touches. Live checks run in the SillyTavern instance at 127.0.0.1:8008. One `/code-review` pass. Commits go to main directly (no PR) |
| The tracker keeps what a rewrite rejected | Stefan corrects with an out-of-character "rewrite"; the narrator writes the corrected reply as a new message and the rejected one stays. Facts recorded from rejected replies are still live in the original chat's ledger: 411 (f379–f382, Koster's audit demands), 419 (f384–f386, a captain sending a patient "for the 302-M protocol under Apprentice Masters"), 423 (f387–f389, Ilyas against Sledge), 425 (f390–f392, DeLuca asking Ellie to wake his hand). None is in `retractedFacts`. The meetings at 423 and 425 are recorded too, so Ellie "has met" Ilyas and DeLuca. Read with `checks.py` in the session's scratch directory, 2026-11-22 |
| Rejected replies stay visible | Of the rejected replies, only 419–424 are hidden (`is_system`); 387–391 and 407–418 are visible to the narrator. Stefan hid 419–424 himself: "If 419-424 contains an OOC discussion between me and the LLM, yes I did. I didn't want the wrong stuff to get stored in memory by SummaryCeption" (2026-11-22) |
| A rollback exists, but not for a rewrite | `rollBackKnowledgeFrom` runs after a delete, a swipe, an edit or a branch load (`architecture.md`, Knowledge Tracker, step 4): entries with a message id go with their message. A new message after an out-of-character rewrite triggers none of these. Not verified: what deleting a rejected reply in the middle of the chat does to the replies after it (the rollback also sets `lastUpdatedAt` back) |
| Rulings after 370 were not stored | The saga holds four rulings, the last from 370 and unanswered. Stefan's corrections at 388, 390, 412, 420, 422, 424 and 426 are not stored: the OVERRULED step catches only a line that contradicts a premise or a pressure, and "we can't speedrun this" contradicts neither |
| Plan items shoved into scenes | Stefan's stop at 242 ("Why did you shove that in?") follows reply 241, where Corbin appears with "a half-inch copper-wire scrape" and "canary-yellow Code 409 fault forms", "crowding within eight inches of her open lapel". The fired trigger `corbin_maintenance_visit` reads "holds out a minor maintenance scrape or a stack of Bay Three fault forms and crowds into Ellie Masters's personal space". Triggers are sent only in spotlight; the saga's `spotlitAt` is 226. Not verified: the focus at 241. Likely, not verified: Stefan's stop at 370 ("Why would Hale try to HIDE something?") follows from the secret `hale_covert_dossier` |
| The knowledge block keeps the secret in view | The block rebuilt for 420 on the branch has 27 lines naming Damon, Hardpoint or Alverez; for 430, 18. Accurate lines, but the topic nobody may know is in front of the narrator every turn. Issue \#21 recorded the same effect for the "Does not know" lines |
| Story Arc on against off | Never compared. Nobody has measured whether Story Arc improves the story |
| Session records | Discussion of 2026-11-21 and 2026-11-22. Its decisions file, `/tmp/claude-1000/-opt-sillytavern-StoryArc/d8a31b14-7ced-49ed-8c79-28e892977c36/scratchpad/decisions.md`, is volatile; the Decided section below is the durable copy |

## Decided

| Decision | Stefan's words |
|---|---|
| A saga needs its own planning rules | "a saga prompt must tell the model to construct the beats differently" (2026-11-21) |
| Focus is defined by what the player wants from the arc right now, for every tier | "Paused = 'Remove it for now'; Background = 'I don't want to deal with this now but its there'; Spotlight = 'Move the arc along now'" (2026-11-22) |
| Normal means "it's part of the story, let it develop" | "1 yes", to that sentence (2026-11-22) |
| A reply that breaks a world fact is not reported on the card | "no to your question - you don't have to report it seperately." (2026-11-22) |
| The recommendation package of 2026-11-22, items 1–5 below | "go" (2026-11-22). He had asked for it: "give me recommendations instead of asking me for every small decision" |
| The second package of 2026-11-22, items 6–9 below | "ok then go" (2026-11-22) |
| The C4 package, items 1–7 of `docs/plans/2026-11-22-rejected-replies-design.md`, Decisions: Story Arc offers to take a rejected span out and the player confirms, recognition runs in the existing extraction, the whole span is ticked by default, the new version is read again at one call per take-out, and a replay comes before code | "go" (2026-11-22) |

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

The second package, after C1 and Stefan's goal statement:

6.  **C2, C3 and every comparison run wait.**
7.  **Corrections first:** when Stefan rejects a reply, Story Arc removes what the tracker recorded from it, and the rejected reply leaves what the narrator sees (C4).
8.  **Then one Story Arc on/off comparison** on the same turn (C5). It changes global switches, so it needs a time window agreed with Stefan and a restore afterwards.
9.  **Nothing new is added to what Story Arc sends** until C5 exists.

## Open questions

| Question | Owner | Unblocked by |
|---|---|---|
| Is a detector needed for world facts the story has outgrown? Any design must keep a broken rule in the prompt: at 425 the narrator broke world fact 4, and dropping that fact would have removed the rule before the rewrite | Stefan | The first saga world fact that goes stale after C2 is live |
| Should a saga plan or re-plan read more of the chat than the last 50 messages? | The C2 spec | C2's spec work |
| What happens to the stored sagas that are shaped like acts (Sovereign's Gilded Orbit, The Kept Girl Theory)? | Stefan | C2 shipping |
| How much of the leaking comes from the preset? C1 did not answer it (status log, 2026-11-22) | Stefan | Repeated regenerations of the first reply after 406, under the old and the new saga text, in throwaway branches |
| Do a pressure's words set the register? At 420 the test pressure's words ("measure", "on paper") were followed by a records clerk and two replies in the procedural register, against the Author's Note's "Keep bureaucracy … as brief background texture" | The C2 spec | C2's spec work |
| Does paperwork carry knowledge? The ledger holds Hale's line that routing Damon's clearance "puts Ellie's provisional number on paper outside Ward Two", while the block's header says nothing reaches anyone through "logs, records". Most of the paperwork spread in both arms rides on that contradiction, a scope gap like the one the `public` flag had | Stefan | — |
| Does spotlight on a saga need a tempo phrase (ADR-0002)? | Stefan | Live play after C3 |
| How does Story Arc tell a rejection from an ordinary out-of-character line? A rewrite request, a stop-and-report, and the narrator's corrected reply each look different | The C4 spec | Answered by the spec, 2026-11-22: a task in the existing extraction recognises a rewrite request; the player confirms the span. The replay gate in the spec tests it |
| Should Stefan's scene-level corrections ("we can't speedrun this") be kept, when they contradict no plan item? | Stefan | C4 shipping; `keeping-the-story-on-track.md` C5 (standing rulings) covers world rulings only |
| Should the knowledge block name a secret topic fewer times? | Stefan | C5's result |

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
- 2026-11-22: C1 set up. Branch "Aegis Central Internship System (Superhero Sim) - 2026-11-17@22h12m23s996ms - Branch \#1", messages 0–406, last message Stefan's "\[OOC: Ellies does, continue\]". The branch carries the test premise, the test pressure on `angel_field_sponsorship` and the five test world facts, written through `updateArc`. The knowledge ledger rolled back to 406 (f374 absent). The original chat is unchanged. No reply played yet.
- 2026-11-22: C1 run, on Stefan's request ("can't you do that on your own"). The session played Ellie's turns through Playwright in a short in-character style, without steering toward or away from Damon. 15 narrator replies (408–436), every one sent with the test pressure (`lastSent`), milestone statuses unchanged throughout. The first browser session crashed the tab for lack of memory after three turns; later turns loaded a fresh page per turn and closed it after.
  - Setup note: the first turn was generated from an empty input, so the preset's "send if empty" text entered the branch as message 407: "(POV Character stays silent or continues doing previous action. Advance the story with a new beat)". Stefan always types, so his original chat has no such message. Every later turn was typed.
  - Omniscience: replies 408–428 (11 replies) are clean. The first clear leak is 430: a patroller just in from the field says "you're 884, right? Hardpoint's miracle kid from Bed Nine", justified by an invented locker-room channel. It compounds in 432 (she knows of "whatever third-floor physical therapy trial Hale has you running") and 434 ("your green slip had 884's code pinned right beside his name"; this last channel follows from Hale's pre-406 line about Ellie's number going on paper). The test pressure does not mention Damon. Baseline: 3 clear leaks in 8 replies, the first in the first reply (407).
  - Pressure as an event: 420 (a records clerk arrives uninvited because the mainframe flags Damon's gain against Ellie's zero reading), continued in 422, and 436 (a Third Floor summons card for Ellie, following from the audit warning in 422). The header says a pressure becomes an arrival only when the user's character goes toward it; this narrator ignores that.
  - Pacing: 418 (the twelve-day Sledge manhunt ends by radio within the hour) and 428 (a third emergency arrives unprompted). New casualties arrive in most replies, as the card and Author's Note invite.
  - Tone: 420 and 422 are in the procedural register Stefan objected to at the original 420 (mainframe parsers, Section Four, File 302-M). 428 hands the untrained apprentice a splint and a nerve check, the over-competence Stefan objected to at 44.
  - The knowledge block rebuilt for 430 (`scripts/rebuild-knowledge-block.mjs` on the branch, ledger up to 428) lists Damon's recovery as "known only to" seven characters, not Halstead. No public fact names the recovery; the public facts name Sledge's capture and Hardpoint on scene.
  - Two counts, because the two arms were first scored by different rubrics. Strict (a character uses knowledge the block does not give them, whatever the channel; the block's header rules out "logs, records"): test 5 of 15 (420 and 422, the records clerk; 430, 432, 434), baseline 7 of 8 (all but 417). Lenient (replies that use a channel the story had set up, such as the clearance paperwork, do not count): test 0 to 3 of 15, depending on whether 430's locker-room channel counts, baseline 3 of 8 (407, 423, 425). Stefan rules which count applies.
  - The baseline's eight replies are five turns: 411 and 415 are one turn (415 is the rewrite), and 419, 423 and 425 are one turn (two rewrites). By turns the strict baseline is 4 of 5.
  - Stefan answered 407 in character. His first out-of-character stop after 406 was 412 (Koster's threat made no sense), and his first stop about omniscience was 426. "The baseline went wrong at its first reply" is the session's scoring, not his.
  - Correction, 2026-11-22: an earlier entry and the first report to Stefan gave the strict count as 3 of 15 against 8 of 8. The records clerk was missed in the test arm, and 417 holds no leak.
  - Not answered by C1: how much comes from the preset. One run per arm, with a different player in each, and one test turn (410, "Nobody knows anything") touched the topic. The only like-for-like pair is the first reply after 406.
- 2026-11-22: Stefan stated the goal (Why). Read-only checks on the original chat found the tracker keeping rejected replies, unstored corrections, a trigger shoved into a scene and the knowledge block keeping the secret in view (Facts). Stefan approved the second package ("ok then go"): C2 and C3 wait, C4 (corrections) and C5 (on/off) come first. The comparison runs of the C1 open question wait as well.
- 2026-11-22: C4 spec written, `docs/plans/2026-11-22-rejected-replies-design.md`. Stefan said "go" to its package:
  - Story Arc offers to take out the rejected span, and the player confirms.
  - The existing extraction recognises the rewrite request.
  - The whole span is ticked by default.
  - The new version is read again, at one call per confirmed take-out.
  - A replay of recognition on nine real cases comes before code.

  Stefan hid Aegis 419–424 himself: "I didn't want the wrong stuff to get stored in memory by SummaryCeption".
  - Correction to the Facts row "The tracker keeps what a rewrite rejected": f379 is recorded at 409, not 411, and 387 carries f354.

## Chapters

Order: C1 first, because its result decides whether C2 and C3 are worth building. Since 2026-11-22 C4 and C5 come next (Decided, items 6–9): a rejected reply that stays in the tracker brings the error back after every fix, and C5 measures whether Story Arc helps at all. C2 and C3 wait for C5. C2 before C3, because background's world facts are safe only once saga world facts are rules only.

- [x] **C1. The test** — branch the Aegis chat at 406, apply the test text from Facts, play 15–20 turns.

  - done = the status log records the branch name, the number of narrator replies played under the test text, and the message numbers of every reply in which a character uses knowledge the knowledge block does not give them. Only replies whose `lastSent` carries the test pressure count. The result is compared with the baseline row in Facts.
  - Completed 2026-11-22: 15 replies (408–436), all under the test pressure. Strict count 5 of 15 (420, 422, 430, 432, 434) against 7 of 8 in the baseline (4 of 5 turns); lenient count 0 to 3 of 15 against 3 of 8. Details in the status log.

- [ ] **C2. Saga planning rules** — the planner and the plan check apply the saga rules from Decided, item 2.

  - done = two sagas freshly planned in the Amy chat each have milestones that name no single event. No pressure names a non-protagonist character or a single event. Every world fact states a rule, not a situation. The unit tests pin the saga rule fragments literally.

- [ ] **C3. Focus semantics** — the injection follows Decided, item 3; ADR-0001 and the glossary entries Focus, Paused, Background and Spotlight are amended.

  - done = unit tests with literal expected sections show: a paused arc sends nothing, a saga in background sends its world facts and no premise or pressure, an act in background sends its title line only, and a spotlit act or saga is back in normal focus after its current milestone is fulfilled. A live check in the Amy chat shows the same for one spotlit act.

- [ ] **C4. A correction cleans up after itself** — when Stefan rejects a reply, what the tracker recorded from it is removed, and the rejected reply no longer reaches the narrator. Takes over "cleaning up a correction" from the tail of `keeping-the-story-on-track.md`.

  - Spec: `docs/plans/2026-11-22-rejected-replies-design.md` (Stefan: "go", 2026-11-22).

  - done = in the Amy chat, after an out-of-character rewrite request and the narrator's corrected reply, the ledger holds no fact, holder entry or meeting recorded from the rejected reply, the rejected reply is not in the next prompt, and the next knowledge block carries none of its content.

- [ ] **C5. Story Arc on against off** — the same turn of a story generated with Story Arc on and with it off, under a rubric fixed in the chapter brief.

  - done = the status log records the turn, the number of generations per arm, the rubric and each generation's score, and Story Arc's switches are back as they were.

Later chapters TBD after C5.
