---
title: "Use case: always name React effects"
description: "A rule from a team convention: every React effect gets a function named for what it does. What the rule does, why it matters, and the rule."
sidebar:
  label: Always name effects
---

# Use case: always name React effects

`is_effect_named` flags a `useEffect` whose function is anonymous or named for nothing. It ships in
`jint:rules/react/hooks`.

`useEffect(function syncDocumentTitle() {...})` reads as a sentence, and a name that is hard to
write shows the effect does too much. A syntax check cannot tell whether a name says what the body
does, so the rule asks for that judgment.

```ts
import type { RuleSchema } from "jint:sdk";

const is_effect_named: RuleSchema = {
  name: "is_effect_named",
  instructions:
    "Does every effect hook call in this function (useEffect, useLayoutEffect, useInsertionEffect) pass a named function whose name says what the effect does?",
  criteria: {
    true: "The function calls no effect hook, or every effect hook it calls receives a named function (a named function expression or a reference to a named function) whose name states the purpose of the effect: syncDocumentTitle, subscribeToResize, focusFormWhenOpened.",
    false:
      "At least one effect hook receives an anonymous arrow or anonymous function, or a name that states no purpose (effect, onMount, run, doStuff, handleEffect), or a name that names a different job from the one the body does. A name that states a purpose is enough: an effect that does two things is not this defect.",
  },
  target: "functions",
  include: ["**/*.tsx"],
  handle: {
    warn: { less_than: 0.6 },
    error: { less_than: 0.3, message: "Name this effect after what it does." },
  },
};
```
