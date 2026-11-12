# What the Narrator Gets — Design Note

- **Date:** 2026-11-12
- **Status:** Scope rulings 2026-11-12 ("go" on every recommendation of the first round); layout ruling 2026-11-12, layout C ("C ist the most structure and readable for a human"); Part B (the junk in the taken names) added on Stefan's "no just fix it as part of the implementation". Three points assumed, see "Assumed". Implementation plan: `docs/plans/2026-11-12-sent-view.md`.
- **Builds on:** issue #83 (the spec), the Arc Manager (#71) and Knowledge popup designs (`DESIGN.md`)
- **ADRs touched:** none
- **Glossary:** `GLOSSARY.md`, Reveal plan (extended: the view has its own switch, which hides less)
- **DESIGN.md:** the Reveal switch section gets the view's variant (premise and pressures show)

## Problem

When a reply goes wrong, the first question is what Story Arc told the narrator,
and nothing in the UI answers it. In the Paragon chat (2026-11-12) the Gilded
Pedestal arc pushed the story far too fast. The player and an in-ST helper
blamed a lorebook entry. The real driver was the arc's Spotlight focus: the
plan block carried the pressure under `BRING TO A HEAD:` with "Let this
pressure intensify over the coming scenes", plus the unplanted clues and the
secrets. Nobody could see that text. Switching Spotlight to Normal would
have fixed most of it in five seconds.

Measured on the Amy test chat with the real builders (4 active arcs, tracker
on), Story Arc adds about 6,150 tokens to one request: plan 2,639, knowledge
2,139, signals 1,197, names 168, stamp 6. One focus switch (one act from
Spotlight to Normal) takes the plan to 2,204 and the signals to 651.

## Decisions (Stefan, 2026-11-12)

1. **Read-only.** No per-part off switches in this view. A follow-up issue if
   the view shows a part worth turning off.
2. **Both requests, last sent first.** "Last sent" is the text as it went out
   for the latest reply, saved at the send. "Next request" is built now. The two
   differ exactly when a reply changed state (a completed beat moves the
   current pressure; the knowledge block is rebuilt after every reply), so
   only the saved one answers "why did that reply do X".
3. **Spoilers masked line by line** in the exact sent text, each hidden run a
   placeholder with its count and tokens. Premise, world facts and pressures
   always show: they steer every reply and are no plot reveal. This view
   differs from the Arc Manager there, on purpose (issue #83).
4. **Five parts, not four.** The stamp that stamping.js puts in front of the
   player's message goes out too; the view shows the newest one.
5. **Order and placement follow the real prompt**, as SillyTavern's chat
   completion assembles it (`openai.js`, checked 2026-11-12; see the table).
6. **Layout C:** a strip of the whole request on the left, the chosen part's
   text on the right. Mockup reviewed in the browser; built on the shipped
   Arc Manager and Knowledge popup CSS.

## What the narrator gets, in order

As SillyTavern's chat completion builds the request (`openai.js`,
`populateChatCompletion`, `populationInjectionPrompts`):

| Part (UI name) | Prompt key | Where it sits | Built by |
|---|---|---|---|
| Arc plan | `story_arc_plan` | appended to the end of the preset's Main prompt (IN_PROMPT becomes position `end` of `main`) | `buildInjection` |
| Who knows what | `story_arc_knowledge` | in chat, depth 1, system role | `buildKnowledgeBlock` |
| Names already in this story | `story_arc_names` | same depth-1 message, after the knowledge block | `buildTakenNamesBlock` |
| Message stamp | none (outgoing array) | in front of the player's newest message | `buildStamp` |
| Pacing and checks | `story_arc_signals` | in chat, depth 0, after the newest message | `buildSignalInjection` |

The rest of the preset (character card, persona, lorebook, the preset's
other prompts) follows the Main prompt in the order the preset sets; the
view does not show it (out of scope). At one depth and role, SillyTavern
joins the preset's own in-chat prompts and every extension's prompts into
one message, extension keys in alphabetical order, so knowledge comes before
names. The view says so in the sub-line ("one system message with Names and
any depth-1 prompt of your preset or other extensions").

Text completion APIs place the parts through `doChatInject` (script.js)
instead; the view describes chat completion only, which is the API Story
Arc's stamps already require.

## The view cannot drift from what is sent

Issue #83 forbids re-implementing the text for display. The builders are
not the whole story: the gates (Story Arc on, the tracker on, active arcs)
and the position, depth and role values sit in `injectStoryArcPrompts`
(index.js) and `injectKnowledgeBlock` (ledger.js). A view that repeats them
drifts.

So one function returns the prompts, and both the injection and the view use
it:

- **`listStoryArcPrompts()`** returns the four keyed parts in prompt order,
  each `{ key, text, position, depth, role }`, with every gate applied
  (an off part has text `''`). `injectStoryArcPrompts` becomes a loop that
  sets each one; `injectKnowledgeBlock` goes, its tests
  (`test-knowledge-inject.js`, `test-knowledge-appearance.js`,
  `test-knowledge-details-switch.js`) move to the new function. A test pins
  the `setExtensionPrompt` arguments, so the injection stays byte-identical.
  It lives in its own file under `lib/injection/`, because two files call
  it (index.js and the view) and it imports from both `injection/` and
  `knowledge/`.
- **Next request** calls `listStoryArcPrompts()`. Its stamp is
  `buildStamp(selectPacingClock(arcs), index)` for the message the next
  request will stamp: `chat.length` when the newest message is the
  narrator's (the player's next message gets that index), the newest
  message's index when it is the player's.
- **Last sent** is read back, not rebuilt: see below.

This rewrites the path every generation takes, a change beyond the view
itself. It is the one way to keep the view honest; it needs Stefan's yes.

## Last sent: the snapshot

Saved in `onChatCompletionPromptReady` (index.js), the moment the request
goes out, not in `onGenerationStarted`: that handler also runs for ST's dry
runs (token counting), and `onMessageDeleted` sets the prompts again without
a send.

- **What is saved:** for each Story Arc key, the value SillyTavern holds in
  its `extension_prompts` registry at that moment, with position and depth;
  the stamp text `stampPromptMessages` put in front of the newest stamped
  message; and the index of the newest message of the request, saved on its
  own (with no pacing clock there is no stamp to take it from).
- **Which requests:** three conditions, all needed.
  - Not a dry run (already skipped there).
  - Not a quiet generation: `onGenerationStarted` notes the generation type,
    and a `quiet` request (a summary through Generate, an impersonation
    helper) does not replace the snapshot.
  - The outgoing array contains the text of at least one Story Arc part.
    Other extensions' `generateRaw` calls fire `CHAT_COMPLETION_PROMPT_READY`
    too (script.js `generateRawData`) without `GENERATION_STARTED`, so the
    noted type would be stale for them; they never carry Story Arc's text.
    Story Arc's own calls (the extraction, the planner) go through `fetch`
    or the connection manager and do not fire the event.
  `onChatCompletionPromptReady` returns early today when no arc is active;
  the snapshot is taken before that return, so a request with only the
  knowledge block is saved too.
- **Which reply it belongs to:** `chat.length` for a new reply or a
  regenerate (the old reply is deleted before the prompt is built), and
  `chat.length - 1` for a swipe or a continue. The head says "for reply #N".
  Reasoned from script.js, to be observed in the live check.
- **Where:** `chat_metadata.story_arc.lastSent`, one per chat, replaced by
  each send; about 25 KB in the Amy chat (the four texts measured
  2026-11-12). It is written with the reply's own chat save; no extra save.
- **Branches:** SillyTavern copies the metadata whole on a branch. A
  snapshot for a reply past the loaded chat's end is dropped on
  `CHAT_CHANGED`, like the beat completions there.
- **Text completion:** `CHAT_COMPLETION_PROMPT_READY` does not fire there;
  Last sent stays empty and the view says so.
- **Macros:** SillyTavern runs `substituteParams` over in-chat prompts when it
  assembles them. Story Arc's text carries no `{{macros}}` today; the
  snapshot holds the registry value before substitution. Noted, not handled.

## Spoiler masking

Masking classifies lines of the built text; it never builds a second text.
One pure function, `maskSpoilerLines(partKey, text, arcs, ledger)`, returns
the text as runs `{ hidden: boolean, lines, kinds }`. Two rules, and a line
either one catches is hidden:

- **By place.** A secrets, triggers or clues list runs from its header
  (`SECRETS (`, `TRIGGERS (`, `FORESHADOWING TO PLANT:`, the test the budget
  trim uses, exported from builder.js) to the blank line the builder closes
  every list with; the header shows, the lines under it do not. In Pacing
  and checks, the BEAT CHECK lines (they quote fulfillments, marker path)
  and the PLANT CHECK lines (they quote clues and trigger actions), by their
  opening phrases, exported from builder.js and used by
  `buildSignalDirective` and the mask alike.
- **By content.** Any line that contains a line of a secret's content, a
  trigger's condition or action, a clue or its target, or a fulfillment of
  the active arcs. This catches what the place rule misses: nothing
  normalises newlines in plan items (validation keeps them, an Arc Manager
  hand edit can add them), and a continuation line has no `- ` in front.
- **Who knows what:** a line whose "(shared only with …)" names a planned
  holder (a holder with how `plan` in the ledger).
- **Names, stamp:** nothing to mask.

The current arcs and ledger decide, also for Last sent; a plan item edited
since the send is still caught by place.

A hidden run shows as one placeholder: eye-slash icon, "3 triggers, 4 clues
hidden · 455 tokens", dashed edge (DESIGN.md: dashed means not shown/not
real). The view's Reveal plan switch shows them; one switch for the whole
view, off whenever the view opens, as in the Arc Manager. Its state word
counts the hidden lines ("25 lines hidden").

## Layout (C)

The view is a large ST popup in the Arc Manager's grammar (`.am` tokens,
head, status bar):

- **Head.** "What the narrator gets"; one summary line ("Story Arc added
  6,149 tokens to the request for reply #65 · 4 active arcs, one in
  spotlight"; for Next request "would add … · 981 fewer than last sent").
  On the right the Last sent / Next request segmented control and the Reveal
  plan switch.
- **Note line** (the Arc Manager's note variant) under the head. Last sent:
  when it was saved and what stays hidden. Next request: that sending a
  message can still change it (a beat may become current; Who knows what
  reads the player's message for who is talked about), and that marked
  lines differ from the last sent request.
- **Strip, left, 280px.** The request top to bottom: SillyTavern's own parts
  as quiet dashed spacers, Story Arc's parts as blocks with name, token
  count and placement, their height following their tokens (with a floor
  so a 6-token stamp stays readable). Top to bottom: "Main prompt (your
  preset)", Arc plan, "Card, persona, lorebook and the rest of your preset",
  "Chat history to #63", Who knows what, Names, "Your newest message, #64"
  with the Message stamp block, Pacing and checks, "The reply is written
  here". One block selected, emphasis outline; the plan is selected on
  open. Blocks are buttons; arrow keys move between them.
- **Reader, right.** The part's name, its placement and a sub-line with the
  depth ("In chat, depth 1 · one system message with Names and any depth-1
  prompt of your preset or other extensions"), its tokens (the plan's "of a
  3,000 budget"), then the text in a sunken well, as sent: line breaks kept,
  section heads (`=== … ===`, the CAPS labels) at weight 600, hidden runs as
  placeholders.
- **Next request marks** lines that are not in the last sent text with the
  emphasis tint. Tokens show the change against last sent ("651 tokens · 546
  fewer than last sent").
- **Status bar.** "Read-only. Correct the plan in the Arc Manager, the
  knowledge in the Knowledge popup." and Close.
- **Entry points.** A button in the drawer's action row and in the wand
  popup (closes the wand popup first, then opens, as Plan and Manage do).

Type: the theme's main font, never mono (DESIGN.md allows mono only in the
JSON editor; the prompt is prose). Token counts use `estimateTokens`, the
estimate the plan budget trim uses (characters / 4).

### States

- **Story Arc off:** the strip shows only SillyTavern's spacers; the reader
  says "Story Arc is off: it sends nothing."
- **No part has text** (no active arc, tracker off): the same, "Story Arc
  sends nothing to this chat right now."
- **No snapshot yet** (new chat, text completion, a branch dropped it): Last
  sent is disabled with its reason in the tooltip; the view opens on Next
  request.
- **An empty part** (the names block with no names): its block stays in the
  strip at the floor height with "0"; the reader says "Nothing: this part is
  empty for this request."

## Out of scope

- Editing from this view; off switches (decision 1).
- The rest of the SillyTavern prompt: preset, card, lorebook, other
  extensions' prompts.
- Copying the text out. (The mockup had a Copy all button; not part of #83.)
- The extraction call and the planner's calls: they are not the narrator's
  request.

## Part B: junk in the taken names

The mockup showed it first: the Amy chat's names block tells the narrator
that `07, 904, A, ID, with, Unknown, Woman` are taken names. Stefan,
2026-11-12: "no just fix it as part of the implementation".

### Where the words come from

`listTakenNames` (names.js) takes every word of every name and alias. Run
read-only over the two chats on 2026-11-12, three kinds of word get through
that are not names:

| Cause | Amy | Paragon |
|---|---|---|
| Hyphen pieces are not re-checked: `nameWords` drops a word without a letter, but `listTakenNames` splits at hyphens after that | `HH-904` → 904; `ID #07-A` → 07, A | `W-04`, `W-09` → 04, 09, W |
| A trailing initial stays (a leading one is dropped as a title) | `Mara K.` → K | `Julien M.`, `Bishop, M.` → M; `M. G.` → G |
| A description stored as a name in Title Case; the description rule only catches names with no capital at all, and only particles are dropped as lowercase words | `Unknown Caller`, `Woman with Umbrella`, `Mezzanine Hostess` | `Nurse Cruz` → Nurse, `SFX Tech`, `Waiter #4` |

Codenames (`AMY_CORE`, `MARA_K`, `CapeChaser_415`) and nicknames (`Red`) are
names: the block's header names codenames, and they stay.

The cost is larger than the block's few tokens. The same derivation feeds
the reused-name flag (`listSharedNames`, ledger.js), the shared-name-word
rule (`isSharedNameWord`) and the planner's cast block: a new "Nurse Patel"
in Paragon would be flagged as sharing a name with Nurse Cruz, a "Waiter #2"
with "Waiter #4", any new "… M." with Julien M. and Marcus Bishop
(reasoned from the code, not observed).

### The fix

No word list of non-names: the NPC names goals document rules out
blacklists, and a list of role words would never be complete.

1. **A hyphen piece without a letter is no name.** `listTakenNames` applies
   the letter test of `nameWords` to the pieces too: `HH-904` gives `HH`.
2. **A single letter is an initial, never a name**, wherever it stands:
   `Mara K.` gives `Mara`, `ID #07-A` gives `ID`.
3. **In a name of several words, a lowercase word is no name word**, not
   only a particle: `Woman with Umbrella` loses `with`. A single lowercase
   word ("zoe") still counts, as now.
4. **A name or alias that starts with a lowercase "the", "a" or "an" is a
   description and gives no words**, whatever its other capitals: "the
   Obsidian Lounge hostess". Today only a description without any capital
   is caught.
5. **The extraction writes descriptions that way.** NEW CHARACTERS in
   `prompts/extract-knowledge.txt` gets one sentence: a character the
   messages give no name is listed under a short lowercase description that
   starts with "the" ("the woman with the umbrella"), never a made-up name
   or a Title Case label ("Unknown Caller"); a name learned later goes under
   newNames. Rule 4 then keeps it out of the taken names.
6. **"nurse" joins the title words**, next to "doctor" and "officer": `Nurse
   Cruz` gives `Cruz`.

The records already stored are not rewritten. Rules 1 to 3 and 6 clean the
ones they cover on the next build of the block; the Title Case
descriptions already in a ledger (`Unknown Caller`, `Waiter #4`, `SFX Tech`)
stay until the player renames them in the Knowledge popup. The plan lists
Paragon's candidates for that, read-only.

The block changes once for every chat whose ledger had such a word: one
prompt-cache miss (ADR-0005), then stable again.

## Assumed (asked 2026-11-12, not ruled; Stefan's "fix it as part of the implementation" taken as the go)

- **`listStoryArcPrompts()`**, the one function the injection and the view
  share, as described above.
- **The view's Reveal switch** gets a line in the glossary's "Reveal plan"
  entry and in DESIGN.md's Reveal switch section: it hides secrets,
  triggers, clues and fulfillments; premise and pressures show.
- **Removed lines in Next request** are not shown; the token change against
  last sent says that text went away. Struck-through lines can follow if the
  view needs them.

## Verification

- Unit tests:
  - `listStoryArcPrompts`: gates, keys, positions, depths (the migrated
    `injectKnowledgeBlock` tests), and the `setExtensionPrompt` arguments
    `injectStoryArcPrompts` passes, pinned.
  - The snapshot: a dry run, a quiet generation, a `generateRaw` array
    without Story Arc text and a deletion save nothing; a new reply saves
    for `chat.length`, a swipe for the swiped index.
  - `maskSpoilerLines` asserts the outcome: no secret content, trigger
    condition or action, clue, clue target or fulfillment from a fixture
    appears in the masked rendering, including an item with a newline and
    one with a blank line inside; every one appears with Reveal on.
- Part B, unit tests on `listTakenNames` / `printTakenNames` with the
  measured inputs as fixtures (`HH-904`, `ID #07-A`, `Mara K.`, `M. G.`,
  `Woman with Umbrella`, `the Obsidian Lounge hostess`, `Nurse Cruz`) and
  hand-written expected lists; and that `listSharedNames` no longer flags
  "Nurse Patel" against "Nurse Cruz".
- Live check in the Amy chat (never Paragon): open the view from the drawer
  and the wand popup; send a message and see Last sent for that reply;
  regenerate, swipe and continue, and check the reply number each time;
  switch an arc to Spotlight and see Next request change; reload ST and see
  Last sent survive; afterwards reopen the chat Stefan was in.
