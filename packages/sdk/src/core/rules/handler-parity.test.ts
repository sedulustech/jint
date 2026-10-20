import { describe, expect, test } from "bun:test";
import { validateConfig } from "@jint/sdk";
import { validateCustomRule } from "@jint/sdk";

// Cross-tier parity: the same bad handler shape must be rejected by BOTH tiers - the JSON
// loader (CONFIG_INVALID) and the TS-rule loader (RULE_INVALID). One tier drifting silently
// while the other validates is exactly the bug class this pins (review: handler-taxonomy #1).

const jsonRule = (handle: unknown) => ({
  input: "x",
  rules: [
    {
      name: "r",
      instructions: "i",
      criteria: { true: "t", false: "f" },
      target: "files",
      handle,
    },
  ],
});

const customRule = (handle: unknown) => ({
  name: "r",
  target: "comments",
  classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),
  handle,
});

const BAD_SHAPES: readonly unknown[] = [
  { warn: { greater_than: 0.5 }, map: ["pass", "warn"] }, // both shapes at once (hybrid)
  { map: ["pass", "warn"] }, // score handler, noul question (custom rules are noul-only)
  { warn: { greater_than: 1.5 } }, // warn_at outside (0, 1)
  { warn: { greater_than: 0.9 }, error: { greater_than: 0.5 } }, // unordered on the defect pole
  { warn: { greater_than: 0.3 }, silent_band: [0, 1] }, // band covers the scale
  { warn: { greater_than: 0.3 }, silent_band: [0.2, 0.4] }, // band contains warn_at
  {}, // no tier: a noul handle declares warn, error, or both
];

describe("handler validation parity (JSON tier <-> custom tier)", () => {
  test.each(BAD_SHAPES.map((h) => [JSON.stringify(h), h] as const))(
    "both tiers reject %s",
    (_label, handle) => {
      expect(() => validateConfig(jsonRule(handle), "inline")).toThrow(/rule 'r' handle/);
      expect(() => validateCustomRule(customRule(handle), "f.ts")).toThrow(/handle/);
    },
  );

  test("both tiers accept an error-only handle", () => {
    const handle = { error: { greater_than: 0.6 } };
    expect(() => validateConfig(jsonRule(handle), "inline")).not.toThrow();
    expect(() => validateCustomRule(customRule(handle), "f.ts")).not.toThrow();
  });
});
