---
name: jint
description: >
  Measure code with AI-classifier judgments using jint: pipe any source through
  jev (TypeSafe System One) with declarative JSON rules - noul probabilities or
  scored rubrics - and get per-element measurements and findings. Use when
  reviewing code quality, naming, comments, readability, or when experimenting
  with new classification criteria. Triggers: jint, jev lint, code judgment,
  rule calibration, self-lint.
---

# Use jint - AI-classifier lint

jint measures code: rules in, findings out. A **rule** compiles to one question
for **jev** (TypeSafe's System One classifier); each answer is a calibrated
reading; a reading that crosses the rule's thresholds becomes a **finding**.

## What jev is (read before writing criteria)

jev is a System One classifier, not a chat model: it returns calibrated
probabilities (noul, 0..1) or rubric scores, no explanations. Key properties:

- **0.5 is undecided, not medium.** A noul of 0.45 vs 0.55 is not a ranking.
- **Calibrated middle matters.** Thresholds live in the 0.3-0.8 band; generic
  LLMs quantize to 0/1 and are useless here (measured: gemini flash-lite).
- **State shape changes readings.** One state x many questions is valid; the
  matrix form (many states + many questions in one call) averages everything.
  jint handles this for you - never stack elements into one state yourself.
- Live docs: https://docs.typesafe.ai/llms.txt (System One, state, primitives,
  confidence). The installed SDK: node_modules/@typesafe-ai/sdk.

## Setup

- Requires bun. `TYPESAFE_API_KEY` in the environment (used as-is).
- Optional: `JEV_DEBUG_REQUEST=1` captures the exact wire bytes per question
  under /tmp/jint/requests/ (or `JEV_DEBUG_REQUEST_LOCATION` — note it wins even
  if relative, e.g. a stale `tmp/requests` in env redirects captures into the
  repo). At end of run jint prints one stderr line naming the run dir:
  `jint: request captures -> <dir> (N calls)` — trust that line, not the docs.
  Read the captures when you need to see precisely what the model saw.

## CLI

```sh
jint src/ --json                            # directory walk, human table or JSON
jint src/a.ts src/b.ts                      # explicit files
cat snippet.ts | jint str - --language typescript --json   # stdin source, declared str
git diff HEAD~1 | jint diff -               # diffs: pipe them in (jint never shells to git)
jint diff fix.patch                         # a patch file, declared a diff
jint --config my-probe.config.json src/core/jev/ --json
```

- The resource is the noun; the verb (measure) is implicit. `str` and `diff` are
  nouns only as the FIRST positional; their next positional is the payload, taken
  verbatim (no flag parsing): `jint str "--json"` measures "--json" as source.
  A path's kind is inferred by shape only: exists-as-dir -> dir, else file —
  never content-sniffed. Nouns never resolve to paths: a repo file named `diff`
  is measured as `jint ./diff`; bare `jint diff` / `jint str` are usage errors.
- Piped stdin is declared, never guessed: `jint str -` (ONE source unit) or
  `jint diff -` (unified diff). Piping without a noun is a usage error.
  `--language` supplies the grammar when there is no path extension; without a
  grammar, inventory-scoped rules fail with WALK_FAILED (in-band) while
  file-scoped rules still measure.
- Exit codes: 0 clean, 1 error findings, 2 usage/config, 3 internal,
  4 zero measurements. Findings -> stdout; run errors -> stderr.
- `--json` carries ALL measurements (raw readings) plus findings - that is the
  calibration data.
- **Ad-hoc rule testing (the fast loop):** write a scratch config with just the
  rule, filter to it, and pipe the snippet straight in. Untracked files, no
  repo changes:

  ```sh
  # tmp/interface-test.config.json holds one rule, e.g. is_name_clear
  # (criteria: true - the name states what the value/function does; false - vague or lying)
  cat interface.ts | jint --config tmp/interface-test.config.json \
    --rule is_name_clear --language typescript
  ```

  The snippet can be a single interface, function, or module - `str -` is one
  unit, so element-scoped rules run on it when `--language` supplies the
  grammar. Keep scratch configs under tmp/ and one rule per config while
  calibrating; measure-only (`"handle": null`) first, thresholds after you have
  seen the spread.

## Rules are data (jint.config.json or --config probe.json)

Every rule (noul included) may carry `instructions`: the yes/no question the
model answers, one sentence, stating the claim. The compiler always prepends a
kind sentence ("This unit is a function definition.") to whatever you write, so
never state the element kind yourself. When `instructions` is absent on a noul
rule, the generic task sentence is used — prefer writing the real question.
Changing instructions is a recalibration event.

```json
{
  "$schema": "./jint.schema.json",
  "rules": [
    {
      "name": "is_seam_isolated",
      "target": "functions",
      "criteria": {
        "true": "Vendor SDK details stay inside the adapter boundary; nothing vendor-specific escapes to callers.",
        "false": "Vendor SDK details leak: vendor types in exported signatures, vendor error classes escaping, or callers must know the vendor."
      },
      "handle": { "warn_at": 0.5, "error_at": 0.3 }
    },
    {
      "name": "is_readable",
      "kind": "choice",
      "target": "definitions",
      "instructions": "How easy is `source` to read at the identifier/structure level? Do not score algorithmic hardness.",
      "criteria": [
        "Names, structure, and types make the story obvious.",
        "Mostly clear; a few opaque names or a slightly awkward shape.",
        "Reader must reconstruct intent from implementation details.",
        "Dense, misleading names, or structure that fights the problem."
      ],
      "handle": { "warn_at": 1, "error_at": 2 }
    }
  ]
}
```

- **Polarity is inferred from threshold ORDER**: warn_at < error_at = high-bad
  (fires above); error_at < warn_at = high-good (fires below). The order MUST
  match the criteria direction: if criteria.true describes the GOOD case,
  findings fire LOW (error_at < warn_at). Getting this backwards fires on
  healthy code - the most common authoring bug.
- `"handle": null` = measure-only (the reading streams, never signals).
- `kind: "choice"` = scored rubric; criteria is an ordered list of level
  descriptions, answer is a 0..N score (can be fractional). Use for graded
  properties (readability); use noul for yes/no claims.

- **A noul that stacks dimensions is a symptom, not style.** When noul
  criteria lists several independent features inside one question - e.g.
  is_cognitively_complex: nesting depth, unrelated concerns mixed, held
  state, non-linear order - the yes/no frame has outlived the idea: each
  dimension needs its own evidence, and one probability cannot carry them
  separately. Convert to `kind: "choice"`: the rubric levels ARE the
  dimensions. The CLI renders the chosen level's text on the finding line
  ("warn 1.65 is_readable - Reader must reconstruct intent..."), so the
  agent reads where to intervene, not a bare number.
- **A score needs a pass option.** At least one level of the rubric must
  resolve to a non-finding: the low end of the scale is the healthy case
  and its map entry must be "pass". A rubric whose every level fires
  (warn/error only) can never approve anything - it flags healthy code,
  the same failure as reversed thresholds. When calibrating, the healthy
  band should land inside the pass level(s) and the defective band above
  them, with the map boundary between them.
- Elements: `files`/`diffs` targets judge the whole unit; `definitions`/
  `comments`/`functions`/`imports` targets judge elements derived from the
  parse. A rule about functions needs the code to parse - snippets without a
  language will not reach it.

## Creating criterias (measured lessons - every rule here was probed against a corpus)

Guidelines, in the order you will need them:

1. **Write the exact condition, both sides.** State what must be observably
   true in the source for yes, and for no. Not "true: the code is good".
2. **Name what is observable in the source, not the quality you want.**
   "Vendor types appear in exported signatures" works; "the code has good
   boundaries" does not. If a criterion cannot be checked by reading the
   element, the rule cannot measure it (a reachability rule was tried and
   dropped: mean 0.58, no separation - the model cannot see call sites).
3. **One attribute per rule.** Two ideas in one criteria halves its precision.
4. **Guard against smallness bias.** Short exact-name helpers read as
   low-purpose; if size is not the defect, say so ("length alone is not a
   defect").
5. **Element fit: say what to do when the surface is absent.** Two forms, both
   measured: "a function with no error handling is not applicable, answer
   false" and "asserting on an injected fake's stubbed values is wiring, not
   pinning". Without an absence clause, undecided 0.5s pile up and calibration
   dies in the middle.
6. **Separate the defect from the deliberate.** Documented deliberate catches,
   event-forwarding handlers, existence probes - name them in the criteria or
   they fire as findings.
7. **Exclude conventions explicitly.** Banner comments, Sphinx-style `#:`
   blocks, and docblocks naming flags/env vars/wire keys are load-bearing
   convention, not defects; rules rotting them must say so.
8. **Calibrate with a seeded positive control.** Healthy corpus quiet is
   necessary but not evidence: write the actual defect (a swallowed catch, a
   lying name) into a scratch file and confirm the rule still fires.
9. **Anchor thresholds to distributions.** Run measure-only ("handle": null)
   first, read the value spread, place warn/error inside the healthy/defective
   gap. Then paste the numbers into the config as data.
10. **Criteria are corpus-calibrated.** Criteria tuned on TypeScript start
    unverified on other languages; re-probe before trusting findings there.

### Example: a noul rule with an absence clause and exemptions

From `will_error_lose_cause` (promoted to defaults after probing). The
interesting parts are the second sentence of `true` (the exemption that keeps
fake wiring and forwarding handlers out of the findings) and the handle order
(fires LOW because `true` describes the DEFECT):

```json
{
  "name": "will_error_lose_cause",
  "target": "functions",
  "criteria": {
    "true": "Error handling loses information: a caught error is swallowed, rethrown
      without its cause, or replaced by a message that drops the original failure
      detail. A function with no error handling is not applicable: answer false.
      Forwarding an error event/stream to a handler is not a defect.",
    "false": "Error handling preserves information: causes are chained, messages
      include the original failure detail, and nothing is swallowed silently."
  },
  "handle": { "warn_at": 0.4, "error_at": 0.7 }
}
```

### Example: a choice (scored-rubric) rule

`is_readable` - use a rubric when the property is graded, not yes/no. Note the
scoping sentence in instructions ("do not score X here") and that levels are
ordered descriptions, not true/false:

```json
{
  "name": "is_readable",
  "kind": "choice",
  "target": "definitions",
  "instructions": "How easy is `source` to read at the identifier/structure level?
    Do not score algorithmic hardness. Do not score comments here.",
  "criteria": [
    "Names, structure, and types make the story obvious.",
    "Mostly clear; a few opaque names or a slightly awkward shape.",
    "Reader must reconstruct intent from implementation details.",
    "Dense, misleading names, or structure that fights the problem."
  ],
  "handle": { "warn_at": 1, "error_at": 2 }
}
```

### What NOT to do

This rule looks reasonable and was a total failure - 43 findings on a healthy
corpus, 43/43 false positives, suspended:

```json
{
  "name": "will_naming_drift",
  "target": "definitions",
  "criteria": {
    "true": "The change introduces naming drift: the same concept is called by
      different names across the change.",
    "false": "Naming is consistent."
  },
  "handle": { "warn_at": 0.5, "error_at": 0.7 }
}
```

Why it failed: `false` is generic (violates guideline 1), the claim spans
multiple elements (violates one-attribute scope - the model compares against
names it cannot see), and "drift" invites the model to narrate quality instead
of checking a condition (guideline 2). The fix was never thresholds; the rule
was suspended until its criteria could name an observable condition.

## SDK (programmatic)

```ts
import { classify, defaultRules } from "jint";
const { measurements, errors, inventory } = await classify("export const x = 1;", defaultRules, {
  language: "typescript",
});
```

Raw measurements, no handles applied. `Measurement = { rule, element, value,
stage }` - value is a noul probability or a rubric score. Programmatic rules
may use function handles; config files use data handles only.

## Calibration loop

1. `jint --dir <corpus> --json` -> collect value distributions per rule.
2. Pick warn_at/error_at so the healthy corpus is quiet.
3. Paste thresholds into config (they are data) and re-run.
   Seed defective variants (rename everything, mangle structure) to confirm the
   rule still fires on real problems - precision on healthy code alone is not
   evidence.
