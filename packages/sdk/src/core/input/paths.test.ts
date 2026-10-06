import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { SetupError } from "../types.ts";
import { parsePathsList, readPathsSource } from "./paths.ts";

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
    ["NUL-separated (git -z) input is not a list: rejected loud", "a.ts\0b.ts", /NUL-separated/],
  ] as ReadonlyArray<[string, string, RegExp | string[]]>)("%s", (_name, text, expected) => {
    if (Array.isArray(expected)) {
      expect(parsePathsList(text)).toEqual(expected);
    } else {
      expect(() => parsePathsList(text)).toThrow(expected as RegExp);
    }
  });

  test("the malformed classes have DISTINCT typed codes", async () => {
    expect(await errorCode(() => parsePathsList("a.ts\0b.ts"))).toBe("LIST_UNREADABLE");
    expect(await errorCode(() => parsePathsList("src/"))).toBe("LIST_ENTRY_INVALID");
    expect(await errorCode(() => parsePathsList("../outside.ts"))).toBe("LIST_ENTRY_INVALID");
  });
});

describe("readPathsSource — the declared read is text, or it fails loud", () => {
  test("binary bytes (invalid UTF-8) are LIST_UNREADABLE, on the file ingestion path", async () => {
    const path = `tmp/paths-binary-${Date.now()}.bin`;
    await writeFile(path, new Uint8Array([0x61, 0x2e, 0x74, 0x73, 0xff, 0xfe]));
    expect(await errorCode(() => readPathsSource(path))).toBe("LIST_UNREADABLE");
  });

  test("a missing list file stays ENTRYPOINT_NOT_FOUND (the remedy names the pipe)", async () => {
    expect(await errorCode(() => readPathsSource("tmp/definitely-not-here.list"))).toBe(
      "ENTRYPOINT_NOT_FOUND",
    );
  });
});
