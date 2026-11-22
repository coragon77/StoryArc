# A Rejected Reply Leaves the Story — Design Note

- **Date:** 2026-11-22
- **Status:** Design approved; Stefan said "go" to the recommendation package of 2026-11-22, items 1–7 below. No implementation plan yet. The replay gate (Gate) runs before any code.
- **Chapter:** C4 of `docs/goals/saga-planning-and-focus.md`
- **Builds on:** ADR-0007 (the tracker) and its rollback, ADR-0008 (recognition in the extraction), the single-message re-extraction of an edit (`architecture.md`, Knowledge Tracker, Rollback)
- **ADRs touched:** `0007`, as an amendment: a span the player rejects is taken out of the ledger and out of every reader of the chat
- **Glossary:** `GLOSSARY.md`: Rejected span (new), Rewrite request (new)

## Problem

Stefan corrects the narrator out of character. He does not delete or swipe: "I can't deleted messages in the midst of a conversation in ST. Swiping is a bad idea because it breaks the cache." (`keeping-the-story-on-track.md`, Decided). The pattern is:

1. the narrator writes a story reply he rejects;
2. he writes an out-of-character line, often "Stop the RP and report back";
3. the narrator sends an out-of-character report;
4. he asks for a rewrite ("Yes, rewrite", "Rewrite - its getting really boring.", or "No. I didn't tell you to …" without the word);
5. the narrator writes the new version as a new message.

The rejected reply stays in the chat. Today nothing in Story Arc reacts to that, and the rejected content keeps coming back. The goal statement, 2026-11-22: "the LLM does something I either miss or try to fix by rewrites and OOC and the error keeps popping up like a whack-a-mole."

Measured in the Aegis chat on 2026-11-22 (read-only, `checks.py` in the C4 run folder):

- **Facts from rejected replies are live.** 411 holds f380–f382, 419 holds f384–f386, 423 holds f387–f389, and 425 holds f390–f392. 387 carries f354 and 409 carries f379, which corrects the goals document's Facts row. None of these facts is retracted.
- **Meetings from them are live.** The meetings at 423 and 425 make Ellie "have met" Ilyas and DeLuca.
- **Characters from them are live.** Jude Callahan and Capt. Malkin (419), and Roman DeLuca and Shatterjack (425), appear nowhere else. They stay in the cast, and their names are in the taken-names block the narrator gets. Character records carry no message index.
- **Only 419–424 are hidden, and Stefan hid them himself.** "If 419-424 contains an OOC discussion between me and the LLM, yes I did. I didn't want the wrong stuff to get stored in memory by SummaryCeption". 387–391 and 407–418 are visible to the narrator.
- **A rejection can reach back several turns.** In the Paragon chat, 3033 rewrites the answer to Stefan's turn at 3022. So 3023, 3025 and 3027 are rejected, with his in-character turns 3024 and 3026 between them, and he hid 3023–3032 as a whole. Code cannot tell where such a span starts.
- **Text overlap cannot spot a rewrite.** Word-trigram overlap is 0.91 for 391 against 387 and 0.52 for 415 against 411. But it is only 0.24 for 423 against 419 and 0.28 for 425 against 423, the same as an ordinary next reply (0.2–0.4).
- **The new version must be read again.** f354 has holders only at 387, the rejected reply. 391 is 91% the same text and added no holder, because the extraction prompt says "Leave out characters who already know it". Dropping 387's entries without reading 391 again would delete a true fact.
- **Hiding is not enough inside Story Arc.** Two readers ignore `is_system`:
  - The planner's harvest (`lib/context/chat-history.js` has no filter), so a re-plan would read a rejected reply as story.
  - The appearance search, which reads hidden messages on purpose because Summaryception hides almost everything.
- **Hiding cannot be the signal either.** Summaryception hides 3,258 of Paragon's 3,294 messages, and the tracker must keep what those taught.

## Decisions (Stefan)

Stefan answered "go" to this package as a whole (2026-11-22):

1. **Story Arc offers, the player confirms.** When a rewrite the player asked for arrives, a dialog proposes the span to take out. The player can move its start back, and nothing happens without his click. The same dialog opens from the message menu, for what recognition misses and for a reply rejected without a rewrite (Aegis 425).
2. **The existing extraction recognises the rewrite request.** It is one more task in the call after each reply, so no call is added per reply. The item must quote the player's words, and the quote is checked like a ruling's. "Continue", "So?" or a stop-and-report on its own are not rewrite requests.
3. **The whole span is ticked by default, the player's out-of-character lines included.** Each message can be unticked. This matches what Stefan does by hand, and his reason: the wrong content must not reach Summaryception's memory.
4. **What "taken out" means:**
   - hidden in SillyTavern;
   - marked by Story Arc, so the planner and the appearance search skip it;
   - the tracker drops what it learned there, characters who exist only there included;
   - beats completed there reopen;
   - the player's rulings and retractions stay.
5. **The new version is read again.** One re-extraction per confirmed take-out, never per reply, so that facts like f354 survive.
6. **Not in C4:**
   - an undo;
   - storing scene-level corrections (Stefan's open question);
   - recognition while the tracker is off. The menu entry still hides and marks.
7. **A replay before code** checks recognition on real cases, with the tracker profile, in about 10 calls.

## What changes, in one paragraph

The knowledge extraction gets an eighth task, REWRITE. When the player's out-of-character line in the new messages asks for a story reply to be written again, and a narrator story reply follows it in the new messages, the answer names the line by index and quotes it. A checked item shows the player a notice: "Reply #415 is a rewrite you asked for. Take out what it replaces?" The notice opens a dialog listing the messages around the proposed span, with checkboxes. On "Take out", Story Arc does five things:

- hides the ticked messages;
- marks them as rejected;
- drops what the knowledge ledger learned at them, characters who exist only there included;
- reopens the beats they completed;
- reads the new version again against the cleaned ledger.

The next prompt has neither the rejected text nor anything the tracker learned from it. Nothing is added to what the narrator gets.

## Recognition: task 8, REWRITE

Added to `prompts/extract-knowledge.txt` after OVERRULED. It is the extraction prompt, not the narrator's: Decided item 9 of the goals document ("Nothing new is added to what Story Arc sends") holds.

What the task says, in substance (the plan fixes the wording, and the Gate tests it):

- Report a player's out-of-character line in the new messages that asks the narrator to write a story reply again. This covers a rewrite, a redo or "try again", and also a rejection that says what should happen instead ("No. I didn't tell you to recycle Ren - I told you to …").
- Report it only when a narrator story reply follows that line in the new messages, so the new version is there.
- Do not report a line that only stops the story or asks for a report, asks a question, says to continue, or states a ruling about the plan. When in doubt, leave it out.
- The item is `{ "quote": "<the player's words that ask for it, copied exactly>", "at": <index of the player's line> }`. The answer key is `rewrites`.

The checks in code, in `parseKnowledgeExtractionAnswer` and the apply:

- A missing `rewrites` reads as `[]`. A non-list, or an item without a string `quote` and an integer `at`, rejects the answer, like `retracted`.
- `at` lies inside the new messages, is a player message, and contains the quote (`findQuoteInText`). A narrator message that is not hidden follows it inside the new messages. Otherwise the item is dropped with a warning.
- The new version is the first narrator message after `at` that the code's out-of-character test (below) does not mark.
- The update log records `answer.rewrites` as a count, never the text.

One offer per new version: the new version carries `extra.story_arc_rewrite_offered` once a notice was shown for it, so a re-extraction after an edit or a swipe switch does not offer again.

Recognition needs the tracker on, like rulings, and does not follow `autoTrack`.

## The out-of-character test in code

The proposal and the dialog need to tell the narrator's reports from story. Code uses a marker test: the trimmed text starts with `[OOC`, `(OOC`, `OOC:` or `((`, ignoring case. All of Stefan's out-of-character lines, and all the narrator's reports in Aegis and Paragon, start with `[OOC:`. The test only shapes the proposal, which the player sees and can change, so a miss costs a tick, not knowledge.

## The proposal

- **Proposed start:** the latest narrator message before the rewrite request that is not hidden and not marked by the test, the reply the request is about.
- **Proposed end:** the message before the new version.
- **Ticked by default:** every message from start to end, including the player's out-of-character lines and the narrator's reports (Decided, item 3).

For Aegis 414→415 the proposal is 411–414, and for 424→425 it is 423–424. 419 was taken out when 423 arrived. For Paragon 3032→3033 the proposal is 3027–3032, and Stefan moves the start back to 3023.

## The notice and the dialog

- **The notice** is a SillyTavern toast that stays until it is clicked or closed: "Reply #415 is a rewrite you asked for. Take out what it replaces? [Review]". It appears a few seconds after the reply, when the extraction applies. A toast, not a popup, because a modal dialog would land while the player is typing. This choice is the spec's and Stefan's to overrule.
- **The dialog** lists the messages from 12 before the proposed start through the new version. Each row has the index, who wrote it, its first line and a checkbox. Rows marked out of character show a small "OOC" tag. The new version is shown and cannot be ticked. Ticking a row before the proposed start moves the start: the rows between it and the start are ticked too. Every row can be unticked.
- The dialog states what will happen, in the player's words: "Hidden from the narrator and from summaries; what Story Arc learned from them is taken back. Unhiding later shows them to the narrator again, but the knowledge does not come back."
- Only chat text is shown, never plan text (spoiler rule).
- **The menu entry:** "Reject from here…" in each message's menu, while Story Arc is on, opens the same dialog. The chosen message is the proposed start. The proposed end is the message before the first narrator message after it that the out-of-character test does not mark, or the chat's last message if there is none. That covers Aegis 425, rejected at 426 and never rewritten. The plan settles how the entry joins ST's message menu (`st-extension-patterns.md`).

## Taking a span out

On "Take out", in this order, all before one save:

1. **Hide and mark.** Each contiguous run of ticked messages is hidden through ST's `hideChatMessageRange(start, end, false)` (`public/scripts/chats.js`), which updates the message blocks too. Each ticked message gets `extra.story_arc_rejected = true`. A message counts as rejected only while it is both marked and hidden. If the player unhides it in ST, it is part of the story again for every reader, but its knowledge stays gone.
2. **Drop what the ledger learned there.** For each ticked message, the take-out drops its holder entries, character details and meetings, as `dropKnowledgeLearnedAt` does for an edit. Facts left without a holder go, as in the rollback. The scene history drops entries recorded at ticked messages. `dropKnowledgeLearnedAt` cannot be called as it is: its predicate also goes to `keepOnlyHolders`, which puts back every retraction whose `at` it rejects (`lib/knowledge/ledger.js`, read 2026-11-22). A retraction stated at a ticked out-of-character line would bring its fact back. So the take-out keeps every retraction and still drops ticked holder entries of retracted facts. Kept:
   - entries the player entered (`at: null`);
   - retractions, because the player's correction stands;
   - rulings (`rulings` on the arcs), because the player's word stands.
3. **Drop characters who exist only there.** A character goes when both of these are true:
   - the update log's change items list them as new in an update that read a ticked message;
   - after the drop, no holder entry, detail, meeting or scene presence names them, and they have no alias or detail the player entered.

   A character the log no longer shows (it keeps 20 records) stays. Dropping them also takes their names out of the taken-names block. This is new: until now "records are never rolled back" (`keepOnlyDetailEntries`), and the ADR-0007 amendment says that a take-out is the exception.
4. **Reopen beats and drop marks.** `reopenCompletionsAt` runs for each ticked message, and queued marks at ticked messages are dropped. An applied mark stays, as it does after a delete today.
5. **Read the new version again.** If there is a new version, it goes through the single-message re-extraction (`reextractKnowledgeOfMessage`), as after an edit:
   - it drops what was learned at the new version and reads it against the cleaned ledger, so f354's case keeps its fact;
   - it reopens the new version's completions and offers them again, as an edit does;
   - a failed call goes on `pendingReextractions` and is retried as for an edit.

   This is the one added call, per confirmed take-out.
6. **Record and refresh.** The update log gets `{ kind: 'rejected', from, to, messageIds, factsDropped, holdersDropped, charactersDropped, beatsReopened }` (counts only). Then the save, `updateProgress`, the status line, and `injectStoryArcPrompts`.

With the tracker off, steps 1, 4 (completions recorded by ARC_SIGNAL) and 6 run. Steps 2, 3 and 5 have no ledger to work on.

Hiding messages near the end of the chat changes the prompt from the first hidden message on, so the next generation misses the prompt cache from that point. That happens once per take-out, close to the end of the chat. A swipe also costs a cache miss, but it costs one every time.

## Every reader of the chat

The plan lists each place that reads `chat` and says how it treats a rejected message. Known now:

| Reader | Today | After C4 |
|---|---|---|
| The narrator's prompt (ST) | skips hidden | unchanged |
| Summaryception | skips hidden | unchanged |
| Knowledge extraction, talked-about | skip hidden | unchanged; an edit of a rejected message re-extracts nothing |
| Planner harvest (`chat-history.js`), plan check, re-plan | read hidden | skip rejected |
| Appearance search | reads hidden on purpose | skips rejected |
| Rulings and the context message | skip hidden | unchanged |

## Gate: the replay before code

Run before any code is written, on Stefan's go to its cost: about 10 calls on the tracker's connection profile, read-only on the chat files. Each case is the extraction's window, the player's line and the narrator's next reply, under the new task text:

| Case | Expect |
|---|---|
| Aegis 390→391, 414→415, 422→423 | rewrite |
| Aegis 424→425 ("No. I didn't tell you to …", no "rewrite") | rewrite |
| Paragon 3032→3033 ("Please do."), 3054→3055 | rewrite |
| Aegis 406→407 ("Ellies does, continue"), 418→419 ("So?") | none |
| Paragon 3044→3045 ("Perfect … continue", after a discussion) | none |

The bar is all six positives with a valid quote and none of the three negatives. If the bar is missed, the task text is reworded once and the replay run again. If it is missed a second time, recognition does not ship: C4 ships the menu entry only, and the result goes to Stefan. The existing RETRACTED task fired 0 times on this pattern in Aegis, so recognition is not assumed to work.

## Tests

Unit tests, with expected values written out by hand:

- `parseKnowledgeExtractionAnswer`: a missing `rewrites` reads as `[]`; a malformed item rejects the answer.
- The item check drops an item:
  - whose `at` is outside the window, or is a narrator message;
  - whose quote is not in the text;
  - that has no narrator reply after it in the window.
- The proposal on fixture chats modelled on Aegis 410–415 (411–414), 418–425 after 419 was taken out (423–424), and Paragon 3022–3033 (3027–3032).
- The menu-entry proposal on a fixture like Aegis 425–427: 425–427, nothing after.
- Taking 411–414 out of a fixture ledger shaped like Aegis:
  - f380 goes;
  - f381 keeps only its 415 holder;
  - f361 keeps its 397 holders;
  - the meeting at 411 goes;
  - a ruling quoting 412 and a retraction at 412 stay;
  - a user-entered holder stays.
- A character listed as new by the update that read 425, with no other trace, goes; one with a holder entry at 427 stays.
- The f354 case: a fact held only at the rejected message is gone after the drop and back after a (mocked) re-extraction answer for the new version.
- The harvest skips a message that is marked and hidden, and reads it once it is unhidden.
- One offer per new version: a second apply for the same message shows no notice.

The live check is the chapter's `done =`, in the Amy chat:

1. A story reply.
2. An out-of-character rewrite request.
3. The new version, then the notice and "Take out".
4. The ledger holds no fact, holder entry or meeting recorded from the rejected reply.
5. The next prompt (seen in "What the narrator gets") has no rejected reply, and its knowledge block carries none of its content.

## Cost

- The extraction prompt grows by the task text, about 700 characters per call.
- The answer grows by a usually empty list.
- One re-extraction call per confirmed take-out.
- The Gate costs about 10 calls, once.

## Changes outside the code

- `architecture.md`, Knowledge Tracker: task 8, the take-out as a row of the Rollback table, the readers table.
- ADR-0007 amendment; `GLOSSARY.md`: Rejected span, Rewrite request.
- `code-index.md` for any new file. "One process, one file": the take-out is one process in one file. The plan names it, for example `lib/knowledge/rejection.js` with the dialog in `lib/ui/`.
- The goals document: the C4 line links this note, and the status log corrects the Facts row (f379 at 409, f354 at 387).

## Risks

- **Recognition misses rewrites, or offers on ordinary out-of-character lines.** The Gate measures this. A false offer is a toast the player closes, and a miss leaves the menu entry.
- **The player ticks too much.** The dialog states the consequence, and no undo ships in C4. Unhiding restores the text for every reader, but not the knowledge.
- **An update reading the span is running during the take-out.** Its answer is dropped by the existing "ledger moved" or "chat changed" checks if the take-out moved `lastUpdatedAt`. Otherwise it applies to the re-read ledger. The plan must check that it cannot bring back entries at a rejected message.
- **A take-out deep in a long chat** where entries carry no message id (ledgers from before #19). The index rule applies to ticked indices only, and no indices shift, because nothing is deleted.

## Not in scope

- An undo of a take-out.
- Storing scene-level corrections such as "we can't speedrun this" (Stefan's open question in the goals document).
- Cleaning the Aegis chat's existing rejected replies. Once C4 ships, Stefan can use the menu entry on them himself, in the original chat or a branch.
- Recognition with the tracker off.
- Reopening an applied clue or trigger mark.

## Open questions

None new. Whether the narrator should keep a scene-level correction once its out-of-character lines are hidden stays with Stefan, under the goals document's existing question.
