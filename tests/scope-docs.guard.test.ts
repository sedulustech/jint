import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runCli } from "./helpers/cli.ts";

// Named files and a path list are scope-checked and --unscoped measures them as given. That is where
// this was misread before, so every place a reader looks - the --help, the README, the config
// reference - must state both, and the retired top-level include/exclude keys must not reappear in
// the docs.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("--help states both forms", async () => {
  const help = (await runCli(["--help"])).stdout;
  expect(help).toContain("--unscoped");
  expect(help).toContain("scope-checked");
});

for (const path of ["README.md", "docs/config.md"]) {
  test(`${path} states both forms and the rules scope`, () => {
    const doc = read(path);
    expect(doc).toContain("--unscoped");
    expect(doc).toContain("scope-checked");
    expect(doc).toContain("rules scope");
  });
}

test("no doc shows a top-level include/exclude in a config", () => {
  for (const path of ["README.md", "docs/config.md", "docs/byog.md"]) {
    expect(read(path)).not.toMatch(/^ {0,2}"?(include|exclude)"?: *\[/m);
  }
});
