---
name: Story Arc
description: A hidden game master's desk inside SillyTavern, drawn entirely from the user's own theme.
colors:
  text: "var(--SmartThemeBodyColor)"
  emphasis: "var(--SmartThemeEmColor)"
  surface: "var(--SmartThemeBlurTintColor)"
  frame-border: "var(--SmartThemeBorderColor)"
  muted: "color-mix(in srgb, var(--SmartThemeBodyColor) 72%, transparent)"
  line: "color-mix(in srgb, var(--SmartThemeBodyColor) 12%, transparent)"
  edge: "color-mix(in srgb, var(--SmartThemeBodyColor) 24%, transparent)"
  hover: "color-mix(in srgb, var(--SmartThemeBodyColor) 6%, transparent)"
  tint: "color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent)"
  selected: "color-mix(in srgb, var(--SmartThemeBodyColor) 16%, transparent)"
  well: "var(--black30a)"
  fill-done: "color-mix(in srgb, var(--SmartThemeBodyColor) 80%, var(--SmartThemeBlurTintColor))"
  primary-fill: "color-mix(in srgb, var(--SmartThemeEmColor) 26%, var(--SmartThemeBlurTintColor))"
  primary-fill-hover: "color-mix(in srgb, var(--SmartThemeEmColor) 38%, var(--SmartThemeBlurTintColor))"
  primary-edge: "color-mix(in srgb, var(--SmartThemeEmColor) 60%, transparent)"
  warning-ink: "color-mix(in srgb, var(--warning) 72%, var(--SmartThemeBodyColor))"
  warning-tint: "color-mix(in srgb, var(--warning) 8%, transparent)"
  ok-ink: "color-mix(in srgb, var(--active) 58%, var(--SmartThemeBodyColor))"
typography:
  headline:
    fontFamily: "var(--mainFontFamily)"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "var(--mainFontFamily)"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "var(--mainFontFamily)"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  label:
    fontFamily: "var(--mainFontFamily)"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
    fontFeature: "tnum"
  meta:
    fontFamily: "var(--mainFontFamily)"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  code:
    fontFamily: "var(--monoFontFamily)"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "4px"
  control: "5px"
  md: "6px"
  switch: "10px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary-fill}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.primary-fill-hover}"
  button-plain:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "30px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
  button-quiet-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  button-danger:
    backgroundColor: "{colors.warning-tint}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  button-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "3px 9px"
    height: "28px"
    typography: "{typography.meta}"
  input-field:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "3px 5px"
  segment-option:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "3px 9px"
    typography: "{typography.meta}"
  segment-option-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
  holder-chip:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "1px 7px"
    typography: "{typography.meta}"
  beat-square:
    rounded: "{rounded.sm}"
    size: "20px"
  beat-square-done:
    backgroundColor: "{colors.fill-done}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    size: "20px"
  warning-line:
    backgroundColor: "{colors.warning-tint}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "7px 8px 7px 12px"
  inline-editor:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.md}"
    padding: "10px 12px 12px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "7px 12px 6px"
  tab-selected:
    textColor: "{colors.text}"
    typography: "{typography.label}"
---

# Design System: Story Arc

## Overview

**Creative North Star: "The Game Master's Desk"**

Story Arc is a game master's desk set into somebody else's room. It owns no colour, no typeface and no control of its own: every surface is the user's SillyTavern theme, re-weighed. In the Arc Manager each arc is a single table row; when something needs the player, a warning line opens beneath that row and carries its own buttons. The Knowledge popup lands on a review list grouped by message range, newest first, with buttons at the end of each line, a second tab that is a search field over the whole cast, and a third, Map, that draws the cast as rings around the scene: plain dots, names only where they fit, the chosen character's sheet beside it. The wizard and the drawer follow the same grammar. Whatever theme the user runs, near-black Glimmer or a light theme, the extension looks like part of SillyTavern.

Density is high and quiet. These are desktop popups for one power user with 100+ characters and hundreds of facts, so rows are tight (7 to 11px vertical padding), text runs at SillyTavern's 15px and secondary text drops to 13px. Distinction comes from structure, weight and spacing: a 600 title against a 400 sub-line, a 1px line between rows, a 4% tint behind a group. Plans are spoilers, so hidden content sits behind one deliberate Reveal switch, never behind drawer after drawer.

State is always carried by shape and words, with colour only as a third signal. A done beat is a filled square, an open one a solid outline, a pending one dashed; a selected focus option is bold and filled; a warning is an icon, a sentence and its buttons.

**Key Characteristics:**
- Every colour is a SillyTavern theme variable or a `color-mix()` of them; no own hex value anywhere.
- One type family (the theme's main font) in a four-step ramp, weights 400/500/600 only, tabular figures.
- SillyTavern's own `menu_button` and `text_pole` controls, Font Awesome icons.
- Flat surfaces separated by 1px lines and faint tints; shadows only on things that float.
- Shape and words carry state; colour reinforces, never decides.
- One fix sits on the line that shows the problem.

## Colors

There is no palette: the theme's body colour, emphasis colour and surface, mixed at fixed percentages, make every tone in the system.

### Primary
- **Theme Emphasis** (`emphasis`): the theme's em/italic colour, the only accent. It draws focus rings, the selected-tab underline, caret, links, the active beat's outline and, mixed into the surface, the primary button (`primary-fill`, edge `primary-edge`, hover `primary-fill-hover`). One primary button per view: Plan a new arc, Activate, Generate, Accept all.

### Neutral
- **Theme Body** (`text`): all running text and titles.
- **Muted Body** (`muted`, body at 72%): sub-lines, counts, labels, hints, unselected tabs and options.
- **Theme Surface** (`surface`): the popup's own surface; sticky bars (search, wizard controls) and floating menus paint it so rows never show through.
- **Hairline** (`line`, body at 12%): the row divider, between every arc row, change line, fact, detail and beat.
- **Edge** (`edge`, body at 24%): borders of controls drawn by the extension (segmented control, chips, strip, search field) and column-head rules.
- **Hover** (`hover`, body at 6%) and **Tint** (`tint`, body at 4%): row hover and grouped containers.
- **Selected** (`selected`, body at 16%): the chosen segment, a checked switch track, a flashed row.
- **Well** (`well`, ST's `--black30a`): sunken fields: inputs, chips, count badges, the inline editor, switch tracks.
- **Done Fill** (`fill-done`, body at 80% into the surface): the filled beat square and a checked box.
- **Frame Border** (`frame-border`): the line above a popup's status bar, matching SillyTavern's own popup frame.

### Tertiary
- **Warning Ink** (`warning-ink`) and **Warning Tint** (`warning-tint`): the theme's `--warning` softened into the body colour. Ink colours warning icons and danger-button icons; tint fills warning lines, danger buttons and the danger editor. Text on them stays the body colour.
- **OK Ink** (`ok-ink`): the theme's `--active` softened the same way, for check icons beside "saved" and "done" words.

### Named Rules
**The Borrowed Palette Rule.** Every colour is a SillyTavern theme variable or a `color-mix()` of them with `transparent` or the surface. A hex, rgb or named colour in a Story Arc stylesheet is a bug: it breaks some user's theme.

**The Ink-Not-Text Rule.** Warning and OK colours touch icons, borders and tints only. The sentence beside them stays in the body colour and carries the meaning in words.

## Typography

**Body Font:** the theme's main font, `var(--mainFontFamily)` (Noto Sans by default)
**Mono Font:** `var(--monoFontFamily)`, only for the raw plan JSON editor

**Character:** one family, four sizes, three weights. Hierarchy is weight and size inside a tight range, so the popups read as SillyTavern rather than as a page dropped into it.

### Hierarchy
- **Headline** (600, 19px, 1.3): popup titles (Knowledge, Plan the next arc, a character's sheet name).
- **Title** (600, 17px): group heads (Messages 2938–2939), section heads in a sheet, the generated arc's title, empty-state heads.
- **Body** (400, 15px, 1.45): all running text; fact and change lines capped near 78ch, help text near 75ch.
- **Label** (600, 13px): field labels, row-kind column (New fact, Retracted), plan list heads, counts.
- **Meta** (400, 13px): sub-lines, hints, row-side facts, chips, segment options, status bar.

### Named Rules
**The Three Weights Rule.** 400 for text, 500 for unselected tabs and quiet emphasis, 600 for titles, names, selected states and the primary button. No 700, no uppercase, no letter-spacing.

**The Tabular Rule.** Every popup root sets tabular figures, so message numbers, counts and "3/6 done" align down a column.

## Layout

Each popup fills SillyTavern's large popup as a column: a fixed head (title, one-line summary, tabs or steps), one scrolling region, and a fixed status bar on SillyTavern's controls row that holds save feedback and Undo. Rows never paint under the status bar.

Lists are tables and grids, not cards. The Arc Manager is a fixed-layout table (one `tbody` per arc: row, warning line, detail) whose columns keep their widths when a row opens. A change line is a three-column grid: kind (104px), body, actions at the line's end. Character sheets split 5:6.

Responsive behaviour is container queries on the popup's content, not the viewport: at about 1240px the focus control drops unselected words to icons; at about 1000px detail grids and sheets fall to one column; at about 860px change-line actions wrap under the body. The product is desktop only.

Spacing runs 4/6/8/12/16px: 6 to 8px between buttons and chips, 7 to 12px row padding, 12 to 16px between blocks, 24 to 26px between groups.

**The Fix-Beside-It Rule.** A correction control sits on the line that shows the problem (end of the change line, inside the warning line, beside the detail), not in a toolbar or a separate screen.

## Elevation & Depth

Flat by default. Depth comes from SillyTavern's `--black30a` well under fields and editors, a 4% body tint behind grouped containers, and 1px hairlines between rows. Shadows exist only on elements that float over the popup.

### Shadow Vocabulary
- **Floating overlay** (`box-shadow: 0 6px 12px var(--black50a)`): the ⋯ action menu; the beat tooltip uses `0 4px 12px`.
- **Toast** (`box-shadow: 0 6px 20px var(--black50a)`): the Arc Manager's save/undo toast above the status bar.
- **Inline editor lift** (`box-shadow: 0 1px 3px var(--black30a)`): the one in-flow element allowed a shadow, so an open fix reads above the line it edits.
- **Key cap** (`box-shadow: inset 0 -1px 0` edge): `kbd` hints only.

### Named Rules
**The Float-Only Shadow Rule.** If it does not overlay other content (menu, tooltip, toast), it gets no shadow; the inline editor's 1px-3px lift is the single exception.

## Shapes

Small, even corners. 4px is the default for anything inside a row: beat squares, chips, count badges, tab tops, row and menu-item hover. 5px is SillyTavern's own control radius (buttons, fields, the segmented control, icon buttons). 6px rounds containers: warning lines, inline editors, the Names-to-check strip, the wizard's context strip, toasts. The only full round is the Reveal switch's 34 by 20px track and its 14px knob. Borders are 1px; 2px is reserved for state (active beat outline, open beat outline, selected-tab underline, focus ring). Dashed borders mean "not yet" or "not real": pending beats, removed holders, plan-only spoiler holders, invalid fields.

## Components

### Buttons
SillyTavern's `menu_button`, re-weighed, never replaced.
- **Shape:** ST's 5px corner, 30px tall in heads and forms, 28px inside rows and warning lines.
- **Primary:** emphasis mixed 26% into the surface, emphasis edge at 60%, weight 600; hover deepens to 38%. One per view.
- **Plain:** ST's default button with an icon and a verb (Re-plan, Add holder, Not true).
- **Quiet:** transparent, muted text, hover tint; the lesser of two fixes (Ignore beside Re-plan).
- **Danger:** warning tint fill, warning-ink edge and icon; destructive confirms only.
- **Press / Focus:** 1px down on press; 2px emphasis outline, 1px offset on focus. Disabled is 50% opacity with a not-allowed cursor.

### Segmented control
Arc focus (Paused / Background / Normal / Spotlight) and beat status (Open / Done). A 1px edge, 5px corners, options split by hairlines; each option an icon plus a word. Selected is filled with `selected`, body colour and 600 weight. In a narrow popup the unselected options keep only their icon and a tooltip; the chosen one keeps its word.

### Beat strip
**The Shape-Carries-State Rule.** A row of 20px squares at 4px corners: filled with `fill-done` is done, a 2px edge outline is open, a 2px emphasis outline with a play icon is an episode's current beat, 1px dashed is pending, dashed with a lock is locked. A "3/6 done" count always sits under the squares, so no state depends on colour.

### Warning line
A line under its arc row, not a banner: warning icon, one sentence ("No milestone in 246 messages; about one is due every 15."), then its fixes. Warning tint, 1px warning edge at 26%, 6px corners. A note variant uses the emphasis tint for non-urgent notices.

### Proposal row
A detail row the appearance search would change becomes the proposal in place, no separate list: the label, the current value struck through in muted (or *unknown* in muted italic, not struck), an emphasis arrow and the found value at 600. The row takes the emphasis tint (9%) with a 1px emphasis edge (34%) and 6px corners; Accept (plain) and Skip (quiet) stand where Set, Edit and Lock were. One sub-line says where it was found ("Found in 10 messages, newest #3293, 4 hidden · Show sources"); Show sources opens a well with a chip per source (a hidden message muted with an eye-slash icon and the word for screen readers) and the three newest passages, each under its #number, the character's names marked. A line with a magnifier under the section head says what the search found. Two or more proposals put the view's one primary button, Accept all, in that head.

### Holder chips
The one look of a holder entry: 1px edge, 4px corners, well fill, 13px; the holder's name in 600, how they learned it in muted. Dashed edge for a plan-only spoiler holder; dashed with struck name for a removed one. As a button, hover shows the emphasis edge.

### Inputs / Fields
SillyTavern's `text_pole`: well fill, ST border, 5px corners. Placeholders in muted at full opacity, caret in emphasis, focus as a 2px emphasis outline. An invalid field gets a dashed warning-ink border plus an error line with its icon. The Knowledge search field is the one large field: 19px text, 8px corners, magnifier inset, sticky at the top of its tab.

### Tabs and steps
Text tabs on a hairline: muted 500 weight, selected in body colour, 600 weight and a 2px emphasis underline. Counts ride in a small well badge (4px corners); a zero count drops to 400 and muted. The wizard's steps (Direction and Review, with Questions between them when the planner asks any) use the same underline with a numbered badge.

### Map
Dots in body colour, their fill fading from the scene outwards and hollow for no facts; dotted rings with muted titles; a name-family band at body 9%; relation lines at body 50%, the selected one in emphasis. Names sit on a surface backing at 13px and show on hover with the tooltip shadow; a name to check is a warning triangle and a dashed ring, never colour alone. The map holds a tinted container with 6px corners; the filter dims what it does not match to a quarter.

### Reveal switch
A checkbox with `role="switch"` drawn as a track: well fill and edge when off, `selected` fill with a body-colour edge and knob when on, a "shown" word beside it. One per plan; it hides again when the popup closes. What the narrator gets has one for the whole view, its state word counting the hidden lines ("11 lines hidden"); there the premise, world facts and pressures show without it, and each hidden run is a dashed placeholder with an eye-slash icon that says what it hides ("3 triggers, 4 clues hidden · 455 tokens").

### Status bar
The popup's bottom row, on SillyTavern's controls line above a frame-border rule: the last save message with its icon, Undo with what it undoes, keyboard hints in `kbd` caps, and Close.

## Do's and Don'ts

### Do:
- **Do** take every colour from `--SmartTheme*`, `--black30a`/`--black50a`, `--warning`, `--active` or a `color-mix()` of them, and check new UI in a dark and a light theme.
- **Do** use SillyTavern's `menu_button` and `text_pole` and Font Awesome solid icons; size icons 12 to 13px inside 13 to 15px text.
- **Do** carry state by shape and words first: fill, solid or dashed outline, weight, a counted phrase. Colour is the third signal.
- **Do** put the fix on the line that shows the problem, and keep one primary button per view.
- **Do** keep hidden plan content behind one Reveal switch and say what is hidden ("Hidden: the premise, 6 milestones, 3 secrets").
- **Do** animate with `cubic-bezier(0.16, 1, 0.3, 1)` at 120 to 260ms, only for reveal, fold, press and arrival, and drop it under `prefers-reduced-motion`.
- **Do** use container queries on the popup content for narrow layouts.

### Don't:
- **Don't** write a hex, rgb or named colour, or bring an own accent: the theme's emphasis colour is the only accent.
- **Don't** use bold 700, uppercase, letter-spacing, or a second typeface outside the JSON editor's mono.
- **Don't** stack arcs or characters as cards that each show every control; rows in a table or list, with the detail opening in place.
- **Don't** use pill-shaped labels or badges; chips and counts keep 4px corners (the switch track is a control, not a label).
- **Don't** add glow, gradients or box shadows of the extension's own to in-flow content (the inline editor's 1px-3px lift excepted); the theme's text shadow is inherited, not added or removed.
- **Don't** colour a word to mean warning or success without an icon and the word itself saying it.
