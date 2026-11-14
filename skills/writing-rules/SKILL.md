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

## Start from the goal

A request for "a rule" often names a goal, and a goal is rarely one property. "Catch unnecessary
tests" is several rules: a test that cannot fail, a test that belongs at another level, a test that
repeats another. The user may not know that.

- Ask what the user is trying to achieve before you write a question.
- List the dimensions the goal contains, one property each, and write one rule per dimension. Two
  properties in one rule is the failure section 1 warns about.
- Say how many rules the goal needs, and which dimension is the most useful, before you write the
  first. Work through them one at a time, each through the steps below.
- A dimension may need a new capture before a rule can judge it (the writing-captures skill), or may
  be a count a test can check without a model.

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
- Name the rule for its true side, so the value reads as the name: `has_` or `lacks_` for a defect
  (high is bad), `is_` for a good property (high is good), `will_` for a defect the unit makes
  likely, such as `will_error_lose_cause`. The handle follows that direction.
- Use `should_` only when the property is where the unit belongs, such as `should_be_e2e`: the
  verdict and the property are the same thing, and the value reads as "0.9 that it should be
  end-to-end". The true side is still the defect. Do not put the fix in any other name: a fix can
  change, such as "delete it" for "move it", and a rule can have several. The handle's message
  carries the fix. Do not coin another prefix.
- The model sees only the unit's own text. A claim about code elsewhere cannot be judged. A
  comment rule sees the definition it belongs to.

## 2. The unit

- Run `jint capture <path> --rule <name>`. It lists, at no cost, the elements the rule judges.
- The unit must carry the name and the context the question needs. A refusal means the unit does
  not fit the question.
- A construct that is not an element needs a capture in the grammar (`jint docs captures`). Read the
  writing-captures skill to add one. Do not stretch a rule over the wrong unit.
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

- **noul** (the default): yes/no. The reading is the model's probability that the answer is `true`,
  the same quantity a language model uses to choose its next word, and it carries meaning: 0.9 is a
  strong lean to yes, 0.1 a strong lean to no, and 0.5 is undecided, where the model could not
  choose. 0.45 against 0.55 is not a ranking. Use noul unless the property is graded.
- **score**: `"kind": "score"`. The ordered `criteria` array is the legend, level 0 to N, and each
  level describes a state. The instructions say what not to score. Use it only when the property is
  graded: a three-level score put most of its probability on the middle level, and the same
  property as a yes/no also sat near 0.5.
- **choice**: named options keyed by label. The tier with the most probability is the verdict. A
  choice can be undecided, which is a signal to recalibrate, not to act on the code (`jint docs
confidence`).
- Never set a noul `greater_than` threshold below 0.5: below the undecided point the rule fires on
  readings that lean no. If the gap between healthy and defective readings only allows a lower
  one, reword the rule until the readings separate; do not lower the threshold.
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

## 6. Scope first

Scoping is running a rule on the narrowest slice of real code that can answer the question in
hand, and widening only once that slice answers it. Each reading is a paid request, and a rule that
does not yet separate healthy from defective units says nothing at the width of a whole codebase.

- Start with one rule, a few units of one kind and one package. `jint capture --rule <name>` lists
  the units for free, and `--dry-run` lists the rules a run would use.
- Narrow by rule (`--rule`), by input (paths, one directory) and by the rule's `include`. Widen one
  of them at a time.
- State the question before a run ("does it fire on real defects?", "does it over-fire on healthy
  code?") and take the smallest sample that settles it. Grow the sample only when the small one is
  ambiguous.
- Widen in steps: a few units, one package, then the whole corpus. At each step read the fire rate
  and the top readings by hand before the next. A rule that fires on a third of healthy code is
  reworded before it runs wider.
- Cover many kinds of unit rather than many units of one kind: a kind's conventions show in a few
  units.

## 7. Show the readings

Start `jint ui serve` before you run, so the run prints its own address, and give that address to the user to review:

<!-- generated:run-address — do not edit. Regenerate with `bun run schema`. -->

`jint ui serve`: serve the run UI, opened on the newest run; it prints its URL. While it is up, a run prints its own page: `report.run.url` in `--json`, and a `ui ->` line on stderr. A classification's address adds `?rule=<rule>&input=<input>` to that page, with the classification's `input` from `--json`. URL-encode `input`: it contains `#`.
<!-- /generated:run-address -->

## Where a rule goes

Rules live in domains, one package each, imported as `jint:rules/<domain>`. A domain is a property
(`comments`, `naming`) or a technology (`typescript`, `react`). A subdomain adds rules for one
technology and never rewords the parent's question: a reworded question is a different rule with
its own calibration. Replace a rule by spreading it with `override: true`.

A rule that no other project would want does not go in a domain. It lives next to what it measures,
in a file named `<subject>.jint.ts` that exports `rules`, as a unit test lives in `<subject>.test.ts`.
Each rule sets its own `include` to the files it reads, so the file says what it covers. The root
config imports it. A rule moves into a domain once other projects, in more than one language, show
the same gap between healthy and defective units.

## Never

- Edit a rule to make a finding pass. A change to a rule is its own item for the user to review.
- Ship a rule with no labeled defective example. It is a hypothesis.

## Feedback

If a step here is wrong, unclear or missing, open an issue at sedulustech/jint
(https://github.com/sedulustech/jint/issues). Say which step, what you did and what happened.
