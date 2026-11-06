# Story Arc

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that plans the next arc of a long-running roleplay and quietly steers the chat model toward it.

Story Arc works like a hidden game master. It reads what has happened so far, has an LLM plan what comes next, and feeds that plan into the prompt without showing it to you. You play; the plan stays a surprise.

> **Status: beta.** In daily use, but tested mostly with GLM, Gemini Argon and Claude models. Please report problems in the [issue tracker](https://github.com/coragon77/StoryArc/issues).

- **Plans arcs** from your lorebook, character card, persona and recent chat.
- **Steers the chat**: the model feels the plan as pressure on the scene, never as a list of goals.
- **Tracks progress** as the story fulfils the plan's beats.
- **Tracks who knows what** (optional), so characters stop knowing things they never learned.
- **Keeps the plan secret** until you choose to reveal it.

## Installation

You need SillyTavern with a **Chat Completion** API. In SillyTavern, open **Extensions → Install extension** and paste:

```
https://github.com/coragon77/StoryArc
```

Or clone it into `SillyTavern/public/scripts/extensions/third-party` and reload SillyTavern.

## Setup

Open the **Extensions** drawer and expand **Story Arc**.

1. **Enable Story Arc.**
2. **Generation profile**: the Connection Manager profile that plans arcs. "Current API" uses the chat's own. Planning needs a capable model and a long response length.
3. **Create arc preset** (recommended): creates a `Story Arc Generation` preset and connection profile tuned for planning. Select it as the generation profile afterwards.
4. **Track who knows what** (optional): switches on the [knowledge tracker](#the-knowledge-tracker). **Update every N replies** sets how often it runs; **Character details** adds character details to it.

The arc preset holds two entries you toggle in SillyTavern's prompt manager. Save the preset after changing them.

| Entry | Default | Effect |
|---|---|---|
| Story Arc: Genre | on | Keeps new arcs in the genre and tone the story has set |
| Story Arc: Adult Content | off | Lets arcs build toward explicit scenes instead of fading to black |

## Using it

Click the **wand menu** next to the chat input and choose **Story Arc**. The popup has **Plan a new arc**, **Manage**, **Knowledge**, and a row for each active arc. The Extensions drawer has the same.

### Planning an arc

**Plan a new arc** opens a two-step wizard.

1. **Direction.** Pick the arc's **tier** (see below), its **genre** ("High fantasy adventure, banter around the campfire, never grimdark") and say what the arc should explore.
2. **Review.** Story Arc plans the arc and shows its title, themes and tone. The rest stays hidden behind **Reveal plan**, so you can **Activate** it without spoiling it.

### Managing arcs

**Manage** opens the Arc Manager, with one row per arc. There you can:

- set an arc's **focus** (see below);
- act on a **warning**, for example **Re-plan** or **Ignore** when an arc has stalled;
- mark a beat done by hand when the model missed it;
- **Re-plan**, **Complete** or **Abandon** an arc from its **⋯** menu;
- **Reveal plan** to read and edit its beats, secrets, clues and triggers.

Every change can be undone while the Arc Manager is open. Completed and abandoned arcs sit under **Past arcs**, where **Reactivate** brings one back.

### Re-planning

When the story has left an arc's plan behind, **Re-plan** writes a new road from where the story is now. It keeps what already happened, the secrets and the premise (which you can edit), and replaces the open beats. The tier can grow but never shrink.

## Tiers and focus

The **tier** is an arc's size:

| Tier | Length | Beats | Use it for |
|---|---|---|---|
| Episode | 8–20 messages | 5–8 scene beats, in order | One job, one evening's play |
| Act | 60–150 messages | 3–5 milestones, any order | A leg of the larger story |
| Saga | 400–1500 messages | 2–4 milestones, any order | The overarching storyline |

Several arcs can run at once, like episodes inside seasons inside a series.

The **focus** sets how much attention an arc gets right now:

| Focus | What the model sees |
|---|---|
| **Paused** | That the arc exists but is on hold. Its clock stops. |
| **Background** | Acts and sagas only: keep the thread off-screen unless your character goes to it. |
| **Normal** | The default. The arc's premise and its pressures on the scene. |
| **Spotlight** | The arc comes to the front, with its secrets, triggers and clues. One arc at a time. |

If an act or saga pulls every scene toward itself, set it to background.

**An example.** In a fantasy campaign you might run three layers: the saga "Defeat the Lich" in **background**, so the lich stays out of scenes until the party looks for it; the act "Make a name in Port Varrow" in **normal**, so the city's rival parties press on every job; and the episode "The Haunting at the Old Mill" in **spotlight**, as tonight's job. When the party detours to a festival, **pause** the episode. When the lich should make a move, put the saga in the spotlight.

## The knowledge tracker

With **Track who knows what** on, Story Arc reads each new reply and records which character learned which fact, and whether they saw it or were told. The model then gets, for the characters in the scene, only what they actually know.

- An out-of-character correction ("that never happened") takes a fact back.
- Deleting, swiping or editing a message takes back what it taught.
- New characters don't get names the story already uses, unless they are related.
- Out-of-character objections to an arc are stored as rulings, and a re-plan follows them.

With **Character details** on, it also records what the story states about each character, and nothing it doesn't:

| Detail | Example |
|---|---|
| Gender | female |
| Age | 52, or "twenty-something" |
| Role | cleaner, double shifts, Oakland |
| Relation | Kendra Osei's mother |
| Status | dead |

A stated detail changes only when the story shows the change happening.

**Knowledge** opens the Knowledge popup, where you fix what the tracker got wrong:

- **What changed** lists the latest updates, each with its fix: **Move to…**, **Not true**, **Same person as…**, **Not their name**. **Fine** marks a line as reviewed.
- **Cast & facts** lets you find, edit, add, merge or delete characters and facts. A detail you edit or **Lock** is no longer changed by the tracker.
- **Map** shows the cast in rings around the current scene. Drag one character onto another to merge them.

Every edit can be undone while the popup is open.

## Good to know

- **Beats never complete?** Your model isn't reporting them. Mark them done by hand in the Arc Manager, or turn on the knowledge tracker, which recognises them itself.
- **Summaries of earlier arcs**: give a lorebook entry a title starting with `[ARC ` (for example `[ARC 3] The Harbour Heist`) and the planner treats it as one.
- **Your data**: everything is stored in the chat file. Story Arc only reads your lorebook, card and persona; removing the extension leaves your chats intact.

## Development

Vanilla JavaScript, no build step. Run the tests with `./tests/run.sh`. Developer documentation starts at [docs/claude/onboarding.md](docs/claude/onboarding.md).

## License

[GNU Affero General Public License v3.0 or later](LICENSE), like SillyTavern. If you distribute a modified version, you must make its source available under the same license.
