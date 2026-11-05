# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One power user, the author, running long adult roleplay stories in SillyTavern (1000+ messages, several arcs at once, a knowledge ledger of ~105 characters in the Paragon chat). Desktop only for now (confirmed 2026-11-05). They write the player character themselves; the narrator is an LLM.

## Product Purpose
Story Arc plans arcs for existing long-running stories, injects them into the prompt to guide the narrator, tracks which beats landed, and keeps a knowledge ledger: who knows what, who is in the scene, each character's details (gender, age, role, relation, status). Success: the story keeps direction and continuity without the player checking things by hand. "The whole point of the extension is that I don't have to check manually and it works in the background."

## Positioning
An automated, mostly hidden game master for an existing story: plans are spoilers by default, the player steers through rulings and occasional edits, the extension does the bookkeeping.

## Operating Context
- The extension lives inside SillyTavern: a settings drawer, a wand-menu entry, and popups (ST's Popup API). It inherits the user's ST theme (currently "Glimmer": near-black tint, white text, blue italics, yellow quotes) and Font Awesome icons.
- The Knowledge popup is used mostly to fix things after an automatic update got something wrong (confirmed 2026-11-05): a fact on the wrong character, a duplicate character, a wrong detail, a name to check. All edit kinds happen: name/alias, details and locks, fact holders, merge, looking up what someone knows.
- The Arc Manager is used to steer arcs: focus (paused/background/normal/spotlight), re-plan, complete/abandon, hand edits of beats and the plan. The user called it "workable but barely"; the Knowledge and name UI "unusable" (2026-11-05).

## Capabilities and Constraints
- Vanilla JS, jQuery, HTML in template literals, no build step; styling via plain CSS; must use ST theme variables so any theme works.
- Plans, secrets and beats are spoilers: hidden by default, revealed deliberately.
- Ledger terms (GLOSSARY.md): character, alias, fact, holder (witnessed/told/plan/player), scene, details, lock, nameClash ("Names to check"), unnamed relative, merge, new name, shared name word.

## Evidence on Hand
Real ledger data in the Paragon chat file (local only, never leaves the machine). No invented users, metrics or claims.

## Product Principles
1. Background first: the extension works without being watched; the UI is for correcting, not for operating every turn.
2. Spoilers stay hidden unless the player chooses to look.
3. The player's word wins: a player edit or lock overrides the automation.
4. Fixing a mistake must be fast at the ledger's real size (100+ characters, hundreds of facts).
