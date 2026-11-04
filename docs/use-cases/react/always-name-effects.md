---
title: "Use case: always name React effects"
description: "Build and calibrate a rule from a team convention: effects named for what they do. The question, the controls, the readings, and the limits of the unit."
sidebar:
  label: Always name effects
---

# Use case: always name React effects

A convention a syntax check cannot enforce: every `useEffect` gets a function named for what the
effect does. `useEffect(function syncDocumentTitle() {...})` reads better than an anonymous arrow,
and a name that cannot be written is a sign the effect does too much. Whether a name says what the
body does is a judgment, so it is a rule. The result ships as `is_effect_named` in
`jint:rules/react/hooks`.

```ts
import { is_effect_named } from "jint:rules/react/hooks";

export default { rules: { use: [is_effect_named] } };
```

## The question

The rule asks one thing: does every effect hook call in this function pass a named function whose
name says what the effect does? The criteria pin both answers.

- **Yes:** the function calls no effect hook, or every effect hook gets a named function, or a
  reference to one, whose name states the purpose (`syncDocumentTitle`, `subscribeToResize`).
- **No:** an effect gets an anonymous arrow, a name that states no purpose (`effect`, `onMount`),
  or a name for a different job than the body does. An effect that does two things is not this
  defect: the rule judges the name, not the design.

A function with no effect hook reads yes, so it never fires. A high reading is good, so the handle
warns below 0.6 and errors below 0.3.

## The controls

A control is a small file whose right answer you know. Seven cover the question:

| control                                            | reading |
| -------------------------------------------------- | ------- |
| named function expressions                         | 1.00    |
| a named function passed by reference               | 1.00    |
| a component with no effect                         | 1.00    |
| two jobs in one name (`loadDashboardAndTrackView`) | 0.96    |
| anonymous arrows                                   | 0.00    |
| generic names (`effect`, `onMount`)                | 0.00    |
| a name for the wrong job (`fetchUser` on a resize) | 0.04    |

The defective controls read at most 0.04 and the healthy ones at least 0.96, and the thresholds
sit inside that gap. The two-jobs control is deliberate: the rule reads it as named well, because
the name states a purpose.

## A real codebase

Controls prove the question separates cases you wrote. A real codebase shows whether it fires where
you mean. On one React codebase's `components` directory, 543 functions were measured and 20 of
them call an effect hook. All 20 read below 0.3, and no function without an effect fired. That
codebase has 75 effect calls and none passes a named function expression, so the rule fires on
every component that has one.
If your convention is that effects are named, that is the rule working.

## What to know before you use it

- **The unit is the function.** An effect call inside a component is not an element of its own, so
  a component with three effects gets one reading. One named effect and two anonymous ones read as
  a single middle number.
- **TSX only.** The rule's own `include` is `**/*.tsx`, the files the calibration covered.
- **The path stays out.** A rule sees only the source unless it sets `includePath`. This rule does
  not, so the same component reads the same wherever the file sits.

To change what the rule judges, copy it into your config and edit the question, as
[Calibration](../../calibration.md) describes.
