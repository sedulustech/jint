import { describe, test, expect, afterAll } from "bun:test";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, mockDecisionsWire } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

/**
 * THE OPEN PATH, PROVEN (owner steering item 3): a BYOG-shaped grammar declares a NEW autonomous
 * capture - a name no engine list knows - with definition and nesting directives, and it works END
 * TO END through the real CLI: discovery, walk, suppression, projection, a qualified-address rule,
 * findings. ZERO engine edits: the .scm lines below are the entire authoring surface. This test is
 * the standing answer to "why edit the engine when the fixture proves you need not" - if it breaks
 * because an engine change made the open path harder, THAT is the regression.
 *
 * Mechanism: the shadow pattern (tests/byog-markdown.test.ts) - a grammar dir named "markdown" with
 * its own queries.scm; the embedded wasm still parses. This fixture's .scm captures atx heading
 * sections as @block (a name minted HERE) plus the shared @comment over setexts; the rule addresses
 * markdown:block through the qualified capture address.
 */

const DIR = scratchDir("jint-capture-directives-e2e");

const CONFIG = JSON.stringify({
  input: "doc.md",
  rules: {
    use: [
      {
        name: "probe_block",
        kind: "noul",
        target: "markdown:block",
        instructions: "Is this block titled?",
        criteria: { true: "Titled.", false: "Not titled." },
        handle: { warn: { greater_than: 0.99, message: "titled block" } },
      },
    ],
  },
});

const GRAMMARS = join(DIR, "grammars", "markdown");
const DOC = join(DIR, "doc.md");

mkdirSync(GRAMMARS, { recursive: true });
cpSync(
  join(
    import.meta.dir,
    "..",
    "packages",
    "sdk",
    "src",
    "core",
    "grammars",
    "embedded",
    "markdown",
    "markdown.wasm",
  ),
  join(GRAMMARS, "markdown.wasm"),
);
writeFileSync(join(GRAMMARS, "extensions.json"), JSON.stringify([".md"]));
// THE ENTIRE AUTHORING SURFACE: one pattern, two directives beside it - a NEW capture (@block) declared a
// definition and a selfNester, with no engine registration anywhere
writeFileSync(
  join(GRAMMARS, "queries.scm"),
  [
    '(section (atx_heading (inline) @name)) @block (#set! "capture.block.definition" "true") (#set! "capture.block.selfNesting" "true")',
    "",
  ].join("\n"),
);
writeFileSync(
  DOC,
  ["# Root", "", "## Nested", "", "prose under nested", "", "# Sibling", ""].join("\n"),
);
writeFileSync(join(DIR, "jint.config.json"), CONFIG);

const provider = startMockDecisions();
const WIRE = mockDecisionsWire(provider.baseUrl);

afterAll(() => {
  provider.stop();
  rmScratchTree(DIR);
});

describe("the open path: a new autonomous capture declared entirely in a .scm", () => {
  test("a BYOG grammar mints @block and a rule measures it - zero engine edits", async () => {
    const proc = await runCli(["run", "--config", "jint.config.json", "--json"], {
      cwd: DIR,
      env: { ...WIRE, JINT_GRAMMAR_DIR: join(DIR, "grammars") },
    });
    expect(proc.code, proc.stderr).toBe(0);
    const report = JSON.parse(proc.stdout);
    const rules = [...new Set(report.measurements.map((m: any) => m.rule))];
    expect(rules).toEqual(["probe_block"]);
    const kinds = report.measurements.map((m: any) => m.element.kind);
    // selfNesting declared: the nested and sibling sections surface as their OWN @block elements
    // beside the root that contains them - three blocks, not one collapsed whole
    expect(kinds).toEqual(["block", "block", "block"]);
    const spans = report.measurements.map(
      (m: any) => `L${m.element.span.start.line}-L${m.element.span.end.line}`,
    );
    expect(spans).toEqual(["L1-L7", "L3-L7", "L7-L8"]);
  });
});
