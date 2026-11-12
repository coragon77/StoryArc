# Tier owns an arc's shape, focus owns its prominence

Before 2026-09-16 an arc had one switch, `focus: foreground | background`, that decided both how its beats were presented (scene beats with a phase brake, or one premise line) and whether the model should pursue it now. Live play showed the two are independent: a 40-message scene-level plan run as "background" became unreachable after two beats, and pausing an episode for a tangent needs the beats kept but the attention removed. We split them. `tier: episode | act | saga` is set at generation (or re-plan) and decides the beat shape and injection form: episodes have ordered scene beats, one active at a time, with the pacing clock; acts and sagas have unordered milestones that all stand at once and complete by recognition. `focus: paused | normal | spotlight` is set by hand at any time and decides only prominence. Existing arcs migrate once to tier `episode`, foreground → normal, background → paused.

## Considered options

- Keep foreground/background and let each tier interpret it: "foreground act" would run milestones through the scene-beat machinery (a `CURRENT PRESSURE` block and a phase brake for something with no current beat). Rejected.
- Remove the manual switch entirely and derive focus from tier: loses the two real use cases, pausing for a tangent and pushing the world story. Rejected.

## Amendment 2026-10-25: background returns as a focus value

Live play in a long test chat showed a gap between paused and normal for acts and sagas. A normal saga's standing pressures are printed with "let them colour scenes", and a saga about a creature stalking the protagonist put storm-drain clues into 17 of 20 consecutive replies. Pausing it would have stopped that, but also stopped recognition, so the thread could not progress when the user chose to play it. We added `focus: background` between paused and normal: the act or saga prints its title and one sentence telling the model to leave it out of scenes unless the user's character goes to it or brings it up. No premise, no pressures, no plan lists. Its milestones stay in the beat check, and its clock runs (the clock only feeds the progress card on an act or saga). Episodes have no background focus, because ordered scene beats with one active at a time have no off-screen form; the Arc Manager does not offer it, and re-plan never turns an act or saga into an episode (ADR-0003 amendment).

The word `background` returns with a new meaning. It no longer decides shape, only prominence, so the split this ADR made stands. The migration still maps a pre-tier `background` arc to `paused`; it only ever touches arcs without a tier, so the two meanings never meet.

### Considered options

- Reword the normal-focus pressure header for every act and saga ("most scenes show none of these"): quiets every normal act and saga, including ones the user wants colouring scenes. Rejected in favour of per-arc control.
- Background without the beat check: identical to paused except for wording. Rejected.
- Print the premise on the background line: premises are paragraphs of the thread's pitch, and the model reads them every message. Rejected; title only.
- A different name (`offscreen`): rejected; the user's word for it is background.

## Amendment 2026-11-12: milestones have a minimum only

The tier table gave an act 3–5 milestones and a saga 2–4. The low ceilings date from the 2026-09-16 design, when every open milestone's pressure was sent at once, so each extra milestone cost prompt space on every message. Since ADR-0010 milestones run in order and only the current pressure is sent, so the ceiling bought nothing, and it squeezed a saga: the Paragon re-plan had a five-step direction (honeymoon, courtship, snub, freeze-out, return) and four slots, so the courtship went into a flexibility note the narrator never sees, and the next milestone's "treats her time as owed for his patronage" pressed with no patronage behind it. Acts and sagas now get "at least 3 milestones, as many as the story's steps need, each one a stage that lasts many scenes, never a single scene". The stage wording, not a number, keeps the planner from writing scene-sized milestones. Cost to watch: every open milestone's fulfillment is in each recognition call, and a later match skips the earlier ones, so a long list gives a loose fulfillment more to skip. Whether the cap was the cause is still being tested by a live re-plan; if the courtship lands in a flexibility note again, the fix is a rule that a step another milestone depends on is a milestone of its own.
