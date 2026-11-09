# Code Index

- **Coverage:** `index.js`, `lib/`, `prompts/`, `tests/`, `style.css`, `manifest.json`
- **Last Updated:** 2026-11-09

File structure and module dependencies. For quick reference, see [CLAUDE.md](../../CLAUDE.md). For system design, see [architecture.md](./architecture.md).

## Directory Structure

```
StoryArc/
├── index.js                    # Entry point, UI setup, event wiring
├── style.css                   # CSS import hub
├── manifest.json               # SillyTavern extension manifest
├── .gitignore                  # Git ignore rules
├── CLAUDE.md                   # AI coding assistant reference
├── prompts/
│   ├── analyze-context.txt     # Phase 1 prompt: analyze harvested context into story state;
│   │                           #   explains the [BEING RE-PLANNED] mark on existing arcs
│   ├── ask-questions.txt       # Wizard question call: 0-5 questions about the author's
│   │                           #   intent the direction leaves open, 2-4 suggested
│   │                           #   answers each; never plot, twists or secrets
│   ├── generate-arc.txt        # Phase 2 prompt: produce JSON arc plan from analysis;
│   │                           #   asks for both faces of each beat (pressure +
│   │                           #   fulfillment, one on-screen moment: never a tally
│   │                           #   of scenes or a chain of events) plus breather
│   │                           #   beats and unresolved threads; {{TIER_BLOCK}} sets beat kind, count and
│   │                           #   length band ("Scene beats only" tags the episode-only
│   │                           #   guidelines); {{ARC_SO_FAR}} on re-plan; {{CAST_BLOCK}}
│   │                           #   and {{CAST_CHECKLIST}} with the tracker on; renders enabled
│   │                           #   arc directives as a STANDING CONSTRAINTS section
│   ├── check-plan.txt          # Phase 3 prompt: plan check — rewrite give-away triggers
│   │                           #   and pressures, list revealed secrets (re-plan),
│   │                           #   rewrite tally/chain fulfillments ({{FULFILLMENTS}},
│   │                           #   kind "fulfillment") into one moment, link triggers
│   │                           #   to secrets; author's answers ({{AUTHOR_ANSWERS}}) as
│   │                           #   public input; step 2 also rewrites contradictions
│   │                           #   with the cast's details, sweeping world facts and
│   │                           #   off-register items (ADR-0009 amendment); answers JSON (ADR-0006)
│   ├── extract-knowledge.txt   # Knowledge extraction prompt (ADR-0007): who is present,
│   │                           #   new characters, who learned which fact and how,
│   │                           #   revealed secrets with what was heard, and (task 6)
│   │                           #   the {{DEVELOPMENTS}} the messages fulfilled
│   │                           #   (ADR-0008); answers JSON
│   └── detail-pass.txt         # Old detail-pass draft (not loaded); carries the
│                               #   one-moment fulfillment rule too
├── lib/
│   ├── core/
│   │   ├── constants.js        # MODULE_NAME, INJECTION_HEADER, defaultSettings,
│   │   │                       #   defaultPerChatSettings, ARC_PHASES, PHASE_ORDER,
│   │   │                       #   PACING_DIRECTIVES, TIER_TABLE (label, beatKind,
│   │   │                       #   beatCount, lengthBand per tier), ARC_FOCUS,
│   │   │                       #   createDefaultArc(); knowledge tracker:
│   │   │                       #   defaultKnowledgeTrackerSettings (off, interval 1),
│   │   │                       #   KNOWLEDGE_PROMPT_KEY ('story_arc_knowledge'),
│   │   │                       #   NAMES_PROMPT_KEY ('story_arc_names'), HOLDER_HOW,
│   │   │                       #   createEmptyKnowledgeLedger() — the ledger's schema
│   │   └── settings.js         # loadSettings(), getSettings(), isEnabled(),
│   │                           #   ensureChatState() (runs migrateArc() over arcs
│   │                           #   stored before tiers existed — see the migration
│   │                           #   note in architecture.md), getChatSettings(),
│   │                           #   arcTier(arc), arcMessageStart(arc) — the tier and
│   │                           #   messageStart fallbacks, named once;
│   │                           #   arcWorldFacts(arc) — the world facts, [] on arcs
│   │                           #   stored before them (ADR-0009);
│   │                           #   getKnowledgeTrackerSettings(),
│   │                           #   isKnowledgeTrackerEnabled(), isCharacterDetailsEnabled(),
│   │                           #   getKnowledgeLedger()
│   │                           #   (ensureChatState creates an empty ledger),
│   │                           #   secretHolders(secret) — [] for old secrets
│   ├── context/
│   │   ├── harvester.js        # harvestContext() — orchestrates all context sources,
│   │   │                       #   returns HarvestedContext object;
│   │   │                       #   selectStoryMessages() (private) drops messages
│   │   │                       #   naming plan ids, the injection header or markers;
│   │   │                       #   fetchLorebookEntries(), filterAndSort(),
│   │   │                       #   categorizeEntries() — read World Info entries,
│   │   │                       #   classify into constants / arcSummaries / recent;
│   │   │                       #   getCharacterData(), getPersonaData() (private) —
│   │   │                       #   character card fields + user persona;
│   │   │                       #   harvestCast() (private, #44) — the ledger's
│   │   │                       #   named characters { name, aliases, details } (#55: no unnamed relative; details: current
│   │   │                       #   value per kind via currentDetailText, {} while details are off) while Story Arc and
│   │   │                       #   the knowledge tracker are on, else []
│   │   └── chat-history.js     # harvestChatHistory() — recent messages with token budget,
│   │                           #   estimateTokens()
│   ├── planning/
│   │   ├── generator.js        # generateArc(context, userDirection, callbacks, { tier, reviseArc, genre, themeSeeds, analysis, authorAnswers }) —
│   │   │                       #   two-phase LLM generation with retry logic (a given
│   │   │                       #   analysis skips Phase 1); stamps
│   │   │                       #   tier, direction, genre, themeSeeds, authorAnswers,
│   │   │                       #   messageStart, lastFulfilledAt;
│   │   │                       #   prepareArc() = Phase 1 + the question call
│   │   │                       #   (buildAskQuestionsVariables with buildSeenArcSoFar:
│   │   │                       #   only what play has shown; parseAuthorQuestions,
│   │   │                       #   answeredAuthorAnswers); formatAuthorAnswersBlock()
│   │   │                       #   fills {{AUTHOR_ANSWERS_BLOCK}} in Phase 2;
│   │   │                       #   formatGenreBlock(genre, phase) fills {{GENRE_BLOCK}}
│   │   │                       #   in both phases (ADR-0004);
│   │   │                       #   formatThemesBlock(themeSeeds) fills {{THEMES_BLOCK}}
│   │   │                       #   in Phase 2 only: colour, never obligations;
│   │   │                       #   formatCastBlock(cast, 'outline'|'checklist') fills
│   │   │                       #   {{CAST_BLOCK}} and {{CAST_CHECKLIST}} in Phase 2
│   │   │                       #   (#44): cast, taken names, two rules; '' for no cast;
│   │   │                       #   passes { tier } into validateArcPlan; on re-plan
│   │   │                       #   merges with mergeReplan(reviseArc, arc), then
│   │   │                       #   runPlanCheck() (Phase 3) with the exported
│   │   │                       #   buildPlanCheckVariables() / applyPlanCheck()
│   │   │                       #   (also the open beats' fulfillments, rewrites
│   │   │                       #   of completed beats ignored; the world facts by
│   │   │                       #   index in {{WORLD_FACTS}}, kind "worldFact" applied
│   │   │                       #   by applyWorldFactRewrites — a text replaces, an
│   │   │                       #   empty text drops, an unknown index is ignored;
│   │   │                       #   renamePlanTexts reaches world facts; with a cast the
│   │   │                       #   {{NAMES_BLOCK}} and the renames, applied by
│   │   │                       #   applyPlanRenames to every text field under
│   │   │                       #   its guards, #49; kind "secret" judged after the
│   │   │                       #   revealed list: proposedContent for the re-planned
│   │   │                       #   arc's own secrets, content replaced otherwise,
│   │   │                       #   renames reach proposedContent);
│   │   │                       #   plantedCluesOfSecret(arc, secretId) — planted clues
│   │   │                       #   whose target's leading id (after an optional
│   │   │                       #   "secret:") is the secret's; listed under each
│   │   │                       #   secret in {{SECRETS}}, also used by wizard.js;
│   │   │                       #   formatExistingArcs(arcs, reviseArcId, reviseRulings)
│   │   │                       #   marks the re-planned arc (its rulings under it as
│   │   │                       #   "Overruled by the player:") in phase 1,
│   │   │                       #   omits it in phase 2; formatRulings() prints
│   │   │                       #   rulings for all three calls (also {{RULINGS}}
│   │   │                       #   in the plan check);
│   │   │                       #   callViaProfile() streams via
│   │   │                       #   ConnectionManagerRequestService when a profile
│   │   │                       #   is set; callBackendDirectly() POSTs
│   │   │                       #   /api/backends/chat-completions/generate and
│   │   │                       #   reads the SSE stream (fallback, bypasses
│   │   │                       #   generateRaw); isRetryableError(detail) — empty
│   │   │                       #   responses and gateway/timeout errors retry,
│   │   │                       #   auth/model errors fail fast;
│   │   │                       #   formatArcDirectives() renders the enabled
│   │   │                       #   preset directives into Phase 2;
│   │   │                       #   callbacks report steps and streamed chars;
│   │   │                       #   buildTierBlock(tier) → {{TIER_BLOCK}}: "== TIER: … =="
│   │   │                       #   with beat kind, beat count, length band and the
│   │   │                       #   milestone rules (a fulfillment is one on-screen
│   │   │                       #   moment), all from TIER_TABLE;
│   │   │                       #   buildArcSoFar(arc) → {{ARC_SO_FAR}} on re-plan: current
│   │   │                       #   premise + "write a premise for the arc as it stands
│   │   │                       #   now" (following every ruling, listed as binding,
│   │   │                       #   when the arc has rulings), secrets (add-only),
│   │   │                       #   escalation, fulfilled beats as
│   │   │                       #   "already happened"; '' for null (plan-new);
│   │   │                       #   loadTemplate(name), fillTemplate(template, vars);
│   │   │                       #   callLlm() exported for the knowledge extraction
│   │   ├── arc-preset.js       # ARC_PRESET_NAME, ARC_PRESET_SETTINGS (fixed ~18-key
│   │   │                       #   barebones preset — no derivation from a base
│   │   │                       #   preset), ARC_PROMPT_ENTRIES (adult-content off,
│   │   │                       #   genre on), buildArcPresetSettings(),
│   │   │                       #   buildArcProfile(),
│   │   │                       #   createArcPreset(baseProfileId, confirmOverwrite);
│   │   │                       #   collectArcDirectives()/readActiveArcDirectives()
│   │   │                       #   read enabled directive prompt entries back out
│   │   ├── validation.js       # parseLlmJson() — strips fences, extracts JSON;
│   │   │                       #   validateArcPlan(raw, { tier }) — schema check +
│   │   │                       #   normalization: tier defaults to episode (the
│   │   │                       #   wizard's tier wins over the model's echo);
│   │   │                       #   milestones (act/saga) all active, unlockAfter
│   │   │                       #   stripped, non-empty pressure required; estimatedLength
│   │   │                       #   clamped to TIER_TABLE[tier].lengthBand; optional
│   │   │                       #   `pressure` per episode beat (stored arcs are
│   │   │                       #   not migrated or re-validated); optional secret
│   │   │                       #   `holders` (normalizeSecretHolders, [] when missing)
│   │   ├── storage.js          # CRUD on chat_metadata.story_arc.arcs:
│   │   │                       #   getArcs(), getActiveArcs(), getArcById(),
│   │   │                       #   saveArc(), updateArc(), replaceArc(stored, arc),
│   │   │                       #   deleteArc();
│   │   │                       #   latestArcText(arcs, 'genre'|'themeSeeds') — wizard
│   │   │                       #   defaults for a new arc
│   │   ├── arc-edit.js         # applyArcEdit(stored, json) — Edit arc save checks;
│   │   │                       #   applyTitleAndPremiseEdit(stored, edit) — trimmed
│   │   │                       #   title + premise as the only updates, same blank
│   │   │                       #   rule and messages as applyArcEdit;
│   │   │                       #   checkTitleAndPremise(title, premise) — that blank
│   │   │                       #   rule, also used by applyReplan;
│   │   │                       #   checkBeatEdit(tier, edit) — validator's rules for a
│   │   │                       #   hand edit; removeBeat(beats, id) — drops the id from
│   │   │                       #   unlockAfter and unlocks beats with nothing left open;
│   │   │                       #   applyArcEdit takes an absent worldFacts key (older
│   │   │                       #   arcs) and refuses a non-list or a non-text item;
│   │   │                       #   completeBeat(beats, id) — completes and unlocks,
│   │   │                       #   drops any completion record (hand toggle and
│   │   │                       #   completeBeats)
│   │   ├── beat-completion.js  # Beat completion by recognition and its rollback
│   │   │                       #   (ADR-0008): completeBeats(completions, arcs) — the
│   │   │                       #   rules both paths share (in-prompt marker, knowledge
│   │   │                       #   extraction): active arc and beat only, one per arc
│   │   │                       #   per message, lastFulfilledAt, unlocks, arc
│   │   │                       #   completion, no promotion; records beat.completion
│   │   │                       #   { at, messageId?, unlocked, arcCompleted,
│   │   │                       #   lastFulfilledBefore } (message id read, never given);
│   │   │                       #   reopenCompletionsFrom(firstGoneIndex) — delete,
│   │   │                       #   swipe, branch load; records follow their message id;
│   │   │                       #   reopenCompletionsAt(messageIndex) — edit;
│   │   │                       #   setBeatStatusByHand(arcId, beatId, status) — the
│   │   │                       #   Arc Manager's toggle; done by hand sets
│   │   │                       #   lastFulfilledAt (raises the records' floor), no record;
│   │   │                       #   reopenCompletion() undoes unlocks, promotions and
│   │   │                       #   arc completion; restoreLastFulfilledAt();
│   │   │                       #   removeRulingsFrom(firstGoneIndex) — delete, branch
│   │   │                       #   load; removeRulingsAt(messageIndex, isStillStated)
│   │   │                       #   — edit: only rulings whose quote is gone (#45)
│   │   └── replan.js           # mergeReplan(existing, generated) — spec §3 merge:
│   │                           #   keeps identity, edited title/premise/direction,
│   │                           #   carries the model's premise as proposedPremise,
│   │                           #   secrets (add-only, content-deduped), completed
│   │                           #   beats (their completion records without unlocked
│   │                           #   and arcCompleted: withoutRoadInRecord), planted
│   │                           #   foreshadowing, fired triggers;
│   │                           #   replaces the rest; withUniqueIds() suffixes
│   │                           #   colliding ids _2, _3, … and renames unlockAfter refs;
│   │                           #   replanTiers(tier) — the tiers a re-plan may pick:
│   │                           #   same or larger, never smaller (wizard selector);
│   │                           #   applyReplan(merged, chatLength, { premise,
│   │                           #   removedRulingIds, storedRulings, secretChoices }) →
│   │                           #   { arc, error } — the arc "Apply re-plan" stores: a
│   │                           #   deep copy with the chosen premise trimmed, no
│   │                           #   proposedPremise; each taken secret's
│   │                           #   proposedContent as content, proposedContent
│   │                           #   removed from every secret; a blank premise refused
│   │                           #   the rulings built from the stored ones at apply:
│   │                           #   removed ones dropped, those the generation saw
│   │                           #   answered (an earlier answeredAt kept), later ones
│   │                           #   open, gone ones gone
│   ├── injection/
│   │   ├── builder.js          # buildInjection(arcs) — dispatcher keyed by (tier, focus):
│   │   │                       #   one section per arc (private builders below), spotlight first,
│   │   │                       #   then normal episodes, then the rest; respects token
│   │   │                       #   budget. buildSignalInjection(arcs) — separate injection
│   │   │                       #   (IN_CHAT depth 0): ARC PACING phase brake for the
│   │   │                       #   pacing clock (clock.js) always,
│   │   │                       #   continuation guard + confidentiality always,
│   │   │                       #   PLANT CHECK with autoTrack on, BEAT CHECK with
│   │   │                       #   autoTrack on and the knowledge tracker off, and
│   │   │                       #   only while a beat is active (ADR-0008).
│   │   │                       #   Every line here must be byte-identical from message
│   │   │                       #   to message within a phase — the block sits at the end
│   │   │                       #   of the prompt and any churn costs the whole cached
│   │   │                       #   prefix. The per-message counters live on the messages
│   │   │                       #   themselves (stamping.js).
│   │   │                       #   Sections are assembled guardrails-first with the
│   │   │                       #   content lists last (secrets, triggers, foreshadowing),
│   │   │                       #   and trimToBudget() drops whole trailing lines plus
│   │   │                       #   any header left without items
│   │   │                       #   Private section builders, picked by buildArcSection():
│   │   │                       #   buildEpisodeSection(arc) — the full section: premise,
│   │   │                       #   world facts (no tone, directives or anti-patterns,
│   │   │                       #   ADR-0009), active beat as CURRENT PRESSURE (pressure,
│   │   │                       #   falling back to intention), no beat ids; linger
│   │   │                       #   directive when no beat is active; guardrails first,
│   │   │                       #   content lists last. Header word kept from before
│   │   │                       #   tiers (architecture.md, migration);
│   │   │                       #   pushWorldFacts(lines, worldFacts) — the WORLD FACTS
│   │   │                       #   block, nothing without facts; never trimmed;
│   │   │                       #   MILESTONE_WORLD_FACT_LIMIT (3, exported) — facts an
│   │   │                       #   act/saga section prints (also arc-manager.js);
│   │   │                       #   pushPlanLists(lines, arc, phase) — secrets,
│   │   │                       #   triggers, foreshadowing; buildMilestoneSection reuses it;
│   │   │                       #   holderSuffix(secret) — " (known only to: …)" on a
│   │   │                       #   SECRETS line while the knowledge tracker is on;
│   │   │                       #   buildPausedSection(arc) — one line under PAUSED: premise
│   │   │                       #   + "pending, not being pursued right now";
│   │   │                       #   buildBackgroundSection(arc) — act/saga: title under
│   │   │                       #   BACKGROUND: + "Runs off-screen…" sentence; no
│   │   │                       #   premise, no pressures (beats stay in the beat check);
│   │   │                       #   buildMilestoneSection(arc, pressures?) — act/saga:
│   │   │                       #   === ACT/SAGA: header, premise, the first three world
│   │   │                       #   facts, unfulfilled milestone
│   │   │                       #   pressures under STANDING PRESSURES (header + trailer
│   │   │                       #   swappable; pressure only, never the fulfillment —
│   │   │                       #   a pressure-less milestone is skipped), gated
│   │   │                       #   secrets/triggers/foreshadowing; no
│   │   │                       #   pacing rules, no phase line;
│   │   │                       #   buildSpotlightSection(arc) — episode → episode section;
│   │   │                       #   act/saga → milestone section under BRING TO A HEAD
│   │   │                       #   + one trailer sentence, no milestone named;
│   │   │                       #   buildSignalDirective(arcs) — continuation guard,
│   │   │                       #   confidentiality clause, BEAT CHECK (tracker off
│   │   │                       #   only) listing every active beat (all unfulfilled
│   │   │                       #   milestones on an act/saga); paused arcs get no
│   │   │                       #   recognition lines; autoTrack gates both checks;
│   │   │                       #   PLANT CHECK with :PLANTED / :FIRED lines for the
│   │   │                       #   clues and triggers the arc's section shows
│   │   │                       #   (showsPlanLists(arc) decides which arcs show them)
│   │   ├── clock.js            # selectPacingClock(arcs) — spotlit episode, else first
│   │   │                       #   normal episode; never paused, never act/saga; feeds
│   │   │                       #   stamping.js;
│   │   │                       #   pauseArc(id) freezes the clock (pausedAt = chat.length);
│   │   │                       #   resumeArc(id, focus) shifts messageStart/lastFulfilledAt
│   │   │                       #   by the paused span, replannedAt/reactivatedAt/spotlitAt
│   │   │                       #   by the pause after the stamp; no-op on the clock if
│   │   │                       #   never paused;
│   │   │                       #   spotlightArc(id) — one arc in the spotlight, the
│   │   │                       #   previous spotlit arc goes back to normal; stamps
│   │   │                       #   spotlitAt (stall count restarts);
│   │   │                       #   reactivateArc(id) — past arc active again in normal
│   │   │                       #   focus, stamps reactivatedAt and messageStart (phase
│   │   │                       #   and stall counts restart), moves it last in storage;
│   │   │                       #   stallCountStart(arc), ignoreStall(arcId) stores
│   │   │                       #   stallIgnoredFrom, showIgnoredStall(arcId) clears it
│   │   ├── pacing.js           # calculatePhase(arc), selectNonOptionalBeats(beats),
│   │   │                       #   getPacingDirective(phase),
│   │   │                       #   shouldShowSecret(revealPhase, phase) — secret gate
│   │   │                       #   shared by the episode and milestone sections;
│   │   │                       #   phaseBoundaryMessage(arc, phase) — arc-relative
│   │   │                       #   message number where the phase ends (chat-length
│   │   │                       #   independent, safe to put in the prompt);
│   │   │                       #   messagesUntilNextPhase(arc, phase) — same boundary as
│   │   │                       #   a countdown, progress card only. Both return 0
│   │   │                       #   (not NaN) for arcs without estimatedLength or
│   │   │                       #   messageStart
│   │   ├── stamping.js         # buildStamp(arc, chatIndex) — "[Arc: message N of ~M]",
│   │   │                       #   a pure function of the index and fixed arc metadata;
│   │   │                       #   stampPromptMessages(promptChat, arcs) — prepends the
│   │   │                       #   stamp to every user message in the OUTGOING prompt
│   │   │                       #   array on CHAT_COMPLETION_PROMPT_READY. Stored chat
│   │   │                       #   and the UI are never touched. Entries are matched to
│   │   │                       #   chat indices by content suffix, not position
│   │   └── signals.js          # parseSignals(text) — extracts [ARC_SIGNAL:…:COMPLETE|PLANTED|FIRED] tokens;
│   │                           #   PLANTED/FIRED are queued in pendingMarks and applied by
│   │                           #   flushPendingMarks(messageIndex, promptChangesAnyway);
│   │                           #   dropPendingMark() for the Arc Manager's hand toggle
│   │                           #   (bare or HTML-comment-wrapped);
│   │                           #   processSignalResults(signals, arcs, messageIndex) —
│   │                           #   queues marks, hands COMPLETE markers to
│   │                           #   completeBeats (planning/beat-completion.js) with
│   │                           #   at = messageIndex; does NOT promote;
│   │                           #   promoteNextBeats(arcs) — episode: activates the next
│   │                           #   pending beat; act/saga: activates every pending
│   │                           #   milestone; called on USER_MESSAGE_RENDERED (one
│   │                           #   user turn later);
│   │                           #   stripSignalsFromMessage() — removes tokens + blank-line residue;
│   │                           #   scrubArcInternals() — deletes leaked beat/arc ids from message
│   ├── knowledge/
│   │   ├── message-ids.js      # Story Arc's message id in a message's extra
│   │   │                       #   (MESSAGE_ID_KEY): assignCoveredMessageIds(chat,
│   │   │                       #   from, last) gives one to every read message,
│   │   │                       #   messageIdOf(message) reads it; shared by the
│   │   │                       #   ledger and planning/beat-completion.js
│   │   ├── names.js            # Taken names (#39): buildTakenNamesBlock(ledger) —
│   │   │                       #   the rule header + every name word on one line,
│   │   │                       #   sorted by folded form (printTakenNames(ledger),
│   │   │                       #   also the planner's cast block); listTakenNames(ledger)
│   │   │                       #   (folded form → first spelling, hyphenated words
│   │   │                       #   whole and by part), nameWords(name), foldName();
│   │   │                       #   reused by the name flag (#35), the planner (#36)
│   │   │                       #   and the plan check's rename guards (#49);
│   │   │                       #   listCharactersWithNames(ledger, names, exceptId)
│   │   │                       #   → who has the flagged names now (the notice)
│   │   └── ledger.js           # The knowledge tracker's process (ADR-0007), sections in
│   │                           #   the order it runs, helpers after their first caller;
│   │                           #   every ledger operation changes the stored ledger in
│   │                           #   place and returns true when it changed; the update
│   │                           #   functions return { ledgerChanged, beatsChanged,
│   │                           #   flaggedCharacters? } (new characters with a taken
│   │                           #   name; applyExtractionAnswer sets their nameClash):
│   │                           #   Update after a reply — updateKnowledgeAfterReply(i),
│   │                           #   every N replies, one at a time, stale answers dropped;
│   │                           #   completeFulfilledBeats() after the apply →
│   │                           #   completeBeats, then flushPendingMarks(i, true);
│   │                           #   Extraction — extractKnowledge(ledger, chat, fromIndex,
│   │                           #   persona) → parsed answer or null; listShownSecrets(arcs),
│   │                           #   listRecognisableBeats(arcs) → {{DEVELOPMENTS}}
│   │                           #   (autoTrack on only), listArcPlans(arcs) → {{PLANS}},
│   │                           #   resolveRulings() → storeRulings() (rulings on the arc),
│   │                           #   buildKnowledgeExtractionVariables(),
│   │                           #   parseKnowledgeExtractionAnswer() (all or nothing,
│   │                           #   except the fulfilled list: broken items dropped),
│   │                           #   resolveRevealedSecrets() (keeps the heard text),
│   │                           #   resolveFulfilledDevelopments() (listed active beats,
│   │                           #   at inside the read messages);
│   │                           #   Apply — applyExtractionAnswer(ledger, answer, from,
│   │                           #   last): new names first (newNames → aliases of the
│   │                           #   named record, a name another record has refused),
│   │                           #   a shared name word (isSharedNameWord over
│   │                           #   listNameWordCarriers) resolves to nobody, is
│   │                           #   refused as a new name, dropped as an alias,
│   │                           #   then the teller of a told fact holds it too, an
│   │                           #   at outside from..last falls back to last; given the
│   │                           #   chat, gives the read messages a message id (extra.
│   │                           #   story_arc_message_id) and stores messageId;
│   │                           #   nextLedgerId(prefix, entries);
│   │                           #   Update log — recordKnowledgeUpdate() keeps the newest
│   │                           #   KNOWLEDGE_UPDATE_LOG_CAP (20) records in updateLog:
│   │                           #   update/reextract (beats as counts only: fulfilled,
│   │                           #   beatsCompleted), skipped (no answer, chat changed,
│   │                           #   ledger moved), rollback; knowledgeHoldings() +
│   │                           #   holdingsChange() find what a step added or removed;
│   │                           #   createdChangeItems() lists the change items of an
│   │                           #   update/reextract record (#67); listChangeItems(record)
│   │                           #   gives each its item key; dropReviewedMarksOfGoneItems()
│   │                           #   + presentChangeItemKeys() drop the reviewed marks of items
│   │                           #   a rollback removed (dropKnowledgeFrom,
│   │                           #   dropKnowledgeLearnedAt);
│   │                           #   Roll back — rollBackKnowledgeFrom(N) (delete, branch
│   │                           #   load) via followMessagesById(ledger, chat) (entries
│   │                           #   with a message id follow their message) and
│   │                           #   dropKnowledgeFrom(ledger, N) (user entries,
│   │                           #   at null, stay), updateKnowledgeAfterSwipe(i),
│   │                           #   updateKnowledgeAfterEdit(i) (reopenCompletionsAt
│   │                           #   first, autoTrack on); the re-extraction completes
│   │                           #   beats like the update after a reply;
│   │                           #   Inject — injectKnowledgeBlock(): story_arc_knowledge,
│   │                           #   then story_arc_names (names.js), both in-chat
│   │                           #   depth 1, system, '' while off;
│   │                           #   Build — buildKnowledgeBlock(ledger, chat): EVERYONE KNOWS
│   │                           #   (public facts), then Knows lines with "shared only with"
│   │                           #   for present + talked-about characters, KNOWLEDGE_LIST_CAP = 5;
│   │                           #   withoutTaggedElements drops status blocks before names count;
│   │                           #   characterName(ledger, id) (also for the popup), characterDisplayName(ledger, character): an unnamed relative reads "<other>'s <kinship>" (#55)
│   ├── ui/
│   │   ├── settings-panel.js   # renderSettingsPanel() — extension drawer HTML:
│   │   │                       #   actions row first (Plan / Manage / Knowledge),
│   │   │                       #   progress container, then groups Arcs (enable),
│   │   │                       #   Knowledge tracker (switch, details, interval,
│   │   │                       #   status line from knowledge-status.js; details,
│   │   │                       #   interval and Knowledge disabled while it is off),
│   │   │                       #   Connection (generation profile dropdown, 'Create
│   │   │                       #   arc preset' → handleCreateArcPreset());
│   │   │                       #   setupSettingsPanelEvents() also wires the drawer's
│   │   │                       #   stall nudge (#story-arc-settings .story-arc-stall-btn
│   │   │                       #   → showWizard(arcId))
│   │   ├── wand-menu.js        # registerWandMenuEntry() — adds a "Story Arc" item to
│   │   │                       #   #extensionsMenu (the wand next to the chat bar);
│   │   │                       #   showWandPopup() closes itself before the wizard,
│   │   │                       #   manager, Knowledge popup or a stall nudge's re-plan
│   │   │                       #   opens, and reopens after it resolves, so the progress
│   │   │                       #   cards rebuild; buildWandContent() (exported) says the
│   │   │                       #   extension is off instead of offering dead buttons;
│   │   │                       #   Knowledge action while the tracker is on
│   │   ├── wizard.js           # showWizard(reviseArcId?) — arc planning popup:
│   │   │                       #   Direction (context summary strip with Retry on a
│   │   │                       #   failed harvest, tier, genre, themes, direction; re-plan:
│   │   │                       #   title, premise, "Your rulings" with remove buttons)
│   │   │                       #   → Questions when the model asked any
│   │   │                       #   (buildQuestionsStep: suggestion chips, answer boxes,
│   │   │                       #   re-plan: earlier answers first; buildStepIndicator
│   │   │                       #   shows three steps then)
│   │   │                       #   → Review (generation log with a polite status line
│   │   │                       #   and a visible Cancel, then the plan behind one
│   │   │                       #   Reveal switch, foreshadowing shown as Clues; re-plan:
│   │   │                       #   buildPremiseChoice(); behind the switch
│   │   │                       #   buildSecretChoices() (keep/take per proposed
│   │   │                       #   secret, keep chosen) and proposedSecretsNote()
│   │   │                       #   (their count in the hidden note); "Apply re-plan"
│   │   │                       #   reads readSecretChoices(), stores via updateArc).
│   │   │                       #   Back from a generated plan asks inline first.
│   │   │                       #   Failures say problem and recovery (raw error to the
│   │   │                       #   console); finished log steps show their outcome;
│   │   │                       #   the re-plan premise shows once. The
│   │   │                       #   build* view functions are exported (tests, shots);
│   │   │                       #   unbinds its click namespace when the popup resolves
│   │   ├── arc-manager.js      # showArcManager() — the Arc Manager (#71): a table of
│   │   │                       #   active arcs (sortActiveArcs), one <tbody> per arc:
│   │   │                       #   title, tier, focus segmented control
│   │   │                       #   (buildFocusControl), phase, beat strip by shape
│   │   │                       #   (buildBeatStrip, waitingMarksOf), last beat
│   │   │                       #   (buildLastBeatCell), ⋯ menu (buildArcMenuItems);
│   │   │                       #   warning area (buildArcAlert: buildArcWarning — ruling,
│   │   │                       #   all done, stall with Re-plan / Spotlight it / Ignore —
│   │   │                       #   then buildStyleFieldsNotice, the note on an episode
│   │   │                       #   planned before world facts — no worldFacts key —
│   │   │                       #   with directives, rules or tone);
│   │   │                       #   detail (buildArcDetail: describeWhatNarratorGets,
│   │   │                       #   counting the world facts each section prints,
│   │   │                       #   Reveal plan switch, beat status, beat editor
│   │   │                       #   buildBeatEditor, buildTitleAndPremiseForm,
│   │   │                       #   buildPlanList, JSON editor); past arcs with
│   │   │                       #   Reactivate (buildPastArc); empty state;
│   │   │                       #   buildSummary; status strip (buildStatusStrip);
│   │   │                       #   undo: startArcUndoSession, runArcEdit,
│   │   │                       #   undoArcEdit, newestArcEditLabel over arcs +
│   │   │                       #   pendingMarks; patches rows in place; Re-plan, Plan
│   │   │                       #   a new arc and Knowledge close it, then open the
│   │   │                       #   wizard or the knowledge popup
│   │   ├── knowledge-popup.js  # showKnowledgePopup() — What changed (listChangeLines:
│   │   │                       #   the update log's change items as lines, Fine,
│   │   │                       #   fixes on the line) and Cast & facts (search,
│   │   │                       #   character / fact sheets, add forms, cast picker),
│   │   │                       #   "Names to check" in both, status bar with Undo;
│   │   │                       #   Map (#77: the cast in rings, layoutCastMap,
│   │   │                       #   label placement, drag/M merge via startMapMerge)
│   │   │                       #   (#70); buildKnowledgeContent(ledger, chatMessages,
│   │   │                       #   withDetails, view) renders it from a view state
│   │   │                       #   (createKnowledgeView); pure ledger edits
│   │   │                       #   (addCharacter, addUnnamedRelative (#55), renameCharacter, setCharacterAliases,
│   │   │                       #   keepCharacterName, addFact, editFactText, deleteFact,
│   │   │                       #   setFactPublic, addFactHolder, removeFactHolder,
│   │   │                       #   saveCharacterDetails: player detail entries that
│   │   │                       #   lock the kind, #54; mergeCharacters: one
│   │   │                       #   record into another, #60; moveFactHolder,
│   │   │                       #   deleteCharacter (+ removed), restoreRetractedFact,
│   │   │                       #   lockCharacterDetail, #66; retractFact,
│   │   │                       #   unnameCharacter, #70;
│   │   │                       #   markChangeItemReviewed, unmarkChangeItemReviewed:
│   │   │                       #   reviewed marks by item key, #67) return
│   │   │                       #   { ledger, error }; saveLedgerEdit stores one and
│   │   │                       #   records it for undoLedgerEdit (undo-stack.js,
│   │   │                       #   per popup session, #68); new holders are how
│   │   │                       #   HOLDER_HOW.user, at null. Opened from the Arc
│   │   │                       #   Manager and the wand menu while the tracker is on
│   │   ├── knowledge-status.js # updateKnowledgeStatus() — the drawer's status line:
│   │   │                       #   last update, + "N new names to check" and a
│   │   │                       #   Knowledge popup button; called by index.js, the
│   │   │                       #   panel and the popup (own file: no import cycle)
│   │   ├── beat-strip.js       # buildBeatStrip(arc, pendingMarks, isInteractive) — the
│   │   │                       #   beat squares by shape and the done count, with the
│   │   │                       #   tier words (beatWords, beatStatusWord), waitingMarksOf,
│   │   │                       #   formatNumber, plural; Arc Manager and progress rows
│   │   ├── undo-stack.js       # createUndoStack({ read, write, changedMessage }) —
│   │   │                       #   a popup session's undo over one stored state,
│   │   │                       #   labelled entries, refused when the state changed
│   │   │                       #   since; Knowledge popup and Arc Manager (#71)
│   │   └── progress.js         # renderProgressDisplay() — one row per active arc in
│   │                           #   the drawer and the wand popup, in the Arc Manager's
│   │                           #   grammar (title; tier · phase · focus; its read-only
│   │                           #   buildBeatStrip; the stall or overrule warning with
│   │                           #   Re-plan, #72); shows "~N messages to the next phase" only
│   │                           #   while the message count holds the phase back,
│   │                           #   never in resolution; isStalled(arc, chatLength) —
│   │                           #   the stall rule behind the stall warning
│   │                           #   (every tier; not while paused or in
│   │                           #   background; counted from the latest of messageStart,
│   │                           #   lastFulfilledAt, replannedAt, reactivatedAt,
│   │                           #   spotlitAt: stallCountStart in clock.js);
│   │                           #   isStallNudgeShown(arc, chatLength) — stalled and
│   │                           #   not the ignored stall (the card's check)
│   └── css/
│       ├── wizard.css          # Two-step wizard: head and step indicator, context
│       │                       #   strip, form, generation log, plan with the Reveal
│       │                       #   switch; ST theme variables only (#72)
│       ├── settings-panel.css  # Settings drawer (action row, grouped settings,
│       │                       #   body padding) and the wand popup; ST theme
│       │                       #   variables only (#72)
│       ├── arc-manager.css     # Arc Manager table, warning lines, detail, menu,
│       │                       #   status strip (ST theme variables only)
│       ├── knowledge.css       # Knowledge popup (#70): tabs, lines, chips, sheets,
│       │                       #   picker, status bar; ST theme variables only
│       └── progress.css        # Layout of the progress rows; tokens, beat squares
│                               #   and the warning come from arc-manager.css (#72)
├── scripts/
│   └── rebuild-knowledge-block.mjs # Diagnosis: the knowledge block the narrator got at
│                               #   one message of a chat file, ledger cut back to then;
│                               #   run with node --import ./tests/setup.js
├── tests/
│   ├── run.sh                  # Node.js test runner (node:test)
│   ├── smoke.sh                # HTTP smoke tests against live ST instance
│   ├── setup.js                # Registers ESM loader before test files load
│   ├── loader.js               # Custom ESM loader — intercepts ST imports, returns mocks
│   ├── mocks/
│   │   └── st-mocks.js         # Mock exports for /script.js, /scripts/extensions.js, etc.;
│   │                           #   Popup records each popup (mockPopups) and, with
│   │                           #   mockPopupState.holdOpen, stays open until complete()
│   ├── test-core.js            # Tests: core/constants (phases, defaults, arc factory)
│   ├── test-lorebook.js        # Tests: fetchLorebookEntries (filter/sort), categorizeEntries
│   ├── test-arc-preset.js      # Tests: pinned preset keys, directive entry defaults
│   │                           #   and round-trip through a re-create, preset/profile
│   │                           #   creation and overwrite handling
│   ├── test-builder.js         # Tests: plan-section beat visibility (active-only,
│   │                           #   pressure w/ intention fallback, linger) + dispatch
│   │                           #   by tier × focus + signal directive (recognition
│   │                           #   phrasing, linger survival, paused arcs skipped,
│   │                           #   autoTrack × tracker: guard and clause always,
│   │                           #   no fulfillment text with the tracker on)
│   │                           #   + section order and line-boundary trimming
│   │                           #   + triggers tied to a secret (hidden until shown)
│   │                           #   + prefix-cache stability (IN_PROMPT and in-chat
│   │                           #   blocks byte-identical as messages accumulate)
│   │                           #   + an edited premise changes only its own line
│   ├── test-arc-edit.js        # Tests: applyArcEdit (kept fields, save checks) +
│   │                           #   applyTitleAndPremiseEdit (trim, blank refused,
│   │                           #   no other field stored) +
│   │                           #   checkBeatEdit (empty intention, milestone
│   │                           #   pressure) + removeBeat (unlockAfter cleanup, unlock)
│   ├── test-background.js      # Tests: background focus — section text, no premise or
│   │                           #   pressures, beat check kept, no plant check, never the
│   │                           #   clock, resume shift, migration untouched, re-plan
│   ├── test-clock.js           # Tests: selectPacingClock (spotlit episode, else first
│   │                           #   normal; never paused/act/saga) + pauseArc/resumeArc
│   │                           #   clock freeze and shift (stamp number continues) +
│   │                           #   spotlightArc (previous spotlit arc back to normal) +
│   │                           #   reactivateArc (both statuses, spotlight kept, paused
│   │                           #   shift, reactivatedAt shift on resume)
│   ├── test-migration.js       # Tests: migrateArc on arcs stored before tiers +
│   │                           #   ensureChatState running it once
│   ├── test-replan.js          # Tests: mergeReplan (kept vs. replaced fields, secrets
│   │                           #   add-only, id de-collision, tier change, kept
│   │                           #   completion records lose unlocked/arcCompleted) + replanTiers +
│   │                           #   buildArcSoFar + formatExistingArcs mark + applyReplan
│   │                           #   (premise choice stored trimmed, blank refused)
│   ├── test-replan-rulings.js  # Tests: the rulings in formatExistingArcs, buildArcSoFar,
│   │                           #   buildPlanCheckVariables; mergeReplan carries them;
│   │                           #   applyReplan builds them from the stored rulings at
│   │                           #   apply (removed, seen, stored later, gone)
│   ├── test-generator-replan.js # Tests: generateArc through the profile mock with the
│   │                           #   real templates: a re-plan's Phase 2 asks for a premise,
│   │                           #   the result keeps the stored one with the proposal,
│   │                           #   the plan check reads the proposal; a new plan's
│   │                           #   premise contract; the rulings reach Phase 1, Phase 2
│   │                           #   and the plan check, a removed one none
│   ├── test-spotlight.js       # Tests: spotlit act/saga BRING TO A HEAD block (no
│   │                           #   milestone named, ordered first), spotlit episode
│   │                           #   byte-identical, brake follows the clock
│   ├── test-stall.js           # Tests: isStalled threshold (hand-computed boundary),
│   │                           #   acts and sagas, paused/background, re-plan stamp,
│   │                           #   migrated arcs,
│   │                           #   lastFulfilledAt set on fulfillment, it and
│   │                           #   replannedAt shifted on resume, nudge rendering,
│   │                           #   reactivation stamp, ignoreStall (hidden, shown again
│   │                           #   after the next beat, a re-plan, a reactivation)
│   ├── test-stamping.js        # Tests: buildStamp purity + stampPromptMessages
│   │                           #   (numbering, old positions unchanged as the chat
│   │                           #   grows, foreign-entry and rewritten-text handling,
│   │                           #   stamps follow the spotlit episode)
│   ├── test-tier.js            # Tests: buildTierBlock per tier, milestone section
│   │                           #   (normal focus; pressure-less milestone skipped),
│   │                           #   progress widget milestone label
│   ├── test-generator.js       # Tests: isRetryableError (retryable vs. fail-fast);
│   │                           #   generateArc stream routes, plan check applied or
│   │                           #   skipped on an unreadable answer
│   ├── test-arc-manager.js     # Tests: Arc Manager builders (plan lists, strip,
│   │                           #   focus, warning lines, last beat, summary, what
│   │                           #   the narrator gets, reveal markup, empty state,
│   │                           #   order) and undo of arc edits incl. the refusal
│   ├── test-undo-stack.js      # Tests: createUndoStack (order, labels, refusal)
│   ├── test-knowledge-popup.js # Tests: knowledge popup ledger edits (literal before/
│   │                           #   after ledgers), Cast & facts search and fact sheet,
│   │                           #   the "Names to check" strip and keepCharacterName (#48)
│   ├── test-knowledge-map.js   # Tests: the Map tab (#77): rings, name families,
│   │                           #   relation lines, filter, sheet, merge preview of a drop
│   ├── test-knowledge-popup-view.js # Tests: What changed (#70): listChangeLines, lines
│   │                           #   per change, reviewed folding, earlier records, plan
│   │                           #   holders hidden, the empty log
│   ├── test-knowledge-hand-edits.js # Tests: retractFact, unnameCharacter (#70); move holder, delete character, restore a
│   │                           #   retracted fact, lock a detail (#66), refusals,
│   │                           #   rollback after a move, restore and lock
│   ├── test-knowledge-undo.js  # Tests: undo of hand edits (#68): exact restore, one
│   │                           #   further per press, refusal after an in-place or
│   │                           #   replacing change, new session empty, every edit
│   ├── test-knowledge-merge.js # Tests: "Merge into…" (#60): every reference kind,
│   │                           #   holder dedupe, details, nameClash, rollback after a
│   │                           #   merge, taken names and the flag see one character
│   ├── test-knowledge-meetings.js # Tests: meetings and the "Has met" line: recording,
│   │                           #   same-message replace, first meetings of an old ledger,
│   │                           #   rollback, merge, delete, popup save, the block line
│   ├── test-knowledge-popup-details.js # Tests: character details in the popup (#54):
│   │                           #   sheet rows and lock state, detail editor, saveCharacterDetails
│   │                           #   (lock on change, unlock on clear, validation)
│   ├── test-knowledge-extraction.js # Tests: extraction template variables, answer
│   │                           #   parsing (all or nothing, null keys)
│   ├── test-knowledge-apply.js # Tests: applyExtractionAnswer (new characters, aliases,
│   │                           #   unknown names/ids ignored, teller holds a told fact, changed in place,
│   │                           #   then the card case through buildKnowledgeBlock)
│   ├── test-knowledge-dedupe.js # Tests: learned items with the same text join one
│   │                           #   fact (in the answer and with the ledger), no
│   │                           #   Knows/Does-not-know contradiction in the block
│   ├── test-knowledge-identity.js # Tests: a deletion in the middle takes back exactly
│   │                           #   the deleted messages' knowledge, later entries move
│   │                           #   up; index-only ledgers as before; message ids after swipe
│   ├── test-knowledge-drop.js  # Tests: dropKnowledgeFrom (holders from N on, user
│   │                           #   entries kept, scene and lastUpdatedAt reset)
│   ├── test-knowledge-retraction.js # Tests: OOC corrections retract facts (user
│   │                           #   holders kept, unknown ids ignored), rollback of the
│   │                           #   correction restores them, retracted parsing, template
│   ├── test-knowledge-shared-name-words.js # Tests: a shared one-word name points
│   │                           #   at nobody (talked about, answer names), refused as
│   │                           #   a new name, dropped as an alias; Paragon names
│   ├── test-knowledge-block.js # Tests: buildKnowledgeBlock literal lines (present,
│   │                           #   talked about by alias, Has told, shared-only-with,
│   │                           #   cap, EVERYONE KNOWS, plan holders never printed)
│   ├── test-knowledge-inject.js # Tests: injectKnowledgeBlock keys (knowledge, names),
│   │                           #   in-chat depth 1, system role; '' while off or empty;
│   │                           #   names text unchanged when scene and facts change
│   ├── test-knowledge-names.js # Tests: buildTakenNamesBlock literal lists (titles,
│   │                           #   hyphenated parts, aliases, repeats, diacritics,
│   │                           #   particles, sort), byte stability; listTakenNames
│   ├── test-knowledge-new-names.js # Tests: new names of a known character (#60):
│   │                           #   parser, alias added / refused / unknown, applied
│   │                           #   before new characters and the rest of the answer,
│   │                           #   prompt with details on and off, update-log counts
│   ├── test-knowledge-name-clash.js # Tests: the reused-name flag (#43) at the apply
│   │                           #   (hyphens, titles, aliases, same-answer family),
│   │                           #   through the update after a reply and an edit,
│   │                           #   cleared by a popup save; the status line count
│   ├── test-knowledge-update.js # Tests: updateKnowledgeAfterReply (off: no call,
│   │                           #   interval, failed/unreadable answer, first update,
│   │                           #   popup edit during the call, swipe during the call)
│   ├── test-knowledge-change-items.js # Tests: change items of update/reextract records,
│   │                           #   item keys, rollback dropping reviewed marks (delete,
│   │                           #   swipe, edit), old ledgers, mark/unmark, save (#67)
│   ├── test-knowledge-update-log.js # Tests: updateLog records (update, empty answer,
│   │                           #   skips by reason, nothing for off/interval/other chat,
│   │                           #   cap 20, rollback drop/restore, re-extraction)
│   ├── test-knowledge-rollback.js # Tests: rollback on regeneration and branch load,
│   │                           #   new vs. existing swipe, edit re-extracts one message,
│   │                           #   late answers dropped, an at outside the covered
│   │                           #   messages still rolled back, an early reveal kept
│   ├── test-knowledge-revealed.js # Tests: shown secrets (phase gate, refs), revealed
│   │                           #   secret becomes a linked fact worded as heard, its own
│   │                           #   text nowhere in the block
│   ├── test-knowledge-secrets.js # Tests: SECRETS holder suffix on, injection as
│   │                           #   before with the tracker off, budget trim
│   ├── test-knowledge-settings.js # Tests: tracker switch, interval and status line in
│   │                           #   the settings panel; the settings that depend on the
│   │                           #   tracker disabled while it is off, following the switch
│   ├── test-ui-wizard.js       # Tests: the wizard through showWizard with a fake
│   │                           #   jQuery: Direction with the context strip, Retry on a
│   │                           #   failed harvest, Cancel during generation, polite
│   │                           #   status line, Clues in Review, Back asks before
│   │                           #   discarding a plan; the Questions step (chips, help
│   │                           #   line, three steps, re-plan prefill, answers stored),
│   │                           #   the flow without questions as before
│   ├── test-ui-wand-menu.js    # Tests: the stall nudge closes the wand popup before
│   │                           #   the wizard opens; Ignore keeps it open; wand content buttons
│   ├── test-plan-check.js      # Tests: applyPlanCheck (scope, revealed on re-plan
│   │                           #   only, links, echoed IF line, fulfillment rewrites of
│   │                           #   open beats only) + buildPlanCheckVariables
│   ├── test-beat-completion.js # Tests: completeBeats rules and completion record
│   │                           #   (message id read, never given), reopenCompletionsFrom
│   │                           #   (delete, swipe, branch, id follow, what reopening
│   │                           #   undoes, lastFulfilledAt), reopenCompletionsAt (edit),
│   │                           #   hand toggle carries no record, setBeatStatusByHand
│   │                           #   (lastFulfilledAt, stall nudge clears, kept on reopen
│   │                           #   and over a rollback of an earlier record)
│   ├── test-ruling-rollback.js # Tests: a ruling goes with its message on delete
│   │                           #   (by id, index rule), branch load and edit (only a
│   │                           #   ruling whose quote is gone; a kept one stays
│   │                           #   answered); a swipe keeps it
│   ├── test-knowledge-beats.js # Tests: DEVELOPMENTS input, fulfilled parsing (lenient)
│   │                           #   and resolving, beat completion by the update after a
│   │                           #   reply, a swipe switch and an edit; marks flushed on a
│   │                           #   completion; autoTrack off; log counts only
│   ├── test-harvester.js       # Tests: harvestContext drops messages with plan ids,
│   │                           #   the injection header or markers, keeps OOC direction;
│   │                           #   the cast while the tracker is on, [] while off;
│   │                           #   the cast's current details, {} while details are off
│   ├── test-planner-cast.js    # Tests: formatCastBlock literal text, the cast slots in
│   │                           #   generate-arc.txt, generateArc over a scripted profile:
│   │                           #   outline prompt with and without a cast, three calls;
│   │                           #   a check rename reaches the stored arc, the check
│   │                           #   prompt with and without the names block
│   ├── test-secret-rewrites.js # Tests: plantedCluesOfSecret (leading id, beat: and
│   │                           #   prose targets unmatched), planted clues in
│   │                           #   {{SECRETS}}, kind "secret": proposal for a revealable
│   │                           #   secret, direct rewrite otherwise, none for a
│   │                           #   revealed/disclosed one, identical/empty/unknown
│   │                           #   dropped, no mutation, renames reach the proposal
│   ├── test-plan-check-renames.js # Tests: applyPlanCheck renames (#49): every text
│   │                           #   field, completed beats / fired triggers / direction /
│   │                           #   genre / theme seeds kept, whole names (possessive matches), longest
│   │                           #   first, each guard, malformed items; the names block
│   │                           #   (with a member's details after a dash)
│   ├── test-author-questions.js # Tests: parseAuthorQuestions (caps, garbage, zero),
│   │                           #   answeredAuthorAnswers, formatAuthorAnswersBlock,
│   │                           #   buildAskQuestionsVariables (new arc, re-plan), the
│   │                           #   prompt and its outline slot, prepareArc, generateArc
│   │                           #   with a given analysis, authorAnswers stamped and
│   │                           #   kept on a re-plan, none in the injection
│   ├── test-plan-check-intent.js # Tests: {{AUTHOR_ANSWERS}} (with, empty, absent,
│   │                           #   malformed), the contradiction / sweeping-claims /
│   │                           #   register rules and the two planner lines pinned,
│   │                           #   a re-plan's kept world facts in {{WORLD_FACTS}}
│   ├── test-genre.js           # Tests: formatGenreBlock, formatThemesBlock, the
│   │                           #   {{GENRE_BLOCK}} / {{THEMES_BLOCK}} slots and checklist
│   │                           #   lines, no genre or theme seeds in the injection,
│   │                           #   latestArcText, mergeReplan keeps both,
│   │                           #   generateArc: themes reach Phase 2 only, stamped when set
│   ├── test-pacing.js          # Tests: phase calculation + pacing directives +
│   │                           #   messagesUntilNextPhase (boundary offset, missing
│   │                           #   estimatedLength/messageStart)
│   ├── test-marks.js           # Tests: PLANTED/FIRED parsing, PLANT CHECK lines per
│   │                           #   tier/focus, queue keeps the prompt byte-identical
│   │                           #   until flush, flush rules, togglePlanItem
│   ├── test-signals.js         # Tests: signal parsing + processSignalResults
│   │                           #   (active-only completion, one per arc per message,
│   │                           #   locked-beat rejection) + promoteNextBeats
│   │                           #   + milestones (all active, any order)
│   │                           #   + scrubArcInternals (incl. secret ids)
│   ├── test-templates.js       # Tests: template loading + {{KEY}} substitution;
│   │                           #   prompt wording (one-moment fulfillments, world facts)
│   ├── test-world-facts.js     # Tests: worldFacts on createDefaultArc, arcWorldFacts,
│   │                           #   validateArcPlan, applyArcEdit (absent key accepted),
│   │                           #   the plan check's {{WORLD_FACTS}}, worldFact rewrites
│   │                           #   and drops, renames inside a world fact
│   └── test-validation.js      # Tests: parseLlmJson + validateArcPlan incl. tier
│                               #   (default, milestone activation, band clamp,
│                               #   pressure-less milestone rejected)
├── CONTEXT.md                  # Glossary — the words for tier, focus, beats, recognition
└── docs/
    ├── adr/                    # Decision records 0001–0008 (tier/focus split,
    │                           #   spotlight names no target, re-plan keeps the situation,
    │                           #   genre binds generation, marks wait for a prompt change,
    │                           #   plans are checked for give-aways, Story Arc tracks
    │                           #   who knows what as an optional feature, the narrator
    │                           #   never sees a fulfillment)
    ├── architecture/
    │   ├── architecture.md     # System design documentation
    │   ├── code-index.md       # This file
    │   └── st-extension-patterns.md
    │                           # SillyTavern extension API reference
    ├── claude/                 # onboarding.md (routing table) + canon guidelines
    ├── plans/                  # Dated design specs and implementation plans
    └── goals/GOALS.md          # High-level feature goals
```

The three architecture docs moved out of the repo root into `docs/architecture/`
(docs reorganization 2026-08-28, outside git history).

## Module Dependencies

```
lib/core/
├── constants.js  (no external deps)
└── settings.js   (imports: constants.js, /scripts/extensions.js, /script.js;
                   ensureChatState() runs migrateArc() over stored arcs)

lib/context/
├── chat-history.js  (imports: /script.js)
└── harvester.js     (imports: chat-history.js, planning/storage.js,
                      injection/signals.js arcInternalIds, core/constants.js,
                      core/settings.js (tracker and details switches, ledger),
                      knowledge/ledger.js currentDetailText, /script.js,
                      /scripts/extensions.js, /scripts/world-info.js getSortedEntries)

lib/planning/
├── validation.js  (imports: core/constants.js)
├── storage.js     (imports: core/settings.js, /script.js)
├── arc-edit.js    (imports: core/constants.js)
├── beat-completion.js (imports: arc-edit.js completeBeat, storage.js,
│                   core/settings.js, injection/pacing.js selectNonOptionalBeats,
│                   knowledge/message-ids.js messageIdOf, /script.js)
├── replan.js      (imports: core/constants.js)
├── arc-preset.js  (imports: core/settings.js, /script.js, /scripts/extensions.js,
│                   /scripts/preset-manager.js, /scripts/utils.js)
└── generator.js   (imports: validation.js, arc-preset.js, replan.js, core/settings.js,
                    core/constants.js, knowledge/names.js printTakenNames,
                    /script.js, /scripts/utils.js;
                    dynamic imports: /scripts/openai.js, /scripts/extensions/shared.js,
                    /scripts/sse-stream.js; templates are fetched from prompts/)

lib/injection/
├── pacing.js   (imports: core/constants.js, core/settings.js, /script.js)
├── clock.js    (imports: planning/storage.js, core/settings.js, /script.js)
├── stamping.js (imports: clock.js, core/constants.js, core/settings.js, /script.js)
├── signals.js  (imports: planning/storage.js, planning/beat-completion.js completeBeats,
│                core/settings.js, /script.js)
└── builder.js  (imports: pacing.js, clock.js, core/settings.js,
                 core/constants.js, context/chat-history.js)

lib/knowledge/
├── message-ids.js (imports: /scripts/utils.js uuidv4)
├── names.js    (imports: none)
└── ledger.js   (imports: message-ids.js, names.js, core/constants.js, core/settings.js,
                 injection/pacing.js, injection/signals.js flushPendingMarks,
                 planning/beat-completion.js completeBeats + reopenCompletionsAt,
                 planning/storage.js, planning/generator.js callLlm + templates,
                 planning/validation.js parseLlmJson, /script.js,
                 /scripts/extensions.js)

lib/ui/
├── progress.js      (imports: planning/storage.js, injection/pacing.js, injection/clock.js,
│                              core/settings.js, core/constants.js, beat-strip.js,
│                              /script.js, /scripts/utils.js)
├── beat-strip.js    (imports: injection/signals.js MARK_FLUSH_WINDOW,
│                              injection/pacing.js, core/settings.js,
│                              core/constants.js ARC_PHASES, /scripts/utils.js)
├── settings-panel.js (imports: core/constants.js, core/settings.js,
│                              planning/arc-preset.js, wizard.js, arc-manager.js,
│                              knowledge-popup.js, knowledge-status.js, progress.js,
│                              /script.js, /scripts/extensions.js, /scripts/popup.js)
├── knowledge-status.js (imports: core/settings.js)
├── wizard.js        (imports: context/harvester.js, planning/generator.js,
│                              planning/storage.js, planning/replan.js,
│                              core/settings.js, core/constants.js, progress.js,
│                              /script.js, /scripts/extensions.js,
│                              /scripts/popup.js, /scripts/utils.js)
├── wand-menu.js     (imports: core/settings.js, planning/storage.js, progress.js,
│                              wizard.js, arc-manager.js, knowledge-popup.js,
│                              /scripts/popup.js, /scripts/utils.js)
├── arc-manager.js   (imports: /script.js chat + chat_metadata + saveMetadata,
│                              planning/storage.js, planning/arc-edit.js,
│                              planning/beat-completion.js setBeatStatusByHand,
│                              injection/signals.js, injection/pacing.js,
│                              injection/builder.js MILESTONE_WORLD_FACT_LIMIT,
│                              injection/clock.js, core/settings.js,
│                              core/constants.js, progress.js, wizard.js,
│                              knowledge-popup.js, undo-stack.js, beat-strip.js,
│                              /scripts/popup.js,
│                              /scripts/utils.js)
├── knowledge-popup.js (imports: /script.js chat + saveMetadata, core/settings.js,
│                              core/constants.js DETAIL_KINDS + DETAIL_STATUS_VALUES + HOLDER_HOW,
│                              knowledge/ledger.js characterDisplayName + characterName + isDetailLocked +
│                              isSameDetailValue + listChangeItems + nextLedgerId,
│                              knowledge/names.js foldName + listCharactersWithNames + listTakenNames + nameWords,
│                              knowledge/message-ids.js messageIdOf, knowledge-status.js
│                              updateKnowledgeStatus, /scripts/popup.js,
│                              /scripts/utils.js)
└── undo-stack.js    (imports: nothing)

index.js  (imports: core/settings.js, planning/storage.js,
                    planning/beat-completion.js reopenCompletionsFrom, injection/builder.js,
                    injection/stamping.js, injection/signals.js,
                    knowledge/ledger.js, ui/settings-panel.js, ui/knowledge-status.js,
                    ui/wand-menu.js, ui/wizard.js closeWizard,
                    ui/progress.js, /script.js)
```

## Key Files by Feature

| Feature | Primary File | Supporting Files |
|---------|-------------|------------------|
| Extension entry | `index.js` | `lib/core/constants.js`, `lib/core/settings.js` |
| Context harvesting | `lib/context/harvester.js` (`fetchLorebookEntries`, `categorizeEntries`, `getCharacterData`, `getPersonaData`) | `chat-history.js` |
| Arc generation | `lib/planning/generator.js` (`loadTemplate`, `fillTemplate`) | `validation.js`, `arc-preset.js`, `prompts/` |
| Arc preset + profile | `lib/planning/arc-preset.js` | `lib/ui/settings-panel.js`, `lib/planning/generator.js` (`formatArcDirectives`) |
| Arc storage | `lib/planning/storage.js` | `lib/core/settings.js` |
| Prompt injection | `lib/injection/builder.js` (`buildArcSection` and the section builders) | `pacing.js`, `signals.js` |
| Tier (shape at generation) | `lib/planning/validation.js` | `lib/planning/generator.js` (`buildTierBlock`), `lib/core/constants.js` (`TIER_TABLE`), `prompts/generate-arc.txt` |
| Milestones (act/saga injection + recognition) | `lib/injection/builder.js` (`buildMilestoneSection`) | `builder.js` (`buildSignalDirective`, tracker off), `ledger.js` (the extraction, tracker on), `beat-completion.js` (`completeBeats`), `signals.js` (`promoteNextBeats`) |
| Focus: pause / resume | `lib/injection/clock.js` | `builder.js` (`buildPausedSection`), `lib/ui/arc-manager.js` |
| Focus: background | `lib/injection/builder.js` (`buildBackgroundSection`) | `lib/ui/arc-manager.js` (no background for episodes), `lib/planning/replan.js` (`replanTiers`: re-plan never shrinks an act or saga into an episode) |
| Focus: spotlight | `lib/injection/builder.js` (`buildSpotlightSection`, `sectionRank`, `buildPacingBlock`) | `clock.js` |
| Pacing clock (stamps + brake) | `lib/injection/clock.js` | `stamping.js`, `builder.js` |
| Re-plan | `lib/planning/replan.js` | `generator.js` (`buildArcSoFar`, `formatExistingArcs`), `lib/ui/wizard.js` (revise mode), `prompts/analyze-context.txt` |
| Stall nudge | `lib/ui/progress.js` (`isStalled`, `isStallNudgeShown`), `lib/injection/clock.js` (`stallCountStart`, `ignoreStall`, `showIgnoredStall`) | `lib/ui/settings-panel.js` (click handler), `lib/planning/beat-completion.js` (`lastFulfilledAt` set and restored), `lib/planning/replan.js` (`replannedAt` stamped by `applyReplan`), `lib/injection/clock.js` (`reactivatedAt` stamped by `reactivateArc`; all shifted on resume) |
| Rulings (the player overruled the plan) | `lib/knowledge/ledger.js` (`listArcPlans`, `latestShownMessageBefore`, `resolveRulings`, `findOptionInMessages`, `storeRulings`) | `prompts/extract-knowledge.txt` (PLANS, MESSAGE BEFORE THE NEW MESSAGES, task 7 with `chose`), `lib/ui/progress.js` (`renderRulingLine`), `lib/planning/replan.js` (`applyReplan` answers them, drops the removed ones), `lib/planning/generator.js` (`formatRulings`: the re-plan's three calls), `lib/ui/wizard.js` (`buildRulingsList`, step 2), `lib/ui/settings-panel.js` (click handler), `lib/planning/beat-completion.js` (`removeRulingsFrom`, `removeRulingsAt`: the rollback), `index.js` (delete, chat change) |
| Tier/focus migration | `lib/core/settings.js` (`migrateArc`) | `lib/planning/storage.js` |
| Phase/pacing | `lib/injection/pacing.js` | `lib/core/constants.js` |
| Signal tracking | `lib/injection/signals.js` | `lib/planning/beat-completion.js`, `lib/planning/storage.js` |
| Beat completion + rollback (ADR-0008) | `lib/planning/beat-completion.js` | `lib/injection/signals.js` (marker path), `lib/knowledge/ledger.js` (extraction path, `reopenCompletionsAt` on edit), `index.js` (`reopenCompletionsFrom` on delete, swipe, chat change), `lib/injection/builder.js` (`buildSignalDirective`: BEAT CHECK only with the tracker off), `prompts/extract-knowledge.txt` (DEVELOPMENTS, task 6), `lib/knowledge/message-ids.js`, `lib/planning/replan.js` (`withoutRoadInRecord`) |
| One-moment fulfillments | `prompts/generate-arc.txt` | `lib/planning/generator.js` (`buildTierBlock`, `applyPlanCheck`), `prompts/check-plan.txt` (FULFILLMENTS), `prompts/detail-pass.txt` |
| World facts (ADR-0009) | `prompts/generate-arc.txt` | `lib/core/settings.js` (`arcWorldFacts`), `lib/injection/builder.js` (`pushWorldFacts`), `lib/planning/generator.js` (`applyWorldFactRewrites`), `lib/planning/replan.js` (`mergeReplan`), `lib/ui/arc-manager.js` (`buildStyleFieldsNotice`), `prompts/check-plan.txt` (WORLD FACTS), `prompts/detail-pass.txt` |
| Secret rewrites (ADR-0003 amendment) | `lib/planning/generator.js` (`applyPlanCheck`, `plantedCluesOfSecret`) | `prompts/check-plan.txt` (step 2, SECRETS), `lib/planning/replan.js` (`applyReplan`), `lib/ui/wizard.js` (`buildSecretChoices`, `proposedSecretsNote`, `readSecretChoices`) |
| Plan check holds the plan to the story and the author (ADR-0009 amendment) | `prompts/check-plan.txt` (step 2: contradictions, sweeping claims, register; `{{AUTHOR_ANSWERS}}`) | `lib/context/harvester.js` (`harvestCast`: details), `lib/knowledge/ledger.js` (`currentDetailText`), `lib/planning/generator.js` (`formatCastLines`, `formatAuthorAnswers`, `buildPlanCheckVariables`), `prompts/generate-arc.txt` (pressure and world-fact lines) |
| Beat promotion / pacing brake | `lib/injection/signals.js` (`promoteNextBeats`) | `index.js` (`USER_MESSAGE_RENDERED`), `builder.js` |
| Planning wizard | `lib/ui/wizard.js` | `lib/context/`, `lib/planning/` |
| Arc manager | `lib/ui/arc-manager.js` | `lib/planning/storage.js`, `lib/injection/clock.js`, `wizard.js` |
| Progress display | `lib/ui/progress.js` | `lib/injection/pacing.js` |
| Wand-menu entry | `lib/ui/wand-menu.js` | `lib/ui/progress.js`, `wizard.js`, `arc-manager.js`, `index.js` |
| Settings panel | `lib/ui/settings-panel.js` | `lib/core/settings.js`, `lib/planning/arc-preset.js` |
| Knowledge tracker | `lib/knowledge/ledger.js` | `lib/knowledge/message-ids.js`, `lib/knowledge/names.js` (taken names), `index.js` (event wiring), `prompts/extract-knowledge.txt`, `lib/ui/knowledge-popup.js`, `lib/ui/settings-panel.js` (switch, interval), `lib/ui/knowledge-status.js` (status line), `lib/injection/builder.js` (`holderSuffix`), `lib/planning/validation.js` (`normalizeSecretHolders`), `prompts/generate-arc.txt` (holders), `lib/core/constants.js` (`createEmptyKnowledgeLedger`) |
| Styles | `style.css` | `lib/css/*.css` |
