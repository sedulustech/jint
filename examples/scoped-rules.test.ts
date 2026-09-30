import { describe, expect, test } from "bun:test";
import { loadConfig } from "@jint/sdk";

// The shipped scoping example (issue 008) must stay a valid config: loads, one rule, scoped out
// of tests/fixtures via exclude.
describe("scoped-rules.config.json (example)", () => {
  test("loads with the documented tests/fixture exclusion", async () => {
    const config = await loadConfig(
      new URL("./scoped-rules.config.json", import.meta.url).pathname,
    );
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]!.exclude).toEqual(["tests/**", "**/*.spec.ts", "**/fixtures/**"]);
  });
});
