---
name: jint-author
description: >
  Author and calibrate jint rules for code or prose: criteria, handles, fixer messages, and
  the calibration ritual. Use when writing, rewording or checking a rule.
  Triggers: rule calibration, jint rules.
---

# jint - author and calibrate rules

A rule is a question the model answers about one unit. Read these first, with `jint docs <name>`:

- `writing-rules`: the steps, what the model answers well, controls, where a rule goes.
- `what-are-rules`: the shape of a rule. `reference/config`: every field.
- `targets` and `captures`: what a rule can judge. `calibration`: thresholds.

## Do

1. Write one yes/no question about one property. Name the rule for its true side: `has_` for a
   defect, `is_` for a good property.
2. Check the unit with `jint capture <path> --rule <name>`. It must carry the name and context the
   question needs. If the construct is not an element, add a capture to the grammar.
3. Make `true` the defect and list its concrete forms. Set the handle in the defect direction, with
   one imperative message.
4. Scope the rule with `include`.
5. Run it on real units: `jint run <paths> --config <config> --json`. Label each reading healthy
   or defective. The thresholds must sit inside the gap.
6. Reword on the units that read wrong: `jint reclassify <run.id> <input> --rule <name>`. See
   `writing-rules` for sending changed instructions.
7. Print the address of the run for the user: `jint docs writing-rules` ends with its shape.

## Do not

- Ask the model about structure, counts, heading levels or formats. Write a test.
- Stretch a rule over the wrong unit. A refusal means the unit does not fit the question.
- Calibrate on fixtures written for the rule. Plant the defect in a real unit with one edit.
- Ship a rule whose healthy and defective readings overlap.
- Edit a rule to make a finding pass (see jint-follow).
