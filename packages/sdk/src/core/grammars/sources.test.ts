/**
 * The source record: every embedded grammar names the upstream release its wasm came from, and that
 * upstream is an official tree-sitter org. A grammar from anywhere else needs a decision, not a
 * quiet addition.
 */

import { describe, expect, test } from "bun:test";
import sources from "./embedded/sources.json" with { type: "json" };
import { EMBEDDED } from "./grammars.ts";

const ORGS = ["tree-sitter", "tree-sitter-grammars"];

describe("embedded grammar sources", () => {
  test("every embedded grammar has a source and none is left over", () => {
    expect(Object.keys(sources).sort()).toEqual(Object.keys(EMBEDDED).sort());
  });

  test.each(Object.entries(sources))("%s comes from an official tree-sitter org", (_id, source) => {
    const [org, repo] = source.repo.split("/");
    expect(ORGS).toContain(org!);
    expect(repo).toMatch(/^tree-sitter-[a-z]+$/);
    expect(source.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
