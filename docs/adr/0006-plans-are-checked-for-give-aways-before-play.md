# Plans are checked for give-aways before play

A planned trigger told the narrator to have a character "panic over her brother's clinic scholarship, creating an opening for Ellie to flip her", while the same section listed that fact under SECRETS as "do not reveal". The narrator followed the specific instruction and the character confessed (Paragon chat, 2026-10-30). Two fixes that only added instructions failed: a header sentence on the TRIGGERS block, and generator rules against secrets and payoffs in triggers and pressures. The re-planned act still carried a trigger that stated a climax secret, a payoff clause and a pressure that stated an escalation secret. Cleaning that up by hand means the player reads the secrets, which the extension exists to avoid ("The plan is secret from me", GOALS.md).

So every generated plan goes through a third, narrow LLM call before it is stored. The call sees the secrets, the unfired triggers, the open pressures, the premise and the author's direction, and on a re-plan the Phase 1 analysis and the last ten story messages. It rewrites trigger actions and pressures that give a hidden secret away or name a payoff, decides which of the arc's secrets the story has revealed (re-plan only, both ways, so a reveal the user deleted or regenerated is taken back), and ties triggers to the secret they touch. A trigger tied to a secret is shown only once that secret is. The premise and the direction are passed as public, because a first live run rewrote items that carried out the author's own direction. A failed or unreadable check keeps the plan as generated.

## Considered options

- A word-overlap check in code: tried on the Paragon plans and rejected. A harmless pressure shared 4 words with its secret, the two leaks 5 each, and 150 of the chat's item–secret pairs shared 4 or more.
- More rules in the generator prompt only: they slipped on 3 of 8 new items in the first re-plan that had them.
- Manual cleanup in the Arc Manager: spoils the plan for the player.
- A per-secret "may come out only when …" condition printed next to the secret: a stated condition is a destination, and the narrator can contrive it ("Starve the solver").

## Consequences

Every plan costs one more call on the generation profile. The check judges meaning, so it can still miss a give-away or rewrite something harmless; one live run before and one after the direction fix are the evidence so far. Milestone and beat intentions are not checked: they are printed in the beat check, and rewriting one would change what "fulfilled" means.

## Amendment 2026-11-04: the check also rewrites fulfillments that can never be recognised

Beats are recognised from a message or two at a time (ADR-0008), so a fulfillment that is a tally of many scenes or a chain of separate events joined by "and" never shows in one message, and its beat stays open for good. The generator now asks for one on-screen moment per fulfillment, and the check is the second line, as it is for give-aways: it receives the plan's open fulfillments and rewrites a tally or a chain into the one moment at which the development shows, keeping the beat id and its meaning. The reason given above for leaving intentions alone ("rewriting one would change what 'fulfilled' means") holds only for beats already in play. The check runs before the plan is stored, so nothing has been recognised against the new text yet. On a re-plan the check runs after the merge, and completed beats the merge kept are not passed to it. Still one call.
