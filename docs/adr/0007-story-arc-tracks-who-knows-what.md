# Story Arc tracks who knows what, as an optional feature

The narrator writes every character from one context that holds the whole chat and the plan's secrets, and nothing tells it which character knows which fact. In the Paragon chat Gabriel told Ellie at breakfast that Noor should lock the gauntlet on with titanium latches (message 2063). In the next Annex scene the model wrote "tell me why Aegis called my bench phone at seven in the morning demanding aircraft-grade titanium shear-pins" (2079): it invented an off-screen call to explain what Noor knew, and the rewrites copied it (2087, 2089). The preset's anti-omniscience rules were in the prompt every time. A rule against omniscience names no fact, so it loses to the scene. The plan makes this worse, because it prints secrets with no holder: `SECRETS (guard these carefully — do not reveal directly):` tells the narrator what to hide from the player, not which character holds what.

So Story Arc keeps a knowledge ledger: which character knows which fact, and how they learned it. An LLM call updates it after each reply, and again when the reply is regenerated. Close to the bottom of the prompt, a short block lists what each character in the scene knows and does not know, along with each character the scene talks about. The ledger lives in `chat_metadata`, next to the arcs, so branches, exports and backups carry it along. The user can edit it in the UI, because some facts were never written into the chat ("Noor tunes Aegis's suit" was only in the user's head). The tracker is optional and has its own on/off switch. When it is off, Story Arc runs no extraction call, injects no knowledge block and behaves as it did before.

The ledger stays inside Story Arc, as its own module, and does not become a separate extension. A planned secret starts with holders and turns into a chat fact once the story reveals it on-screen; from then on, who else heard it is the question the ledger answers. A separate extension would print its knowledge block next to Story Arc's holder-less SECRETS block, and keeping the two consistent would need an interface between the extensions. This reverses "Not a memory/summarization system" and "One thing well" in GOALS.md for this one kind of memory, who knows what. Story Arc still does not summarize the story or manage lorebooks.

## Considered options

- Anti-omniscience rules in the preset or the injection only: in place during 2079, 2087 and 2089, and lost each time.
- A separate extension: it would work in chats without arcs, but it needs an interface to Story Arc's secrets, and secrets are where a leak costs the most.
- A side file per chat through ST's File API: it keeps the chat file smaller, but a branch, rename, export or backup leaves the ledger behind.

## Consequences

When the tracker is on, every reply costs one more call, unless testing shows that updates can be spaced out over several messages; how often to update is still open. A fact in the ledger has to record which message and swipe it came from, so that a regeneration, deletion or edit can take it back. The extraction is itself an LLM, so it can record a leak as a fact; the edit UI is the correction path. The ledger shows what characters know about the plan's secrets, so its UI needs the same spoiler protection as the Arc Manager.
