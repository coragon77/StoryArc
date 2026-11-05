# Story Arc

A SillyTavern extension that plans the next narrative arc of an existing, long-running roleplay and steers the chat model toward it without the player seeing the plan.

## Language

### Plans

**Arc**:
One planned unit of story, at any tier, with its own premise, secrets and beats.
_Avoid_: plan, storyline, quest

**Tier**:
The size class of an arc: episode, act or saga. Chosen when the arc is generated; decides how its beats are written and how it is injected.
_Avoid_: scope, scale, level

**Episode**:
The smallest tier, roughly 8 to 20 messages. A playable, resolvable unit such as one guild mission. Its beats are ordered scene beats.
_Avoid_: mission, quest, foreground arc

**Act**:
The middle tier, roughly 60 to 150 messages. A leg of the larger story that colours episodes without being pursued directly. Its beats are milestones.

**Saga**:
The largest tier, roughly 400 to 1500 messages. The overarching storyline, such as defeating the big bad. Its beats are milestones.
_Avoid_: campaign, main plot

**Focus**:
How much of the model's attention an arc gets right now: paused, background, normal or spotlight. Set by hand at any time; the tier decides what each value looks like in the prompt.
_Avoid_: foreground, emphasis, prominence

**Paused** (focus):
The arc is set aside for a tangent. The model is told it exists and is not being pursued; its beats are not checked and its message clock stands still.
_Avoid_: shelved, backgrounded, dormant

**Background** (focus):
An act or saga that goes on off-screen. The model sees only its title and an instruction to leave it out of scenes unless the user's character goes to it or brings it up; no premise, no pressures. Its milestones are still recognised, so one still completes when the user plays the thread. Episodes have no background focus. Not the pre-tier `background` value, which meant paused and migrates to it.
_Avoid_: lurking, simmering, offscreen

**Spotlight** (focus):
The arc is pushed to the front. Only one arc at a time: spotlighting an arc sends the previous one back to normal. For an act or saga, its milestone pressures are placed in the main block with a request that the world story move, never naming a milestone to reach, and its secrets, triggers and foreshadowing are added. In normal focus an act or saga shows only its premise and pressures. For an episode it only makes that episode the pacing clock.
_Avoid_: foregrounded, focused, pushed, urgent

**Pacing clock**:
The one episode whose message count drives the stamps and the phase brake. The spotlit episode if there is one, otherwise the first onstage episode.
_Avoid_: counter, timer

**Direction**:
The free-text creative guidance the player gives before an arc is generated or re-planned. Stored on the arc.
_Avoid_: prompt, instructions, ingredients

**Genre**:
The register an arc must stay in, written by the player per arc. Binding for both generation phases and printed as one line in the arc's section (ADR-0004).
_Avoid_: style, theme, tone

**Re-plan**:
Regenerating the unfulfilled part of an active arc from the story's current state, keeping its identity, its secrets and its fulfilled beats. May keep the tier or grow it (episode → act → saga), never shrink it.
_Avoid_: revise, regenerate, reroll

### Beats

**Beat**:
One planned development inside an arc. Has a pressure and a fulfillment.
_Avoid_: step, item, checkpoint, task

**Scene beat**:
An episode's beat. Ordered, one active at a time, the rest hidden from the model until reached.

**Milestone**:
An act's or saga's beat. Unordered, all unfulfilled milestones stand at once, and any may be fulfilled in any message.

**Mark**:
The model's note that a foreshadowing clue was planted or a trigger fired. Queued, and applied when the prompt changes anyway, so the clue then leaves the plan.
_Avoid_: tick, flag

**Pressure**:
The face of a beat the model sees before it is fulfilled: a force acting on the scene, with no completion state.
_Avoid_: objective, goal, intention

**Fulfillment**:
The face of a beat used only for recognition: the one on-screen moment at which the development shows, in past tense. Never a tally of many scenes or a chain of separate events. With the knowledge tracker on, the narrator never sees it.
_Avoid_: intention, completion condition, outcome

**Recognition**:
The report that the story has already fulfilled a beat: from the knowledge extraction when the knowledge tracker is on, from the narrator via a hidden marker when it is off. The only automatic way a beat completes; a completion is reopened when the message it happened in is deleted or swiped.
_Avoid_: signal, tracking, advancement

### Story state

**Secret**:
A hidden truth of the arc with a complete answer, known to the model and withheld from the player. Never regenerated on re-plan.

**Trigger**:
A condition the model watches for, and the visible reaction it causes when the story meets it. The reaction never states a secret's content or a payoff. A trigger that belongs to the moment a secret comes out is tied to that secret and stays out of the prompt until the secret is shown; a trigger that only shows a reaction to suspicion is not tied.
_Avoid_: event, hook

**Divergence**:
The story having moved past the state an arc's remaining beats assume, so they can no longer be fulfilled as planned: an episode's scene beats, or an act's or saga's milestones once the story or the player's rulings have closed the road they stand on.
_Avoid_: derail, drift

**Ruling**:
An out-of-character line of the player that contradicts an arc's premise or one of its open pressures. Noticed by the knowledge extraction, stored on the arc in the player's words, and shown on its progress card until the arc is re-planned. Every re-plan of the arc, the first and every later one, follows its rulings as binding; only the player removes one. A request about the current scene, or new direction that contradicts nothing in the plan, is not a ruling. Only noticed while the knowledge tracker is on.
_Avoid_: correction (the ledger's word for a retracted fact), OOC note, instruction

**Stall**:
The measurable sign of divergence: an arc going roughly three times its expected per-beat length without a fulfillment, counted from its last fulfillment or its last re-plan, whichever is later. Paused arcs and background arcs never stall; time spent paused does not count. Shown to the player as a nudge to re-plan, never to the narrator.
_Avoid_: timeout, stuck

### Knowledge

**Knowledge ledger**:
The chat's record of which character knows which fact, and how each one learned it. Optional; it learns from the story only while the player has the tracker switched on, and the player can correct it by hand. It records only who knows; the narrator is never told who does not know.
_Avoid_: memory, knowledge base, lore

**Fact**:
One piece of knowledge in the knowledge ledger, stated in a short sentence that names who and what. A secret identity is a fact like any other; a public fact is one everyone knows. A secret becomes a fact once the story reveals it on-screen.
_Avoid_: clue, info, memory

**Holder**:
A character who knows a fact or a secret, together with how they learned it: witnessed it, was told by someone, was planned to know it, or was entered by the player. In the story, a character learns a fact only on-screen.
_Avoid_: owner, knower, witness

**Present** (character):
A character in the scene at the latest message. The narrator is told what each present character knows.
_Avoid_: active, onstage, in-scene

**Talked about** (character):
A character who is not present but is named, by name or alias, in the latest message of the player or the narrator. The narrator is also told whom such a character has told.
_Avoid_: mentioned, referenced, offscreen

**Cast**:
The knowledge ledger's characters with their names and aliases, as the planner and the plan check see them. A plan names a cast member exactly as the cast does; a new character in a plan is anyone not in the cast. Each cast member may also carry character details, which the narrator sees for the characters present or talked about; the planner and the plan check see only the names. An unnamed relative is a cast member too, but the planner and the plan check do not see it, since it has no name. Empty while the knowledge tracker is off.
_Avoid_: roster, character list

**Character details**:
A cast member's gender, age, role (job or place in the world, plus where it puts them), relation (kinship to another cast member) and status (alive or dead), each recorded only as the story text states it. A detail the text has not stated is unknown and is never guessed. A detail the story has set is binding: a different value the narrator merely states later does not replace it. Shown to the narrator in the knowledge block for the characters present or talked about. Only recorded while the knowledge tracker is on.
_Avoid_: character profile, attributes, character sheet, stats

**Unnamed relative**:
A cast member the story knows only through their kinship to another cast member ("Kendra Osei's mother"): a record without a name, called after its relation wherever a name is printed. It adds no taken name and is never a name clash. When the story names them on screen, the record takes the name and keeps its details.
_Avoid_: anonymous character

**Taken name**:
A first name, surname or codename a character in the knowledge ledger already uses, derived in code from each character's name and aliases; titles and lowercase surname particles are not names. A new character gets no taken name unless the story makes them related to the character who has it. The narrator and the planner are told the taken names; nothing is banned outright.
_Avoid_: used name, reserved name, blacklist

**Name clash**:
A new character the knowledge extraction added with a taken name: the record keeps which names it shares and the message it was named in. Shown to the player under "Names to check" in the Knowledge popup until the player renames the character or keeps the name; once no other character has the shared names, the player clears it with "Not a clash". Only a character added by the extraction is checked, once, when it is added.
_Avoid_: flag, duplicate name
