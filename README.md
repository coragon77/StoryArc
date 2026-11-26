# Story Arc

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that plans the next arc of a long-running roleplay and quietly steers the chat model toward it.

Story Arc works like a hidden game master. It reads what has happened so far, has an LLM plan what comes next, and feeds that plan into the prompt without showing it to you. You play; the plan stays a surprise.

> **Status: beta.** In daily use, but tested mostly with GLM, Gemini Argon and Claude models. Please report problems in the [issue tracker](https://github.com/coragon77/StoryArc/issues).

- **Plans arcs** from your lorebook, character card, persona and recent chat.
- **Steers the chat** toward the plan without spelling it out.
- **Tracks progress** as the story fulfils the plan's beats.
- **Tracks who knows what** (optional), so characters stop knowing things they never learned.
- **Keeps the plan secret**: from you until you choose to reveal it, and its goals from the model, so it does not rush through the arc.

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
4. **Track who knows what** (optional): switches on the [knowledge tracker](#the-knowledge-tracker). Its options below it set how often it runs, what it records and which profile it uses; a cheaper model than planning works.

The arc preset holds two entries you toggle in SillyTavern's prompt manager. Save the preset after changing them.

| Entry | Default | Effect |
|---|---|---|
| Story Arc: Genre | on | Keeps new arcs in the genre and tone the story has set |
| Story Arc: Adult Content | off | Lets arcs build toward explicit scenes instead of fading to black |

## Using it

Click the **wand menu** next to the chat input and choose **Story Arc**. The popup has **Plan a new arc**, **Manage**, **Knowledge**, **What the narrator gets**, and a row for each active arc. The Extensions drawer has the same.

### Planning an arc

**Plan a new arc** opens the wizard.

1. **Direction.** Pick the arc's **tier** (see below) and a short **genre**, add **themes** if you like, and say what the arc should explore. The arc stays on that one thread of the story; everything else going on can be its setting but never its steps. Leave **Keep this arc to itself** on, or switch it off to let the planner secretly tie the arc's people to another thread. Press **Generate**.
2. **Questions**, only when your direction leaves something important open: a few short questions about what you want, never about the plan. Click a suggestion, write your own or leave one blank, then press **Plan the arc**.
3. **Review.** Story Arc shows the arc's title, tone and "What's it about?". The rest stays hidden behind **Reveal plan**, so you can **Activate** it without spoiling it.

### Managing arcs

**Manage** opens the Arc Manager, with one row per arc. There you can:

- set an arc's **focus** (see below);
- act on a **warning**, for example **Re-plan** or **Ignore** when an arc has stalled;
- mark a beat done or skipped by hand when the model missed it;
- **Re-plan**, **Complete** or **Abandon** an arc from its **⋯** menu;
- **Reveal plan** to read and edit its beats, secrets, clues and triggers.

Every change can be undone while the Arc Manager is open. Completed and abandoned arcs sit under **Past arcs**, where **Reactivate** brings one back.

### Re-planning

When the story has left an arc's plan behind, **Re-plan** writes a new road from where the story is now. What already happened stays; the open beats and the secrets still hidden are planned again.

## Tiers and focus

The **tier** is an arc's size:

| Tier | Length | Beats | Use it for |
|---|---|---|---|
| Episode | 8–20 messages | 5–8 scene beats, in order | One job, one evening's play |
| Act | 60–150 messages | 3 or more milestones (usually up to 7), in order | A leg of the larger story |
| Saga | 400–1500 messages | 3 or more milestones (usually up to 7), in order | The overarching storyline |

Several arcs can run at once, like episodes inside seasons inside a series.

An act or saga is one plot thread: the model feels only its current milestone, and milestones the story jumps past show as **skipped**. For a second thread, plan a second arc.

The **focus** sets how much attention an arc gets right now:

| Focus | What the model sees |
|---|---|
| **Paused** | That the arc exists but is on hold. Its clock stops. |
| **Background** | Acts and sagas only: keep the thread off-screen unless your character goes to it. |
| **Normal** | The default. The arc's premise, its world facts (what is true, who holds what power) and its current pressure. |
| **Spotlight** | The arc comes to the front, with its secrets, triggers and clues. One arc at a time. |

If an act or saga pulls every scene toward itself, set it to background.

**An example.** In a fantasy campaign you might run three layers: the saga "Defeat the Lich" in **background**, so the lich stays out of scenes until the party looks for it; the act "Make a name in Port Varrow" in **normal**, so the city's rival parties press on every job; and the episode "The Haunting at the Old Mill" in **spotlight**, as tonight's job. When the party detours to a festival, **pause** the episode. When the lich should make a move, put the saga in the spotlight.

## The knowledge tracker

With **Track who knows what** on, Story Arc reads each new reply and records which character learned which fact. The model then gets, for the characters in the scene, only what they actually know. An out-of-character correction ("that never happened") takes a fact back, and deleting, swiping or editing a message takes back what it taught.

**A reply you rejected can leave the story.** When you ask out of character for a rewrite and the narrator writes the new version, a notice offers to **Take out** the rejected reply, so the narrator and the tracker forget it. **Reject from here…** in a message's menu does the same by hand.

With **Character details** on, it also records what the story states about each character:

| Detail | Example |
|---|---|
| Gender | female |
| Age | 52, or "twenty-something" |
| Role | cleaner, double shifts, Oakland |
| Relation | Kendra Osei's mother |
| Status | dead |

With **Appearance** on as well, it records how each character looks, which [Story Image](https://github.com/coragon77/StoryImage) uses to draw them the way the story describes them.

**Knowledge** opens the Knowledge popup, where you fix what the tracker got wrong. **What changed** lists the latest updates, each with its fix. **Cast & facts** lets you find, edit, merge or delete characters and facts, and **Find details** fills in what the tracker missed. **Map** shows the cast around the current scene. Every edit can be undone while the popup is open.

## Good to know

- **Beats never complete?** Your model isn't reporting them. Mark them done by hand in the Arc Manager, or turn on the knowledge tracker, which recognises them itself.
- **A reply went somewhere odd?** **What the narrator gets** shows everything Story Arc added to the request, with spoilers hidden until you reveal the plan.
- **Your model ignores Story Arc's instructions?** **Prompts**, next to **Create arc preset**, lets you change the wording Story Arc sends when it plans and tracks, in every chat. **Reset to built-in** brings its own wording back.
- **Summaries of earlier arcs**: give a lorebook entry a title starting with `[ARC ` (for example `[ARC 3] The Harbour Heist`) and the planner treats it as one.
- **Your data**: arcs and knowledge live in the chat file; your settings and prompt edits live with SillyTavern's settings. Story Arc only reads your lorebook, card and persona, and removing it leaves your chats intact.

## Development

Vanilla JavaScript, no build step. Run the tests with `./tests/run.sh`. Developer documentation starts at [docs/claude/onboarding.md](docs/claude/onboarding.md).

## License

[GNU Affero General Public License v3.0 or later](LICENSE), like SillyTavern. If you distribute a modified version, you must make its source available under the same license.
