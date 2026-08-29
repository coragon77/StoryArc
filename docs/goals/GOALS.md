# Story Arc - Project Goals

## The Problem

Long-running roleplay stories in SillyTavern (1000+ messages) lose narrative direction over time. The AI makes things up moment-to-moment with no plan -- mysteries go nowhere because the AI doesn't know the answer, tension resolves immediately because the AI wants to complete rather than sustain, and stories become flat, repetitive, and aimless. This is "AI slop."

The human co-author runs out of ideas too. Even experienced writers hit a wall around 1000-1500 messages. When neither the human nor the AI knows where the story is going, the RP stalls.

Existing extensions either:
- **Plan stories from scratch** (Story Mode) -- useless when you're 1400 messages deep
- **Manage memory/context** (Timeline Memory, Memory Books, Smart Memory) -- they track what happened, but don't plan what should happen next

No existing SillyTavern extension bridges the gap between "where am I?" and "where should this go?"

## The Goal

Build a SillyTavern extension that acts as an **automated dungeon master** for existing, long-running stories. It harvests context from the current chat, generates detailed narrative plans with the depth of a novelist's outline, and injects those plans into the AI's prompts -- giving the chat LLM something it never normally has: **it knows where the story is going**.

The user experiences the story as a player, not a planner. Mysteries have real answers the user doesn't know. Foreshadowing is deliberate. Tension builds because the AI has a plan to follow, not because it's improvising.

## What "Success" Looks Like

1. **The extension understands my story** -- it harvests context from character cards, personas, all connected lorebooks, chat history, and my own input to deeply understand the world, characters, relationships, and ongoing threads.

2. **It generates plans like a novelist** -- not a quest log, but a narrative outline with secrets the AI guards, foreshadowing to plant, flexible beats that adapt to the RP, escalation patterns, and explicit pacing rules. The plan includes "what this arc IS" and "what this arc is NOT" directives.

3. **The plan is secret from me** -- the arc plan is injected into the AI's prompt so I experience the story as a player. Mysteries stay mysterious. I can peek behind spoiler toggles if I want, but by default I'm surprised by what happens.

4. **Multiple arcs run simultaneously, at different timescales** -- the long-term structure (decided 2026-08-29) is three nested tiers, like episode/season/series in serialized TV:
   - **Episode** (~10 messages, foreground): a playable, resolvable unit -- "the group takes a job from the guild board." Gets the full treatment: active beat as pressure, hidden roadmap, signal tracking, promotion gating.
   - **Act** (~100 messages, background): influences everything without being pursued. Its current beat is injected as a standing *pressure line* (no completable objective), and it completes by *recognition* -- whenever the story, possibly mid-episode, happens to fulfill it.
   - **Saga** (~1000 messages): the overarching storyline ("defeat the Big Bad"). Premise plus current era as one line of standing tension; beats at this scale are milestones, advanced by the same recognition mechanism, coarser.

   Supporting goals: **quick episode planning** (a lightweight wizard path that plans a small arc on the spot, harvesting the active act/saga so episodes inherit their weather) and resisting a formal hierarchy (no arc-owns-arc links) until recognition-based completion proves insufficient -- the act notices what episodes do for free.

5. **The AI doesn't rush** -- pacing controls prevent the LLM from resolving tension in 2-3 messages. Beat gating hides future plot points from the AI until the story reaches them. Explicit phase directives ("you are in SETUP, do not resolve anything") keep the narrative pace realistic.

6. **I can track progress without spoilers** -- progress bars and phase labels show where I am in each arc without revealing what's coming. Detailed beat tracking is available behind spoiler toggles.

7. **I can give creative direction** -- before generating an arc, I can provide ingredients: factions, antagonists, themes, situations I want to explore. The LLM has creative freedom in how to use them.

8. **When an arc ends, I plan another** -- the extension supports iterative arc planning. Each new arc benefits from all the context that came before, keeping the story fresh indefinitely.

## What This Is NOT

- Not a "start a new story" tool -- that's Story Mode's job
- Not a memory/summarization system -- that's Timeline Memory / Memory Books / Smart Memory
- Not a lorebook manager -- that's LoreManager / WorldInfo Recommender
- Not a full story authoring suite -- no cover art, no libraries, no PNG export
- Not a game engine -- arcs are narrative intentions, not gameplay mechanics

## Core Workflow

```
Open extension -> "Plan Next Arc"
    |
    v
Context is harvested automatically:
  - Character card (description, personality, scenario)
  - User persona
  - All connected lorebooks (character-bound, global, chat-bound)
  - Recent chat history
  - Existing active arcs
  - User's creative direction (free-form: ingredients, themes, factions)
    |
    v
User reviews harvested context summary:
  - Can include/exclude specific lorebook entries
  - Token budget estimation
    |
    v
Multi-phase LLM generation:
  Phase 1: Analyze story state, identify threads and tensions
  Phase 2: Generate arc outline (premise, secrets, beats, foreshadowing)
  Phase 3: Detail pass (expand beats, add specificity)
    |
    v
User reviews the plan (spoiler-gated):
  - Always visible: title, themes, tone, directives
  - Behind spoiler toggles: secrets, foreshadowing, beat details
  - Can edit any section
    |
    v
Plan becomes active:
  - Injected into AI prompts with pacing controls
  - Multiple arcs layered (foreground gets detail, background gets summary)
  - Triggers can fire across arcs
  - Progress tracked via AI signals, stripped from visible output
    |
    v
Arc completes -> "Plan Next Arc" (cycle repeats)
```

## Guiding Principles

- **Context is king.** The quality of the arc plan depends entirely on how well we understand the current story. Invest heavily in context harvesting.
- **Read-only.** Never modify the user's lorebook, chat history, or other extensions' data. We consume context, we don't produce side effects. One deliberate exception: freshly received AI messages are cleaned of plan internals (signal markers stripped, leaked arc/beat identifiers scrubbed) before they persist -- that is our own protocol data, not the user's story.
- **Starve the solver.** LLMs are trained to complete visible goals: a stated destination gets referenced verbatim, characters turn into exposition mouthpieces, and tension escalates to 100% immediately. A story cannot be "solved" -- it must meander and leave threads open. So the model is never shown the roadmap: it sees only the current beat, phrased as a *pressure* (a force in the scene), never as an outcome; fulfillment conditions exist only for past-tense recognition; upcoming beats stay hidden until the story reaches them. Prompt clauses steer, but only withholding information guarantees.
- **React, don't clock.** Arc progression follows the roleplay, never a round counter. Beats complete when the model recognizes the story fulfilled them; the next beat is revealed only after the player's next turn. A mechanical clock detaches the plan from an unforeseen story direction; when the story truly leaves the plan, the answer is mid-arc revision, not pacing.
- **Narrative-first.** Plans are novelist's outlines, not quest logs. Secrets, foreshadowing, escalation patterns, and flexible beats -- not checkboxes.
- **Player experience.** The user should feel like a player in a story with a skilled dungeon master, not a co-author staring at an outline.
- **Pace control.** The single biggest failure mode is the LLM rushing to resolution. Every layer of the system pushes against this: gated beats, phase directives, explicit anti-patterns, message-count awareness.
- **Graceful degradation.** If the lorebook is empty, work with chat history. If the chat is short, work with user description. Any single context source should be sufficient.
- **One thing well.** Plan arcs. That's it. Don't creep into memory management, lorebook editing, or story-from-scratch generation.
