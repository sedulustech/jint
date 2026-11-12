/** Error-handling rules: does a failure keep its cause on the way out. */

import type { RuleSchema, NoulRuleSchema } from "@jint/contract";

export const will_error_lose_cause: NoulRuleSchema = {
  name: "will_error_lose_cause",
  instructions: "Does this function's error handling lose information about the original failure?",
  criteria: {
    true: "Error handling loses information: a caught error is swallowed, rethrown without its cause, or replaced by a message that drops the original failure detail.",
    false:
      "Error handling preserves information: causes are chained, messages include the original failure detail, and nothing is swallowed silently.",
  },
  target: "functions",
  handle: {
    warn: { greater_than: 0.4 },
    error: {
      greater_than: 0.7,
      message:
        "Chain the cause into the error you throw, or handle it here. Never swallow it or keep only its message.",
    },
  },
};

export const rules: readonly RuleSchema[] = [will_error_lose_cause];
