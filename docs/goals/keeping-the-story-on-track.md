# StoryArc: keeping the story on track

**Status:** open · **Opened / last verified:** 2026-11-09 · **Scale:** six chapters, several sessions

This is a goals document, not a spec; chapters go through the normal spec/plan workflow.

## Why

Stefan's description of what Story Arc is for (2026-11-09): "StoryArc is not a generalized memory system - lorebooks and summaryception are for that. It keeps track of the details that keep the story on track so you don't have to course correct every few messages via OOC."

The cost when it fails, in his words (2026-11-08): "I'm getting a bit exhausted. The last correction I had to make - those complete continuity fuckups and misunderstandings of basic connection .... do I really have to OOC direct every single message?" And why each slip weighs more than it looks: "since its pretty good, I'm in the suspension of disbelief zone and fuck ups rip me out. So I'm reacting more negatively to errors because the baseline quaility is very good."

The largest single source he named: "if the planned story arc is bad, it derails the whole story. And since the Arc is not written by me but by an LLM, that is a real problem of happening. Especially if the returned wording implies stuff that ovverides the preset."

The incidents behind this document, all in the Paragon chat:

- Message 3027 (since regenerated): Levi called Sofia Vega "the mouth-scar female" though he had never seen her. Her scar was only in the lorebook's cast entry.
- Message 3023: Vasquez, an ally since the October 14 scene, tied her help to a vault keycard and a blood match and walked off when Ellie refused.
- Message 3051: Sofia produced a "SWORD Parahuman Registry" form and ordered an adult Defender around. The same correction ("Sofia IS NOT GABRIELS COMMANDER") had to be made again at 3054 and 3070.
- Message 3069: Tanya, a PR coordinator, held a signed agreement in front of Ellie to pull her out of school.

## Scope

In:

- Plan text that steers the narrator: what a plan may say, what reaches the prompt, how a plan with bad wording gets corrected.
- Continuity details the narrator gets wrong when they drop out of view: who has met whom (shipped), how characters stand with each other (stance).
- The player's corrections: a ruling made once in OOC stays made.
- Seeing what Story Arc sends (#83).

Out:

- General memory and recall: lorebooks and Summaryception.
- Features borrowed from other projects without an incident of their own. Stefan: "I don't want StoryArc to become a kitchen sink extension … I want to keep the focus tight if possible"; and "We did the discussion because I had a specific need that appeared in the roleplay."
- Changes to the player's own stack (preset, Author's Note, Summaryception settings). They were discussed and are his calls.

## Facts a new session must not re-derive

| Fact | Where it was verified |
|---|---|
| Acts and sagas at normal focus send only GENRE, PREMISE and STANDING PRESSURES to the narrator. Spotlight adds secrets, triggers and clues. Tone, directives and anti-patterns are printed only in the episode section. No Paragon arc's directives were ever in the prompt. | `lib/injection/builder.js` (`buildMilestoneSection`, `buildEpisodeSection`); the Paragon plan block rebuilt from the chat file, 2026-11-09 |
| The plan's own wording decides whether the narrator invents coercion. Contract-clause pressures: 6 of 6 replies fail without a rule. Lever-and-cost pressures: 0 of 3, with the same GENRE line. The ranking line and removing the GENRE line changed nothing. An explicit rule in the Author's Note at depth 1 beats bad wording, 0 of 3. | Amy chat test, 2026-11-09, three replies per condition; `docs/plans/2026-11-09-plans-state-the-situation-design.md` |
| The extended plan check rewrites contract-clause pressures and trigger actions into lever and cost (2 of 2), and leaves a military arc alone with a one-line direction (0 of 2) and with an explicit one (0 of 1). It judges a power by the setting: an officer commands soldiers, an employer does not own an employee's free time. Two earlier wordings failed: counting the premise rewrote nothing; resting on the direction rewrote legitimate orders when the direction was one line, because a fresh plan's check gets no story messages. | Live calls of `check-plan.txt`, 2026-11-09; ADR-0009; design note, Risks |
| Stance experiment, in a separate test chat: Mara's ally history (on-screen, then hidden and replaced by an events-only summary, with an agenda pointing elsewhere) did not turn her coercive in 0 of 3 replies without a stance line. She never mentioned the history either. Per the reading fixed beforehand, this scene gives no case for stance, and the stance condition was not run. A first run in the main Amy chat was invalid: its summary contradicted the on-screen story, and the narrator followed the story in 3 of 3. | Chat "Amy - 2026-11-09@08h40m16s679ms", 2026-11-09 |
| A world fact in an act's section beats contract-clause pressures: 0 of 3 failed with "WORLD FACTS (true in this story; keep every scene consistent with them): - Amy's employer cannot make her work outside her shifts …", against 3 of 3 without it. In those three replies Greg Masters' daughter (an old "Ellie Masters" ledger record) appeared, unexplained. | Main Amy chat, reply 54 swipes 12-14, 2026-11-09; implementation plan, Test |
| The planner gets the character card, persona, lorebook, the last 50 messages, the other arcs and the cast. It gets no Author's Note, no preset, no OOC rulings. | `lib/context/harvester.js` |
| A re-plan keeps title, direction, the premise unless the player takes the proposed one, completed beats, planted clues, fired triggers and the revealed secrets. It replaces directives, anti-patterns, tone, themes, escalation and the open road, and plans the unrevealed secrets again (ADR-0003 amendment, later 2026-11-09). | `lib/planning/replan.js`, ADR-0003 |
| An unrevealed secret has no copy in the knowledge ledger. A fact is created only at the reveal, linked by `{ arcId, secretId }`. | `lib/knowledge/ledger.js`, `applyExtractionAnswer` |
| The `relation` detail is kinship only, one history per character. Ellie is recorded as Diana's daughter, not Paul's. | `prompts` text in `lib/knowledge/ledger.js`; the Paragon ledger |
| SillyTavern's Author's Note injects the text of its panel textarea, not `chat_metadata.note_prompt`. | `public/scripts/authors-note.js`; one test reply went out without the note |
| Summaryception's summarizer skips hidden messages, so `/hide` keeps a rejected turn out of the prompt and out of later summaries. | `src/core/chatutils.js` (`isSummarizerConversationMessage`) |
| Summaryception's continuity block holds at most 4 `[R]` rules, hard-coded. It runs one audit per reply. After a gap it reads only the last 4 unaudited exchanges. Its bonds were empty in all 852 audits of Paragon. Vasquez's agenda stayed "Track the escaped Berth 14 construct …" from message 2737 to 3030. | `src/foundation/prompt-constants.js`, `src/core/continuity-coverage.js`; the Paragon chat file |
| State left behind: Paragon messages 3023–3032 and 3051–3055 are hidden. In the main Amy chat, message 54 is the last message and carries 15 test swipes (0–11 the ranking test, 12–14 the world-facts test); the invalid stance run's messages 55–56 were removed; the test arc "Ranking Test: The Night Shift" is abandoned, not deleted. The test chat "Amy - 2026-11-09@08h40m16s679ms" keeps its scripted history, has Steve locked as persona, and can be deleted. | Chat files, 2026-11-09 |
| `scripts/rebuild-knowledge-block.mjs` prints the knowledge block the narrator got at a given message of a chat file. | `docs/architecture/code-index.md` |

## Decided

| Decision | Settled by | Pointer |
|---|---|---|
| A plan states the situation, never how to narrate: world facts, power and wants may stay; tone, pacing, emphasis, portrayal and what to show stay out; genre and tone steer generation only; someone who presses uses leverage the setting gives them | Stefan's rulings, 2026-11-09 | ADR-0009 |
| The genre leaves the injection | Stefan: "The style should not influence the main chat (eg. the style tags should not appear in the story) - its only to steer what and how the arc gets generated" | ADR-0004 amendment, PR \#84 |
| New plans carry `worldFacts`; directives and anti-patterns are no longer sent for any arc; a re-plan is the conversion | Stefan: "yes to both" (2026-11-09) | design note, Part B |
| A re-plan offers to rewrite unrevealed secrets, old and new side by side; changes ADR-0003 when it ships | Stefan: "yes to both" | design note, Part C |
| Trigger actions and clues state a consequence the world allows, as lever and cost; never tone, pacing or portrayal | Stefan: "yes" | shipped in 7630f2b |
| The ranking line ships only if a test supports it; the test showed no effect, so it did not ship | Stefan: "yes but test it in the Amy chat?" | design note, Test |
| Fixes are story-agnostic | Stefan: "Proposing a fix only for THIS STORY is kinda boneheaded when the extension is Story-agnostic." | ADR-0009 |
| Corrections happen through OOC messages, not deletes or swipes; `/hide` is in use | Stefan: "I can't deleted messages in the midst of a conversation in ST. Swiping is a bad idea because it breaks the cache." | this document |
| No feature without an observed need in play; the two Molfar Vertep ideas without an incident (a player-armed push, commitments in the ledger) are out; the view of what Story Arc sends is in | Stefan: "I think thats the only valid feature" | \#83 |
| Tests run in the Amy chat | Stefan: "use the Amy chat for a test?" | this document |
| Pressure stays implied, and every choice costs | Stefan: "I'd prefer the pressure to not be spelled out - that way Ellie has the choice. There is a cost with every choice though ... Its very important that this is handled in a mature way and not ... blunt." | planner leverage rule, b2a6b11 |
| World facts in act and saga sections too (at most about three); the old-arc notice only on episodes, no clear button; secret rewrites from the plan check, as proposals on a re-plan; the bare-preset trade-off accepted | Stefan: "yes, write the plan and run the test" (2026-11-09), the world-facts test passed | implementation plan |

## Open questions

| Question | Owner | Unblocks |
|---|---|---|
| Reword GOALS.md around Stefan's definition ("keeps track of the details that keep the story on track")? Proposed, not confirmed. | Stefan | GOALS.md |
| Standing rulings: where they are stored and how the player confirms one. The Author's Note route was ruled out by the story-agnostic ruling. | Stefan | C5 spec |
| Stance: build it? The experiment ran (Facts); no case from that scene, and the ally acted like a colleague, never mentioning the shared history. | Stefan | C6 |
| Summaryception's continuity tracker: keep it on, switch it off, or try it off in a branch. Stefan: "I'm unsure to be honest." | Stefan | Nothing in Story Arc; his stack |

## Living rules

For this document:

- Check off a chapter when its `done =` holds, with a dated line.
- Append dated status entries to the Status section above the chapters. Never rewrite earlier entries.
- Supersede this document with a companion or handover document, not by rewriting it.

For a chapter brief (the kickoff-brief contract):

- It carries the chapter row with its `done =`, the decisions with attribution, the standing constraints (story-agnostic, tests in the Amy chat, no feature without an observed need), the pointers (ADRs, the design note, issues) and the current measured state.
- It carries no task list (the tickets' job) and no code or model sketches.
- It has no wording that lets a chapter skip its spec/plan cycle.

## Status

- 2026-11-09: C1 complete. The stance experiment ran (C6 facts row): no case for stance from that scene; C6 waits on Stefan's decision. The plan check's exception was reworded after a thin-direction test and re-checked on five calls.
- 2026-11-09: the four design-note questions answered; the world-facts test passed (0 of 3); implementation plan for C2 and C3 written.
- 2026-11-09: C2 and C3 complete (PRs \#85, \#86). The code review found nine points; seven were fixed before merge. Acts and sagas print at most three world facts, by ruling. A re-plan keeps the current premise unless the player picks the proposed one, so an old premise with bad wording stays until then.
- 2026-11-09: C7 opened. The Gilded Pedestal was fixed by hand twice in one evening (world facts "uncertified minor Ward" next to the cast's age 18, "predatory fixation from peers, superiors, and VIPs alike", "coerced sexual compromises"; a "plaything" pressure). Stefan: "we are currently 'fixing' the story? This is something I should not have to do with you." Genre and Themes were split the same day (ADR-0004 amendment).
- 2026-11-09: C7 complete (951141d). The Gilded Pedestal in Paragon was fixed by hand once more before it, as the manual version of what the question step now produces.

## Chapters

Order: C1 finishes what shipped. C2 and C3 complete the plan-format change while its evidence is fresh. C4 makes every later diagnosis cheap. C5 removes the correction Stefan repeated most. C6 waits on its experiment. C7 moves the intent interview the player had with Claude into the wizard, so plans stop needing hand fixes.

- [x] **C1. Plan wording (Part A)** — the planner and the plan check apply the leverage rule (7630f2b), and the genre leaves the injection (PR \#84).
  - done = PR \#84 merged, and the Paragon plan block rebuilt from the chat file carries no `GENRE:` line.
  - Completed 2026-11-09: PR \#84 merged (a0f8fa9); the Paragon plan block rebuilt from the chat file opens each act with its header and premise, no `GENRE:` line; CI green.
- [x] **C2. World facts (Part B)** — `worldFacts` replace directives and anti-patterns, and tone, directives and anti-patterns leave the prompt. Spec: `docs/plans/2026-11-09-plans-state-the-situation-design.md`. Plan: `docs/plans/2026-11-09-plans-state-the-situation.md`.
  - done = a freshly planned arc in the Amy chat has world facts and no directives, and its injected sections carry no `TONE:`, no directives and no anti-patterns.
  - Completed 2026-11-09: PR \#85 merged (133d2a0). The fresh episode "Salt, Flour, and Stolen Hours" in the Amy chat got four world facts, no directives or anti-patterns, and its section has no `TONE:`, `DO NOT:` or `DIRECTIVES:`. A re-planned old episode got world facts, and its notice went away. CI green.
- [x] **C3. A re-plan rewrites unrevealed secrets (Part C)** — same spec, ADR-0003 amendment. Plan: `docs/plans/2026-11-09-plans-state-the-situation.md`.
  - done = a re-plan in the Amy chat proposes a rewrite for an unrevealed secret, shows the old text and its planted clues, and stores the rewrite only when the player takes it.
  - Completed 2026-11-09: PR \#86 merged (b2df77d). A re-plan of the ranking-test act proposed lever-and-cost wording for a contract-addendum secret, next to the stored text and its planted clue. Taking it stored the new wording; id, holders and reveal phase stayed, and no proposal stayed in storage.
- [ ] **C4. The view of everything Story Arc sends** — \#83.
  - done = \#83 closed.
- [ ] **C5. Standing rulings** — an OOC world ruling becomes a confirmed rule that stays in the prompt.
  - done = in the Amy chat, an OOC ruling is offered as a standing rule, the player confirms it, and it is in the prompt of the next reply and of a reply 50 messages later.
- [ ] **C6. Stance** — how characters stand with each other, recorded when the story shows a change.
  - done = the stance experiment has run and its result is recorded here, with Stefan's decision on building it.
- [x] **C7. Story Arc asks before it plans** — a question step in the wizard captures the author's intent (how pressure works, how dark, whether allies can step in, the inner conflict, hard lines), and the plan check gains the cast's details and rules against contradictions, sweeping claims in world facts and a register that contradicts the stated intent. Branches `feature/author-questions`, `feature/plan-check-intent`.
  - done = in the Amy chat, an act planned from a one-paragraph direction plus the question step's answers carries no contract, order, rescuer or sweeping claim the answers rule out, and no world fact contradicts a cast detail.
  - Completed 2026-11-09: merged on main (951141d), CI green. In the Amy chat a one-paragraph direction ("most requested unit… desired by powerful people… hidden dangers and exploitation") got four intent questions (how control works, what clients hire her for, Steve's role, how far and the hard lines). With answers in Stefan's register, the act "Velvet Queue Priority" carries only deniable leverage: world facts "Elite clients never force or openly demand anything from a unit" and "looks away from whatever happens during private patronage", pressures "declining is completely allowed but quietly costs standing and protection"; no contract, order, rescuer or claim about everyone. The live run used the code before the ten code-review fixes; the merged code was smoke-checked (wizard opens, no errors).

Later chapters TBD after C4 and C5: cleaning up a correction (offering to hide a corrected span), and editing meetings in the Knowledge popup (#82). Two ideas from the session are not ruled on and have no chapter yet: rulings against any arc field, not only the premise and pressures; and a plan check that also tests the plan for internal consistency.
