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
The register an arc must stay in, written by the player per arc and kept short ("Superhero drama"). Binding for both generation phases, for the register only: the arc reads as this genre. What the arc must deliver comes from the direction and the premise, never from the genre. Never sent to the narrator (ADR-0004, amended 2026-11-09).
_Avoid_: style, tone

**Themes** (player):
The themes the player writes per arc beside the genre ("corruption, political intrigue"), stored as `themeSeeds`. They colour the arc where the premise and the direction leave room and are never obligations; a theme is never a world fact and never the reason for a pressure, secret or trigger: it colours only what the direction already puts there. They seed the plan's own `themes`, its thematic statements, which the player sees as "What's it about?". Outline phase only, never sent to the narrator (ADR-0004, amended 2026-11-09).
_Avoid_: tags, ingredients, requirements

**Author's answers**:
The player's answers, in their own words, to the questions the wizard asks after Generate about what the direction leaves open (how pressure works, how dark the arc is, whether anyone can step in, hard lines). Only answered ones are stored, as `authorAnswers` on the arc. They bind the outline like the direction and win over genre and themes. A re-plan shows them again for editing. Never sent to the narrator.
_Avoid_: survey, interview, preferences

**Re-plan**:
Regenerating the unfulfilled part of an active arc from the story's current state, keeping its identity, its revealed secrets and its fulfilled beats. The secrets not yet revealed are planned again with the rest. May keep the tier or grow it (episode → act → saga), never shrink it.
_Avoid_: revise, regenerate, reroll

**Past arc**:
An arc that is no longer active: completed (by the player, or once its last open beat is done) or abandoned by the player. It is out of the prompt and its beats are no longer checked; the Arc Manager lists it under "Past arcs".
_Avoid_: archived arc, old arc, closed arc

**Reactivate**:
Making a past arc active again, in normal focus, with its beats as they stand. Its phase and stall counts start over at that moment, and it goes last among the arcs, so it never takes the pacing clock from an episode running now.
_Avoid_: revive, reopen (the word for a beat whose completion a rollback takes back)

**Reveal plan**:
The Arc Manager's switch, one per arc, that shows the arc's plan text: premise, pressures and fulfillments, secrets, clues and triggers. Off whenever the Arc Manager opens, so the plan stays secret unless the player asks for it; the title, the focus, the beat strip and the warnings show either way.
_Avoid_: spoilers on, unhide, show plan

### Beats

**Beat**:
One planned development inside an arc. Has a pressure and a fulfillment.
_Avoid_: step, item, checkpoint, task

**Scene beat**:
An episode's beat. Ordered, one active at a time, the rest hidden from the model until reached.

**Milestone**:
An act's or saga's beat. Unordered, all unfulfilled milestones stand at once, and any may be fulfilled in any message.

**Mark**:
The model's note that a foreshadowing clue was planted or a trigger fired. Queued, and applied when the prompt changes anyway, so the clue then leaves the plan. The Arc Manager calls a queued mark a **report** ("2 reports waiting", "Drop report"): the player's word for it.
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
A hidden truth of the arc with a complete answer, known to the model and withheld from the player. Once revealed it never changes. One not yet revealed is planned again on a re-plan: kept, rewritten or dropped, keeping its id when kept or rewritten, and always still explaining the planted clues and fired triggers that point at it.

**Trigger**:
A condition the model watches for, and the visible reaction it causes when the story meets it. The reaction never states a secret's content or a payoff. A trigger that belongs to the moment a secret comes out is tied to that secret and stays out of the prompt until the secret is shown; a trigger that only shows a reaction to suspicion is not tied.
_Avoid_: event, hook

**Clue**:
What the UI calls one of an arc's foreshadowing entries: a detail planted early that points to a secret or a later development. Code and the stored arc keep `foreshadowing` (with `clue` and `target`); the wizard and the Arc Manager say "Clues".
_Avoid_: foreshadowing (in UI text), hint

**World fact**:
A statement of what is true in the arc's world: what is possible, who holds what power, what a character or faction wants, believes or knows. Sent to the narrator, which keeps every scene consistent with it; never says how to narrate (tone, pacing, emphasis, how a character comes across). An episode's section prints all of them, an act's or saga's the first three. Replaces the directives and anti-patterns of older plans, which are stored but no longer sent (ADR-0009).
_Avoid_: directive, rule, anti-pattern

**Divergence**:
The story having moved past the state an arc's remaining beats assume, so they can no longer be fulfilled as planned: an episode's scene beats, or an act's or saga's milestones once the story or the player's rulings have closed the road they stand on.
_Avoid_: derail, drift

**Ruling**:
An out-of-character line of the player that contradicts an arc's premise or one of its open pressures. Noticed by the knowledge extraction, stored on the arc in the player's words, and shown on its progress card until the arc is re-planned. Every re-plan of the arc, the first and every later one, follows its rulings as binding; only the player removes one. A request about the current scene, or new direction that contradicts nothing in the plan, is not a ruling. Only noticed while the knowledge tracker is on.
_Avoid_: correction (the ledger's word for a retracted fact), OOC note, instruction

**Stall**:
The measurable sign of divergence: an arc going roughly three times its expected per-beat length without a fulfillment, counted from its last fulfillment, its last re-plan, its reactivation (a past arc made active again, which also restarts its phase) or the last time it went into the spotlight, whichever is later. A beat the player marks done by hand is a fulfillment too. Paused arcs and background arcs never stall; time spent paused does not count. Shown to the player as a nudge to re-plan, never to the narrator. The player can ignore a stall: its nudge stays hidden until the arc's next beat lands or it is re-planned, reactivated or spotlit.
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
A character who is not present but is named, by name or alias, in the latest message of the player or the narrator. The narrator is also told whom such a character has told. A shared name word does not count.
_Avoid_: mentioned, referenced, offscreen

**Meeting**:
A scene the knowledge tracker saw with two or more characters present: everyone in it has met everyone else. The narrator sees, for each character present or talked about, whom they have met ("Has met"), so a character does not know the face or looks of someone they never saw. Recorded from the scene the extraction reports, with no call of its own, and only from when the tracker started: a meeting earlier in the story is not on the list.
_Avoid_: encounter, acquaintance, contact

**Cast**:
The knowledge ledger's characters with their names and aliases, as the planner and the plan check see them. A plan names a cast member exactly as the cast does; a new character in a plan is anyone not in the cast. Each cast member may also carry character details, which the narrator sees for the characters present or talked about; the planner and the plan check see only the names. An unnamed relative is a cast member too, but the planner and the plan check do not see it, since it has no name. Empty while the knowledge tracker is off.
_Avoid_: roster, character list

**Map** (Knowledge popup):
The Knowledge popup's view of the cast as rings around the scene: present characters in the centre, then those who learned a fact in the last hundred messages, then those who learned one earlier, then those who know none. Records that share a name word sit side by side, so a likely duplicate shows next to its other half; relations are lines between two characters. For seeing and finding: selecting a character opens its sheet, dropping one character onto another proposes merging them.
_Avoid_: graph, network, cast map (in UI text)

**Character details**:
A cast member's gender, age, role (job or place in the world, plus where it puts them), relation (kinship to another cast member) and status (alive or dead), each recorded only as the story text states it. A detail the text has not stated is unknown and is never guessed. A detail the story has set is binding: a different value the narrator merely states later does not replace it. Shown to the narrator in the knowledge block for the characters present or talked about. Only recorded and shown while the knowledge tracker and its character details switch are both on; the switch is off by default.
_Avoid_: character profile, attributes, character sheet, stats

**Unnamed relative**:
A cast member the story knows only through their kinship to another cast member ("Kendra Osei's mother"): a record without a name, called after its relation wherever a name is printed. It adds no taken name and is never a name clash. When the story names them on screen, the record takes the name and keeps its details.
_Avoid_: anonymous character

**New name** (of a character):
A name the story gives a character the knowledge ledger already has, such as a codename, a first name or a nickname. The knowledge extraction reports it only when the text makes plain both names belong to one person, and it becomes an alias of that character's record instead of a second record. A secret identity is still one character in the ledger once the text has shown it, even while the characters in the scene know only one of the names. A name another character already has is not added, nor is a shared name word.
_Avoid_: rename, duplicate

**Shared name word**:
A name or alias that is one single name word ("Sterling", "Marcus"; titles and surname particles are not name words, so "Mr. Sterling" is not one) while another named character in the knowledge ledger carries the same word in a name or alias (Julian Sterling next to Arthur Sterling's alias "Sterling"). It points at nobody: a mention of it makes no one talked about, and an extraction answer using it names no one. Whole names and names of several words ("Julian Sterling", "Mrs. Osei", "Agent Cross") still point at their character, and a one-word name only one character carries keeps working. The extraction adds no such name as a new name and drops it from a new character's aliases; the player may still give it by hand in the Knowledge popup. Relatives sharing a surname is the common case.
_Avoid_: duplicate alias, ambiguous name

**Taken name**:
A first name, surname or codename a character in the knowledge ledger already uses, derived in code from each character's name and aliases; titles and lowercase surname particles are not names. A new character gets no taken name unless the story makes them related to the character who has it. The narrator and the planner are told the taken names; nothing is banned outright.
_Avoid_: used name, reserved name, blacklist

**Name clash**:
A new character the knowledge extraction added with a taken name: the record keeps which names it shares and the message it was named in. Shown to the player under "Names to check" in the Knowledge popup until the player renames the character or keeps the name; once no other character has the shared names, the player clears it with "Not a clash". Only a character added by the extraction is checked, once, when it is added.
_Avoid_: flag, duplicate name

**Merge** (characters):
Joining two character records the ledger holds for one person (a codename and a civilian name) in the Knowledge popup: the player picks the record that stays, the other record's names become its aliases, everything the other record knew and every detail of a kind the staying record does not have moves to it (a kind only the other record has set by the player moves too, replacing the staying record's), and the other record goes. Renaming stays a separate edit.
_Avoid_: combine, link

**Move** (holder):
Giving a fact's holder entry to another character in one step in the Knowledge popup, for an entry the extraction gave the wrong person. How they learned it and the message it came from stay, so it still goes when that message is swiped, edited or deleted. When the other character already holds the fact, their own entry stays and the moved one goes. A holder the moved-from character told still reads as told by them.
_Avoid_: reassign, transfer

**Delete** (character):
Removing a character record in the Knowledge popup, with every mention of them: what they knew, the scenes, relations other characters have to them; someone they told reads as having witnessed it. A fact only they knew goes with them (a public one stays), and the popup names those facts before the player confirms. Refused while an unnamed relative is called after them ("Marcus Vale's mother"): name the relative or change their relation first.
_Avoid_: erase, purge

**Restore** (retracted fact):
"Still true": the player takes back a retraction in the Knowledge popup, and the fact returns with its holders as they were. It still goes when the messages its holders learned it in are swiped, edited or deleted.
_Avoid_: unretract, revert

**Lock** (character detail):
Keeping a detail at the value the story set: the player's entry with that same value goes on top, so the extraction no longer changes the detail and a swipe of the message that stated it does not take it away. Setting a detail by hand locks it the same way.
_Avoid_: pin, freeze

**Undo** (hand edit):
Taking back the newest hand edit made in the open Knowledge popup or Arc Manager, one edit per press, back to the state before it. Undo lasts only while the popup is open. When the ledger (in the Arc Manager: the arcs) changed since that edit (an update ran after a reply, a swipe or a deleted message), undo refuses and nothing older can be undone either.
_Avoid_: revert, rollback (the word for dropping what a swiped or deleted message brought)

**Change item**:
One thing a knowledge update or re-extraction did to the knowledge ledger, as its record in the update log lists it: a new character, a holder entry added, a character detail set or changed, a new name, a fact retracted, or a change of who is present. Each has an item key made of the record's own id, the item's kind and its ids (`u6:holder:f2:c1`), stable across reloads and never shared by two records. Records from before the items list counts only and have none.
_Avoid_: change entry, delta

**Reviewed mark**:
The player's note on a change item that they have looked at it, stored on the knowledge ledger by item key. A rollback that removes the item drops its mark.
_Avoid_: seen flag, read mark

**What changed** (Knowledge popup):
The Knowledge popup's opening view: the change items of the newest updates, one line per change, newest first, each with its fixes and "Fine" on the line. "Fine" sets the reviewed marks of the line's items, and a reviewed line folds away. Updates recorded before change items existed show as counts only.
_Avoid_: feed
