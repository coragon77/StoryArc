# Story Arc

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that plans the next arc of an existing, long-running roleplay and quietly steers the chat model toward it.

Long roleplays lose direction. After a few hundred messages the story drifts from scene to scene, and the model has no idea where things are supposed to go. Story Arc works like a hidden game master: it reads what has already happened, asks an LLM to plan what happens next, and feeds that plan into every prompt without showing it to you. You play; the plan stays a surprise.

> **Status: beta (0.1.0).** Story Arc is in daily use in long roleplays, but it has mostly been run with GLM and Claude models on one SillyTavern install. Expect rough edges, and please report problems in the [issue tracker](https://github.com/coragon77/StoryArc/issues).

What it does:

- **Reads the story so far** from your lorebook (World Info), the character card, your persona and the recent chat history.
- **Plans an arc** in three LLM passes: an analysis of the story's current state, a structured plan with beats, secrets, foreshadowing and triggers, and a check that rewrites anything in the plan that would give a secret away. On a re-plan the check also notices which secrets the story has already revealed.
- **Steers the chat** by injecting the plan into the prompt. The model sees only the current pressure on the scene, never a checklist of goals, so it does not race through the plan.
- **Tracks progress** by letting the model report, with a hidden marker, when the story has fulfilled a beat.
- **Keeps the plan secret.** Everything that would spoil the story sits behind spoiler toggles.

Story Arc was scaffolded from [Story Mode](https://github.com/Prompt-And-Circumstance/StoryMode). Story Mode plans a story from scratch; Story Arc continues one that already exists.

## Requirements

- SillyTavern with a **Chat Completion** API. The fallback generation route and the per-message arc counter both use the Chat Completion pipeline. Text Completion APIs are not tested.
- Optional: SillyTavern's **Connection Manager** extension, if you want arc planning to run on a different API, model or preset than the chat itself.

## Installation

In SillyTavern, open **Extensions → Install extension**, paste the repository URL and confirm:

```
https://github.com/coragon77/StoryArc
```

To install by hand instead, clone the repository into SillyTavern's third-party extension folder and reload SillyTavern:

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/coragon77/StoryArc.git
```

There is no build step. SillyTavern loads the files as they are. To update, use **Manage extensions → Update**, or run `git pull` in the `StoryArc` folder.

## Setup

Open the **Extensions** drawer and expand **Story Arc**.

1. **Enable Story Arc.** The extension does nothing until this is checked.
2. **Generation profile.** Choose which Connection Manager profile plans the arcs. "Current API" uses whatever the chat is using. Planning sends a large prompt (often 20,000+ characters) and expects a long JSON answer, so a capable model with a generous response length works best.
3. **Create arc preset** (optional, recommended). This creates a preset named `Story Arc Generation`, tuned for planning (high reasoning effort, 20,000 response tokens, temperature 0.8), plus a connection profile of the same name, cloned from the selected profile. Select that profile as the generation profile afterwards.

The arc preset also holds two **standing directives** as ordinary prompt entries. You edit and toggle them in SillyTavern's own prompt manager:

| Entry | Default | Effect |
|---|---|---|
| Story Arc: Genre | on | Keeps new arcs inside the genre and tone the story has already set. Replace its text to force one genre for every arc. |
| Story Arc: Adult Content | off | Allows arcs to build toward explicit scenes instead of fading to black. |

The directives are read from the **saved** preset, so save the preset after you change a toggle.

## Everyday use

Most of the time you use the **wand menu** next to the chat input: click it and choose **Story Arc**. The popup has **Plan Next Arc**, **Manage Arcs** and a progress card for each active arc. The same buttons are also in the Extensions drawer.

### Planning an arc

**Plan Next Arc** opens a three-step wizard.

1. **Context.** This shows what Story Arc harvested: the character, persona, number of lorebook entries, chat depth, estimated tokens and active arcs. Expand "Inspect harvested entries" to see the lorebook entries themselves.
2. **Direction.** Here you choose the arc's size and say what you want:
   - **Tier**: episode, act or saga (see [Tiers](#tiers)).
   - **Genre**: the register this arc must stay in, for example "High fantasy adventure: guild jobs, monsters and ruins, banter around the campfire. Dark moments, but never grimdark." It binds both planning passes. A new arc starts with the genre of your most recent arc.
   - **Direction**: free text about what the arc should explore, for example "The party takes a job from the guild board: find out what haunts the old mill. Let it look routine at first, and let one clue point at something much bigger."
3. **Review.** Story Arc runs the two planning passes and shows a live log. The finished plan shows its title, themes, tone, tier and estimated length openly. The premise, secrets, beats, foreshadowing, triggers and escalation are hidden behind spoiler toggles, so you can activate an arc without reading it. Choose **Activate**, **Regenerate** or **Back**.

Failed requests caused by timeouts or gateway errors are retried automatically, up to two times.

### Managing arcs

**Manage Arcs** lists every arc in the current chat. Completed and abandoned arcs are collapsed under "Past Arcs". For each active arc you can:

- **Set its focus** (paused, background, normal, spotlight) with the dropdown. See [Focus](#focus).
- **Re-plan** the rest of the arc from where the story is now. See [Re-planning](#re-planning).
- **Complete** or **Abandon** it.
- **Edit a beat** with the pencil icon: change its pressure (what the model sees) and its "Fulfilled when" text (what counts as done). Delete is inside the editor and needs a second click.
- **Toggle a beat's status** by clicking it, for example to complete a beat the model missed.
- **Mark secrets, clues and triggers as done** in their spoiler groups (Secrets, Clues, Triggers — each opens on its own). An hourglass means the model has reported the item and the report waits to be applied; clicking it drops the report.
- **Edit arc** opens the whole arc as JSON. Story Arc refuses invalid edits and always keeps the bookkeeping fields (id, status, tier, focus, message counters) as stored.

### The progress card

Each active arc has a card in the wand popup and the Extensions drawer. It shows:

- the beats or milestones fulfilled so far, for example `2/6 beats`;
- the current phase (Setup, Development, Escalation, Climax, Resolution);
- `~N msgs to next phase` when the message count, not the beats, holds the phase back;
- **"May have drifted — re-plan?"** when an episode has gone about three times its expected length per beat without progress. The button opens the wizard in re-plan mode for that arc. The model is never told about this.

## Concepts

### Tiers

The tier is the size of an arc. You choose it when you plan the arc.

| Tier | Length | Beats | Use it for |
|---|---|---|---|
| Episode | 8–20 messages | 5–8 ordered **scene beats** | One playable unit, such as a single job from the guild board |
| Act | 60–150 messages | 3–5 **milestones** | A leg of the larger story that colours the episodes in it |
| Saga | 400–1500 messages | 2–4 **milestones** | The overarching storyline, such as defeating the BBEG (Big Bad Evil Guy) |

Scene beats come in order. Only the current one is shown to the model, and the next one is revealed only after you have reacted to the last. Milestones are unordered: all of them stand at once, and any message can fulfil any of them.

You can run several arcs at the same time. They work best as layers, the way a TV series has episodes inside seasons inside the whole show.

### Focus

Focus decides how much of the model's attention an arc gets right now. You can change it at any time in the Arc Manager.

| Focus | What the model sees |
|---|---|
| **Paused** | One line saying the arc exists but is not being pursued. Its beats are not checked and its message clock stands still. Use it for tangents. |
| **Background** | Acts and sagas only. Only the title and an instruction to keep the thread off-screen unless your character goes to it or brings it up. Its milestones can still complete when you play that thread. |
| **Normal** | The default. An episode gets its full section; an act or saga gets its premise and the standing pressures of its open milestones. |
| **Spotlight** | The arc is pushed to the front. For an act or saga, its pressures move into the main block, and its secrets, triggers and foreshadowing are added. Only one arc can be in the spotlight: choosing spotlight sends the previous one back to normal. |

If an act or saga keeps pulling every scene toward itself, set it to background.

### Example: a fantasy campaign

Your adventuring party has played for a few hundred messages. You plan three arcs, one per tier, and give each the focus it needs:

| Arc | Tier | Focus | Why |
|---|---|---|---|
| Defeat the Lich of the Northern Wastes | Saga | Background | Defeating the BBEG takes a thousand messages and should not haunt every scene. |
| Make a name for the party in Port Varrow | Act | Normal | Becoming a known party in the city is a slow goal that should colour every job. |
| The Haunting at the Old Mill | Episode | Spotlight | The next job from the guild board is what you play tonight. |

What the model gets from each layer:

- **The saga** is only a title and an instruction to keep it off-screen. The lich stays out of scenes until your characters go looking for it or bring it up. Its milestones are coarse states of the world, such as "the party has learned the lich's true name", and they still complete when the story gets there. Its secrets stay specific: who the lich was, and what it wants.
- **The act** puts its standing pressures into every scene, for example "the city's established parties take the best contracts and close ranks against newcomers". Its milestones, such as "the city watch knows the party by name" or "a rival party sees them as a threat", can come true during any job, the mill job included.
- **The episode** gives the model one scene beat at a time: the frightened miller, the cold spot in the cellar, the thing behind the wall. It drives the pacing. With a single episode, normal focus does the same; spotlight matters when two episodes run at once.

Then you adjust as the story moves:

- When the party takes a detour to the harvest festival, you **pause** the episode. Its clock stops, and it picks up where it left off when you resume it.
- When the BBEG should make a move, you put the **saga** in the **spotlight**. Its pressures, secrets and triggers come to the front, and the episode drops back to normal.
- When the mill job is done, you plan the next episode. The act and the saga keep running.

### Re-planning

Stories go where they want. When an arc no longer fits, **Re-plan** regenerates the unfulfilled part from the story's current state. Re-plan keeps:

- the arc itself, with its id, progress card and message counter;
- its title, premise and direction, which you can edit in the wizard;
- every secret, word for word (new ones may be added);
- every fulfilled beat, planted clue and fired trigger.

It replaces the open beats, the unplanted clues, the unfired triggers and the arc's tone and rules. You can keep the tier or grow it (episode → act → saga), but you can never shrink it.

### Phases and pacing

Every arc moves through five phases: Setup, Development, Escalation, Climax and Resolution. The phase is the lower of two ratios, beats fulfilled and messages played against the estimated length, so the story never rushes ahead of either. Each phase adds its own pacing directive, for example "Plant seeds. Build atmosphere. No revelations." in Setup. Secrets are released by phase.

### Lorebook conventions

Story Arc reads the lorebook entries SillyTavern itself would scan for the chat: chat lore, persona lore, character lore and global books. Disabled entries are skipped. The entries are sorted into three groups:

- **Constants**: entries marked constant (always active).
- **Arc summaries**: entries whose comment (title) contains `[ARC ` followed by text, for example `[ARC 3] The Harbour Heist`. Use this to give the planner summaries of earlier arcs.
- **Recent**: everything else.

## How it works

In a long RP the narrator model has no idea where the story is going. So it improvises, invents mysteries without answers, and resolves every tension in two or three messages. Story Arc acts as an automated dungeon master. It reads the story, writes a novelist's plan for what comes next, and slips that plan into the narrator's prompt, while you stay a player who gets surprised. The rule that makes this work is "Starve the solver". The narrator gets facts and forces, never a goal or an outcome, because a visible goal gets solved. In one line: prompt clauses steer, but only withholding information guarantees. In that frame, a leaked secret and a rushed scene are the same failure: the narrator was shown an outcome and went straight for it.

Story Arc sets two prompt injections before every generation:

- **The plan** (inside the prompt, before the chat history): one section per active arc, chosen by its tier and focus. It is capped at about **3000 tokens**. If it is larger, whole list lines are dropped from the end, and the pacing rules and the spotlight arc are kept.
- **The beat check** (the last message before the model answers): pacing for the episode that drives the clock, plus one recognition line per open beat. It tells the model that if the story has *already* brought a beat about, it should write a marker such as `<!-- [ARC_SIGNAL:1a2b3c4d:beat_3:COMPLETE] -->` on the first line of its reply.

When a reply arrives, Story Arc reads the markers, updates the arc, and removes the markers and any leaked plan ids from the message, so you never see them. Clues (`PLANTED`) and triggers (`FIRED`) are reported the same way, but their marks are held and applied in a batch: when a beat completes, or at the latest 20 messages after the oldest mark. Until then the Arc Manager shows them with an hourglass, and the arc card counts the waiting reports. Marking one by hand applies at once. While an episode is running, your own messages get an `[Arc: message N of ~M]` stamp in the outgoing prompt only; the stored chat is not changed.

The injected text changes only when the plan changes, never per message. This keeps the provider's prompt cache working. Completing a beat, changing an arc's focus, editing a beat or marking an item by hand changes the plan, so the next generation misses the cache once.

**If beats never complete**, your model is probably not writing the markers. Some models follow the instruction better than others. You can always complete a beat by hand in the Arc Manager.

## Where the data lives

Everything is stored per chat in the chat file's metadata (`chat_metadata.story_arc`). Story Arc only reads your lorebook, character card and persona. It writes:

- its own chat metadata and its global settings;
- AI replies, but only to remove its own markers and any leaked plan ids;
- the `Story Arc Generation` preset and connection profile, and only when you click **Create arc preset**.

Deleting the extension leaves your chats readable; the arc data simply stays unused in the metadata.

## Development

- Vanilla JavaScript ES modules, jQuery and plain CSS. No bundler and no build step.
- Tests use Node's built-in test runner with a loader that mocks the SillyTavern imports:

  ```bash
  ./tests/run.sh                        # all tests
  ./tests/run.sh tests/test-replan.js   # one file
  ```

- The prompt templates for the planning passes are in `prompts/`.
- Developer documentation starts at [docs/claude/onboarding.md](docs/claude/onboarding.md). The design is described in [docs/architecture/architecture.md](docs/architecture/architecture.md), the vocabulary in [GLOSSARY.md](GLOSSARY.md), and the design decisions in [docs/adr/](docs/adr/).

## License

Story Arc is free software under the [GNU Affero General Public License v3.0 or later](LICENSE), the same license as SillyTavern. If you distribute a modified version, you must make its source available under the same license.
