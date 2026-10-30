/** Error-handling rules: does a failure keep its cause on the way out. */

import type { RuleSchema, NoulRuleSchema } from "@jint/contract";

/**
 * Promoted from the seam-purity probe (tmp/probes/seam-purity.config.json), where it was the
 * densest signal (13 findings on the vendor-adapter corpus); exercised on every self-lint run
 * since, and held up in use.
 */
export const will_error_lose_cause: NoulRuleSchema = {
  name: "will_error_lose_cause",
  instructions: "Does this function's error handling lose information about the original failure?",
  criteria: {
    true: "Error handling loses information: a caught error is swallowed, rethrown without its cause, or replaced by a message that drops the original failure detail.",
    false:
      "Error handling preserves information: causes are chained, messages include the original failure detail, and nothing is swallowed silently.",
  },
  target: "functions",
  handle: { warn: { greater_than: 0.4 }, error: { greater_than: 0.7 } },
};

/** Every rule of this domain, in run order. */
export const rules: readonly RuleSchema[] = Object.freeze([will_error_lose_cause]);
