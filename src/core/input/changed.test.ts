import { describe, expect, test } from "bun:test";
import { parseChangedList } from "./changed.ts";

describe("parseChangedList — one flat list, the caller's git output", () => {
  test("bare lines (git diff --name-only shape) pass through, order kept", () => {
    expect(parseChangedList("src/a.ts\ntests/b.spec.ts\n")).toEqual([
      "src/a.ts",
      "tests/b.spec.ts",
    ]);
  });

  test("deduplicated (first occurrence wins); blank lines skipped", () => {
    expect(parseChangedList("a.ts\n\nb.ts\na.ts\n")).toEqual(["a.ts", "b.ts"]);
  });

  test("git-status prefixes are NOT special: a tab is part of no path jint wants — reject -z, keep it simple", () => {
    // jint takes ONE flat list. Status-prefixed output (--name-status) is the caller's to cut:
    // git diff --name-only HEAD~1. A -z (NUL) paste would silently join paths — reject loud.
    expect(() => parseChangedList("a.ts\0b.ts")).toThrow(/NUL-separated/);
  });

  test("empty list -> empty array (lens defined-but-empty; the input backstop fires)", () => {
    expect(parseChangedList("")).toEqual([]);
    expect(parseChangedList("\n\n")).toEqual([]);
  });

  test("absolute paths are legal entries (verbatim identity)", () => {
    expect(parseChangedList("/repo/src/a.ts")).toEqual(["/repo/src/a.ts"]);
  });
});
