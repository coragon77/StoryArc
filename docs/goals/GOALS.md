# Story Arc - Project Goals

## The Problem

Long-running roleplay stories in SillyTavern (1000+ messages) lose narrative direction over time. The AI has no sense of where the story should go next, and the user is left manually steering every beat. Aggressive summarization keeps context manageable but doesn't solve the fundamental issue: there is no plan.

Existing extensions either:
- **Plan stories from scratch** (Story Mode) -- useless when you're 1400 messages deep
- **Manage memory/context** (Timeline Memory, Memory Books, Smart Memory) -- they track what happened, but don't plan what should happen next

No existing SillyTavern extension bridges the gap between "where am I?" and "where should this go?"

## The Goal

Build a SillyTavern extension that plans new story arcs for existing, long-running stories -- not from scratch, but from where the story actually is right now.

## What "Success" Looks Like

1. **I can tell the extension about my current story state** -- through my lorebook, chat history, summaries, or my own description -- and it understands the world, characters, relationships, and ongoing threads.

2. **It generates a structured arc plan** -- a sequence of narrative beats or turning points that continue the existing story in a coherent direction, respecting everything that has happened so far.

3. **The plan guides the AI during chat** -- the arc plan is injected into the AI's prompt so it has narrative direction, knowing what beats to work toward without railroading the conversation.

4. **I can see progress** -- as the story unfolds, I can track which beats have been hit and where I am in the arc.

5. **When the arc ends, I can plan another** -- the extension supports iterative arc planning for stories that run indefinitely.

## What This Is NOT

- Not a "start a new story" tool -- that's Story Mode's job
- Not a memory/summarization system -- that's Timeline Memory / Memory Books / Smart Memory
- Not a lorebook manager -- that's LoreManager / WorldInfo Recommender
- Not a full story authoring suite -- no cover art, no libraries, no PNG export

## Core Workflow

```
Open extension -> "Plan Next Arc"
    |
    v
Context is gathered automatically:
  - Lorebook entries (world state, characters, history)
  - Recent chat / summaries (what just happened)
  - Optionally: user writes what they want to explore next
    |
    v
LLM generates an arc plan:
  - 5-8 narrative beats with descriptions
  - Overall arc direction and theme
  - Respects existing story context
    |
    v
User reviews and optionally adjusts the plan
    |
    v
Plan becomes active:
  - Injected into AI prompts during chat
  - Progress tracked as beats are hit
  - UI shows current position in arc
    |
    v
Arc completes -> "Plan Next Arc" (cycle repeats)
```

## Guiding Principles

- **Context is king.** The quality of the arc plan depends entirely on how well we understand the current story. Invest heavily in context harvesting.
- **Read-only.** Never modify the user's lorebook, chat history, or other extensions' data. We consume context, we don't produce side effects.
- **One thing well.** Plan arcs. That's it. Don't creep into memory management, lorebook editing, or story-from-scratch generation.
- **Lean.** No features beyond the core loop. No library, no cover art, no file storage beyond what ST provides via chat_metadata.
- **Graceful degradation.** If the lorebook is empty, work with chat history. If the chat is short, work with user description. Any single context source should be sufficient.
