import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GENERATED_OUTPUTS } from "../scripts/generate-schema.ts";

// Generic freshness e2e: regenerate ONCE, then assert every generated output is byte-identical
// to the committed file. The output list comes from the generator's GENERATED_OUTPUTS export, so
// a new output is covered the moment the generator declares it - no hardcoded path list to fall
// behind. (Absorbs the freshness half of the deleted tests/rules-doc.test.ts.)
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const committed = new Map(
  GENERATED_OUTPUTS.map((rel) => [rel, readFileSync(repoRoot + rel, "utf8")]),
);

describe("generated outputs", () => {
  const run = spawnSync("bun", ["scripts/generate-schema.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  expect(run.status).toBe(0);

  test.each(GENERATED_OUTPUTS)("%s regenerates byte-identical", (rel) => {
    expect(readFileSync(repoRoot + rel, "utf8")).toBe(committed.get(rel));
  });
});
