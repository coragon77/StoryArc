# A Rejected Reply Leaves the Story — Implementation Plan

- **Date:** 2026-11-22
- **Design:** `docs/plans/2026-11-22-rejected-replies-design.md`. That note is the spec, and this plan only orders the work.
- **Go:** Stefan, 2026-11-22: "please crate the plan and then implement … just implement it?" He is playing in SillyTavern while this is built.
- **Verification environment:**
  - GitHub Actions runs `./tests/run.sh` on every push to main.
  - Locally, run only the suites a task touches.
  - One `/code-review` pass at the end.
  - The live check runs in the Amy chat, and only in a time window Stefan agrees to. A second browser tab on his running ST can overwrite his settings, so nothing is driven in the browser without asking him first.
  - Commits go straight to main.

## Where the work happens

The checkout `/opt/sillytavern/StoryArc` is symlinked into Stefan's running ST, so an edit is live on his next page reload. A half-done change, such as a new import without its export, would break his tracker mid-play. So the work happens in a git worktree on a branch: tasks, tests, the Gate and the review. The branch lands on main in one fast-forward after the review, and Stefan is told that his next reload picks it up.

## Amendments to the spec

1. **A broken `rewrites` item is dropped alone.** It does not reject the whole answer, which is how rulings are read already. A broken offer must not cost the knowledge update. This replaces the spec's "rejects the answer, like `retracted`".
2. **Task numbers.** The new task is 8 (REWRITE), and the optional DETAILS task becomes 9.
3. **The Gate runs through SillyTavern's server, from a script.** It does not drive the browser. The script sends `POST /api/backends/chat-completions/generate`, with a CSRF token from `/csrf-token`. The request body copies what `callViaProfile` and ST's request service send for the tracker profile, read from the code, not guessed from the preset file. The server reads the API key itself, so the script never sees it, and Stefan's browser session is not touched. One sample per case is reported case by case, not as proof. Stefan's "just implement it" is read as covering the Gate's 13 calls.
4. **A second Gate miss does not stop the work.** As the spec says, recognition then does not ship and the menu entry ships alone. Stefan is told, so he can reword the `done =`.
5. **The new version comes from the final ticks.** It is the first narrator message after the last ticked message that is not ticked, not hidden and not marked out of character. It is never a rejected message: on Aegis 419–424 by the menu, 423 is ticked, so the new version is 425.
6. **The new version's beats reopen only while the extraction recognises beats** (`beatRecognitionPath() === 'extraction'`), as on the edit path. Otherwise nothing would complete them again. The ticked messages' beats reopen in every case.
7. **Character removal reuses the Knowledge popup's delete-character edit** (issue #66), so every reference goes with the record, including relation and stance `of`.
8. **The `rejected` update log record is not shown** in "What changed". It is enough that the popup ignores an unknown record kind, and the plan checks that.

## Tasks

### 1. Gate: the replay

- `scripts/replay-extraction.mjs` is a repo primitive, like `rebuild-knowledge-block.mjs`. It takes a chat file, the first message of the window and its last message.
  - It cuts the ledger back to the message before the window, the same way `rebuild-knowledge-block.mjs` does.
  - It shows the window's messages as they were (`is_system: false`).
  - It builds the extraction prompt with `buildKnowledgeExtractionVariables` and the template, and calls the server.
  - It prints the raw answer's `rewrites` list and whether each item passes the code's checks.
- The task 8 text goes into `prompts/extract-knowledge.txt` first, because the replay tests the shipped wording.
- The cases and the bar are those in the spec's Gate table: 13 windows, all six positives with a valid quote, and none of the seven negatives.
- If the bar is missed, the wording is changed once and the replay runs again. A second miss stops the work, and the result goes to Stefan.

### 2. Recognition

- `prompts/extract-knowledge.txt`: task 8, REWRITE, and `rewrites` in the answer's JSON shape. DETAILS becomes 9 (`DETAILS_TASK` in `ledger.js`).
- `parseKnowledgeExtractionAnswer` reads `rewrites`, tolerant like rulings.
- `resolveRewrites(rewrites, chatMessages, fromIndex, lastReadIndex)` returns `{ at, quote, newVersionAt }` or nothing. It checks:
  - the window;
  - that `at` is the player's message and shown;
  - the quote (`findQuoteInText`);
  - that a new version follows: a shown narrator message after `at` inside the window, not marked out of character.

  Only the first checked item counts.
- `isMarkedOutOfCharacter(text)`: the trimmed text starts with `[OOC`, `(OOC`, `OOC:` or `((`, ignoring case.
- `updateKnowledgeAfterReply` passes the resolved rewrite back on its result (`rewriteOffer`), unless the new version already carries `story_arc_rewrite_offered`. The update log counts `answer.rewrites`.
- Tests are in `tests/test-knowledge-rewrites.js`:
  - parse;
  - each check;
  - the 412–413 fixture, a report and no new version;
  - the marker test.

### 3. The take-out

- A new file, `lib/knowledge/rejection.js`. One process, in the order it runs:
  - `proposeRejectedSpan(chatMessages, requestIndex, newVersionIndex)`;
  - `proposeSpanFromMessage(chatMessages, startIndex)` for the menu entry;
  - `takeOutRejectedSpan(tickedIndices, newVersionIndex)` with the spec's steps 1–7.
- `message-ids.js` gets the rejected mark:
  - `REJECTED_KEY = 'story_arc_rejected'`;
  - `isRejectedMessage(chatMessage)`, which is true only when the message is marked and `is_system` is set.

  The readers in other files call it, so it lives in the file that already holds Story Arc's per-message data.
- `ledger.js` gets new exports:
  - `dropKnowledgeOfRejectedMessages(ledger, indices)`. It drops holder, detail and meeting entries and scene history entries at those indices. The scene reverts. Retractions are kept, except those left without holders. Facts left without holders go.
  - `dropCharactersOnlyInRejected(ledger, indices, chatMessages)`. It applies the spec's three tests, using the update log's change items and `findQuoteInText` on names over the update's range.
  - The re-read reuses `reextractKnowledgeOfMessage`, exported with the beats offered.

  When the re-read call fails, the new version's read-text hash is removed. `retryPendingReextraction` goes through `updateKnowledgeAfterEdit`, which acts only on a text that differs from the one read, so without this the retry would never call. With the hash gone, the message counts as changed.
- Steps 1–4 run without an await. "Take out" is refused while `isKnowledgeUpdateRunning()` is true, while a retry runs (a new export, `isReextractionRetryRunning()`), or while another take-out runs.
- Beats come from `reopenCompletionsAt` for each ticked index and the new version. Marks come from a new export, `dropPendingMarksAt(indices)`, in `signals.js`.
- The update log record is `{ kind: 'rejected', … }` (counts only), and `listChangeLines` must ignore it or show it as a line. The plan picks "show it": "Messages #411–#414 taken out as rejected".
- Tests are in `tests/test-rejection.js`, with fixtures shaped like the Aegis numbers in the spec's Tests list. Expected values are written out by hand.

### 4. Every reader

- `chat-history.js` `getRecentChat` skips rejected messages (the planner harvest).
- `appearance-search.js` `listNamingPassages` skips rejected messages, which covers both passage searches.
- `updateKnowledgeAfterEdit` and `updateKnowledgeAfterSwipe` (its re-extraction) refuse a rejected message, which also covers `retryPendingReextraction`. A pending entry for a rejected message leaves the list.
- Tests: the harvest skips a marked and hidden message and reads it once unhidden; an edit and a swipe switch of a rejected message make no call.

### 5. The notice, the dialog and the menu entry

- A new file, `lib/ui/rejection-popup.js`:
  - the toast (`toastr`, `timeOut: 0`, `extendedTimeOut: 0`) with a Review link;
  - the dialog (ST `Popup`, rows with checkboxes, the OOC tag, the consequence sentence);
  - "Reject from here…" as a `mes_button` in `.extraMesButtons`, added to `#message_template` and to rendered messages, as StoryImage does.
- The offer keeps message ids and resolves them again on open and on confirm.
- `index.js`:
  - `onMessageReceived` shows the toast when the update result carries `rewriteOffer`, and sets `story_arc_rewrite_offered` on the new version;
  - `CHAT_CHANGED`, `MESSAGE_DELETED` and `MESSAGE_SWIPED` close an open offer toast;
  - the menu-entry click opens the dialog.
- `lib/css/` gets dialog styles in a new `rejection.css`, imported in `style.css`.
- UI strings are in English (onboarding, Localization).

### 6. Docs

- `architecture.md`, Knowledge Tracker:
  - task 8;
  - the take-out as a row of the Rollback table;
  - the readers;
  - the update log record.
- ADR-0007 amendment.
- `GLOSSARY.md`: Rejected span, Rewrite request.
- `code-index.md`: the two new files and the script.
- The goals document: a status log line when it ships. C4 is checked off only after the live check.

### 7. Done gate

1. The suites touched pass (`tests/run.sh` covers them; CI runs it all).
2. `/code-review`, one pass, and its findings fixed.
3. Push.
4. The live check in the Amy chat, in a window agreed with Stefan. These are the five steps of the chapter's `done =`, seen in the Knowledge popup and in "What the narrator gets".
5. C4 is checked off with a dated line, after the live check.
