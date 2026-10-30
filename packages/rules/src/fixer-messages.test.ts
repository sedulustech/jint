import { describe, expect, it } from "bun:test";
import { allRules } from "@jint/rules";
import type { NoulRuleSchema } from "@jint/contract";

describe("error-tier fixer messages", () => {
  it("will_comment_drift's error tier is decisive: remove, no fork", () => {
    const drift = allRules.find((r) => r.name === "will_comment_drift") as NoulRuleSchema;
    expect(drift).toBeDefined();
    const error = drift.handle.error as { message?: string };
    expect(error.message).toBe("Remove this comment.");
  });
});
