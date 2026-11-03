/**
 * React hook rules (the `react/hooks` subdomain): how a hook call reads. A project pulls the rules
 * it cares about; none is part of any default.
 */

import type { NoulRuleSchema, RuleSchema } from "@jint/contract";

/**
 * Calibrated on TSX only, the one language React is written in. Seven controls: the four defective
 * (anonymous arrows, generic names, a name for the wrong job) read 0.00-0.04, the three healthy
 * (named function expressions, a named reference, a component with no effect) 0.96-1.00; the
 * thresholds sit inside that gap. On one real React codebase (543 functions, 20 of them with an
 * effect call) all 20 read below the error line and no function without an effect fired. The unit
 * is the function, not the effect call: an effect inside a component is not an element of its own,
 * so a component with several effects gets one reading.
 *
 * A high reading is good. A function with no effect hook reads true, so it never fires.
 */
export const is_effect_named: NoulRuleSchema = {
  name: "is_effect_named",
  instructions:
    "Does every effect hook call in this function (useEffect, useLayoutEffect, useInsertionEffect) pass a named function whose name says what the effect does?",
  criteria: {
    true: "The function calls no effect hook, or every effect hook it calls receives a named function (a named function expression or a reference to a named function) whose name states the purpose of the effect: syncDocumentTitle, subscribeToResize, focusFormWhenOpened.",
    false:
      "At least one effect hook receives an anonymous arrow or anonymous function, or a name that states no purpose (effect, onMount, run, doStuff, handleEffect), or a name that names a different job from the one the body does. A name that states a purpose is enough: an effect that does two things is not this defect.",
  },
  target: "functions",
  // The only language React is written in; a .ts file holds hooks without JSX, but the calibration
  // covered components.
  include: ["**/*.tsx"],
  handle: {
    warn: { less_than: 0.6 },
    error: { less_than: 0.3, message: "Name this effect after what it does." },
  },
};

/** Every rule of this subdomain, in run order. */
export const rules: readonly RuleSchema[] = [is_effect_named];
