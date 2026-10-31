/**
 * Complexity rules: how hard the code's own structure makes it to read, and whether a unit serves
 * one purpose.
 */

import type { RuleSchema, NoulRuleSchema, ScoreRuleSchema } from "@jint/contract";

export const is_function_srp: NoulRuleSchema = {
  name: "is_function_srp",
  instructions:
    "Does this unit serve a single cohesive responsibility, every step serving one stated purpose?",
  criteria: {
    true: "The unit performs one cohesive responsibility: all its steps serve a single purpose its name and docblock state.",
    false:
      "There is more than one reason for the unit to change: it mixes business logic, data validation, and side effects.",
  },
  target: "functions",
  // Defect pole "false" (a unit serving several purposes). Calibrated under the per-rule
  // question (issue 001): the whole-project healthy median is P(good) 0.54 (P(bad) 0.46) and
  // the low tail - dominated by test callbacks, issue 008 - starts near P(bad) 0.55, so
  // warn_at 0.55 keeps roughly the bottom 8% in warn; nothing anchors error_at 0.7 yet below
  // a clearly broken unit.
  handle: { warn: { less_than: 0.45 }, error: { less_than: 0.3 } },
};

// provisional: first score rule — scored rubric via the provider score primitive; unanchored until
// the self-lint corpus has score readings
export const is_cognitively_complex: ScoreRuleSchema = {
  name: "is_cognitively_complex",
  kind: "score",
  instructions:
    "How much EFFORT does a reader need to follow this code's logic - effort caused by structure the author chose, not by the problem itself? Ignore length alone: a long linear unit with one job reads as easy. Ignore inherent complexity: cases the data or the domain genuinely force are not this failure. Judge how hard the code's own structure makes it to read top-to-bottom.",
  criteria: [
    "Easy: the logic reads top-to-bottom. A single pass suffices. Any difficulty present is inherent to the problem, not to the structure.",
    "Moderate: the reader must pause once or twice - hold a small amount of state across a few lines, or re-check an outer condition - but the structure is otherwise linear and the full flow is recoverable by re-reading one or two spots.",
    "Hard: following the code requires actively reconstructing its flow - a stack of nested conditions to track, several unrelated concerns fused into one unit, state held across many lines, or an order that forces jumps instead of top-to-bottom reading. The structural difficulty could be removed without changing what the code does.",
  ],
  // Explicit union, not the definitions shorthand - same measured set, pinned identical by the defaults-parity test.
  target: ["functions", "classes", "methods", "types", "bindings"],
  // Calibrated 2026-09-29 (two-language: app/src + cobra, healthy/defective fixtures):
  // scores are bounded 0..2; error at round>=2 (>=1.5) sits between cobra healthy-max 1.46
  // and defective stacked fixtures 1.95/1.97; warn at round>=1 (>=0.5) warns 5-13% of healthy.
  handle: {
    map: [
      "pass",
      "warn",
      {
        level: "error",
        message:
          "Decompose this function: extract readable named steps so the main body reads easily.",
      },
    ],
  },
};

/** Every rule of this domain, in run order. */
export const rules: readonly RuleSchema[] = Object.freeze([
  is_function_srp,
  is_cognitively_complex,
]);
