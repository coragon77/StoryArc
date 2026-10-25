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
An act or saga that goes on off-screen. The model sees only its title and an instruction to leave it out of scenes unless the user's character goes to it or brings it up; no premise, no pressures. Its milestones stay in the beat check, so one still completes when the user plays the thread. Episodes have no background focus. Not the pre-tier `background` value, which meant paused and migrates to it.
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
The face of a beat used only for recognition: what has already happened on screen once the beat is complete, in past tense.
_Avoid_: intention, completion condition, outcome

**Recognition**:
The model's own report, via a hidden marker, that the story has already fulfilled a beat. The only way a beat completes.
_Avoid_: signal, tracking, advancement

### Story state

**Secret**:
A hidden truth of the arc with a complete answer, known to the model and withheld from the player. Never regenerated on re-plan.

**Divergence**:
The story having moved past the state an episode's remaining scene beats assume, so they can no longer be fulfilled. Cannot happen to milestones.
_Avoid_: derail, drift

**Stall**:
The measurable sign of divergence: an episode going roughly three times its expected per-beat length without a fulfillment, tangents excluded. Shown to the player as a nudge to re-plan.
_Avoid_: timeout, stuck
