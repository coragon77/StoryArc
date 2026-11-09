# Genre is set per arc and binds generation

A superhero chat drifted into spy thriller over a long saga (test chat, 2026-10-19). The direction said "becoming a superhero", the user's own system prompt ranked cape life first, and the model still followed the register of the recorded material: procedural scene summaries, an analysis that turned them into the active threads, and a generator whose only examples were military intrigue. A stated priority loses when the content points the other way. So each arc carries `genre`, written by the player in the wizard (pre-filled from the newest arc that has one), never by the model. Both generation phases receive it: the analysis reads the story through it and reports material that leans another way as an imbalance; the outline treats it as outranking the analysis and the recorded material. The injection carries one `GENRE:` line per arc section as a guard; the generation-time binding is the actual fix, because it makes the pressures, secrets and tone match the genre in the first place. An empty genre changes nothing.

## Considered options

- One genre per chat: rejected by the player ("I want it PER ARC"); a story can run a light episode inside a darker saga.
- Reuse the `storyArcGenre` standing directive in the arc preset: per story, Phase 2 only, never injected, and its default text ("stay inside the register the story has already established") reinforces exactly the drift this fixes.
- Injection line only: the same kind of stated priority that already failed.

## Amendment 2026-11-09: the genre is no longer sent to the narrator

The `GENRE:` line is gone from every section of the injection. The player set the genre to steer what the planner writes, and the narrator read it as an instruction for the scene in front of it: in the Paragon chat every act section opened with "GENRE: Superhero drama, echi/hentai, action, non-con, comedy, corruption, sexual deviancy, intrigue and backstabbing, political thriller". The player's ruling: style steers generation only and never appears in the story. The binding at generation time, which this ADR named the actual fix, stays as it is: both phases still get `{{GENRE_BLOCK}}`.

A test on the disposable test chat (2026-11-09, three replies per condition) found the line neither caused nor prevented the failure it was checked against, a narrator inventing contracts the setting does not allow: with the plan's pressures written as lever and cost, 0 of 3 replies failed with a "legal thriller, exploitation" GENRE line in the prompt; with the pressures written as contract clauses, 3 of 3 failed with the line and 3 of 3 without it (that run also had a sentence ranking the plan below the narration instructions, which changed nothing either). The plan's own wording decided it. The line goes on the ruling, not on the test.
