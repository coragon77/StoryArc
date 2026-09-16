# Tier owns an arc's shape, focus owns its prominence

Before 2026-09-16 an arc had one switch, `focus: foreground | background`, that decided both how its beats were presented (scene beats with a phase brake, or one premise line) and whether the model should pursue it now. Live play showed the two are independent: a 40-message scene-level plan run as "background" became unreachable after two beats, and pausing an episode for a tangent needs the beats kept but the attention removed. We split them. `tier: episode | act | saga` is set at generation (or re-plan) and decides the beat shape and injection form: episodes have ordered scene beats, one active at a time, with the pacing clock; acts and sagas have unordered milestones that all stand at once and complete by recognition. `focus: paused | normal | spotlight` is set by hand at any time and decides only prominence. Existing arcs migrate once to tier `episode`, foreground → normal, background → paused.

## Considered options

- Keep foreground/background and let each tier interpret it: "foreground act" would run milestones through the scene-beat machinery (a `CURRENT PRESSURE` block and a phase brake for something with no current beat). Rejected.
- Remove the manual switch entirely and derive focus from tier: loses the two real use cases, pausing for a tangent and pushing the world story. Rejected.
