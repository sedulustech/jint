/** Comment rules: does a comment add what the code cannot say, and will it stay true. */

import type { RuleSchema, NoulRuleSchema } from "@jint/contract";

export const is_comment_narration: NoulRuleSchema = {
  name: "is_comment_narration",
  instructions:
    "Does any comment in this unit merely restate what the code in this unit already says, so that removing it loses nothing a reader could not get from the code itself?",
  criteria: {
    true: "At least one comment merely narrates the code: it restates what the code already says - translating statements into prose, echoing the identifier's own name, or annotating the obvious (an increment, an assignment, a return) - so removing it loses nothing a reader could not get from the code itself.",
    false:
      "Every comment here says something the code cannot: it states why the code exists, records a constraint, or flags a non-obvious trap.",
  },
  target: "comments",
  handle: {
    warn: { greater_than: 0.6 },
    error: { greater_than: 0.7, message: "Remove this comment." },
  },
};

export const is_comment_patching_readability: NoulRuleSchema = {
  name: "is_comment_patching_readability",
  instructions:
    "Does any comment here patch code that should read itself, instead of the code being made readable?",
  criteria: {
    true: "At least one comment exists to explain code that should read itself - patching dense expressions, tangled control flow, or misleading names with prose instead of the code being made readable. This is a code smell: the fix is rewriting the code, and the comment makes the confusion livable so the rewrite never happens.",
    false:
      "Every comment earns its place by carrying what code cannot: rationale, constraints, or external contracts. Comments that add what code cannot carry are not readability patches, even when the surrounding code is also hard to read.",
  },
  target: "comments",
  handle: { warn: { greater_than: 0.4 }, error: { greater_than: 0.55 } },
};

export const will_comment_drift: NoulRuleSchema = {
  name: "will_comment_drift",
  instructions:
    "Does any comment pin specific artifacts by name such that renaming or removing them silently invalidates the comment?",
  criteria: {
    true: "At least one comment pins specific artifacts by name - files, functions, parameters, constants, types, paths - such that renaming or removing that artifact silently invalidates the comment while the code keeps working. The claim is coupling between the comment's wording and identifiers, not comments already wrong today.",
    false:
      "No comment here is coupled to specific artifacts by name: every comment describes behavior, rationale, or constraints without pinning identifiers, so renaming or removing code can never silently invalidate it.",
  },
  target: "comments",
  // Anchored above the healthy distribution on purpose: comments that pin
  // artifact names are common in healthy code, so the bar sits at strong
  // assertions only.
  handle: {
    warn: { greater_than: 0.55 },
    error: {
      greater_than: 0.7,
      message: "Remove this comment.",
    },
  },
};

/** Every rule of this domain, in run order. */
export const rules: readonly RuleSchema[] = Object.freeze([
  is_comment_narration,
  is_comment_patching_readability,
  will_comment_drift,
]);
