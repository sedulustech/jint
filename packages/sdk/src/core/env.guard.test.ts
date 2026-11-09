import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ENV_VARS } from "./env.ts";

// Variables the source reads on purpose and the reference leaves out: they are not a user's
// setting. A name added here needs a reason.
const INTERNAL: Record<string, string> = {
  JINT_UI_DIST: "the dev and build location of the built UI",
  JINT_UI_NO_HOLD: "makes `jint serve` return, for tests",
};

const SOURCE_ROOTS = ["../../../cli/src", "../../../sdk/src"];
const NAME = /(?:process\.env\.|["'`])(JINT_[A-Z0-9_]+|OPENAI_API_KEY)(?:["'`]|\b)/g;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith(".d.ts"))
      yield path;
  }
}

test("every environment variable the source reads is in the reference", () => {
  const read = new Set<string>();
  for (const root of SOURCE_ROOTS) {
    for (const file of files(join(import.meta.dir, root))) {
      for (const match of readFileSync(file, "utf8").matchAll(NAME)) read.add(match[1]!);
    }
  }
  // the scan must find what it looks for, or an empty result would pass for a whole registry
  expect(read.has("JINT_API_URL")).toBe(true);
  const known = new Set([...ENV_VARS.map((v) => v.name), ...Object.keys(INTERNAL)]);
  expect([...read].filter((name) => !known.has(name)).sort()).toEqual([]);
});
