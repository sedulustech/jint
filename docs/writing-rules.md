---
title: Writing rules
description: "How to write a rule the model answers well, and how to check it before you rely on it."
sidebar:
  label: Writing rules
---

# Writing rules

A rule is a question the model answers about one unit. Most failed rules fail on the unit or the
question, not on the model.

## Steps

1. Ask one question about one property. Name the rule for its true side: `has_` for a defect,
   `is_` for a good property.
2. Pick the unit. `jint capture <path> --rule <name>` lists what the rule judges. The model sees
   only that unit, so it must carry the name and the context the question needs. A construct that
   is not an element needs a capture in the grammar: see [captures](captures.md).
3. Write `true` as the exact condition that answers yes, and `false` for no. Make the defect the
   `true` side and list its concrete forms. Set the handle in the defect direction, with one
   imperative message.
4. Scope the rule with `include`. A file with no element for it reports `WALK_FAILED`.
5. Run it on real units and label each reading healthy or defective. The thresholds must sit
   inside the gap between the two. If the readings overlap, do not ship the rule. See
   [calibration](calibration.md).
6. Reword with `jint reclassify` on the units that read wrong. It files each answer beside the
   original in the run UI.
7. Open the run in the UI and read the readings:

<!-- generated:run-address — do not edit. Regenerate with `bun run schema`. -->

`jint serve`: open the run UI on the newest run; it prints its URL. A classification's address there: `<serve url>/runs/<run.id>?rule=<rule>&input=<input>`, with `run.id` and the classification's `input` from `--json`. URL-encode `input`: it contains `#`.
<!-- /generated:run-address -->

## What the model answers well

- **Defects, concretely.** The model leans yes. Phrase the defect first, and let a planted
  control decide. A file-name rule read a mismatched body as fitting (0.97) under "does the name
  fit?", and as a mismatch (0.96) under "does the name promise a different subject?".
- **Yes or no, not a scale.** A three-level score put most of its probability on the middle level.
  Use a score only when the property is graded.
- **0.5 is undecided.** A reading of 0.45 against 0.55 is not a ranking.
- **A refusal means the unit does not fit the question.** Read the request in the run UI. The unit
  usually lacks its name or its context.
- **Meaning, not structure.** Counts, heading levels, nesting and formats belong in a test.
  Markup the grammar does not parse, such as raw HTML, reads as paragraphs.

## Messages

A message is the instruction an agent executes. Write it imperative and singular: "Remove this
comment." One action, no choice. An agent briefed only to follow the messages cleared 34
error-tier comments that an agent briefed with the rule's taxonomy kept.

## Controls

Calibrate on real code, never on fixtures written for the rule: they match the criteria by
construction. A control is a real unit with one mechanical edit that plants the defect. The rule
must separate every pair. A rule with no labeled defective unit is a hypothesis.

Test small on many kinds of unit, not big on one. A rule that fires on a third of healthy code is
over-firing or finding real defects, and only labels say which.

## Where a rule goes

Rules live in domains, one package each, imported as `jint:rules/<domain>`. A domain is a property
(`comments`, `naming`) or a technology (`typescript`, `react`). A subdomain adds rules for one
technology and never rewords the parent's question. A reworded question is a different rule with
its own calibration. Replace a rule by spreading it with `override: true`.
