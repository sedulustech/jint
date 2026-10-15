/**
 * The grammar-dir seam: user registration, manifest validation (facts + policy), and the loud
 * failures that keep a typo from parsing into silence.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knownLanguages, loadUserGrammars, resetGrammarsForTest } from "./grammars.ts";

/** A scratch grammar dir; `files` are written verbatim under it. */
function scratchDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "jint-grammars-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const MANIFEST = JSON.stringify({ version: "1.2.3", extensions: ["xyz"] });
const SCM = "(function_declaration name: (identifier) @name) @function\n";

function withWasm(files: Record<string, string>): Record<string, string> {
  return { ...files, "probe.wasm": "not a real wasm" };
}

// The grammar scan memoizes per process, and bun runs the suite's files in one process: reset
// BEFORE and after each test so a parallel file's lint run can never satisfy this one.
beforeEach(() => {
  resetGrammarsForTest();
});
afterEach(() => {
  resetGrammarsForTest();
});

describe("loadUserGrammars", () => {
  test("a manifest without a wasm and without an embedded grammar is a setup error", async () => {
    const dir = scratchDir({ "ghost.manifest.json": MANIFEST, "queries.scm": SCM });
    await expect(loadUserGrammars(dir)).rejects.toThrow(/no ghost\.wasm beside the manifest/);
  });

  test("a manifest without queries.scm is a setup error naming the missing extraction half", async () => {
    // shadowing an embedded grammar (no wasm needed) reaches the extraction-half check
    const dir = scratchDir({
      "python.manifest.json": JSON.stringify({ version: "9.9.9", extensions: ["py"] }),
    });
    await expect(loadUserGrammars(dir)).rejects.toThrow(/queries\.scm is missing/);
  });

  test("a manifest with a malformed version or extensions is a setup error", async () => {
    const noVersion = scratchDir({ "probe.manifest.json": JSON.stringify({ extensions: ["x"] }) });
    await expect(loadUserGrammars(noVersion)).rejects.toThrow(/"version"/);
    // the scan memoizes per process: reset before the next directory
    resetGrammarsForTest();
    const noExtensions = scratchDir({ "probe.manifest.json": JSON.stringify({ version: "1" }) });
    await expect(loadUserGrammars(noExtensions)).rejects.toThrow(/"extensions"/);
  });

  test("an unknown policy capture key is rejected by name (a typo must not sit inert)", async () => {
    const dir = scratchDir(
      withWasm({
        "probe.manifest.json": JSON.stringify({
          version: "1.2.3",
          extensions: ["xyz"],
          policy: {
            functoin: {
              opaque: true,
            },
          },
        }),
        "queries.scm": SCM,
      }),
    );
    await expect(loadUserGrammars(dir)).rejects.toThrow(/policy\.functoin names no capture/);
  });

  test("a negative or fractional absorbTail is rejected, a good one registers", async () => {
    const bad = scratchDir(
      withWasm({
        "probe.manifest.json": JSON.stringify({
          version: "1.2.3",
          extensions: ["xyz"],
          policy: { type: { absorbTail: -1 } },
        }),
        "queries.scm": SCM,
      }),
    );
    await expect(loadUserGrammars(bad)).rejects.toThrow(
      /absorbTail must be a non-negative integer/,
    );
    resetGrammarsForTest();
    const good = scratchDir(
      withWasm({
        "probe.manifest.json": JSON.stringify({
          version: "1.2.3",
          extensions: ["xyz"],
          policy: { type: { absorbTail: 3 }, selfNesting: true },
        }),
        "queries.scm": SCM,
      }),
    );
    await loadUserGrammars(good);
    expect(knownLanguages()).toContain("probe");
  });
});
