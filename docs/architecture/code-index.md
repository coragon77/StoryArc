# Code Index

- **Coverage:** `index.js`, `lib/`, `prompts/`, `tests/`, `style.css`, `manifest.json`
- **Last Updated:** 2026-11-04

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
│   ├── generate-arc.txt        # Phase 2 prompt: produce JSON arc plan from analysis;
│   │                           #   asks for both faces of each beat (pressure +
│   │                           #   fulfillment, one on-screen moment: never a tally
│   │                           #   of scenes or a chain of events) plus breather
│   │                           #   beats and unresolved threads; {{TIER_BLOCK}} sets beat kind, count and
│   │                           #   length band ("Scene beats only" tags the episode-only
│   │                           #   guidelines); {{ARC_SO_FAR}} on re-plan; renders enabled
│   │                           #   arc directives as a STANDING CONSTRAINTS section
│   ├── check-plan.txt          # Phase 3 prompt: plan check — rewrite give-away triggers
│   │                           #   and pressures, list revealed secrets (re-plan),
│   │                           #   rewrite tally/chain fulfillments ({{FULFILLMENTS}},
│   │                           #   kind "fulfillment") into one moment, link triggers
│   │                           #   to secrets; answers JSON (ADR-0006)
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
│   │                           #   getKnowledgeTrackerSettings(),
│   │                           #   isKnowledgeTrackerEnabled(), getKnowledgeLedger()
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
│   │   │                       #   character card fields + user persona
│   │   └── chat-history.js     # harvestChatHistory() — recent messages with token budget,
│   │                           #   estimateTokens()
│   ├── planning/
│   │   ├── generator.js        # generateArc(context, userDirection, callbacks, { tier, reviseArc, genre }) —
│   │   │                       #   two-phase LLM generation with retry logic; stamps
│   │   │                       #   tier, direction, genre, messageStart, lastFulfilledAt;
│   │   │                       #   formatGenreBlock(genre, phase) fills {{GENRE_BLOCK}}
│   │   │                       #   in both phases (ADR-0004);
│   │   │                       #   passes { tier } into validateArcPlan; on re-plan
│   │   │                       #   merges with mergeReplan(reviseArc, arc), then
│   │   │                       #   runPlanCheck() (Phase 3) with the exported
│   │   │                       #   buildPlanCheckVariables() / applyPlanCheck()
│   │   │                       #   (also the open beats' fulfillments, rewrites
│   │   │                       #   of completed beats ignored);
│   │   │                       #   formatExistingArcs(arcs, reviseArcId) marks the
│   │   │                       #   re-planned arc in phase 1, omits it in phase 2;
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
│   │   │                       #   buildArcSoFar(arc) → {{ARC_SO_FAR}} on re-plan: premise,
│   │   │                       #   secrets (add-only), escalation, fulfilled beats as
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
│   │   │                       #   latestGenre(arcs) — wizard default for a new arc
│   │   ├── arc-edit.js         # applyArcEdit(stored, json) — Edit arc save checks;
│   │   │                       #   applyTitleAndPremiseEdit(stored, edit) — trimmed
│   │   │                       #   title + premise as the only updates, same blank
│   │   │                       #   rule and messages as applyArcEdit;
│   │   │                       #   checkBeatEdit(tier, edit) — validator's rules for a
│   │   │                       #   hand edit; removeBeat(beats, id) — drops the id from
│   │   │                       #   unlockAfter and unlocks beats with nothing left open;
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
│   │   │                       #   reopenCompletion() undoes unlocks, promotions and
│   │   │                       #   arc completion; restoreLastFulfilledAt()
│   │   └── replan.js           # mergeReplan(existing, generated) — spec §3 merge:
│   │                           #   keeps identity, edited title/premise/direction,
│   │                           #   secrets (add-only, content-deduped), completed
│   │                           #   beats (their completion records without unlocked
│   │                           #   and arcCompleted: withoutRoadInRecord), planted
│   │                           #   foreshadowing, fired triggers;
│   │                           #   replaces the rest; withUniqueIds() suffixes
│   │                           #   colliding ids _2, _3, … and renames unlockAfter refs;
│   │                           #   replanTiers(tier) — the tiers a re-plan may pick:
│   │                           #   same or larger, never smaller (wizard selector);
│   │                           #   applyReplan(merged, chatLength) — the arc "Apply
│   │                           #   re-plan" stores (today a deep copy of the merged arc)
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
│   │   │                       #   tone, active beat as CURRENT PRESSURE (pressure,
│   │   │                       #   falling back to intention), no beat ids; linger
│   │   │                       #   directive when no beat is active; guardrails first,
│   │   │                       #   content lists last. Header word kept from before
│   │   │                       #   tiers for byte-identity (architecture.md, migration);
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
│   │   │                       #   === ACT/SAGA: header, premise, unfulfilled milestone
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
│   │   │                       #   by the paused span, no-op on the clock if never paused;
│   │   │                       #   spotlightArc(id) — one arc in the spotlight, the
│   │   │                       #   previous spotlit arc goes back to normal
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
│   │   │                       #   sorted by folded form; listTakenNames(ledger)
│   │   │                       #   (folded form → first spelling, hyphenated words
│   │   │                       #   whole and by part), nameWords(name), foldName();
│   │   │                       #   reused by the name flag (#35) and planner (#36)
│   │   └── ledger.js           # The knowledge tracker's process (ADR-0007), sections in
│   │                           #   the order it runs, helpers after their first caller;
│   │                           #   every ledger operation changes the stored ledger in
│   │                           #   place and returns true when it changed; the update
│   │                           #   functions return { ledgerChanged, beatsChanged }:
│   │                           #   Update after a reply — updateKnowledgeAfterReply(i),
│   │                           #   every N replies, one at a time, stale answers dropped;
│   │                           #   completeFulfilledBeats() after the apply →
│   │                           #   completeBeats, then flushPendingMarks(i, true);
│   │                           #   Extraction — extractKnowledge(ledger, chat, fromIndex,
│   │                           #   persona) → parsed answer or null; listShownSecrets(arcs),
│   │                           #   listRecognisableBeats(arcs) → {{DEVELOPMENTS}}
│   │                           #   (autoTrack on only), buildKnowledgeExtractionVariables(),
│   │                           #   parseKnowledgeExtractionAnswer() (all or nothing,
│   │                           #   except the fulfilled list: broken items dropped),
│   │                           #   resolveRevealedSecrets() (keeps the heard text),
│   │                           #   resolveFulfilledDevelopments() (listed active beats,
│   │                           #   at inside the read messages);
│   │                           #   Apply — applyExtractionAnswer(ledger, answer, from,
│   │                           #   last): the teller of a told fact holds it too, an
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
│   │                           #   characterName(ledger, id) (also for the popup)
│   ├── ui/
│   │   ├── settings-panel.js   # renderSettingsPanel() — extension drawer HTML:
│   │   │                       #   enable toggle, generation profile dropdown
│   │   │                       #   (Connection Manager profiles), 'Create arc preset'
│   │   │                       #   button (handleCreateArcPreset(), no base-preset
│   │   │                       #   dropdown), plan/manage buttons, progress container;
│   │   │                       #   setupSettingsPanelEvents() also wires the stall
│   │   │                       #   nudge (.story-arc-stall-btn → showWizard(arcId));
│   │   │                       #   knowledge tracker switch, update interval and
│   │   │                       #   status line (updateKnowledgeStatus())
│   │   ├── wand-menu.js        # registerWandMenuEntry() — adds a "Story Arc" item to
│   │   │                       #   #extensionsMenu (the wand next to the chat bar);
│   │   │                       #   showWandPopup() reopens itself after the wizard or
│   │   │                       #   the manager resolves, so the progress cards rebuild;
│   │   │                       #   says the extension is disabled instead of offering
│   │   │                       #   dead buttons; Knowledge action while the tracker is on
│   │   ├── wizard.js           # showWizard(reviseArcId?) — multi-step arc planning popup:
│   │   │                       #   context preview → tier selector + direction →
│   │   │                       #   generation view (append-only step log with elapsed
│   │   │                       #   times, live streamed-chars ticker, active profile
│   │   │                       #   name) → review. Revise mode: tier/direction/title/
│   │   │                       #   premise pre-filled, reviseArcWithEdits() feeds
│   │   │                       #   generateArc, "Apply re-plan" writes via updateArc;
│   │   │                       #   unbinds its click namespace when the popup resolves
│   │   ├── arc-manager.js      # showArcManager() — arc list popup: status/tier/focus
│   │   │                       #   badges, focus <select> (paused / background / normal
│   │   │                       #   / spotlight via clock.js; no background for an
│   │   │                       #   episode), Re-plan (closes, then opens
│   │   │                       #   showWizard(arcId)), Edit title and premise
│   │   │                       #   (buildTitleAndPremiseEditor(), outside the
│   │   │                       #   spoilers), complete, abandon; per beat an
│   │   │                       #   inline editor (pressure + intention, delete with a
│   │   │                       #   second click) and an Edit arc JSON editor (via
│   │   │                       #   arc-edit.js); buildPlanItemLists() — Secrets,
│   │   │                       #   Clues, Triggers drawers with open / waiting /
│   │   │                       #   done items; buildReportsWaitingLine(); unbinds the whole
│   │   │                       #   .storyArcManager namespace when the popup resolves;
│   │   │                       #   Knowledge button (tracker on) opens the knowledge popup
│   │   ├── knowledge-popup.js  # showKnowledgePopup() — the knowledge ledger behind two
│   │   │                       #   closed spoiler drawers (Characters, Facts):
│   │   │                       #   buildKnowledgeContent(); pure ledger edits
│   │   │                       #   (addCharacter, renameCharacter, setCharacterAliases,
│   │   │                       #   addFact, editFactText, deleteFact, setFactPublic,
│   │   │                       #   addFactHolder, removeFactHolder) return
│   │   │                       #   { ledger, error }; new holders are how
│   │   │                       #   HOLDER_HOW.user, at null. Opened from the Arc
│   │   │                       #   Manager and the wand menu while the tracker is on
│   │   ├── spoiler-group.js    # buildSpoilerGroup(id, label, warning, body) — the
│   │   │                       #   collapsed spoiler drawer of the Arc Manager and
│   │   │                       #   the Knowledge popup
│   │   └── progress.js         # renderProgressDisplay() — compact beat status display
│   │                           #   injected into ST sidebar; "n/m beats" or "n/m
│   │                           #   milestones"; shows "~N msgs to next phase" only
│   │                           #   while the message count holds the phase back,
│   │                           #   never in resolution; isStalled(arc, chatLength) —
│   │                           #   the stall rule behind the "May have drifted —
│   │                           #   re-plan?" button (episodes only, not while paused)
│   └── css/
│       ├── core.css            # CSS custom properties, base layout, badges incl.
│       │                       #   the tier badge
│       ├── spoiler.css         # Spoiler toggle (hidden arc content)
│       ├── wizard.css          # Wizard popup layout, step indicators, tier row and
│       │                       #   hint, generation step log and streamed-chars ticker
│       ├── arc-manager.css     # Arc list, beat rows, status badges
│       ├── knowledge.css       # Knowledge popup rows, holder chips, editors
│       └── progress.css        # Compact sidebar progress widget, incl. the
│                               #   "msgs to next phase" line and the stall nudge
├── tests/
│   ├── run.sh                  # Node.js test runner (node:test)
│   ├── smoke.sh                # HTTP smoke tests against live ST instance
│   ├── setup.js                # Registers ESM loader before test files load
│   ├── loader.js               # Custom ESM loader — intercepts ST imports, returns mocks
│   ├── mocks/
│   │   └── st-mocks.js         # Mock exports for /script.js, /scripts/extensions.js, etc.
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
│   │                           #   spotlightArc (previous spotlit arc back to normal)
│   ├── test-migration.js       # Tests: migrateArc on arcs stored before tiers +
│   │                           #   ensureChatState running it once
│   ├── test-replan.js          # Tests: mergeReplan (kept vs. replaced fields, secrets
│   │                           #   add-only, id de-collision, tier change, kept
│   │                           #   completion records lose unlocked/arcCompleted) + replanTiers +
│   │                           #   buildArcSoFar + formatExistingArcs mark + applyReplan
│   ├── test-spotlight.js       # Tests: spotlit act/saga BRING TO A HEAD block (no
│   │                           #   milestone named, ordered first), spotlit episode
│   │                           #   byte-identical, brake follows the clock
│   ├── test-stall.js           # Tests: isStalled threshold (hand-computed boundary),
│   │                           #   never for paused/act/saga, migrated arcs,
│   │                           #   lastFulfilledAt set on fulfillment and shifted on
│   │                           #   resume, nudge rendering
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
│   ├── test-arc-manager-plan-lists.js # Tests: three plan drawers, item order,
│   │                           #   waiting state, reports-waiting line, title and
│   │                           #   premise editor (escaped, no plan text)
│   ├── test-knowledge-popup.js # Tests: knowledge popup ledger edits (literal before/
│   │                           #   after ledgers), spoiler drawers start closed
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
│   ├── test-knowledge-block.js # Tests: buildKnowledgeBlock literal lines (present,
│   │                           #   talked about by alias, Has told, shared-only-with,
│   │                           #   cap, EVERYONE KNOWS, plan holders never printed)
│   ├── test-knowledge-inject.js # Tests: injectKnowledgeBlock keys (knowledge, names),
│   │                           #   in-chat depth 1, system role; '' while off or empty;
│   │                           #   names text unchanged when scene and facts change
│   ├── test-knowledge-names.js # Tests: buildTakenNamesBlock literal lists (titles,
│   │                           #   hyphenated parts, aliases, repeats, diacritics,
│   │                           #   particles, sort), byte stability; listTakenNames
│   ├── test-knowledge-update.js # Tests: updateKnowledgeAfterReply (off: no call,
│   │                           #   interval, failed/unreadable answer, first update,
│   │                           #   popup edit during the call, swipe during the call)
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
│   │                           #   the settings panel
│   ├── test-plan-check.js      # Tests: applyPlanCheck (scope, revealed on re-plan
│   │                           #   only, links, echoed IF line, fulfillment rewrites of
│   │                           #   open beats only) + buildPlanCheckVariables
│   ├── test-beat-completion.js # Tests: completeBeats rules and completion record
│   │                           #   (message id read, never given), reopenCompletionsFrom
│   │                           #   (delete, swipe, branch, id follow, what reopening
│   │                           #   undoes, lastFulfilledAt), reopenCompletionsAt (edit),
│   │                           #   hand toggle carries no record
│   ├── test-knowledge-beats.js # Tests: DEVELOPMENTS input, fulfilled parsing (lenient)
│   │                           #   and resolving, beat completion by the update after a
│   │                           #   reply, a swipe switch and an edit; marks flushed on a
│   │                           #   completion; autoTrack off; log counts only
│   ├── test-harvester.js       # Tests: harvestContext drops messages with plan ids,
│   │                           #   the injection header or markers, keeps OOC direction
│   ├── test-genre.js           # Tests: formatGenreBlock, {{GENRE_BLOCK}} slots in both
│   │                           #   templates, GENRE: line per section, latestGenre,
│   │                           #   mergeReplan keeps the edited genre
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
│   ├── test-templates.js       # Tests: template loading + {{KEY}} substitution
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
                      injection/signals.js arcInternalIds, core/constants.js, /script.js,
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
                    core/constants.js, /script.js, /scripts/utils.js;
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
├── progress.js      (imports: planning/storage.js, injection/pacing.js,
│                              core/settings.js, /script.js, /scripts/utils.js)
├── settings-panel.js (imports: core/constants.js, core/settings.js,
│                              planning/arc-preset.js, wizard.js, arc-manager.js,
│                              /script.js, /scripts/extensions.js, /scripts/popup.js)
├── wizard.js        (imports: context/harvester.js, planning/generator.js,
│                              planning/storage.js, planning/replan.js,
│                              core/settings.js, core/constants.js, progress.js,
│                              /script.js, /scripts/extensions.js,
│                              /scripts/popup.js, /scripts/utils.js)
├── wand-menu.js     (imports: core/settings.js, planning/storage.js, progress.js,
│                              wizard.js, arc-manager.js, knowledge-popup.js,
│                              /scripts/popup.js, /scripts/utils.js)
├── arc-manager.js   (imports: /script.js chat_metadata + saveMetadata,
│                              planning/storage.js, planning/arc-edit.js,
│                              injection/signals.js, injection/pacing.js,
│                              injection/clock.js, core/settings.js,
│                              core/constants.js, progress.js, wizard.js,
│                              knowledge-popup.js, spoiler-group.js, /scripts/popup.js,
│                              /scripts/utils.js)
├── knowledge-popup.js (imports: /script.js saveMetadata, core/settings.js,
│                              core/constants.js HOLDER_HOW,
│                              knowledge/ledger.js characterName + nextLedgerId,
│                              spoiler-group.js, /scripts/popup.js,
│                              /scripts/utils.js)
└── spoiler-group.js (imports: nothing)

index.js  (imports: core/settings.js, planning/storage.js,
                    planning/beat-completion.js reopenCompletionsFrom, injection/builder.js,
                    injection/stamping.js, injection/signals.js,
                    knowledge/ledger.js, ui/settings-panel.js, ui/wand-menu.js,
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
| Stall nudge | `lib/ui/progress.js` (`isStalled`) | `lib/ui/settings-panel.js` (click handler), `lib/planning/beat-completion.js` (`lastFulfilledAt` set and restored) |
| Tier/focus migration | `lib/core/settings.js` (`migrateArc`) | `lib/planning/storage.js` |
| Phase/pacing | `lib/injection/pacing.js` | `lib/core/constants.js` |
| Signal tracking | `lib/injection/signals.js` | `lib/planning/beat-completion.js`, `lib/planning/storage.js` |
| Beat completion + rollback (ADR-0008) | `lib/planning/beat-completion.js` | `lib/injection/signals.js` (marker path), `lib/knowledge/ledger.js` (extraction path, `reopenCompletionsAt` on edit), `index.js` (`reopenCompletionsFrom` on delete, swipe, chat change), `lib/injection/builder.js` (`buildSignalDirective`: BEAT CHECK only with the tracker off), `prompts/extract-knowledge.txt` (DEVELOPMENTS, task 6), `lib/knowledge/message-ids.js`, `lib/planning/replan.js` (`withoutRoadInRecord`) |
| One-moment fulfillments | `prompts/generate-arc.txt` | `lib/planning/generator.js` (`buildTierBlock`, `applyPlanCheck`), `prompts/check-plan.txt` (FULFILLMENTS), `prompts/detail-pass.txt` |
| Beat promotion / pacing brake | `lib/injection/signals.js` (`promoteNextBeats`) | `index.js` (`USER_MESSAGE_RENDERED`), `builder.js` |
| Planning wizard | `lib/ui/wizard.js` | `lib/context/`, `lib/planning/` |
| Arc manager | `lib/ui/arc-manager.js` | `lib/planning/storage.js`, `lib/injection/clock.js`, `wizard.js` |
| Progress display | `lib/ui/progress.js` | `lib/injection/pacing.js` |
| Wand-menu entry | `lib/ui/wand-menu.js` | `lib/ui/progress.js`, `wizard.js`, `arc-manager.js`, `index.js` |
| Settings panel | `lib/ui/settings-panel.js` | `lib/core/settings.js`, `lib/planning/arc-preset.js` |
| Knowledge tracker | `lib/knowledge/ledger.js` | `lib/knowledge/message-ids.js`, `lib/knowledge/names.js` (taken names), `index.js` (event wiring), `prompts/extract-knowledge.txt`, `lib/ui/knowledge-popup.js`, `lib/ui/settings-panel.js` (switch, interval, status), `lib/injection/builder.js` (`holderSuffix`), `lib/planning/validation.js` (`normalizeSecretHolders`), `prompts/generate-arc.txt` (holders), `lib/core/constants.js` (`createEmptyKnowledgeLedger`) |
| Styles | `style.css` | `lib/css/*.css` |
