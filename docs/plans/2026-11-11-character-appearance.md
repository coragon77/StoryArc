# Character Appearance — Implementation Plan (Parts A and B)

- **Date:** 2026-11-11
- **Status:** Built 2026-11-11 (Parts A and B, three agents, one review pass, live-checked on the Amy chat); not yet committed. Approved for implementation by Stefan, 2026-11-11: "Go ahead with the implementation plan and Part A", then "work in parallel using subagents and get it done, implementation plan, Part A and Part B, without stopping between them".
- **Design:** `docs/plans/2026-11-11-character-appearance-design.md`

## Decisions this plan builds on

All ruled by Stefan on 2026-11-11 (see the design note):

1. **Six kinds.** `ethnicity`, `skin`, `hair`, `eyes`, `build` and `features`, in `APPEARANCE_KINDS`, apart from `DETAIL_KINDS`. Never clothing.
2. **Refinement.** For appearance kinds only, a value that keeps every word of the stored one (the kind's own word aside) replaces it without a change event.
3. **Narrator and planner.** The narrator sees appearance only for present characters. The planner sees none.
4. **The switch.** Appearance has its own switch, off by default, under character details.
5. **The extraction input.** It prints a character's appearance only when the new messages name them, tested on the text without tagged elements.
6. **The search.** It runs per character in the Knowledge popup and reads hidden messages. It proposes one value per kind (the latest), and the player accepts each kind. An accepted finding is appended, so a history is in the order recorded and the last entry is current. Ethnicity is found through a small fixed word pattern.

## Deviation from the design note

The design gives `applyExtractionAnswer` a `withAppearance` parameter. The code instead follows the existing pattern for details: `extractKnowledge` already returns `details: []` while details are off. With appearance off, it also filters out the appearance items. `applyExtractionAnswer` then applies whatever the answer carries, and none of its callers change.

**L8, as built.** The rule went through two versions before the one that shipped:

1. **Read evidence from the ledger.** The first version took a hash or ledger entries as the evidence of a read. Sizing on the Paragon chat (read-only) found 595 hidden messages that an update had read, that taught nothing and that had no read-text hash. Under that version, a rewrite of any of them would no longer have been re-extracted.
2. **A marker on the search's ids.** The shipped version marks the ids the search creates (`SEARCH_ID_KEY` and `isIdFromSearch` in `message-ids.js`), and `showsUpdateRead` reads a message as read when it has a hash, an id the search did not create, or a holder at its index.

The shipped rule is the original one minus the search's ids. The same predicate replaces the `lastUpdatedAt` fallback's "newest message with an id" (`latestReadMessage`). That fallback was a second place that relied on an id meaning "read", which the code review found.

**After the review.** The review fixes:

- a negation guard on refinement;
- the `fillTemplate` `$` patterns, a one-line fix in `generator.js` that also protects the extraction's prompt;
- unnamed relatives and curly apostrophes in the search;
- one passage per sentence;
- a re-check of a stale finding at Accept, and of a source message that has moved or changed.

## Groundwork (done before the split)

- **`lib/core/constants.js`:**
  - `APPEARANCE_KINDS`;
  - `defaultKnowledgeTrackerSettings.appearance: false`;
  - the shape comment (appearance kinds, history in the order recorded).
- **`lib/core/settings.js`:** `isAppearanceEnabled()`, true only when `isCharacterDetailsEnabled()` is true and `knowledgeTracker.appearance === true`.
- **`lib/knowledge/ledger.js`:** `isAppearanceRefinement(kind, storedValue, newValue)`, exported. It checks word containment, leaving out the kind's own words (`APPEARANCE_KIND_WORDS`: hair, eye/eyes, skin). It is false for non-appearance kinds and for equal values. Checked against every row of the design's table.

## The split: three agents, disjoint files

The three agents share one working tree, and each file has exactly one owner. Nobody edits a file another agent owns. Docs (architecture.md, GLOSSARY.md, ADR-0007, code-index.md, AGENTS.md) are the orchestrator's, after the merge.

### Agent L: the ledger, the prompt, the switch

**Owns:**

- `lib/knowledge/ledger.js`;
- `prompts/extract-knowledge.txt`, which needs no change, since the details task lives in `ledger.js`;
- `lib/ui/settings-panel.js`;
- `lib/css/settings-panel.css`, if it needs one;
- `lib/context/harvester.js`, for a comment only if needed;
- new or extended tests: `tests/test-knowledge-appearance.js` (new) and `tests/test-knowledge-details-switch.js`.

**L1. The settings drawer.** An "Appearance" checkbox `#story-arc-knowledge-appearance` comes right after the character details checkbox. It is wired like that one (`change.storyArcSettings`, `saveSettingsDebounced`, a `[Story Arc] Appearance on/off` log). It is disabled while character details are off: the details checkbox's change handler and the initial render both set `disabled`. The help text says it records lasting looks as the story states them (never clothing), and that StoryImage can use them.

**L2. Extraction prompt parts.** These are constants in `ledger.js`, next to `DETAILS_TASK`:

- `DETAILS_TASK` gets `{{APPEARANCE_KINDS_NOTE}}` at the end of its "kind" bullet, and `{{APPEARANCE_TASK}}` after its closing rules paragraph and before its trailing blank line.
- `DETAILS_SCHEMA` gets `{{APPEARANCE_SCHEMA_KINDS}}` after `status` in the kind field (`"gender | age | role | relation | status{{APPEARANCE_SCHEMA_KINDS}}"`).
- `buildKnowledgeExtractionVariables` gets a ninth parameter `withAppearance = false` and fills the three parts in those constants before returning. Plain `replaceAll` on the constant is enough, because `fillTemplate` runs a single pass. With `withAppearance` false the parts are `''`, so the prompt is **byte for byte** what it is today.
- The texts are worded as the design note's "Extraction task" section says:
  - each kind with one example;
  - lasting looks only;
  - never clothing, shoes, the day's jewellery, makeup or passing states;
  - ethnicity only when named;
  - `features` is one whole list;
  - values leave out the kind's own word;
  - a fuller description of a known appearance kind is reported without `change`, named as **the exception** to task 8's "not reported again";
  - a different description needs `change`;
  - appearance goes into DETAILS, never into LEARNED.

**L3. Extraction input.** In `buildKnowledgeExtractionVariables`, while `withAppearance` is on, a character whose name the new messages name gets its known appearance kinds added to its line. The new messages are `fromIndex` on, hidden ones left out, each through `withoutTaggedElements`, joined. "Names" is `isNamedInText` with `listNameWordCarriers(ledger.characters)`. Each kind is labelled `kind: value`, after the `DETAIL_KINDS` notes in `APPEARANCE_KINDS` order, joined with `; ` into the same ` — ` note. `characterDetailTexts` stays `DETAIL_KINDS`-only, which keeps the planner's cast (`harvestCast`) free of appearance. Use a separate helper for the appearance texts.

**L4. `extractKnowledge`.** It reads `isAppearanceEnabled()` once and passes it to the builder. The `details` it returns leave out items with an appearance kind while appearance is off.

**L5. The parser.** `parseKnowledgeExtractionAnswer` accepts a kind from `DETAIL_KINDS` or `APPEARANCE_KINDS`. Any other kind still rejects the answer.

**L6. The apply.** In `applyExtractionAnswer`'s details loop:

- the kind check becomes "in `DETAIL_KINDS` or `APPEARANCE_KINDS`";
- for a known kind with a different value and no `change`, an appearance kind whose `isAppearanceRefinement(kind, currentValue, value)` holds is appended and counted in `detailCounts.detailsRefined`. This count starts at 0 like the others and goes into the `update`/`reextract` record next to `detailsChanged`, in `extractionRecord`;
- otherwise the item is ignored as a restatement, as today.

The comment block above the loop gains the rule. Change items need nothing: a refinement is a detail entry like a change.

**L7. The knowledge block.** `buildKnowledgeBlock(ledger, messages, withDetails = true, withAppearance = false)`:

- A **present** character with a known appearance kind gets `- Appearance: <parts>` right after the details line. The parts are in `APPEARANCE_KINDS` order: ethnicity unlabelled, the others as `skin warm brown`, `hair dark glossy curls`, `eyes warm brown`, `build petite, five-two`, `features freckles`, joined with `; `.
- Talked-about characters never get the line.
- An appearance line alone gives a section and counts as a printed detail, so the header gains `KNOWLEDGE_BLOCK_DETAILS_SENTENCE`.
- `withAppearance` needs `withDetails`.
- `injectKnowledgeBlock` passes `isAppearanceEnabled()`.

**L8. Hidden messages the search gave an id.** `isHiddenAndUnread` today treats any message id as "read". Part B gives ids to hidden messages no update read. Required: an edit or `MESSAGE_UPDATED` of such a message makes no call and changes nothing, and appearance entries at it stay.

Change the test so a hidden message counts as read only when it shows an update's read. That means a read-text hash (`READ_TEXT_HASH_KEY`), or a holder, retraction, scene, scene-history or meeting entry at its index or with its message id. Detail entries do not count. Check in `git log -S READ_TEXT_HASH_KEY` and `git log -S MESSAGE_ID_KEY` which came first. A message an update read before read-text hashes existed must still count as read; say in the report how the rule covers it. Extend the existing hidden-edit tests in `tests/test-knowledge-rollback.js`, where 7ddd57c added them.

**L tests (`tests/test-knowledge-appearance.js`).** Expected values are written by hand.

- The parser accepts the appearance kinds and rejects an unknown kind.
- The apply:
  - each row of the design's refinement table;
  - a locked appearance kind is skipped;
  - a refinement is appended (both entries are there);
  - `role` never refines;
  - `detailsRefined` is counted.
- The extraction input:
  - appearance only for a named character;
  - none for a character named only inside a `<trk>` block;
  - none for a shared name word;
  - none with `withAppearance` false;
  - the prompt variables byte for byte the same as today with it false (in `test-knowledge-details-switch.js`).
- The block:
  - the present line;
  - none for a talked-about character;
  - a section for a present character with only an appearance;
  - byte for byte the same without appearance.
- The planner: `characterDetailTexts` returns no appearance kind.
- Rollback: rolling back a refinement restores the shorter value.

### Agent S: the appearance search

**Owns:**

- `lib/knowledge/appearance-search.js` (new);
- `prompts/find-appearance.txt` (new);
- `lib/knowledge/message-ids.js`, adding one function;
- `tests/test-appearance-search.js` (new);
- `tests/mocks/st-mocks.js`, only if a new mock is truly needed.

**Contract** (Agent P builds the UI against it; keep these names and shapes exactly):

```javascript
// lib/knowledge/message-ids.js
/** Give one message Story Arc's message id, hidden or not, unless it has one; returns the id. */
export function giveMessageId(chatMessage) { ... }

// lib/knowledge/appearance-search.js
/** Passages of the whole chat (hidden messages included) that say how the person looks, oldest first. */
export function findAppearancePassages(chatMessages, names, otherNames, maxChars) // → [{ at: number, text: string }]

/** The search for one character: passages, the call, the parse, the offer rule. */
export async function searchAppearance(ledger, characterId, chatMessages, personaName)
// → { findings: [{ kind, value, at, passage }], passageCount: number } | { error: string }
// findings: offered ones only (listOfferedFindings), in APPEARANCE_KINDS order

/** Which findings the player is offered for a character (pure). */
export function listOfferedFindings(character, findings) // → findings subset
```

**S1. `findAppearancePassages`.** Port the approach of StoryImage's `findDescriptions` (`/opt/sillytavern/StoryImage/lib/looks.js`, with its tests in `/opt/sillytavern/StoryImage/tests/test-looks.js`). Read it, and write StoryArc's own version in house style. Its behaviour is described under "Finding the passages" in the design note:

- sentence split, with `;` and `•` too;
- a sentence that names the person (or the pronoun sentence right after one) and has a lasting-feature word or a height, with a describing word next to it and nobody else named closer;
- ownership by `'s` or by the first named person;
- at most 3 of the newest passages per feature, a `maxChars` budget, returned oldest first;
- hidden messages included;
- tagged elements: decide whether to keep `<trk>` lines, which StoryImage splits per person, and say which you chose.

**Ethnicity** (ruled): a small fixed pattern, counted as its own feature group. It matches `-American`/`-British` style compounds, `descent`, `heritage`, `ethnicity`, `born in`, plus a short demonym list of roughly 25 common ones (Indian, Chinese, Korean, Japanese, Filipino, Vietnamese, Mexican, Nigerian, …). A demonym counts only with the person's name in the sentence. No describing word is needed for ethnicity.

The names come from the caller:

- `names` is the character's name and aliases, minus shared name words (`isSharedNameWord` and `listNameWordCarriers` are in `ledger.js`; export what you need from there only if it is already exported, or ask the orchestrator);
- `otherNames` is every other ledger character's names and aliases, plus the persona.

**S2. `searchAppearance`.** It builds the passages (`maxChars` 6000), and returns `{ findings: [], passageCount: 0 }` without a call when there are none. Otherwise it fills `prompts/find-appearance.txt` with the character's display name (`characterDisplayName`), aliases, the known appearance kinds with their values, and the passages as `[#at] text`. It calls `callLlm` (`lib/planning/generator.js`, the arc generation profile, the same transport the extraction uses) and parses with `parseLlmJson`.

The answer is `{ "appearance": [{ "kind", "value", "at" }] }`. An item with a kind outside `APPEARANCE_KINDS`, an `at` that is not one of the sent passages' `at`, or an empty value is **dropped** (not the whole answer). One item per kind is kept, the first. `passage` is the text of the passage at `at`. A failed call or unreadable answer gives `{ error }`, with a short English message for the popup.

**The prompt.** Lasting looks only. Never clothing, shoes, the day's jewellery, makeup or passing states. Ethnicity only when named. Never a guess. `features` is one list. Values leave out the kind's word. For each kind, the latest value the passages state, combined when passages add to each other, with `at` the newest passage used. A missing kind means not found. Answer with only the JSON.

**S3. `listOfferedFindings(character, findings)`.** A kind is offered when it is not locked (`isDetailLocked`) and one of these holds:

- the character's current entry for the kind is missing;
- the finding's `at` is newer than the current entry's `at` and the value differs (`isSameDetailValue`);
- the current entry's `at` is null or higher, and `isAppearanceRefinement(kind, current.value, finding.value)` holds.

A current entry with `at: null` that is not a player entry cannot occur for appearance kinds; treat it as "newer".

**S tests (`tests/test-appearance-search.js`).** Expected values are written by hand.

- Passages from a hand-written chat:
  - a hidden message is included;
  - a pronoun sentence follows a named one;
  - another person's feature is excluded ("Ellie's blonde hair" in a Priya sentence);
  - "her eyes went wide" is excluded;
  - a height is found;
  - an ethnicity is found;
  - the per-feature cap and the budget hold.
- The offer rule: unknown; newer and different; older and refining; older and not refining; locked; the same value.
- The parse drops bad items and keeps the good ones. Mock `callLlm` the way the existing extraction tests do (look at how `tests/test-knowledge-*.js` stub the LLM call).
- `giveMessageId`: it gives a hidden message an id and keeps an existing one.

### Agent P: the Knowledge popup

**Owns:**

- `lib/ui/knowledge-popup.js`;
- `lib/css/knowledge.css`;
- `tests/test-knowledge-popup.js`, `tests/test-knowledge-hand-edits.js`, `tests/test-knowledge-merge.js` and a new `tests/test-knowledge-appearance-popup.js`.

**P1. Part A rows.** `isAppearanceEnabled()` is read where `isCharacterDetailsEnabled()` is, and carried in the render context as `withAppearance`. With it on:

- `buildCharacterSheet` lists the appearance kinds under an "Appearance" sub-heading after the detail rows, each through `buildDetailRow` with text fields;
- `listMergeConsequences` and `buildMessageSearch` also go over `APPEARANCE_KINDS`;
- `saveCharacterDetails` and `lockCharacterDetail` accept appearance kinds (`typedDetails` may hold them);
- `KIND_LABELS` gains Ethnicity, Skin, Hair, Eyes, Build, Features.

`detailsSummary` stays unchanged. The "What changed" lines need only the labels; check that a refinement reads as a changed detail. Keyboard: D on a sheet opens details; leave the keys as they are unless an appearance row breaks them.

**P2. Part B UI.** On a character's sheet, with appearance on, an "Appearance" sub-heading action "Search the chat" (`act: 'search-appearance'`) calls `searchAppearance(getKnowledgeLedger(), characterId, chat, personaName)`. Take the persona name the way `ledger.js`'s update does: `getContext().name1`, or whatever the popup already uses.

- While the search runs, the button shows a busy state and the status line says so.
- The result is kept in the view per character (`view.appearanceFindings[characterId]`), so a redraw keeps it.
- Each finding is a line: the kind label, the value, "message #N" (", hidden" when `chat[N].is_system`), a "Show passage" toggle for the passage text, and Accept / Skip.
- "Nothing found" and `{ error }` show in the status line.

**Accept.** A pure edit, `acceptAppearanceFinding(ledger, characterId, finding, messageId)` → `{ ledger, error }`. It appends `{ value, at, messageId }` to the kind's history and never changes its input. It refuses a locked kind, an unknown character or a kind outside `APPEARANCE_KINDS`. The handler first calls `giveMessageId(chat[finding.at])`. It checks that `chat[finding.at]` still exists; otherwise it refuses with a message. It saves through `saveLedgerEdit`, so Undo covers it and the chat with the new id is saved, and removes the line. Skip removes the line without an edit. Every Accept writes one edit; there is no "accept all".

Agent S builds `searchAppearance` and `giveMessageId` in parallel. Import them by the contract names; Agent P's tests cover the pure `acceptAppearanceFinding` and the rendering, not the call.

**P tests.**

- Appearance rows render only with appearance on, with the right sources.
- Saving and locking an appearance kind works.
- The merge preview names an appearance kind.
- `acceptAppearanceFinding`:
  - appends after a newer entry (history in the order recorded);
  - refuses a locked kind;
  - leaves its input unchanged.
- The findings lines render from a view state, with "hidden" for a hidden source.

## Order and verification

1. The groundwork (done) and this plan.
2. Agents L, S and P in parallel. Each runs its own test files (`bash tests/run.sh tests/test-<file>.js`) and must not commit.
3. The orchestrator runs the full `bash tests/run.sh`, writes the docs (ADR-0007 amendment, GLOSSARY, architecture.md "Knowledge Tracker", code-index.md, the AGENTS.md directory tree), and runs `graphify update .`.
4. One `/code-review` pass against this plan and the design note.
5. Live check in ST (port 8008) on the Amy chat, never Paragon:
   - appearance on, a few replies;
   - compare the extraction prompt size and the answers with appearance off;
   - check that clothing stays out, that refinement fires, and that the Appearance line reaches the narrator for present characters;
   - one search on an Amy character, then accept one kind;
   - an edit of that hidden source message makes no call.
6. Commit to main directly (the project's rule for StoryArc) once Stefan says so. CI runs `tests/run.sh` on Node 24 on push.

## Not in this plan

- Clothing, appearance for the planner, a global search button, image tags.
