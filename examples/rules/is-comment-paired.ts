/**
 * Example TS rule: header-comment pairing (tmp/designs/rules-context/01) — a comment is judged
 * TOGETHER WITH the code it annotates, via the element's parent link. Not in the default set: TS
 * rules are opted into per project via the config's tsRules key.
 *
 * Use it with a config:
 *
 * { "input": "src/", "rules": [], "tsRules": ["examples/rules/is-comment-paired.ts"] }
 *
 * Run: jint --config <that-config> --json
 */

/// <reference path="../../src/core/tsrules/sdk.d.ts" />

import { defineConfig } from "jint:sdk";

export default defineConfig({
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
          // dumped (JEV_DEBUG_REQUEST), so observability is the guarantee, not restriction.
          state: {
            comment: self.source,
            annotated: self.parent?.source ?? "(no annotated code - the comment stands alone)",
            position: ctx.targets.findIndex((t) => t.id === self.id),
          },
        };
      },
      // criteria.true is the GOOD case, so the defect pole is "false": thresholds sit on the
      // inaccuracy probability — above 0.6 warns, above 0.85 errors.
      handle: { fires_when: "false", warn_at: 0.6, error_at: 0.85 },
    },
  ],
});
