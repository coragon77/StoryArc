# Long-Term Memory in the Knowledge Block — Design Note

- **Date:** 2026-11-17
- **Status:** Built 2026-11-17 on Stefan's "implement it please", without a separate implementation plan. The two open questions were not answered explicitly; both were built as recommended (an OOC reminder sets the state; the seed runs automatically) and are his to overrule. The replay decided the fill order: fewest facts first, `KNOWLEDGE_FACT_BUDGET` = 5600 (4085: Jalen's promise and the dock story in, 10,727 characters against 11,472 before; 4063 and 4065 about 3.5k and 4.6k smaller). Standing state is off by default (`knowledgeTracker.standingState`). Not built: an update record for a seed.
- **Builds on:** ADR-0007 and its amendments (character details, meetings, appearance), `docs/plans/2026-11-11-character-appearance-design.md`
- **ADRs touched:** `0007` (Story Arc tracks who knows what), as a new amendment
- **Glossary:** `GLOSSARY.md`: Standing state (new), Stance (new), Knowledge block (changed)

## Problem

Story Arc is meant to let the player run a very long roleplay without
keeping the story straight by hand. At 4,000+ messages in the Paragon chat
that breaks. The player corrects the narrator constantly: 146 of their
messages between 3089 and 4088 carry an OOC note. Many of these are the
player doing the memory job by hand ("Please ensure Gabriels personality
does not drift from his description", "Continuity check—Vera was at
St. Hilda's boarding school since age six", "please don't break the
continuity").

The knowledge block was built to stop characters knowing what they
shouldn't (ADR-0007). It was never built to carry what the narrator has
lost, and the numbers show it (read-only, 2026-11-17, block sent at
message 4088):

- **The block is 15,088 characters.** The "Has met" lines take 4,278 (28%).
  1,451 of those are unnamed extras ("the bearded cyclist", "the two college
  girls in the painted KPIX foam visors").
- **The same fact is printed several times.** The 31 "Knows" lines hold 14
  distinct facts. A fact five present characters share is printed five times.
- **Most of it is already in the chat window.** 19 of the 31 "Knows" lines
  are facts learned in messages 4032–4088, the only ones the narrator still
  has word for word (Summaryception hides the rest with `is_system`).
- **Older facts never reach the narrator.** Each list prints only the five
  newest facts (`KNOWLEDGE_LIST_CAP`). Ellie holds 1,250 facts and Vera 542.
  Facts the player had to restate were ranked 11 to 279 in their holder's list.
  Jalen holds only 31, but his promise to keep the dock story secret (f1396)
  was 15th and never sent.

The OOC notes say what kind of memory is missing. Sorted by kind, about as
many corrections are about **how someone is now** as about what happened:
Vera's personality and her change since October 22, Gabriel's voice, Ellie's
body and fighting style since the island, how Gabriel and Vera stand
toward each other. None of
these is one event the fact list could carry. The 2026-11-15 wardrobe case
(Vera reverting to the prefect uniform) is the same kind.

Two cases show the limit of any prompt change: at 4065 the narrator was
given the Saturday patrol (f1445) and still invented schedule conflicts, and
at 3836 Dramatis Personae, which is always on, said "Marco is Ellie's easygoing
ex" and the narrator still used Marco as a lacrosse extra. A better block
raises the odds; it does not guarantee.

## Decisions (Stefan)

- **2026-11-15, direction.** "StoryArc is supposed to allow me to do a very
  longform roleplay consistently (plotthreads, knowledge and so on)." The
  narrator gets the older facts that matter, not only the newest five.
- **2026-11-15, the concern.** "I'm mostly concerned about facts that need
  to be kept in details - like personality, outfit, status etc." A character
  who changed over an arc must not revert.
- **2026-11-17, rejected: showing the player the contradictions.** "I don't
  want the extension to show me where it fucked up - the goal is for
  StoryArc to do this in the background so the user can focus on writing
  the story." Everything here runs in the background. No review queue, no
  acceptance step, no warnings to act on. The Knowledge popup stays the
  place to correct the ledger, as it is today.

## What changes, in one paragraph

The ledger gains **standing state**: three new character detail kinds
(style, manner, stance toward someone) that the extraction keeps up to
date, under the existing rule that a detail changes only when the story
shows it changing. Characters that already have a long history get their
first state from a one-time background call over their ledger facts. The
knowledge block prints the state of every present character, prints each
fact once with its holders instead of once per holder, drops the unnamed
extras from "Has met", and spends the space this frees on older facts.
The block does not grow.

## Part A — Standing state

### The kinds

Three kinds form a third list, `STATE_KINDS`, next to `DETAIL_KINDS` and
`APPEARANCE_KINDS`, behind their own switch under character details, as
appearance is. They are lasting, not about one scene:

- **style**: how the character dresses and presents now, as a lasting
  habit, never one scene's outfit. Vera: "fitted and feminine since Oct 22;
  no longer the prefect uniform".
- **manner**: how the character behaves now, written as behaviour the
  narrator can play. Vera: "soft, eager to be of use, persistent when she
  wants something; more at ease in her body". Lasting abilities and changes
  belong here too. Ellie: "since the island: near-perfect body control;
  fights close, grappling".
- **stance**: how the character stands toward one other character, like
  `relation` but about feeling and conduct, not kinship. Vera → Ellie:
  "devoted to her; stays close as her assistant, asks for tasks".
  Gabriel → Vera: "close through Ellie; at ease with her".

A character can hold a stance toward several others. `details.stance` stays
one history array, as every kind is, so the rollback loops and
`scripts/rebuild-knowledge-block.mjs` (which call `.filter` on each kind)
keep working. Each stance entry carries `of`, the other character's id, as
a relation entry does. The current stance toward someone is the last entry
with their `of`. Every other rule of character details holds unchanged:
story entries roll back with their message, a player entry from the popup
locks the kind (for a stance: toward that one character), and an absent
kind is unknown. StoryImage reads `details` by named kinds only
(`lib/cast.js`) and is unaffected.

### When a value changes

The rule that keeps details from drifting stays: **a value merely stated
differently is not a change.** When the narrator writes Vera strict and
prim again, that is the drift this feature exists to stop. The stored
manner stays, and the next block tells the narrator again.

State changes gradually, so "an on-screen event" is widened for these kinds
to **a turning point the story shows**: a decision, a confession, a
lasting choice, a scene that ends a phase ("Vera tells Ellie she won't go
back to the uniform"). The extraction gives a short quote from the new
messages for it, and the code checks the quote is in the text
(`findQuoteInText`, as for rulings and beat completions). An item whose
quote is not found is dropped. A refinement that keeps every word of the
stored value replaces it without a turning point, as for appearance.

### The player's word

Today "Out-of-character lines set no detail." For the state kinds only,
**an OOC line of the player that states how a character lastingly is or
stands sets the state**: a reminder or correction ("Vera is still …",
"Gabriel's personality does not drift from …", "from now on …"). A scene
direction does not, even when it describes the character: "[OOC: Ellie is
feeling very bratty tonight]" is about tonight. The extraction quotes the
line and the code checks the quote, as for a turning point. It is stored as
a story entry with the player message's index and id, so it rolls back with
that message. It is not a lock: the story can still change it later by a
turning point. This turns the player's reminders into memory, so each is
said once. (Open question 1.)

### Extraction input and output

The extraction prompt shows a character's state only when the new messages
name them, in the section split out for the appearance of named characters
(6823d12), not in the characters list. The characters list is part of the
stable prefix the provider caches; state that changes there would break the
cache on every update. The input grows only for the cast on screen. Task 8 lists the three kinds, the turning-point rule
and the quote. The answer's `details` items gain `quote` for these kinds and
`of` for a stance. No call is added.

### Seeding existing chats

A long chat has no state yet. The Paragon ledger starts at message 2129;
Vera's arc since October 22 is in her 542 facts and nowhere else that
updates. So the first time a character with many facts is present and has
no state, Story Arc runs **one background seed call** for them:

- **Who:** a present character holding at least `STATE_SEED_MIN_FACTS`
  facts (proposed 40; Jalen's 31 are printed in full anyway, Part B) and no
  state of any kind. At most one seed per reply, after the extraction, so a
  scene with five new characters seeds over five turns.
- **Input:** the character's facts, newest first, up to a budget (proposed
  ~24k characters, ~6k tokens); their details and appearance; their entry in
  the always-on lorebook entries if one names them (read-only).
- **Output:** style, manner, and stances toward the characters they share
  the most facts with. Each is stored as a seed entry
  `{ value, at: null, by: 'seed' }`, shaped like the record entry an unnamed
  relative is created with: it survives every rollback and locks nothing.
  A story entry anchored to the newest message it drew on would go with a
  swipe of that reply and trigger another seed call. Later turning points
  and player entries append after it as usual. No acceptance step, per the
  2026-11-17 ruling. The popup shows and edits it like any detail.
- **Profile:** the tracker's connection profile (8444f41).
- **Failure:** a failed or unparsable call stores nothing and is retried
  the next time the character is present, at most three times per chat
  session.

## Part B — The knowledge block

### Each fact once

Facts move out of the per-character sections into one list, each fact
printed once with who holds it:

```
WHAT THE CHARACTERS HERE KNOW (a character not named on a line does not know it)
- Jalen Briscoe swore on his starting spot to keep Ellie Masters's harbor rooftop chase story secret … — known only to Ellie Masters and Jalen Briscoe
- Ellie Masters offered to teach Jalen Briscoe the ten-foot drop on Sunday … — known to Ellie Masters, Vera Lin, Jalen Briscoe, Dez Hargrove and Vaughn Stoddard (nobody else)
```

The holders named are all holders, covered or not, as "shared only with"
does today, and "told by" stays where it applies. The "Has told only …"
lines of a talked-about character stay in that character's own section:
they are about what the absent character passed on, not about who in the
scene knows it. The header changes from
"Each character knows only their own list" to the per-line rule. This is
the one change to the block's wording, so it gets the live check (Tests).

### Which facts

One budget for the fact list, `KNOWLEDGE_FACT_BUDGET`, starting at what
today's fact lines take (about 6.8k characters at 4088). Every covered
character first gets up to five facts, as today. The rest of the budget
goes to older facts.

The order in which the rest is filled is the one open parameter, and the
replay decides it. Plain rounds (each character's next-newest fact in
turn) are not enough: with five characters in the 4085 scene, reaching
Jalen's 15th fact takes about 75 lines, roughly 16k characters. Two
candidates to replay:

- **Fewest facts first:** characters with the shortest lists get their
  next facts first, so Jalen (31) and Dez (6) are printed far back before
  Ellie (1,250) gets more.
- **Facts few people hold first:** among each character's older facts,
  those with the fewest holders come first. A promise between two people
  ranks above a scene everyone saw, which the chat window and
  Summaryception are more likely to still carry.

The acceptance criterion is the replay (Tests): at 4085 the block reaches
f1396 and f1398 and does not grow. If no order meets both, the replay
reports how much the budget has to grow, and that goes to Stefan before
the plan. For Ellie and Vera either order reaches only a few dozen facts
back, not hundreds. Their older history is what standing state carries.
Keyword relevance is not
used: on the 4085 turn it ranked noise first and missed f1396–f1398, and
its candidate set depends on who was present, which the ledger cannot
recover for older turns.

`EVERYONE KNOWS` keeps its cap of five.

### The state lines

Each present character's section prints the state after the details and
appearance:

```
VERA LIN (present)
- Details: …
- Style: fitted and feminine since Oct 22; no longer the prefect uniform
- Manner: soft, eager to be of use, persistent when she wants something
- Toward Ellie Masters: devoted to her; stays close as her assistant, asks for tasks
- Has met: …
```

A talked-about character gets their stances toward present characters only,
not style or manner, for the reason appearance is present-only.

### Has met

Unnamed extras (a name starting with a lowercase word: "the bearded
cyclist") leave the "Has met" lines. They are kept in the ledger and the
popup. The guard the line exists for, a named character recognising a face
(ADR-0007, 2026-11-08), is unchanged.

### Size

Net, the block should not grow: roughly 3.5k characters freed by printing
facts once (31 lines held 14 facts at 4088; the holder list each line keeps
costs some of that back), 1.4k by the extras, against roughly 150–300 characters of state
per present character. The replay measures it; a block larger than today's
on the replay turns is a failed acceptance criterion, not a tuning note.

## Cost

- **Every reply:** no new call. The extraction input grows by the state of
  the characters the new messages name (est. 200–600 tokens), and its
  answer by the rare state item.
- **Once per long-history character:** one seed call of ~6k tokens input.
  The Paragon chat would seed perhaps 10–15 characters over its next
  scenes. This is the one new cost.
- **Narrator prompt:** no growth (Size).

## Changes outside the code

- ADR-0007: amendment "the ledger also keeps standing state", with the
  turning-point rule and the player's OOC word; and "the block prints each
  fact once".
- `docs/goals/GOALS.md`: ADR-0007 reversed "Not a memory/summarization
  system" only for who knows what. Standing state and the seed widen that to
  how characters are now, so the goals say so: Story Arc keeps the story's
  continuity for the narrator (who knows what, and how each character is
  now), and still does not summarise the story or manage lorebooks.
- `GLOSSARY.md`: Standing state, Stance; Knowledge block updated.
- `docs/architecture/architecture.md`, Knowledge Tracker: state kinds,
  seeding, block format and selection; `code-index.md` if a file is added.
- `prompts/` or the in-code task 8 text: the new kinds.

## Tests

Unit tests (`bash tests/run.sh`), with expected values written out by hand:

- A state item whose quote is not in the message is dropped; one whose quote
  is found is stored with its index and id.
- A stated different manner with no turning point does not change the
  stored value.
- An OOC line of the player sets a state kind and rolls back with its
  message; it does not set any other kind.
- A seed entry survives the rollback of every message and does not lock the
  kind: a later turning point appends after it.
- A stance toward one character is replaced by a newer entry with the same
  `of` and left alone by one with another `of`.
- The fact list prints a fact shared by three covered characters once,
  with all its holders.
- The round-robin fill: with a small budget, a character with 3 facts
  prints all 3 and a character with 50 prints 5; with more budget the large
  holder gets more, newest first.
- Unnamed extras are left out of "Has met"; named characters stay.

Offline replay on the Paragon chat file (read-only script in `scripts/`,
built on `rebuild-knowledge-block.mjs`):

- At 4085 the block contains f1396 and f1398, and is no larger than the
  block the current code rebuilds for the same turn.
- The same size check at 4063 and 4065, the two other turns with a
  recoverable scene.

Live check in the Amy test chat (never Paragon): switch the state kinds on,
play a scene that shows a turning point and one that only restates, read
the result in "What the narrator gets" and the update log. The seed is
checked there on a character with enough facts, or with a lowered threshold.

## Risks

- **The extraction records the narrator's drift as a turning point.** The
  quote check proves the words are there, not that they are a turning point.
  The prompt wording carries that, and the live check tests it. The popup
  lock stays the player's fix, as for every detail.
- **The seed writes canon from hundreds of facts in one call.** A wrong
  stance would be told to the narrator every turn. The seed reads the ledger,
  not raw chat, so it summarises what the tracker already accepted.
- **The new block format confuses the narrator about who knows what.** The
  per-line holder list is more explicit than per-character lists, but the
  narrator has been reading the old format for weeks. The live check
  compares a secret-keeping scene in both formats.
- **The extraction reads a scene direction as lasting state.** Most OOC
  notes are scene directions that also describe a character ("Ellie is
  feeling very bratty tonight"). Read as state, one evening's mood would be
  told to the narrator for weeks. The prompt draws the line (lasting
  statements only); the live check plays both kinds of note.
- **The narrator ignores what it is given** (4065, 3836). Not fixed here.

## Not in scope

- Checking or rewriting a reply after it is written. Silent rewriting
  breaks the read-only rule (GOALS.md) and adds a generation per turn; a
  shown check was rejected on 2026-11-17.
- Keyword or embedding relevance for facts.
- World rules (how Ellie's power recharges, what the mask does). They belong
  in the lorebook, which Story Arc does not edit.
- Summaryception's own prompts and the other extensions' status lines (the
  "💰 Currency" line at 3899 is not Story Arc's).
- The "Has met" popup editing (issue #82).

## Open questions

1. **Does a player OOC line set the state?** Recommended yes, as above, so
   each reminder is said once. The alternative keeps "OOC lines set no
   detail" and leaves the player's reminders as one-turn instructions.
2. **The seed.** Recommended: automatic, at most one per reply, about 6k
   tokens per character, once. The alternative is no seed: state then fills
   only from turning points from now on, and Vera's past change is missing
   until the story or the player restates it.
