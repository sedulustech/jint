import { afterAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mockDecisionsWire, runCli } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// A path list names a page no grammar claims (an .astro file). A rule that judges a whole file and
// names such pages in its own include measures it, even when another rule in the config targets
// elements and has no include: that rule follows the config scope, which does not admit the page.

const scratch: string[] = [];
afterAll(() => scratch.forEach(rmScratchTree));

test("a path list measures a grammar-less page for the rule that includes it", async () => {
  const dir = scratchDir("paths-grammarless");
  scratch.push(dir);
  writeFileSync(join(dir, "page.astro"), '<Layout title="Home" description="A page." />\n');
  writeFileSync(
    join(dir, "jint.config.json"),
    JSON.stringify({
      rules: {
        include: ["**/*.ts"],
        use: [
          {
            name: "is_element_probe",
            instructions: "Is it short?",
            criteria: { true: "it holds", false: "it does not hold" },
            target: "functions",
            handle: { warn: { greater_than: 0.5 } },
          },
          {
            name: "is_page_probe",
            instructions: "Does the page set a title?",
            criteria: { true: "it does", false: "it does not" },
            target: "files",
            include: ["**/*.astro"],
            handle: { warn: { greater_than: 0.5 } },
          },
        ],
      },
    }),
  );
  const provider = startMockDecisions({ predicate: 0.8 });
  try {
    const run = await runCli(
      ["run", "paths", "-", "--config", join(dir, "jint.config.json"), "--json"],
      {
        cwd: dir,
        stdin: "page.astro\n",
        env: mockDecisionsWire(provider.baseUrl),
      },
    );
    if (run.stdout === "") throw new Error(run.stderr);
    const report = JSON.parse(run.stdout);
    expect(report.errors).toEqual([]);
    expect(report.notes.join("\n")).not.toContain("not found in the walk");
    expect(
      report.classifications.map((c: { rule: string; input: string }) => [
        c.rule,
        c.input.split("#")[0],
      ]),
    ).toEqual([["is_page_probe", "page.astro"]]);
  } finally {
    provider.stop();
  }
});
