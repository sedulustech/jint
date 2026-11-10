---
name: writing-rules
description: >
  Write and calibrate jint rules for code or prose: the question, criteria, handle, fixer
  message, and the check that the rule separates good units from bad. Use when writing,
  rewording or checking a rule.
  Triggers: write a rule, rule calibration, jint rules.
---

# Writing jint rules

A rule is a question the model answers about one unit. The model is a classifier: it returns
probabilities and no explanations. Most failed rules fail on the unit or the question, not on
the model. `jint docs` lists the reference pages: `what-are-rules`, `targets`, `captures`,
`calibration`, `reference/config`.

## 1. The question

- Ask one yes/no question about one property. Two properties is two rules: one answer cannot say
  which failed.
- Define the measured word inside the instruction. "Informative", "complete" and "consistent"
  mean different things to different readers, so the instruction says what the property is
  ("Does the title name the page's subject without needing the site's name around it?"), and
  the criteria list its concrete forms. A question that relies on the word alone measures the
  model's own idea of it.
- Do not state the element kind. The compiler prepends it ("This unit is a function
  definition."). Changing the instructions later recalibrates the rule.
- Name the rule for its true side, so the value reads as the name: `has_` for a defect (high is
  bad), `is_` for a good property (high is good). The handle follows that direction.
- The model sees only the unit's own text. A claim about code elsewhere cannot be judged. A
  comment rule sees the definition it belongs to.

## 2. The unit

- Run `jint capture <path> --rule <name>`. It lists, at no cost, the elements the rule judges.
- The unit must carry the name and the context the question needs. A refusal means the unit does
  not fit the question.
- A construct that is not an element needs a capture in the grammar (`jint docs captures`). Do not
  stretch a rule over the wrong unit.
- Scope the rule with `include`. A file with no element for it reports `WALK_FAILED`. Set
  `includePath: true` only for a rule whose claim needs the file path.

## 3. The criteria

- `true` names the exact observable condition for yes. `false` does the same for no. Both sides
  are exhaustive.
- Make the defect the `true` side and list its concrete forms. The model leans yes, and positive
  phrasing hides defects: a file-name rule read a body for another subject as fitting (0.97)
  under "does the name fit?", and as a mismatch (0.96) under "does the name promise a different
  subject?".
- A shape that fails: `false: "Naming is consistent."` The `false` side is generic, the claim spans
  elements the model cannot see, and "drift" invites narrating quality instead of checking a
  condition. The fix is never thresholds: rewrite until the criteria name an observable condition.
- Ask about meaning, not structure. Counts, heading levels, nesting and formats belong in a test.
  Markup the grammar does not parse, such as raw HTML, reads as paragraphs.

## 4. The kind

- **noul** (the default): yes/no. The reading is the probability of `true`. Use it unless the
  property is graded. 0.5 is undecided, so 0.45 against 0.55 is not a ranking.
- **score**: `"kind": "score"`. The ordered `criteria` array is the legend, level 0 to N, and each
  level describes a state. The instructions say what not to score. Use it only when the property is
  graded: a three-level score put most of its probability on the middle level, and the same
  property as a yes/no also sat near 0.5.
- **choice**: named options keyed by label. The tier with the most probability is the verdict. A
  choice can be undecided, which is a signal to recalibrate, not to act on the code (`jint docs
confidence`).
- The handle follows the kind: noul takes `warn` and `error` thresholds, score takes a `map` with
  one level per criteria entry, choice takes one tier per option. Every field is in
  `jint docs reference/config`.
- Write one imperative, singular fixer message per tier: "Remove this comment." One action, no
  fork. An agent briefed only to follow the messages reached zero error-tier comments, and one
  briefed with the rule's taxonomy kept 34.

## 5. Calibrate

1. Run on real units: `jint run <paths> --config <config> --json`.
2. Label each reading healthy or defective by hand. Reruns show stability, only labels show
   correctness.
3. Set the thresholds inside the gap: the healthy minimum against the defective maximum. If they
   overlap, do not ship the rule.
4. Reword on the units that read wrong: `jint reclassify <run.id> <input> --rule <name>`. Send
   only what changed (`jint docs reference/cli`). Test the rewording on units that are not in the
   sample.
5. Read the fire rate on healthy code. A rule that fires on a third of it over-fires or finds real
   defects, and only labels say which.
6. Aim for orthogonal rules. Merge or reword two rules that ask nearly the same question.

Calibrate on real code only. A fixture written for the rule matches its criteria by construction
and proves nothing. A control is a real unit with one mechanical edit that plants the defect, and
the rule must separate every pair. Test small on many kinds of unit, not big on one: a language's
conventions show in a few units.

## 6. Show the readings

Start `jint serve` before you run, so the run prints its own address, and give that address to the user to review:

<!-- generated:run-address — do not edit. Regenerate with `bun run schema`. -->

`jint serve`: open the run UI on the newest run; it prints its URL. While it is up, a run prints its own page: `report.run.url` in `--json`, and a `ui ->` line on stderr. A classification's address adds `?rule=<rule>&input=<input>` to that page, with the classification's `input` from `--json`. URL-encode `input`: it contains `#`.
<!-- /generated:run-address -->

## Where a rule goes

Rules live in domains, one package each, imported as `jint:rules/<domain>`. A domain is a property
(`comments`, `naming`) or a technology (`typescript`, `react`). A subdomain adds rules for one
technology and never rewords the parent's question: a reworded question is a different rule with
its own calibration. Replace a rule by spreading it with `override: true`.

## Never

- Edit a rule to make a finding pass. A change to a rule is its own item for the user to review.
- Ship a rule with no labeled defective example. It is a hypothesis.

## Feedback

If a step here is wrong, unclear or missing, open an issue at sedulustech/jint
(https://github.com/sedulustech/jint/issues). Say which step, what you did and what happened.
