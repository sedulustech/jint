---
name: jint-author
description: >
  Author and calibrate jint rules: criteria, handles, fixer messages, and the
  calibration ritual - small tests on many languages - for promoting a rule into an
  official domain.
  Triggers: rule calibration, jint rules.
---

<!-- Generated - do not edit. Regenerate with: bun run schema -->

# jint - author and calibrate rules

jint measures code: rules in, findings out. A **rule** compiles to one question
for the **provider** (an AI classifier); each answer is a calibrated
reading; a reading that crosses the rule's thresholds becomes a **finding**.

## Rules are data

Every rule (noul included) may carry `instructions`: the yes/no question the
model answers, one sentence, stating the claim. The compiler always prepends a
kind sentence ("This unit is a function definition.") to whatever you write, so
never state the element kind yourself. Changing instructions is a recalibration
event. Criteria pin what each answer means; for score rules the ordered
criteria list is the score legend (score 0..N).

Write the question about ONE property, as a yes/no the model can answer from the
unit alone. Name the rule for what the true side says, so the value reads as the
name: `has_filename_mismatch` high is bad, `is_greppable` high is good, and the
handle direction follows. Two properties under one question is two rules: one
reading cannot say which failed. The model sees only the element's frame (a
comment rule sees the definition it belongs to), so a claim about code elsewhere
cannot be judged. REFERENCE.md has what was measured.

| key            | meaning                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | The rule id: findings join back to it. Two entries with one name are a config error unless the later one sets override.                                       |
| `kind`         | noul                                                                                                                                                          |
| `instructions` | The yes/no question the model answers, specific to the rule's claim. Required - a generic fallback question would silently recalibrate every reading.         |
| `criteria`     | The two-sided contract: true names the exact observable condition for yes, false for no. The defect side decides the handle direction.                        |
| `target`       | What the rule judges: files = the whole unit; functions/definitions/comments/imports = elements derived from the parse.                                       |
| `handle`       | When readings surface as findings; the shape depends on kind (the descriptions below).                                                                        |
| `include`      | Rule scoping: glob list over walked paths; replaces any fragment-level scope wholesale. Config exclude stays absolute.                                        |
| `exclude`      | Rule scoping: glob list over walked paths; replaces any fragment-level scope wholesale. Config exclude stays absolute.                                        |
| `override`     | true: this entry replaces an earlier entry of the same name. Without it a repeated name is a config error, and with it an entry that replaces nothing is too. |

Handles, one form per kind - direction lives in the handle, never in prose:

- **noul** (yes/no): `Noul handler (noul rules only): per-threshold comparison operators declare the direction. Declare at least one tier - warn, error, or both; a handle with neither is rejected. An error-only handle fires error past its threshold and passes otherwise. When both tiers are present, warn is the wider region and error the strictly narrower one (same direction, ordered toward the defect: greater warn < greater error, or less warn > less error). silent_band [lo, hi] keeps raw-p readings inside it silent (must be ordered, must not cover the whole scale, must not contain any declared threshold value); absent = everything surfaces.`
- **score** (scored rubric): `Score handler (score rules only): one level per criteria entry, indexed by score 0..N. Direction is expressed by the map itself (high-bad: [pass, pass, warn, error]; high-good: [error, warn, pass, pass]). The length MUST equal the criteria count and at least one level must be non-pass. An optional per-tier message (author feedback) becomes the finding's note when the tier fires; absent = a bare finding.`
- **choice** (named options): `Choice handler (choice rules only): one tier per option label, keyed by the label. The option probabilities are summed per tier; the tier with the most probability is the verdict, and its most probable option's message becomes the finding's note. Options are unordered, nothing is averaged. The labels MUST equal the criteria labels and at least one tier must be non-pass. Optional undecided { margin, level, message? }: when the top tier's probability leads the runner-up tier's by less than `margin` (between 0 and 1), this tier fires instead - an undecided reading the rule acts on like any other tier.`

Callback custom rules (TS config only): handle may be a (results, ctx) => decisions function, one decision per reading: { severity: "error" | "warn" | null, message? }. Null severity is silent (measurement only). message is an instruction to the caller fixing the finding; severity says whether, message says how - it renders beneath the finding line and rides the report as finding.message.

A live config example, serialized from real default specs (always the current
wire shape):

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
      "kind": "score",
      "instructions": "How much EFFORT does a reader need to follow this code's logic - effort caused by structure the author chose, not by the problem itself? Ignore length alone: a long linear unit with one job reads as easy. Ignore inherent complexity: cases the data or the domain genuinely force are not this failure. Judge how hard the code's own structure makes it to read top-to-bottom.",
      "criteria": [
        "Easy: the logic reads top-to-bottom. A single pass suffices. Any difficulty present is inherent to the problem, not to the structure.",
        "Moderate: the reader must pause once or twice - hold a small amount of state across a few lines, or re-check an outer condition - but the structure is otherwise linear and the full flow is recoverable by re-reading one or two spots.",
        "Hard: following the code requires actively reconstructing its flow - a stack of nested conditions to track, several unrelated concerns fused into one unit, state held across many lines, or an order that forces jumps instead of top-to-bottom reading. The structural difficulty could be removed without changing what the code does."
      ],
      "target": ["functions", "classes", "methods", "types", "bindings"],
      "handle": {
        "map": [
          "pass",
          "warn",
          {
            "level": "error",
            "message": "Decompose this function: extract readable named steps so the main body reads easily."
          }
        ]
      }
    }
  ]
}
```

Worked examples and failure shapes: REFERENCE.md next to this file.

`jint serve`: the run UI over the store's newest run; it prints its URL. A reading's address there: `<serve url>/runs/<run.id>?rule=<rule>&input=<input>`, with `run.id` and the reading's `input` from `--json`. URL-encode `input`: it contains `#`.

## Fixer messages are decisive

A handle tier's `message` is the instruction the fixing agent executes. Write
it imperative and singular: "Remove this comment." One action, no forks, no
alternatives - a forked message ("remove it, or better, rewrite the function")
gives the agent a choice, and a choice is where fixes die.

Measured: an agent briefed with extra rule taxonomy kept 34 error-tier
comments; an agent briefed only with "follow the fixer messages" reached zero.
The message is the intervention. Everything else is rationalization material.

## Preview the population

Before calibrating, see what the rule will judge. `jint capture` runs the
extraction only - no classifier calls, no cost:

```bash
jint capture <path>                  # every element: grammar, capture, span, name
jint capture <path> --rule <name>    # mark the elements this rule judges
```

A defect in code that no element covers is invisible to every rule. If the
construct you want judged is not an element, the fix is a capture in the
grammar's queries.scm, not a rule: see docs/captures.md and docs/directives.md
(https://github.com/sedulustech/jint/tree/main/docs).

## The calibration ritual

A rule is not promoted into an official domain from one corpus:
single-language calibration overfits that language's naming and structure
conventions.

- Test small on many languages, not big on a couple: a sample of real units
  per language. A language's conventions show in a few units; another hundred
  units of the same language add little.
- Calibrate only on real code: agent-generated code from benchmarks, or
  existing open-source software. Never on fixtures written for the rule - they
  match the criteria by construction and prove nothing. A control is real code
  with ONE mechanical edit that plants the defect (rename one function to another
  casing, give a file another file's body): the good and the edited unit are a
  pair, and the rule must separate every pair. A rule that never fires needs
  this before its silence means anything.
- Document the healthy-max / defective-min gap for each language; thresholds
  must sit inside every measured gap.
- Validate that the rule's claim survives each language's conventions (naming
  style, file/package layout), not only its syntax.
- Read the fire rate on healthy code. A rule that fires on a third of it (measured:
  an error-handling rule at 10-36% across three repositories) is over-firing or
  finding real defects, and only labels say which.
- Label a sample of the readings by hand: reruns show stability, only labels
  show correctness. A rule with no labeled defective example is a hypothesis,
  not a rule.

## Where a rule goes

Rules live in domains, one package each, imported as `jint:rules/<domain>`. A
domain is the property a rule judges (`comments`, `naming`) or a technology
(`typescript`, `react`); a domain may nest subdomains (`comments/typescript`)
that add rules or examples for one technology and never reword the parent's
question - a reworded question is a different rule with its own calibration. A
config that lists a rule name twice fails; replace a rule by spreading it with
`override: true`. Per-rule `include` scopes a rule to the files it is about.

AGENTS.md ("Adding rules to a domain") is the authority for this ritual, including the
precedent (has_filename_mismatch, issue 006: TS test 0.36/0.88, Go test
0.25/0.72). Defer to it; do not restate thresholds here.
