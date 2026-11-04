# StoryArc NPC names: no reuse of names already in the story

**Status:** open · **Opened / last verified:** 2026-11-04 · **Scale:** three chapters, a few sessions

This is a goals document, not a spec; chapters go through the normal spec/plan workflow.

## Why

Stefan's need, in his words (2026-11-04): "The LLM invents characters and uses them. Then summaryception compacts and sometimes those characters either get removed from the context (if they were one off) or they are in the middle of the context. Problem: (especially Gemini Argon) - it brings up the names again."

His examples from the Paragon chat, some already renamed by hand: Julian Vance, Julian Sterling, Julian Stern (renamed to Solomon Stern), Vera Chen (renamed to Lin), Marissa Chen Vance, and Priya Mehta, "here the model even defaulted back to Priya Patel - a name it loves a lot". "It really loves its standard names."

The goal: "I want it to at least not reuse names or Surnames unless the characters are related - otherwise they blend into each other (like Julien Vance - operative at bellweather - the one with the cigarettes and Julian Sterlin (the vanguard)." And: "So the goal is to ensure those names don't get reused willy nilly because that breaks the story after compacting (we are still doing 2000+ message roleplays)."

That is the cost: two different people become one in the narrator's mind, and in a long chat the compaction makes sure the narrator cannot see that it already used the name. A preset can say "do not reuse names", but it cannot know which names are in use after compaction. StoryArc can, because the knowledge ledger already records every character who appeared, one-offs included. The feature is less "track NPC names" than "use the names StoryArc already tracks".

## Scope

In scope, three chapters:

1.  Prevention. The narrator is told which first names and surnames are already taken in this story, derived from the knowledge ledger, with the rule that a new character gets none of them unless the new character is related.
2.  Detection. When the extraction adds a character whose first name or surname is already taken, StoryArc flags it where the player edits the ledger, so the rename happens early.
3.  StoryArc's own planner. The planner and the plan check see the cast, and a colliding name in a generated plan is rewritten before the plan is stored.

Out of scope:

| Not in this work | Why, and where it belongs |
|---|---|
| Name blacklists, lists of the model's favourite names | Stefan: "Name blacklists and so on are out of scope - that can be handled in Authors Notes." |
| A model of who is related to whom | Relatedness is left to the narrator, which is told the rule and decides, as it did with Marissa Vance-Chen. Agreed 2026-11-04 |
| Renaming a character in the chat text | Stefan does that by hand, as with Solomon Stern and Vera Lin |
| Summaryception's compaction | Not StoryArc's; this work makes the names survive it, not the messages |
| Chats with the knowledge tracker off | No ledger, so no names to protect; consistent with ADR-0007 |

## Facts a new session must not re-derive

| Fact | Detail and how it was checked |
|---|---|
| What the ledger records per character | Id, name and aliases. Nothing else: no role, no relation, no "entered by the user" flag. Read from the Paragon chat file, 2026-11-04 |
| How a name enters the ledger | The extraction's NEW CHARACTERS task: "every character who appears or is talked about in the new messages and is not in the ledger under any name, with the other names the messages give them. Do not list a character the ledger already has under another name." The extraction sees the whole cast with aliases on every call (`prompts/extract-knowledge.txt`). The player can add, rename and alias a character in the Knowledge popup (`lib/ui/knowledge-popup.js`). Read 2026-11-04 |
| The register is imperfect | Paragon holds 75 records. A codename and a civilian name are sometimes two records (Aegis and Gabriel Marin, Fletchette and Vera Lin, Anvil and Kendra Osei, Switchback and Mateo Reyes, Overdrive and Brody) and sometimes one (Marcus Bishop with alias Sundown). Single-token records exist (Vance, Priya, Brody, Marco, Noor, Levi). Titles lead some names (Mr., Mrs., Dr., Judge, Commissioner, Capt., Señora, Uncle, Auntie). Surnames are hyphenated in four records (Vance-Chen, Vance-Hall, Vance-Sterling, Okafor-Banks). "Priya" carries no surname, so the ledger alone could not have caught "Priya Patel". Read 2026-11-04 |
| Collisions already in the ledger | First name Marcus three times (Marcus Chen, Marcus Bishop, Capt. Marcus Vance-Sterling). Surnames: Masters three times (the family), Sterling twice (Arthur, Julian), Park twice (Linney, Kevin), Miller twice (Chloe, Todd), Chen twice (Marcus, Ava) plus Marissa Vance-Chen, and Vance in four records. Some are related by design; the ledger does not say which. Counted 2026-11-04 |
| A rename drops the old name | Solomon Stern has the alias "Stern", not "Julian Stern". A name renamed away is not protected unless it is kept as an alias. Read 2026-11-04 |
| Where the cast is not seen | The harvester reads the lorebook, the character card, the persona, the last 50 messages and the existing arcs, never the ledger (`lib/context/harvester.js`). The plan check (ADR-0006) gets premise, direction, story block, secrets, triggers, pressures and fulfillments, no cast. The arc's own `characters` field is generated and read by nothing (`lib/injection/builder.js`, `lib/planning/generator.js`, `lib/knowledge/ledger.js`, grep 2026-11-04). The knowledge block prints only the present and talked-about characters, in-chat at depth 1 with the system role (`lib/knowledge/ledger.js`). No prompt anywhere lists taken names |
| Live evidence from StoryArc's own planner | The two re-plans of the Street act on 2026-11-04 produced "Julian Vance" (collides with Julian Sterling and the Vance family), "Toby Vance-Miller" in the first reroll, and changed Priya Mehta to Priya Patel in the cast list. The planner never saw the ledger |
| Cost of a taken-names block | Any changed byte of an injection is a full prompt-cache miss (ADR-0005). A list derived from the ledger changes only when a character is added, renamed or aliased |
| Cost of detection | A comparison in code when the extraction adds a character. No LLM call |
| Verification environment and chat rules | As in `docs/goals/act-drift-and-rulings.md`: CI runs the unit tests on every push and PR, live checks in the Amy chat only, Paragon is never a test chat and never written to, one `/code-review` pass, push on Stefan's go |

## Decided

| Decision | Stefan's words, 2026-11-04 |
|---|---|
| Names and surnames already in the story are not reused, unless the characters are related | "I want it to at least not reuse names or Surnames unless the characters are related - otherwise they blend into each other" |
| The reason is compaction in long chats | "So the goal is to ensure those names don't get reused willy nilly because that breaks the story after compacting (we are still doing 2000+ message roleplays)." |
| No blacklists | "Name blacklists and so on are out of scope - that can be handled in Authors Notes." |
| All three pieces: prevention, detection, and the planner with the plan check | "yes to your recommendations", to the question "Do you want all three, or prevention only?" with the three pieces as listed under Scope |
| Relatedness is left to the narrator | "yes to your recommendations", to "I'd leave relatedness to the narrator." |

## Open questions

- Does a name renamed away stay reserved, for example "Julian Stern" after the rename to Solomon Stern? Owner: Stefan. Unblocks the spec of chapter 1.
- How are first names and surnames derived from records with titles, single tokens, hyphenated surnames and codenames? Owner: the spec of chapter 1; chapters 2 and 3 reuse the derivation.
- Where is a detected reuse shown, the Knowledge popup, the progress card or both? Owner: the spec of chapter 2.

## Living rules

- Check off a chapter when its last ticket closes, with a dated completion line under it.
- Append dated entries to the status log below. Never rewrite history; supersede this document with a companion or handover document.
- Kickoff-brief contract. A chapter brief carries the rows below and nothing that lets a chapter skip the spec, plan and review cycle.

| A chapter brief carries | Detail |
|---|---|
| The chapter row | With its `done =` |
| The Decided entries | With their attribution |
| The standing constraints | The verification environment; Paragon is never a test chat; no extra LLM call; no blacklists; the spoiler rule: a name is never a spoiler, a plan's content is |
| The pointers | This document, ADR-0005, ADR-0006, ADR-0007, `docs/goals/act-drift-and-rulings.md`, the glossary entries Holder, Present and Talked about |
| The current measured state | From the Facts table |
| Never | A task list (the tickets' job); code or model sketches (the spec's job) |

Status log:

- 2026-11-04: opened after the discussion in a Fable session, right after the act-drift goals document.

## Chapters

Ordering: C1 defines how taken names are derived from the ledger; C2 and C3 reuse that derivation, so C1 comes first. C3 is independent of C2 and comes last because its collisions reach the story only through a plan, which is rarer than a narrator's reply. Later chapters TBD after C1 has run in Paragon with Gemini Argon; see Open questions.

- [ ] **C1. Prevention** — the narrator is told the first names and surnames already taken in this story, derived from the knowledge ledger, with the rule that a new character gets none of them unless related.
  - done = in the Amy test chat with the tracker on, the narration prompt carries the taken names derived from the ledger, the text changes only when a character is added, renamed or aliased, and with the tracker off it carries nothing.
- [ ] **C2. Detection** — when the extraction adds a character whose first name or surname is already taken, StoryArc flags it where the player edits the ledger.
  - done = in the Amy test chat, a new character with a taken surname is flagged after the next extraction, a new character with a free name is not, and no LLM call was added.
- [ ] **C3. The planner and the plan check see the cast** — a colliding name in a generated plan is rewritten before the plan is stored.
  - done = a plan generated in the Amy test chat against a seeded cast names no new character with a taken first name or surname, or the plan check rewrote it, with no extra call.
