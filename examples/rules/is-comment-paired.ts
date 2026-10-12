/**
 * Example inline custom rule: header-comment pairing (tmp/designs/rules-context/01) — a comment is
 * judged TOGETHER WITH the code it annotates, via the element's parent link. Not in the default
 * set: custom rules are authored INLINE in a TS config's rules array, next to the defaults they
 * compose with.
 *
 * This file is a full jint.config.ts: load it with `jint --config
 * examples/rules/is-comment-paired.ts`.
 */

/// <reference path="../../packages/sdk/src/core/rules/custom/sdk.d.ts" />

import { defineConfig } from "jint:sdk";

export default defineConfig({
  input: "examples/rules/fixtures/paired.py",
  apiKey: "unused",
  rules: [
    {
      name: "is_comment_paired_with_code",
      target: "comments",
      classify(self, ctx) {
        return {
          instructions:
            "This unit is a comment. Given the code it annotates, does the comment accurately describe what that code does?",
          criteria: {
            true: "the comment accurately describes the behavior of the annotated code",
            false: "the comment is narration, drifts from the code, or contradicts it",
          },
          // State is composed freely — the pairing IS the state. Every byte sent to the model is
          // dumped (always-on recording), so observability is the guarantee, not restriction.
          state: {
            comment: self.source,
            annotated: self.parent?.source ?? "(no annotated code - the comment stands alone)",
            position: ctx.targets.findIndex((t) => t.id === self.id),
          },
        };
      },
      // criteria.true is the GOOD case, so the defect direction is LOW accuracy — below 0.4
      // warns, below 0.15 errors.
      handle: { warn: { less_than: 0.4 }, error: { less_than: 0.15 } },
    },
  ],
});
