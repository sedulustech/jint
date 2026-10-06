import { describe, expect, test } from "bun:test";
import { SetupError } from "../types.ts";
import { parsePathsList } from "./paths.ts";

/** The thrown SetupError's code, for assertions that pin the taxonomy (not just the prose). */
async function errorCode(run: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await run();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(SetupError);
    return (thrown as SetupError).code;
  }
  throw new Error("expected the run to throw");
}

describe("parsePathsList — one flat list, the caller's git output", () => {
  test("bare lines (git diff --name-only shape) pass through, order kept", () => {
    expect(parsePathsList("src/a.ts\ntests/b.spec.ts\n")).toEqual(["src/a.ts", "tests/b.spec.ts"]);
  });

  test("deduplicated (first occurrence wins); blank lines skipped", () => {
    expect(parsePathsList("a.ts\n\nb.ts\na.ts\n")).toEqual(["a.ts", "b.ts"]);
  });

  test("absolute paths are legal entries (verbatim identity)", () => {
    expect(parsePathsList("/repo/src/a.ts")).toEqual(["/repo/src/a.ts"]);
  });

  test("empty list -> empty array (defined-but-empty; the input backstop fires)", () => {
    expect(parsePathsList("")).toEqual([]);
    expect(parsePathsList("\n\n")).toEqual([]);
  });

  test.each([
    ["CRLF line endings are stripped", "a.ts\r\nb.ts\r\n", ["a.ts", "b.ts"]],
    [
      "a `..` segment escapes the input dir: rejected, entry named",
      "../outside.ts",
      /escapes the input dir.*\.\.\/outside\.ts/,
    ],
    ["a `..` mid-path is the same rejection", "src/../../etc/passwd", /escapes the input dir/],
    ["a trailing / names a directory: rejected, entry named", "src/", /names a directory.*"src\/"/],
  ] as ReadonlyArray<[string, string, RegExp | string[]]>)("%s", (_name, text, expected) => {
    if (Array.isArray(expected)) {
      expect(parsePathsList(text)).toEqual(expected);
    } else {
      expect(() => parsePathsList(text)).toThrow(expected as RegExp);
    }
  });

  test("entry rejections carry LIST_ENTRY_INVALID (the NUL/binary rejection is the reader's)", async () => {
    expect(await errorCode(() => parsePathsList("src/"))).toBe("LIST_ENTRY_INVALID");
    expect(await errorCode(() => parsePathsList("../outside.ts"))).toBe("LIST_ENTRY_INVALID");
  });
});
