# Character Appearance in the Knowledge Ledger — Design Note

- **Date:** 2026-11-11
- **Status:** Rulings by Stefan 2026-11-11 (relayed from the StoryImage session: "Perfect, lets go with your recommendations then"; the three open questions: "yes to all three recommendations"). Part A (the appearance kinds) and Part B (the appearance search) built together on 2026-11-11; the search reads the persona, card and lorebooks too since the same day (Part B, "The definitions"). Implementation plan: `docs/plans/2026-11-11-character-appearance.md` (one deviation: `extractKnowledge` filters appearance items while the switch is off, instead of a `withAppearance` parameter on the apply).
- **Builds on:** spec issue #50 (character details), issues #52 (restatements), #53 (rollback) and #54 (details in the popup)
- **ADRs touched:** `0007` (Story Arc tracks who knows what), as a new amendment
- **Glossary:** `GLOSSARY.md`: Character details (extended), Appearance (new), Refinement (new), Appearance search (new)

## Problem

StoryImage, a sibling extension that only reads StoryArc's ledger, draws
story images. It keeps a stored, locked look for each character. Its look
scan read only the 15 newest messages that mention a person. In a
3,000-message chat, that misses how long-known characters were described.

In the Paragon chat, Priya's look ("dark glossy curls, warm brown eyes",
"five-two to Ellie's five-five", "warm brown skin against Ellie's flushed
pink") sits hundreds of messages back (#140, #520, #770, #2825). Her stored
look came out nearly the same as Ellie's, and the image model mixed the two
up.

StoryArc's knowledge extraction already reads every reply and keeps a
history per character detail. It is the one place that sees a description
when the story writes it. The narrator benefits too: eye colour and hair
drift once Summaryception has compacted the history, for the same reason
the details drifted (spec #50).

Two facts shape the design:

- **Most of a long chat is hidden.** 3,258 of 3,294 Paragon messages are
  `is_system: true`, hidden by the summary extension. The introductions sit
  there. The forward extraction reads each reply once, while it is still
  shown, so it is unaffected. A search of an existing chat has to read hidden
  messages.
- **The extraction input is already large.** The Paragon ledger has 148
  characters. The `{{CHARACTERS}}` list of the extraction prompt is about
  9.5k characters (~2.4k tokens) today. A ~135-character look on a quarter of
  them would add ~1.3k tokens to every extraction, and on half of them
  ~2.5k (measured read-only on 2026-11-11, without an LLM call).

## Decisions (Stefan, 2026-11-11)

Settled in the StoryImage session:

1. **StoryArc stores appearance as character details.** They are written
   when a character is introduced, and changed when they change in the story,
   like a new haircut. Stefan: "What if the StoryArc extension (who already
   stores some info about characters) also stores stuff like ethnicity, hair,
   eyes and so on? Not the outfit though. … the data is written when the
   character is introduced and changed if they change in the story (like a
   new haircut)?"
2. **No clothing.** Same quote.
3. **Plain words, not image tags.** The story's own words are stored
   (`hair: dark glossy curls, about shoulder length`). StoryImage turns them
   into its own approved tags and never prints StoryArc's values directly.
4. **Never invent.** A feature the story never states stays unknown.
5. **The appearance search runs per character, in the Knowledge popup**, not
   from a global button, after the kinds are in place.

Settled on 2026-11-11 for this spec ("lets go with your recommendations"):

6. **Six kinds, in their own list.** `ethnicity`, `skin`, `hair`, `eyes`,
   `build` and `features`, kept in `APPEARANCE_KINDS` apart from
   `DETAIL_KINDS`. They are not called `marks`, because "mark" is a glossary
   term (the model's note that a clue was planted).
7. **Refinement.** Without a change event, a new appearance value replaces
   the old one when it contains every word of the old one. A real change
   (a haircut) still needs the change event. This applies to the appearance
   kinds only.
8. **Only present characters' appearance goes to the narrator.** The
   characters a scene only talks about get none (the "Has met" case: Levi
   described Sofia's lip scar without ever having seen her). The planner's
   cast gets none.
9. **Appearance has its own switch.** It is off by default and works only
   while character details are on.
10. **A small extraction input.** The input prints a character's appearance
    only when the new messages name the character.
11. **The search shows what it found first.** The player accepts each kind
    separately. Accepted entries carry their source message's index, so
    rollback treats them like every other entry.

## Part A — the appearance kinds

### Data

`constants.js` gains:

```javascript
export const APPEARANCE_KINDS = ['ethnicity', 'skin', 'hair', 'eyes', 'build', 'features'];
```

An appearance kind is stored like every detail kind: one history per kind
under `character.details`, oldest first, the last entry current. The entry
shapes are unchanged:

- a story entry `{ value, at, messageId? }`
- a player entry `{ value, at: null, by: 'user' }`

The value is always a short string. What each kind holds:

| Kind | Holds | Example |
|---|---|---|
| `ethnicity` | heritage or ethnicity, only as the text names it | `Indian` |
| `skin` | skin tone or complexion | `warm brown` |
| `hair` | colour, length, texture, a lasting style | `dark glossy curls, about shoulder length` |
| `eyes` | eye colour and shape | `warm brown` |
| `build` | height and body | `petite, five-two` |
| `features` | lasting marks, all in one list: scars, tattoos, freckles, birthmarks, piercings, glasses, a beard | `freckles; scar over the left eyebrow` |

Older ledgers need no migration: an absent kind is unknown. The rollback,
the merge and the change items already go over every kind a character's
`details` holds, so they cover the new kinds without a change:

- `keepOnlyDetailEntries`
- `detailEntriesOf`
- `mergeDetails`
- the change item key `u6:detail:c1:hair`

**Contract for StoryImage.** StoryImage reads
`characters[].details.<kind>` with `detailAt` (the last entry with
`at == null || at <= messageIndex`). The new kinds have the same shape, so
`detailAt` needs no change. The only new thing StoryImage has to know is the
six kind names.

### The switch

- A new setting, `knowledgeTracker.appearance`, defaults to `false` in
  `defaultKnowledgeTrackerSettings`.
- `isAppearanceEnabled()` in `settings.js` is true only while Story Arc, the
  tracker, character details and the appearance switch are all on.
- The settings drawer gets an "Appearance" checkbox under "Character
  details". It is disabled while character details are off.
- The builders take `withAppearance` as a parameter, next to `withDetails`.

While the switch is off:

- The extraction prompt and the knowledge block are byte for byte what
  character details give today, pinned by a test like
  `tests/test-knowledge-details-switch.js`.
- The appearance entries already stored stay where they are. Rollbacks still
  run, since they go over every kind.
- The popup hides the appearance rows and the appearance search.
- An appearance item in an answer is dropped at the apply without a count
  (see "Parsing").

### Extraction input

`buildKnowledgeExtractionVariables` keeps printing every character's
`DETAIL_KINDS` details as today. A character's known appearance kinds are
added to the same line, labelled by kind, only when one of the new messages
(`fromIndex` on, hidden ones left out, as now) names the character. "Names"
means the test the knowledge block uses for talked-about characters
(`isNamedInText`, so a shared name word names nobody). The test runs on each
message's text with its tagged elements removed (`withoutTaggedElements`),
the same text the block tests. A preset's status block (`<svt>…</svt>`,
`<trk>…</trk>`) names characters who are nowhere in the scene, and testing
it would print almost everyone's appearance and lose the saving:

```
- Priya Mehta (also: Priya) — gender: female; age: 17; role: student, Brockton Bay High; ethnicity: Indian; hair: dark glossy curls, about shoulder length; eyes: warm brown
```

A character the new messages describe without naming ("her curls") then
shows no appearance. The extraction may report a kind the ledger knows
already. The code guard in the apply catches that, at the cost of a few
answer tokens.

### Extraction task

Task 8 (DETAILS) keeps its text. That text says a known detail "is not
reported again unless the new messages show it changing" and that a
different value merely stated is not reported. The appearance paragraph
makes one explicit exception to that rule, named as an exception, so the two
do not contradict each other. With appearance on, three placeholders add the
appearance kinds; with it off they are empty:

- **`{{APPEARANCE_KINDS_NOTE}}`**, inside the "kind" bullet: the six kinds,
  each with one example from the table above.
- **`{{APPEARANCE_TASK}}`**, a short paragraph after the task's rules:
  - Appearance is what lasts: the body and lasting marks, as the text states
    them.
  - Never clothing, shoes, jewellery worn for the day, makeup, or a passing
    state: wet hair, hair up for the evening, wide eyes, a flush, a bruise
    that will heal.
  - Ethnicity only when the text names it, never from a name, a skin tone or
    a look.
  - `features` is one list: write the whole list, the known items included.
  - A value leaves out the kind's own word: `dark glossy curls`, not
    `dark glossy curls hair`; `warm brown`, not `warm brown eyes`.
  - The exception: for an appearance kind only, a fuller description of a
    known kind, one that keeps every word the ledger has and adds to it, is
    reported, without `change` (a refinement). Every other rule of task 8
    stands for appearance too.
  - A different description needs the on-screen change ("Priya cuts her hair
    short") as `change`.
- **`{{APPEARANCE_SCHEMA_KINDS}}`**, in the `kind` field of the answer's
  schema line.

Task 3 tells the extraction not to record "descriptions" as learned facts.
That stays as it is: it is about facts. The appearance paragraph says once
that appearance goes into DETAILS, never into LEARNED.

### Parsing

`parseKnowledgeExtractionAnswer` accepts a `kind` from `DETAIL_KINDS` or
`APPEARANCE_KINDS`, whatever the switch says. Any other kind still rejects
the whole answer.

The parser does not know the switch, so a model that reports hair unasked
must not cost the whole answer. With the switch off, the apply drops the
item instead.

### Apply

`applyExtractionAnswer` gets `withAppearance`. Its callers read it once,
like `withDetails`: the update after a reply and the re-extraction. An
appearance item is skipped without a count while the switch is off.
Otherwise the rules of the detail kinds apply in their order:

1. a locked kind is skipped (`detailsLocked`);
2. an unknown kind is set (`detailsSet`);
3. the same value, case aside, does nothing;
4. a different value with `change` is appended (`detailsChanged`);
5. **new:** for an appearance kind only, a different value without `change`
   that contains every word of the current value is appended as a
   refinement. It is counted as `detailsRefined`, a new count in the `update`
   and `reextract` records;
6. any other value is ignored as a restatement (`restatementsIgnored`).

**Word containment.** Words are lowercased runs of letters and digits,
compared as sets, with hyphens splitting words. The kind's own words are
left out of both sides before the comparison: `hair` for hair, `eye` and
`eyes` for eyes, `skin` for skin. The prompt asks for values without them,
but an extraction that writes "dark hair" must not block a later "dark
glossy curls". Examples:

| Current | New | Result |
|---|---|---|
| `dark hair` | `dark glossy curls, about shoulder length` | refines (`hair` left out) |
| `dark hair` | `dark glossy curls, shoulder length hair` | refines |
| `freckles` | `freckles; tattoo on the wrist` | refines |
| `five-two` | `petite, five-two` | refines |
| `dark hair` | `black hair` | restatement |
| `dark glossy curls` | `dark curls` | restatement (a shorter text never refines) |

A refinement appends a new entry; it does not edit the old one. Rolling
back the message that refined a kind therefore brings back the shorter
value.

The narrator restating a known look with more words is the remaining risk.
"Warm brown eyes" can turn into "warm brown eyes flecked with gold". The
rule accepts that, because nothing the story set is lost. A contradiction
that keeps every old word also gets through: "dark" → "dark blonde" refines.
Containment only stops restatements that drop or swap a word ("dark" →
"black"). The live check looks for such cases.

### Knowledge block

`buildKnowledgeBlock` gets `withAppearance`. For a **present** character with
a known appearance kind, an appearance line comes right after the details
line, labelled by kind, in `APPEARANCE_KINDS` order:

```
PRIYA MEHTA (present)
- Details: female; 17; student, Brockton Bay High
- Appearance: Indian; skin warm brown; hair dark glossy curls, about shoulder length; eyes warm brown; build petite, five-two
- Has met: Ellie Lin, Vera Lin
```

Ethnicity carries no label, because it reads plainly. The other kinds carry
one, because "warm brown" alone could be the skin or the eyes.

The rules around the line:

- A talked-about character's section never prints the line.
- A present character with an appearance and nothing else to print still gets
  a section.
- An appearance line counts as a printed detail, so the header gains the
  existing details sentence ("A character keeps the details listed for them;
  a detail changes only when the story shows it changing.").
- With no appearance to print, the block is byte for byte what it is today.

### The planner

`harvestCast` uses `characterDetailTexts`, which goes over `DETAIL_KINDS`
only. That stays, so the planner and the plan check get no appearance. A
test pins this.

### Knowledge popup

With the switch on, the places in `knowledge-popup.js` that go over
`DETAIL_KINDS` also go over `APPEARANCE_KINDS`:

- `buildCharacterSheet`, under its own "Appearance" sub-heading in the
  details list. Each kind gets a row (`buildDetailRow`) with the same
  Edit / Set, Lock and Unlock / Clear as the other kinds, all text fields.
- the merge preview (`listMergeConsequences`)
- the message search (`buildMessageSearch`)
- `saveCharacterDetails` and `lockCharacterDetail`, which check the kind
  against both lists

`KIND_LABELS` gains the six labels. The "What changed" lines come from the
change items, which carry their kind already, so they need only the labels.
A refinement shows there as the detail line every detail entry gets ("set
to …"), and the record's count of details set includes refinements
(as built).

The result row's summary (`detailsSummary`) stays as it is. It lists
gender, age, role, status and relation, and six looks would crowd the row.

## Part B — the appearance search

Existing long chats get nothing from the forward extraction. On a
character's sheet, while appearance is on, a button "Search the chat for
their appearance" runs one search for that character.

### Finding the passages

The search runs locally over the whole chat, **hidden messages included**.
It keeps the sentences that say how the person looks. StoryArc gets its own
search, modelled on StoryImage's `findDescriptions`
(`/opt/sillytavern/StoryImage/lib/looks.js`). StoryArc cannot import from a
sibling extension that may not be installed. How that search works:

- It splits every message into sentences. It also splits on `;` and `•`, so
  tracker lines are cut per person.
- It keeps a sentence when the sentence names the person (or is the pronoun
  sentence right after one) and has three things:
  - a lasting feature word, or a height like "five-two";
  - a describing word next to the feature;
  - nobody else named closer to the feature.
- It decides whose feature it is: a name with 's right before the feature,
  otherwise the sentence's first named person.
- It keeps at most 3 of the newest passages per feature, within a 6,000
  character budget, and returns them oldest first as `[#index] passage`.

On Paragon this found 10 passages for Priya (about 2.2 KB, ~170 ms),
against 360 noisy ones from a loose filter. Ellie, the main character, is
still about half noise.

The search reads the persona and every ledger character's names and aliases
to tell whose feature a sentence describes. Shared name words do not count
as the person's names (`isSharedNameWord`).

The search lives in `lib/knowledge/appearance-search.js`, with the whole
process in one file in the order it runs: search, prompt, call, parse,
findings. The popup calls it, and accepting a finding is a popup edit.

### The call

The search sends one LLM call with the new prompt file
`prompts/find-appearance.txt`. It goes through the arc generation connection
profile and the transport the extraction uses (`extractKnowledge`). The call
receives:

- the character's display name and aliases;
- the appearance kinds the ledger already knows, with values;
- the passages.

The rules are those of the appearance task: lasting features only, never
clothing, never a guess. For each kind, it reports the latest value the
passages state, with the message index of the passage that states it:
`{ kind, value, at }`. When two passages combine ("dark glossy curls" at
#2825, "shoulder length" at #140), `at` is the newer one.

A missing kind means not found. An `at` must be the index of a passage it
was sent. An item with a kind outside `APPEARANCE_KINDS`, an `at` that was
not sent or an empty value is dropped. Unlike the extraction, the whole
answer is not rejected: the player reviews every finding before it counts.

### Findings and acceptance

The findings open in the character sheet as a list. Each kind is one line:
the found value, the source message ("message #2825, hidden"), the passage
text on demand, and Accept / Skip.

A kind is offered when one of three things holds:

- the ledger does not know it yet;
- the finding's message is newer than the kind's current entry and its
  value differs;
- the finding is older but refines the current value (word containment, as
  in the apply). This is the Priya case: by the time Part B ships, the
  forward extraction may have set a vague "dark" at #3295, and the fuller
  "dark glossy curls" sits at #2825.

A locked kind is never offered. An older finding that does not refine the
current value is not offered: it would only rewrite history.

Accepting a kind appends a story entry `{ value, at, messageId }` to the
kind's history, so the accepted value becomes current in every case. For an
older refining finding, `at` is then lower than the entry before it. A
kind's history is therefore in the order its entries were recorded, not
always in `at` order (see open question 3). The current value is still the
last entry, which is what `currentDetailText`, the popup's `currentDetail`
and `storyDetail` read. StoryImage's `detailAt` takes the last entry at or
before a message, by array order, and gives the right value either way:
with `[dark @3295, dark glossy curls @2825]` it gives "dark glossy curls"
at #3300 and at #3000. Rollback filters entries and needs no order:

- a swipe of #3295 leaves "dark glossy curls";
- a delete of #2825 brings back "dark".

The source message gets a Story Arc message id if it has none, so the entry
follows it through deletions. `followMessagesById` maps ids over the whole
chat, hidden messages included. `assignCoveredMessageIds` skips hidden
messages, so the search needs a variant for the one message.

**An id on a hidden message must not make it look read.** Today an edit of
a hidden message decides by `isHiddenAndUnread` whether an update read it.
A hidden message with a Story Arc message id counts as read, and its edit
drops what was learned at its index and re-extracts a shown copy
(`chatShowingMessage`, 7ddd57c). It has no read-text hash, so even a
cancelled edit (`MESSAGE_UPDATED`, which ST Copilot also fires) would count
as changed.

An id from the search would therefore turn every edit event on an old
hidden message into a full extraction call on it. That call would import
facts, holders and a scene from message #140 that no update ever read.
Required behaviour: an edit of a hidden message that only the search gave
an id changes nothing and makes no call, as for any hidden message no
update read. The accepted entry stays. The implementation plan picks the
test, for example "hidden, no read-text hash and no holder entry at its
index" in place of "hidden and no message id". It must keep working for
messages read before read-text hashes existed.

It saves through `saveLedgerEdit`, so Undo covers it. The chat file is saved
too, since the id lives in the message's `extra`. Like other hand edits, it
writes no update-log record.

The entry is a story entry, not a locked one: the sheet shows "From the
story, message #2825". Later extractions can refine or change it, and the
player can lock it.

Rollback treats it like any story entry:

- a deleted source message takes the entry with it (by message id);
- a swipe of it takes the entry too;
- an edit of a shown source message drops it before the re-extraction;
- an edit of a hidden source message no update read keeps it, with no call
  (above).

### The definitions (added 2026-11-11)

The first search read only the chat. For Ellie Masters in Paragon it found
nothing usable: she is the player's persona, her look is in the persona
description and the lorebook, and in the chat almost every sentence names
her next to someone else. Stefan: "I think the search should first check
the connected lorebooks, then user character definition and then the
chat." He accepted one change to that order ("please do"): the chat wins
on a disagreement, since card and lorebook are written once at the start
and the chat is where looks change. Each finding shows its source. No new
spec or plan ("Cut down on ceremony - I think thats a minor change").

What the search reads besides the chat (`findDefinitions`):

- **The persona description**, when the persona's name is one of the
  character's names (`power_user.persona_description`; `getContext()` has
  no `persona` field).
- **The card description** of a card character of this chat: the one
  character, or the group's members. Cards of other chats are left out,
  because another story may have a card of the same name.
- **Lorebook text** from the books ST scans for this chat
  (`fetchLorebookEntries`: chat, persona, character and global books). An
  entry whose keys or comment name the character and that has at most
  1,500 characters is their sheet and goes whole. Every other entry that
  names them goes through the chat's sentence filter
  (`findAppearancePassages`). Whole sheets go first, within 3,000
  characters in all. Paragon's book has two entries named after Ellie, of
  6 and 9.5 KB; the filter keeps one sentence of them.

The persona and card texts are capped at 3,000 characters each. `{{user}}`
becomes the persona's name in every text and `{{char}}` the card's name in
a card description. Line breaks become " / ", so each text is one line.

Lorebook entries written during the story (arc summaries, long-term-memory
books) count as older than every message too. This is accepted: the chat
they summarise is searched as well and wins over them, so they only fill a
kind the chat never states, and the player sees the entry as the source.

The prompt gets a section "Written before the story", one `[persona]`,
`[card]` or `[lore N]` line per text. They count as older than every
passage: on a disagreement the passage wins, and they fill in what the
passages never state. Each item lists every text its value uses in
`sources`: message indexes and these labels, `[2825, "persona"]`.

**Every source is shown (Stefan, 2026-11-11, on the first live run).** The
first version had one `at` per item, the newest text used. On Paragon,
Ellie's build "about 166 cm … C-cup" came out as message #1753, whose
passage only says "lean curve of her waist"; the height came from the
persona. In Amy, "lithe and toned" was labelled "card" although the card
does not say it, and it was stored as an entry no rollback removes.
Stefan ruled: list every source a value uses, and store an accepted value
without a message only when all its sources are definitions. As soon as
one part comes from a chat message, store it under the newest message it
uses, so it rolls back with that message.

So a finding has `sources`: the definitions' sources ("persona", "card",
"lorebook: <book> / <entry>") in the order sent, then the message indexes,
oldest first. Its `at` is the newest message among them, or null when it
uses definitions only. The finding line shows them all ("persona +
message #2825, hidden"), and Show passage shows every text used. An answer
with a single `at` instead of `sources` still reads as one source. A
source that was not sent is left out; an item with none left is dropped.

A finding with a message is accepted as before: the source-message check
on its newest message, a message id for it, a story entry at it. A finding
from definitions only skips the check and gives no message an id.

It is stored as a record entry `{ value, at: null, by: 'record', source }`,
its sources joined with " and ", the shape the relation of an unnamed
relative already has. It holds at
every message and no rollback removes it, since it comes from no message.
It locks nothing, so the extraction can still change it with a change
event. The sheet shows "From the persona" (or the card, or the lorebook
entry), and an update line it overtook says "Changed later, from the
persona".

The sheet's button is now "Find appearance" instead of "Search the chat",
since it reads more than the chat (Stefan, 2026-11-11).

Settled in the review of the final diff:

- A persona or card named by the first name alone ("Amy" for the ledger's
  "Amy Chen"), or the other way round, is the character. Its name then also
  names the character in lorebook text.
- In a chat with one card, `{{char}}` in lorebook text, keys and the
  persona becomes that card's name. A group chat has no single `{{char}}`,
  so the macro stays.
- A record entry accepted over story entries (a refinement) counts as the
  newest of them in `listOfferedFindings`, so their older, vaguer values
  are not offered back.
- Accept checks every message a finding uses, not only the newest one.
- Accepted as is: the forward extraction treats a record entry like any
  current value, so a different chat value without a change event is a
  restatement and is ignored. Letting it replace a definition would let a
  vague "red hair" overwrite the card's "fiery red curls". The search
  still offers the chat's value over a definition.

`listOfferedFindings` counts a definition, as a finding or as the current
entry, as older than every message:

- A definition finding is offered for an unknown kind, or when it refines
  the story's value.
- A chat finding that differs from a definition entry is offered.
- A definition finding that differs from another definition entry is not
  offered unless it refines it.

### Gender, age and role (added 2026-11-11)

Stefan cleared Mateo Reyes's hand-set gender, age and role in the Paragon
chat by accident and did not want to type them in again. A hand-set value
is always locked, so the search finds them instead, as unlocked story
values. He chose the minimal version: "You sure we need everything? That
takes a lot of time till it is usable", then "yes, do it".

- The same search reports `gender`, `age` and `role` too, in
  `SEARCHED_KINDS` (those three, then the appearance kinds). Not
  `relation`, not `status`. The button is "Find details".
- No new passage search: no age patterns, no introduction search. The call
  gets the definitions as before, plus the newest sentences of the chat
  that name the character (`findNamingPassages`: a naming sentence with
  the pronoun sentence after it, the unit of the appearance passages,
  newest first until 4,000 characters, a text the appearance passages
  already hold left out). They are sent only while one of the three kinds
  is not locked. Add patterns only if this proves too thin, and ask
  Stefan first.
- The prompt takes the age and role wording and the never-guess rule from
  the extraction's DETAILS_TASK. The appearance-only rules (no clothing,
  no kind word in the value) now name the looks. The answer key is
  `details`; `appearance` still reads.
- Accept, locks and offers are unchanged. A detail kind gets no
  refinement (`isAppearanceRefinement` is for appearance kinds only), so
  an older gender, age or role is never offered over a known one.

### Save without the lock (added 2026-11-11)

Stefan asked why a hand edit and the lock are one button. A player entry
(`by: 'user'`) is both the player's value and the lock, but the record entry
gives an unlocked value a shape. So the detail editor has two buttons, for
every kind:

- **Save and lock**: a player entry, as before. It is the first button,
  so Enter keeps it.
- **Save**: a record entry `{ value, at: null, by: 'record', source:
  'player' }`. No rollback removes it, and the extraction can still change
  it with an on-screen change. The sheet shows "Set by you" with the open
  lock, never "Locked by you".

Decided in the session:

- The player's own value is one entry. Either save, Lock, and an emptied
  field replace or remove the earlier one, locked or not. A definition
  record (from the persona, card or lorebook) stays in the history.
- Save on a locked kind unlocks it, even with the value unchanged: the
  button does what it says, and Unlock stays for going back to the story's
  value.
- An unnamed relative's relation, the record's identity, keeps only "Save
  and lock".
- Save at the value shown over a story value makes it the player's own,
  so no swipe of its message takes it away. Over a record entry it has
  nothing to change and says so.
- The search treats the player's unlocked value as newer than every
  message (`isPlayerRecordEntry` in `ledger.js`), as it does a locked one,
  so it never offers a chat value over it. Only a refinement of an
  appearance value is still offered, since that value is not locked.

### Cost

The search costs one call per press, of about the passage budget plus the
prompt: roughly 2.5k tokens in, a few hundred out. The definitions add up
to 3,000 characters per persona or card text and 3,000 for the lorebooks,
so at most about 2.5k tokens more. The naming passages for gender, age
and role add up to 4,000 characters, about 1k tokens. It never runs on
its own.

## Changes outside the code

- **ADR-0007:** a new amendment, "the ledger also keeps how characters look".
  It covers the six kinds and the never-invent rule. It records that only
  present characters' appearance goes to the narrator, because of the "Has
  met" case, and that a talked-about character gets none. It also records the
  refinement rule and why the detail kinds do not get it, and the search with
  its acceptance per kind.
- **GLOSSARY.md:**
  - **Character details**, extended: the appearance kinds belong to it, with
    their own switch.
  - **Appearance**, new: a cast member's lasting looks, as the story states
    them; never clothing. _Avoid_: look, looks (StoryImage's word for its
    image tags), description, outfit.
  - **Refinement**, new: a fuller appearance value that keeps every word of
    the stored one. _Avoid_: update, restatement (the word for a value that
    is ignored).
  - **Appearance search**, new: the per-character search of the whole chat,
    hidden messages included. Its findings wait for the player's acceptance
    per kind. _Avoid_: backfill (in UI text), scan.
- **`docs/architecture/architecture.md`**, "Knowledge Tracker": the kinds,
  the switch, the input rule, the refinement and the block line. Part B adds
  the search. The coverage header of `docs/architecture/code-index.md` gains
  `appearance-search.js` and `find-appearance.txt`.

## Tests

The expected values are written out by hand, as in the existing knowledge
tests.

- **Parser:** the appearance kinds are accepted; an unknown kind still
  rejects the answer.
- **Apply:**
  - each row of the word-containment table;
  - a locked appearance kind is skipped;
  - a refinement is appended, not edited in place;
  - an item is dropped with the switch off;
  - refinement never applies to `role` ("cleaner" → "cleaner, double shifts"
    stays a restatement).
- **Extraction input:**
  - appearance only for a character named in the new messages;
  - none for a shared name word;
  - none with the switch off;
  - the prompt byte for byte the same with the switch off.
- **Block:**
  - the appearance line for a present character;
  - none for a talked-about one;
  - a section for a present character with only an appearance;
  - byte for byte the same with no appearance.
- **Planner:** `harvestCast` carries no appearance kind.
- **Rollback:** a refinement rolled back restores the shorter value.
- **Search (Part B):**
  - passage finding on a hand-written chat with hidden messages;
  - the offer rule: unknown, newer and different, older and refining, older
    and not refining, locked;
  - accepting appends with the message id, and a hidden source message gets
    one;
  - an edit of a hidden source message the search gave an id makes no call
    and keeps the entry.

**Live check** (Amy chat, never Paragon):

- A few replies with appearance on. Compare the extraction prompt size and the
  answer against appearance off. Check four things:
  - clothing and passing states stay out;
  - the extraction reports a real fuller description despite task 8's "not
    reported again" (the exception's wording);
  - the refinement rule fires on it;
  - no "dark" → "dark blonde" kind of contradiction slips through.
- Part B: one search on an Amy character, accepting one kind.

## Answered (Stefan, 2026-11-11: "yes to all three recommendations")

Each question below was settled as recommended: a small fixed ethnicity
pattern, one value per kind, and append with the last entry current.
StoryImage confirmed that its `detailAt` needs no change for point 3.

1. **Ethnicity in the search.** StoryImage's `findDescriptions` looks for
   hair, eyes, skin, marks, beard, build and heights, not ethnicity. A
   heritage word is an open list. I propose adding a small fixed pattern
   ("-American", "descent", "heritage", plus a short list of demonyms) and
   leaving the rest to the forward extraction and the player's Set. The
   alternative, no ethnicity in the search, keeps the search strict.
2. **Only the current value.** The search proposes one value per kind, the
   latest. StoryImage's `detailAt` could use earlier values (long hair at
   #140, short at #2000) for an image of an earlier scene. I propose current
   only. A history from passages is guesswork about when a change happened,
   and every proposal would need its own acceptance.
3. **History order.** Today a kind's history is oldest first by `at`. An
   accepted older, refining finding (the Priya case) is appended after a
   newer vague entry, so histories become "in the order recorded, last entry
   current". Everything that reads them goes by array order, and StoryImage's
   `detailAt` still gives the right value. The alternative keeps `at` order
   by inserting the finding before the newer entry. Then the vague value
   stays current and the search does not fix the Priya case. I propose
   append; architecture.md and the `constants.js` shape comment would then
   say "in the order recorded". Earlier today I told you entries would be
   inserted in message order; this is the reason that changed.

## Risks

- **The extraction answers get longer and noisier.** Six more kinds may make
  it report clothing or passing states despite the rule. The live check
  measures this. If it fails, the prompt gets a concrete counter-example, not
  a new code rule.
- **Refinement lets the narrator's embellishments in.** Accepted for this
  spec (see "Apply"). If the stored looks keep growing, a cap on value length
  is the next step.
- **The appearance line costs narrator tokens** for every present character,
  about 30 tokens each.
- **Two copies of the search.** StoryImage and StoryArc each keep one.
  Once StoryArc stores appearance, StoryImage's own scan may become
  unnecessary. That is StoryImage's call.

## Not in scope

- Clothing and outfits, at any time.
- Appearance for the planner or the plan check.
- A global "search all characters" button.
- Turning values into image tags (StoryImage's job).
