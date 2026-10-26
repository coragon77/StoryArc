# Coding Guidelines for AI-Written Code

**Read this before writing any code.** The goal: what you write must read like
the house style, so the owner understands it quickly ten years from now. "Simple
code" — easy to read, straightforward, no cleverness.

**Deviation rule:** match the house style unless your alternative is *clearly
superior*, which means correctness, security, or **measured** performance. When
you deviate, say so in your response and give the reason. "More idiomatic" or
"cleaner" is not a reason.

`onboarding.md` names this project's reference example, its formatter command,
and its own helper inventory. Read it alongside this file.

------------------------------------------------------------------------

## Naming

Domain concepts use the **English terms in `GLOSSARY.md`**, exactly as defined
there (arc, tier, episode, act, saga, focus, beat, milestone, pressure, secret,
trigger, foreshadowing). Each glossary entry lists under _Avoid_ the synonyms
that must not appear in code, comments or UI text. Infrastructure keeps
SillyTavern's own names (`chat_metadata`, `extension_settings`,
`setExtensionPrompt`).

``` javascript
// YES — glossary terms
const pendingMilestones = arc.beats.filter(b => b.status === 'pending');
if (arc.focus === 'paused') return '';

// NO — synonyms the glossary avoids
const quest = getArcById(arcId);       // it is an arc
if (arc.focus === 'shelved') return '';  // the focus value is paused
```

Long descriptive camelCase names. Functions are verb phrases stating exactly
what they do:

``` javascript
// YES
export function messagesUntilNextPhase(arc, currentPhase) { ... }

// NO
export function calcMsgs(a, p) { ... }
```

Collections carry a qualifier telling you *which subset* you hold:
`nonOptionalBeats` against `arc.beats`, `visibleSecrets` against `arc.secrets`,
`unplanted` foreshadowing against `arc.foreshadowing`. Use only established
abbreviations — never invent new ones. Never shadow JavaScript builtins or the
SillyTavern globals the code imports (`chat`, `characters`, `chat_metadata`).

## Structure — "simple code"

Write a **linear narrative**. Decompose into helpers per *business step*, not
into tiny methods that satisfy a complexity metric. A long readable function
beats ten fragments you have to jump between. Complexity numbers are advisory;
readability wins.

- Plain `if/elif` chains for business cases, one explicit dict literal per case.
  No clever dict-merging, comprehension tricks, or dispatch tables for three
  cases.

- Named intermediate variables over nested expressions:

  ``` python
  # YES
  vz_betrag = ensure_number(vz_gesamt) * -1
  auszahlung = round(vz_betrag + vz_betrag_allg - ensure_number(anteil), 2)

  # NO
  auszahlung = round(ensure_number(vz_gesamt) * -1 + ensure_number(vz_allg) * -1 - ensure_number(anteil), 2)
  ```

- Guard clauses early: `continue` / `return` / raise, instead of nesting the
  happy path.

- Long-running loops in user-visible operations emit progress.

- **No speculative abstractions.** No base class, factory, registry, or config
  option with a single implementation or caller. Add flexibility when the second
  use case arrives, not before.

## Reuse before writing

These codebases are old and wide. **The helper you are about to write probably
exists.** Before writing any utility, grep the shared utils package and the
app's own `utils.py` / `actions.py`. `onboarding.md` lists the helpers this
project reaches for most often, and what each one replaces.

## Error handling

Bare `except:` appears across legacy code. It is a known antipattern of the
owner — **never write it, never copy it.** Catch specific exceptions. When
guarding an attribute chain that can hit `None`, include `AttributeError`.

Prefer query-or-default over try/except around indexing:

``` python
# YES
letzte_auszahlung = Abrechnungszeile.nicht_stornierte.filter(...).order_by("-timestamp").first()

# NO (legacy pattern — do not copy)
try:
    letzte_auszahlung = Abrechnungszeile.nicht_stornierte.filter(...).order_by("-timestamp")[0]
except:
    letzte_auszahlung = None
```

Include error handling that prevents data loss without being asked. Do not add
try/except that silently swallows and continues.

## Language and formatting

- Comments and docstrings: **English**. Google-style docstrings on modules,
  classes, and public functions.
- User-facing strings — notifications, status messages, UI text: **German**.
- **f-strings** in new code. Leave existing %-formatting untouched, no churn.
- Never add commented-out code or debugger traces. Never delete existing ones
  without asking.
- The project's formatter owns formatting and imports; do not hand-format
  against it. Running it on the whole file you touched is wanted — incremental
  cleanup is the strategy. Commit those mechanical fixes as a **separate**
  `style:` commit, so the semantic commit's diff contains only what it claims.

## Self-check before presenting code

- Did I re-implement an existing helper? (grep first)
- Did I add an abstraction with exactly one caller?
- Did I fragment a linear flow nobody asked me to fragment?
- Did I use a term `GLOSSARY.md` lists under _Avoid_?
- Did I write a bare `except:` or swallow an exception silently?
- Would the owner recognise this as his code in ten years?
