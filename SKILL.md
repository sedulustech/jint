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

## Setup

Install (either):

- npm: `npm install -g @sedulus/jint@rc` or as a devDependency. The package is a meta-package that pulls the matching platform binary (`@sedulus/jint-linux-x64`, `-linux-arm64`, `-darwin-x64`, `-darwin-arm64`) via optionalDependencies and exposes the `jint` bin. Works with npm and bun (`bunx`). The `rc` dist-tag tracks prereleases; plain `@sedulus/jint` resolves `latest`, empty until the first stable release. `npx @sedulus/jint@rc --version` runs without installing.
- Shell: `curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/main/install.sh | bash` - installs to `~/.local/bin`, verifies sha256 against the release `checksums.txt`, warns if `~/.local/bin` is not on `PATH`, prints `--version`. Pin with `curl -fsSL ... | VERSION=v1.2.3 bash` (the env goes on the bash side of the pipe). Versionless resolves the newest STABLE release; prereleases (rc) never become latest, so pin the tag during the rc phase.
- Linux needs glibc (any mainstream distro); on musl/Alpine images add a glibc layer (e.g. `sgerrand/alpine-pkg-glibc` + a `/lib64` loader symlink) or use a glibc base image.

Then `TYPESAFE_API_KEY` in the environment (used as-is).

- Recording is always on: the exact wire bytes per question land under
  `~/.jint/runs/` (or wherever `JINT_RUNS_DIR` points).
  Read the recorded request files when you need to see precisely what the model saw. Every run
  also persists `report.json` (the canonical output — the same bytes `--json` prints) and is
  browsable in the measurement UI - see "Give the user the link" below.

## Output

- Env summary: recording is always on (there is no off switch); `JINT_RUNS_DIR` moves where
  run dirs land (default `~/.jint/runs`); `JINT_GRAMMAR_DIR` moves the user grammar dir (default `~/.jint/grammars`).

## Span anchors are pre-edit

Element-scoped queries (`path@L58`) address elements by line. Edits shift lines, so an
anchor from an earlier run can silently select a DIFFERENT element after the file changed -
the run looks valid, the line is simply someone else now. After any edit, re-locate the
element (grep the name, re-run) instead of reusing the old `@L`. Do not try to attribute
stale findings to current code automatically: matching by name or content heuristics is a
rabbit hole; re-anchor and re-measure.

<!-- run-dir:begin (generated - do not edit; bun run schema) -->

## The run dir

The run dir is the record of what the model saw. Read it before you probe.

### The fix loop

1. Take a finding. Re-query just that unit: `jint run <path>@L<line> --rule <rule>`. One query,
   one unit, one verdict. No full re-run.
2. Anchors are PRE-EDIT. `@L<n>` names the line the run saw, not the line that exists now.
3. After any edit, re-anchor at the CURRENT line. Grep the declaration. Then re-query.

### Element inventory without the CLI

Every run records its captures in a run dir. Find it on stderr after a run, or read the
report's top-level `run` field: `run.dir` is the dir, `run.id` is its name. The dir holds
capture files named `<unixts>-elements-<file>.json` - one file per request, one request per
element. The envelope is `{request, response}`; the judged text is `request.state.source`,
with `request.state.id` and `request.state.path`. A capture carries no span: spans live in the
report (`measurements[].element.span`, `findings[].location.span`), joined by input id. Read
these instead of probing anchors with live queries.

### The join: finding to judged text

A report finding names its element in `findings[].input`. That string is `<path>#<id>`,
where `<id>` equals the capture's `state.id`. Split on `#` and match the tail. The match
recovers the exact text the model judged.

### Quote source from the file, never from the capture

Captures tell you WHAT was judged. The file tells you HOW it is written now. Capture JSON is
pretty-printed; its indentation is not source. Edit from the file. A pasted capture indent is
a wasted edit.

### Paths and scoping

An explicit path overrides config scoping. That is by design. A piped list must respect the
config's `exclude`: filter before the pipe, e.g.
`git diff --name-only | grep -vE '\.test\.ts$|^tests/' | jint paths -`.

### The binary goes stale

The repo-root `jint` is a compiled artifact. Merges do not rebuild it. `bun run build`
refreshes `packages/cli/dist/cli.js`, not the root binary. Run
`bun packages/cli/dist/cli.js` after a merge, or recompile the root binary before trusting
it. Use bun, not node: the SDK uses parameter properties, which node cannot execute. A stale
binary reports old behavior as if it were current.

<!-- run-dir:end -->

## CLI

CLI usage lives in `jint --help` - the tool's own contract, not duplicated here.

## Rules are data

Every rule (noul included) may carry `instructions`: the yes/no question the
model answers, one sentence, stating the claim. The compiler always prepends a
kind sentence ("This unit is a function definition.") to whatever you write, so
never state the element kind yourself. When `instructions` is absent on a noul
rule, the generic task sentence is used — prefer writing the real question.
Changing instructions is a recalibration event.

<!-- rule-schema:begin (generated - do not edit; bun run schema) -->

| key            | meaning                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | The rule id: findings join back to it; config rules later in the array override same-named earlier ones.                                              |
| `kind`         | noul                                                                                                                                                  |
| `instructions` | The yes/no question the model answers, specific to the rule's claim. Required - a generic fallback question would silently recalibrate every reading. |
| `criteria`     | The two-sided contract: true names the exact observable condition for yes, false for no. The defect side decides the handle direction.                |
| `target`       | What the rule judges: files = the whole unit; functions/definitions/comments/imports = elements derived from the parse.                               |
| `handle`       | When readings surface as findings; the shape depends on kind (the two descriptions below).                                                            |
| `include`      | Rule scoping: glob list over walked paths; replaces any fragment-level scope wholesale. Config exclude stays absolute.                                |
| `exclude`      | Rule scoping: glob list over walked paths; replaces any fragment-level scope wholesale. Config exclude stays absolute.                                |

Handles, both kinds - direction lives in the handle, never in prose:

- **noul** (yes/no): `Noul handle (noul rules only): per-threshold comparison operators declare the direction - warn is the wider region, error the strictly narrower one (same direction, ordered toward the defect: greater warn < greater error, or less warn > less error). silent_band [lo, hi] keeps raw-p readings inside it silent (must be ordered, must not cover the whole scale, must not contain a threshold value); absent = everything surfaces.`
- **choice** (scored rubric): `Score handler (choice rules only): one level per criteria entry, indexed by score 0..N. Direction is expressed by the map itself (high-bad: [pass, pass, warn, error]; high-good: [error, warn, pass, pass]). The length MUST equal the criteria count and at least one level must be non-pass.`

Callback custom rules (TS config only): handle may be a (results, ctx) => decisions function, one decision per reading: { severity: "error" | "warn" | null, message? }. Null severity is silent (measurement only). message is an instruction to the caller fixing the finding; severity says whether, message says how - it renders beneath the finding line and rides the report as finding.message.

A live config example, serialized from real default specs (always the current wire shape):

```json
{
  "$schema": "./jint.schema.json",
  "rules": [
    {
      "name": "is_greppable",
      "instructions": "Are the identifiers in this function searchable with terms a developer would use to find this code?",
      "criteria": {
        "true": "The code identifiers judged here are those in the function's declaration and body - its own name, its parameters, its locals, and the names it reads - and they are greppable: written out in full at every occurrence, never split into fragments or dynamically constructed from pieces, never renamed at a boundary, and specific enough that a search hit is genuinely a reference to this thing.",
        "false": "At least one identifier in the function cannot be found by a single search: it is split into fragments or dynamically constructed from pieces, renamed at a boundary so the same concept needs two search strings, or is a bare word (data, handler, util) whose hits are mostly noise. CLI flag spellings, help text, and log messages are user-facing interface, not code identifiers, and are outside this rule."
      },
      "target": "functions",
      "handle": {
        "warn": {
          "less_than": 0.75
        },
        "error": {
          "less_than": 0.6
        }
      }
    },
    {
      "name": "is_cognitively_complex",
      "kind": "choice",
      "instructions": "How much EFFORT does a reader need to follow this code's logic - effort caused by structure the author chose, not by the problem itself? Ignore length alone: a long linear unit with one job reads as easy. Ignore inherent complexity: cases the data or the domain genuinely force are not this failure. Judge how hard the code's own structure makes it to read top-to-bottom.",
      "criteria": [
        "Easy: the logic reads top-to-bottom. A single pass suffices. Any difficulty present is inherent to the problem, not to the structure.",
        "Moderate: the reader must pause once or twice - hold a small amount of state across a few lines, or re-check an outer condition - but the structure is otherwise linear and the full flow is recoverable by re-reading one or two spots.",
        "Hard: following the code requires actively reconstructing its flow - a stack of nested conditions to track, several unrelated concerns fused into one unit, state held across many lines, or an order that forces jumps instead of top-to-bottom reading. The structural difficulty could be removed without changing what the code does."
      ],
      "target": ["functions", "classes", "methods", "types", "bindings"],
      "handle": {
        "map": ["pass", "warn", "error"]
      }
    }
  ]
}
```

<!-- rule-schema:end -->

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
- Elements: the `files` target judges the whole unit; `definitions`/
  `comments`/`functions`/`imports` targets judge elements derived from the
  parse. A rule about functions needs the code to parse - snippets without a
  language will not reach it.

## Virtual modules - no install, no runtime

Rule authoring needs nothing but this binary: no JS runtime, no npm install, no
node_modules. Configs (and the rules inline in them) import the compiled-in virtual modules

- `jint:defaults` (the default rules: `defaultRules` + named exports) and
  `jint:sdk` (`defineConfig`) - and jint loads and executes them on its own
  runtime. Their version IS the binary's: same tree, same CLI, same readings.

## Creating criterias

Think of jev as the features you would like to activate to trigger a result in
your favor: when you see something in a file that is off, the rule is how you
convey that idea. Each noul side (`true`/`false`) and each score level is a
way to disambiguate. A rule is a reminder of the dimensions you care about in
the code.

Guidelines, in the order you will need them:

1. **Write the exact condition, both sides.** State what must be observably
   true in the source for yes, and for no. Not "true: the code is good".
2. **Name what is observable in the source, not the quality you want.**
   "Vendor types appear in exported signatures" works; "the code has good
   boundaries" does not. If a criterion cannot be checked by reading the
   element, the rule cannot measure it (a reachability rule was tried and
   dropped: mean 0.58, no separation - the model cannot see call sites).
3. **Abstract the rule from the target - do not overfit.**
   The criteria must state the generalizable dimension the target exemplifies, not
   quote it. "Identifiers of the same role mix word-order patterns"
   is a rule; "fetchUsers beside usersRetriever" is a fixture. A criteria
   that recites the target validates the observation, not the rule: the probe
   fires on the target files and reads healthy code as hot, because healthy
   code has _other_ instances of the same dimension the criteria never names.
   Examples are encouraged - use abstracted placeholders (john_doe-style
   roles: a fetch pattern, a builder pattern), never the real file's names.
4. **One attribute per rule.** Two ideas in one criteria halves its precision.
5. **Guard against smallness bias.** Short exact-name helpers read as
   low-purpose; if size is not the defect, say so ("length alone is not a
   defect").
6. **Element fit: say what to do when the surface is absent.** Two forms, both
   measured: "a function with no error handling is not applicable, answer
   false" and "asserting on an injected fake's stubbed values is wiring, not
   pinning". Without an absence clause, undecided 0.5s pile up and calibration
   dies in the middle.
7. **Separate the defect from the deliberate.** Documented deliberate catches,
   event-forwarding handlers, existence probes - name them in the criteria or
   they fire as findings.
8. **Exclude conventions explicitly.** Banner comments, Sphinx-style `#:`
   blocks, and docblocks naming flags/env vars/wire keys are load-bearing
   convention, not defects; rules rotting them must say so.
9. **Calibrate with a targeted positive control.** Healthy corpus quiet is
   necessary but not evidence: write the actual defect (a swallowed catch, a
   lying name) into a scratch file and confirm the rule still fires.
10. **Anchor thresholds to distributions.** Run the probe first (real handle; read
    measurements, discard findings), read the value spread, place warn/error inside the
    healthy/defective gap. Then paste the numbers into the config as data. Thresholds sit on
    0.05 steps (0.4, 0.5, 0.7, 0.9) - identical measurements vary by around 0.05
    between runs, so a threshold finer than that fits noise: a threshold like 0.82
    is fitted around one reading you are dodging, and the dodge usually protects a
    real defect from being fixed. A threshold at 0.5 reads undecidedness as a verdict: whether undecided is a pass, a warn, or an error is the rule author's explicit choice. A healthy file reading above 0.75 is not a threshold problem - it is a
    criteria problem (the rule narrates quality instead of checking a condition) or
    the property is graded and wants a `kind: "choice"` rubric, not a noul.
11. **Criteria are corpus-calibrated.** Criteria tuned on TypeScript start
    unverified on other languages; re-probe before trusting findings there.

## Examples

### will_error_lose_cause - the absence clause and exemptions

The second sentence of `true` keeps fake wiring and forwarding handlers out of the findings; the handle fires LOW because `true` describes the DEFECT:

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
  "handle": { "warn": { "greater_than": 0.4 }, "error": { "greater_than": 0.7 } }
}
```

### is_readable - the choice rubric

Use a rubric when the property is graded, not yes/no. The instructions carry a scoping sentence ("do not score X here"); levels are ordered descriptions, not true/false:

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
  "handle": { "map": ["pass", "pass", "warn", "error"] }
}
```

### will_naming_drift - the criteria shape that fails

This shape reads reasonable and fails on a healthy corpus:

```json
{
  "name": "will_naming_drift",
  "target": "definitions",
  "criteria": {
    "true": "The change introduces naming drift: the same concept is called by
      different names across the change.",
    "false": "Naming is consistent."
  },
  "handle": { "warn": { "greater_than": 0.5 }, "error": { "greater_than": 0.7 } }
}
```

It fails three ways: `false` is generic (guideline 1), the claim spans multiple elements - the model compares against names it cannot see - and "drift" invites narrating quality instead of checking a condition (guideline 2). The fix is never thresholds; rewrite the criteria until they name an observable condition.
