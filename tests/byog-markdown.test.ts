import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, mockDecisionsWire } from "./helpers/cli.ts";
import { expectContract } from "./helpers/contract.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// BYOG end-to-end: a USER grammar dir walks a real file through the seam (docs/byog.md) to
// elements to a qualified-capture-address rule. The registration mechanics are unit-tested
// (packages/sdk/src/core/grammars/grammars.test.ts); this file proves the seam OBSERVABLY, over the
// mock provider wire, by the house e2e pattern (custom-rules-e2e.test.ts).
//
// THE SHADOW PATH (no wasm committed): tests/fixtures/grammars/markdown/ is named for the embedded
// id "markdown" and holds queries.scm + extensions.json WITHOUT a wasm - so it shadows the embedded
// grammar's EXTRACTION (the embedded wasm still parses). Its toy .scm INVERTS the embedded mapping
// (assigns @section to paragraph nodes), so the measured spans prove WHICH .scm governed extraction.

const GRAMMARS_DIR = join(import.meta.dir, "fixtures", "grammars");
const DIR = scratchDir("jint-byog-e2e");

// The input: two headings, three paragraphs. Under the EMBEDDED .scm, markdown:section resolves the
// heading sections (L1-L10 and L5-L10) and markdown:paragraph the three prose runs. Under the SHADOW
// .scm the mapping inverts: markdown:section resolves the three PROSE runs, and markdown:paragraph
// (which the shadow never emits) resolves nothing.
const FIXTURE = [
  "# Title",
  "",
  "first paragraph body",
  "",
  "## Sub",
  "",
  "second paragraph body",
  "",
  "third paragraph body",
  "",
].join("\n");

const provider = startMockDecisions();
const WIRE = mockDecisionsWire(provider.baseUrl);
afterAll(() => {
  provider.stop();
  rmScratchTree(DIR);
});

/** A scratch run dir holding the .md input and a JSON config with the given rules. */
function setup(name: string, rules: unknown[]): string {
  const dir = join(DIR, name);
  rmScratchTree(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "doc.md"), FIXTURE);
  writeFileSync(
    join(dir, "jint.config.json"),
    JSON.stringify({ input: "doc.md", apiKey: "test-key", rules: { use: rules } }, null, 2),
  );
  return dir;
}

const noulRule = (name: string, target: string) => ({
  name,
  target,
  instructions: "Judge the unit.",
  criteria: { true: "t", false: "f" },
  handle: { warn: { greater_than: 0.5 } },
});

/** Spans of one rule's measurements, sorted by start byte - the extraction fingerprint. */
function spansOf(report: Record<string, any>, rule: string): string[] {
  return (report.measurements ?? [])
    .filter((m: any) => m.rule === rule)
    .map((m: any) => `L${m.element.span.start.line}-${m.element.span.end.line}`)
    .sort();
}

describe("byog: the user-grammar seam end-to-end", () => {
  test("a shadow dir governs extraction of a real file through a qualified-address rule", async () => {
    const dir = setup("shadow", [noulRule("probe_shadow_section", "markdown:section")]);
    const r = await runCli(["run", "--config", "jint.config.json", "--json"], {
      cwd: dir,
      env: { ...WIRE, JINT_GRAMMAR_DIR: GRAMMARS_DIR },
    });
    const report = expectContract(r, { exit: 0, stdout: "json" });
    // The shadow .scm assigns @section to {paragraph}: the three measured elements are the three
    // PROSE runs - NOT the two heading sections the embedded .scm would produce (L1-L10, L5-L10).
    const spans = spansOf(report, "probe_shadow_section");
    expect(spans).toEqual(["L3-4", "L7-8", "L9-10"]);
    // Every measured capture is the shadow's section - the qualified address resolved through it
    // (an element the embedded .scm would NOT produce at these spans).
    for (const m of report.measurements) {
      expect(m.element.kind).toBe("section");
    }
    // The wire state carries the shadow's element content verbatim: the prose runs, not the
    // headings or their bodies - the strongest single proof the shadow .scm, not the embedded one,
    // materialized extraction.
    const sources = provider.requests
      .filter((req) => req.questions.length === 1)
      .map((req) => req.state.source)
      .sort();
    expect(sources).toEqual([
      "first paragraph body\n",
      "second paragraph body\n",
      "third paragraph body\n",
    ]);
  });

  test("the embedded mapping is the contrast: without the shadow dir the same file yields its headings", async () => {
    const dir = setup("embedded", [noulRule("probe_embedded_section", "markdown:section")]);
    const empty = scratchDir("jint-byog-empty");
    try {
      const r = await runCli(["run", "--config", "jint.config.json", "--json"], {
        cwd: dir,
        env: { ...WIRE, JINT_GRAMMAR_DIR: empty },
      });
      const report = expectContract(r, { exit: 0, stdout: "json" });
      // The embedded .scm resolves the heading sections - a DIFFERENT extraction of the same bytes,
      // which is exactly what makes the shadow test above a proof rather than a coincidence.
      expect(spansOf(report, "probe_embedded_section")).toEqual(["L1-10", "L5-10"]);
    } finally {
      rmScratchTree(empty);
    }
  });

  test("a capture only the EMBEDDED .scm emits is a loud setup failure under a shadow without it", async () => {
    const dir = setup("not-emitted", [noulRule("probe_missing", "markdown:paragraph")]);
    const r = await runCli(["run", "--config", "jint.config.json", "--json"], {
      cwd: dir,
      env: { ...WIRE, JINT_GRAMMAR_DIR: GRAMMARS_DIR },
    });
    // markdown:paragraph is emitted by the EMBEDDED .scm but not by the shadow. Address validation
    // runs at LINT STARTUP, AFTER the grammar dir is scanned (loadUserGrammars), so it checks the
    // SHADOW'S emitted set and the run is a LOUD setup failure (exit 2, CONFIG_INVALID) -
    // validating against the embedded set would let the address start, then silently measure zero.
    expectContract(r, {
      exit: 2,
      stderr: [
        /capture address "markdown:paragraph": grammar "markdown" does not emit "paragraph"/,
        /markdown emits: section/,
      ],
    });
  });

  test("a qualified address naming a capture NO loaded grammar emits is a loud setup failure", async () => {
    const dir = setup("bad-capture", [noulRule("probe_bad", "markdown:function")]);
    const r = await runCli(["run", "--config", "jint.config.json", "--json"], {
      cwd: dir,
      env: { ...WIRE, JINT_GRAMMAR_DIR: GRAMMARS_DIR },
    });
    // Setup, before any file is measured: CONFIG_INVALID names the address AND the emitted set -
    // the SHADOW's (validation runs at lint startup, after loadUserGrammars). A shadow cannot
    // widen the addressable vocabulary - it can only change what an emitted capture resolves to
    // at extraction (the test above).
    expectContract(r, {
      exit: 2,
      stderr: [
        /capture address "markdown:function": grammar "markdown" does not emit "function"/,
        /markdown emits: section/,
      ],
    });
  });

  test("a shadow-named dir for a grammar that is not embedded and ships no wasm fails loudly", async () => {
    // The shadow path is only valid for an EMBEDDED id; a dir named for anything else needs its own
    // wasm. Without one, registration fails at setup naming the dir - the wasm cross-check itself
    // does not apply to a shadow dir, but the "nothing to shadow" check does.
    const root = scratchDir("jint-byog-nonembedded");
    const dir = setup("nonembedded", [noulRule("probe_unused", "markdown:section")]);
    try {
      mkdirSync(join(root, "grammars", "verilog"), { recursive: true });
      writeFileSync(
        join(root, "grammars", "verilog", "queries.scm"),
        "(module_declaration) @type\n",
      );
      writeFileSync(join(root, "grammars", "verilog", "extensions.json"), JSON.stringify([".v"]));
      const r = await runCli(["run", "--config", "jint.config.json", "--json"], {
        cwd: dir,
        env: { ...WIRE, JINT_GRAMMAR_DIR: join(root, "grammars") },
      });
      expectContract(r, {
        exit: 2,
        stderr: [
          /grammar verilog: no verilog.wasm in the dir and no embedded grammar of that name to shadow \[CONFIG_INVALID\]/,
        ],
      });
    } finally {
      rmScratchTree(root);
    }
  });
});
