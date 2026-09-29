import { describe, expect, test } from "bun:test";
import { validateConfig } from "../src/config/load.ts";
import { validateTsRule } from "../src/core/tsrules/sdk.ts";

// Cross-tier parity for per-rule scoping (issue 008): the same bad scope shapes must be rejected
// by BOTH tiers - the JSON loader (CONFIG_INVALID) and the TS-rule loader (RULE_INVALID) - with
// the same field-naming messages. Mirrors the handler-parity test.

const jsonRule = (scope: Record<string, unknown>) => ({
  input: "x",
  rules: [
    {
      name: "r",
      criteria: { true: "t", false: "f" },
      target: "files",
      handle: { warn: { greater_than: 0.3 }, error: { greater_than: 0.7 } },
      ...scope,
    },
  ],
});

const tsRule = (scope: Record<string, unknown>) => ({
  name: "r",
  target: "comments",
  classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),
  handle: { warn: { greater_than: 0.3 }, error: { greater_than: 0.7 } },
  ...scope,
});

// Shapes the shared checker rejects on BOTH tiers; the field-naming message is pinned below.
const CHECKER_SCOPES: readonly Record<string, unknown>[] = [
  { include: [] }, // empty array
  { exclude: [] },
  { include: ["pass", ""] }, // empty string entry
  { include: ["!tests/**"] }, // negated glob (rejected decision)
  { exclude: ["!src/**"] },
];
// Shape-rejected only by the JSON tier's TypeBox schema (the TS tier reaches the checker).
const SCHEMA_SCOPES: readonly Record<string, unknown>[] = [{ exclude: [42] }];

describe("scope validation parity (JSON tier <-> TS tier)", () => {
  // Review 396888e finding 5: the rejection SET alone could stay green if the JSON tier started
  // rejecting a shape via the schema union for an unrelated reason — pin the message content too.
  test.each(CHECKER_SCOPES.map((s) => [JSON.stringify(s), s] as const))(
    "both tiers reject %s naming the field",
    (_label, scope) => {
      const field = "include" in scope ? "include" : "exclude";
      expect(() => validateConfig(jsonRule(scope), "inline")).toThrow(
        new RegExp(`invalid config inline: rule 'r' ${field}:`),
      );
      expect(() => validateTsRule(tsRule(scope), "f.ts")).toThrow(new RegExp(`"r": ${field}:`));
    },
  );

  test.each(SCHEMA_SCOPES.map((s) => [JSON.stringify(s), s] as const))(
    "JSON schema rejects %s (generic union message, pinned); TS checker names the field",
    (_label, scope) => {
      // The schema's generic union message is PINNED: if it ever grows field-naming, make the
      // checker-rejected assertion above cover this shape instead.
      expect(() => validateConfig(jsonRule(scope), "inline")).toThrow(
        "invalid config inline: /rules/0 Expected union value",
      );
      expect(() => validateTsRule(tsRule(scope), "f.ts")).toThrow(/"r": exclude:/);
    },
  );

  test("both tiers accept the valid shapes", () => {
    for (const scope of [
      { include: ["src/**"] },
      { exclude: ["tests/**"] },
      { include: ["src/**"], exclude: ["src/generated/**"] },
    ]) {
      expect(() => validateConfig(jsonRule(scope), "inline")).not.toThrow();
      expect(() => validateTsRule(tsRule(scope), "f.ts")).not.toThrow();
    }
  });
});
