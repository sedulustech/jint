/**
 * The json grammar: it routes .json and .jsonc files, and captures comments only. Data has no
 * definitions, so a `files` rule is how a JSON file gets judged.
 */

import { describe, expect, test } from "bun:test";
import { EMBEDDED, languageOf } from "./grammars.ts";
import { decompose } from "./walk.ts";

describe("decompose - json", () => {
  test("routes .json and .jsonc", () => {
    expect(languageOf(EMBEDDED, "package.json")).toBe("json");
    expect(languageOf(EMBEDDED, "tsconfig.jsonc")).toBe("json");
  });

  test("captures a comment and no definitions", async () => {
    const inv = await decompose('// a note\n{ "a": 1, "b": [true, null] }\n', "json");
    expect(inv.definitions).toHaveLength(0);
    expect(inv.comments.map((c) => c.content)).toEqual(["// a note"]);
  });

  test("a plain object parses to zero elements", async () => {
    const inv = await decompose('{ "a": 1 }\n', "json");
    expect([...inv.definitions, ...inv.comments, ...inv.imports]).toHaveLength(0);
  });
});
