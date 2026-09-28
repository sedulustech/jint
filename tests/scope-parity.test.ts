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
      handle: { fires_when: "true", warn_at: 0.3, error_at: 0.7 },
      ...scope,
    },
  ],
});

const tsRule = (scope: Record<string, unknown>) => ({
  name: "r",
  target: "comments",
  classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),
  handle: { fires_when: "true", warn_at: 0.3, error_at: 0.7 },
  ...scope,
});

const BAD_SCOPES: readonly Record<string, unknown>[] = [
  { include: [] }, // empty array
  { exclude: [] },
  { include: ["ok", ""] }, // empty string entry
  { exclude: [42] }, // non-string entry
  { include: ["!tests/**"] }, // negated glob (rejected decision)
  { exclude: ["!src/**"] },
];

describe("scope validation parity (JSON tier <-> TS tier)", () => {
  test.each(BAD_SCOPES.map((s) => [JSON.stringify(s), s] as const))(
    "both tiers reject %s",
    (_label, scope) => {
      // The JSON tier's TypeBox schema pre-rejects TYPE-invalid entries (a number in a string
      // array) with its generic union message; the TS tier has no schema for scopes, so its
      // message is always the field-naming one. The rejection SET is identical on both tiers.
      expect(() => validateConfig(jsonRule(scope), "inline")).toThrow(/invalid config/);
      expect(() => validateTsRule(tsRule(scope), "f.ts")).toThrow(/"r": (include|exclude):/);
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
