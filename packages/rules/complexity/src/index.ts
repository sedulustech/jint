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
  handle: {
    warn: { less_than: 0.45 },
    error: {
      less_than: 0.3,
      message:
        "Split this function by responsibility: one function per reason to change, each named for its one purpose.",
    },
  },
};

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
  target: ["functions", "classes", "methods", "types", "bindings"],
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

export const rules: readonly RuleSchema[] = [is_function_srp, is_cognitively_complex];
