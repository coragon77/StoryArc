# An arc is one plot thread: milestones run in order

The 2026-09-16 tier design made an act's or saga's milestones unordered: every unfulfilled milestone stood at once, and the narrator got all their pressures in one list. In the Paragon chat an act planned its pressures in story order, perks first, then the freeze-out once the perks are withdrawn. The narrator got both from the first message, so the freeze-out pressed while the perks were still arriving. The player had said: "you cannot speedrun this." Then, on 2026-11-09: "is an arc not supposed to be sequential? And if for some reason I skip a step and do the later one - thats ok as well? The skipped one is obsolete now? Thats how a story works => linear in a plotthread?", and "yes, please build it".

So an arc is one plot thread. Its milestones run in the planner's order. The narrator gets only the current milestone's pressure: the first open one. Recognition still watches the fulfillments of every open milestone. When the story fulfils a later one, it completes, and every earlier open milestone becomes `skipped`: obsolete, not failed. The next open milestone after it becomes current. The cap of one completion per arc per message stays, and a rollback of a completion undoes its skips.

## Considered options

- Prerequisites on unordered milestones (`unlockAfter`, as scene beats have): rejected in favour of plain order.
- Unlocking later milestones by phase or by the clock: rejected. A pressure from lost perks must follow the perks in the story, not a message count; a clock detaches the plan from where the story is.

## Consequences

The narrator gets one pressure per act or saga instead of several; parallel threads become separate arcs, and the planner is told so (`prompts/generate-arc.txt`, `buildTierBlock`). Every open milestone stays `active` and "current" is derived (`currentMilestone`), so arcs stored before this decision, with every milestone active, need no migration: their first open milestone is current. A skipped milestone counts like a completed one for the phase, arc completion and the progress count ("3/5 done or skipped"); completing the last milestone with earlier ones open completes the arc. The Arc Manager shows skipped milestones faded, offers Skipped next to Open and Done, and a hand completion skips like a recognised one. The stall rule needed no change: the current milestone moves only through a completion, and every completion restarts the count. Episodes are unchanged; their scene beats already run in order, one active at a time.
