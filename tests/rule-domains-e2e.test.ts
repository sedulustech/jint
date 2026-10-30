import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";

// The rule-domain contract through the spawned binary: jint runs only the rules a config names, a
// config with none (or no config at all) is told which domains exist, a name given twice is an
// error until the later entry says override, and capture - which classifies nothing - needs no rules.

const ROOT_DIR = scratchDir("jint-rule-domains");
afterAll(() => rmScratchTree(ROOT_DIR));

function project(name: string, files: Record<string, string>): string {
  const dir = join(ROOT_DIR, name);
  rmScratchTree(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.ts"), "function alpha() {}\n");
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return dir;
}

describe("rule domains: what a run needs", () => {
  test("no config: exit 2, every domain and its rules named, a working example given", async () => {
    const dir = project("none", {});
    const r = await runCli(["run", "a.ts"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no jint config found");
    for (const domain of ["comments", "complexity", "errors", "naming"]) {
      expect(r.stderr).toContain(`jint:rules/${domain}: `);
    }
    expect(r.stderr).toContain("has_filename_mismatch");
    expect(r.stderr).toMatch(/import \{ \w+ \} from "jint:rules\/\w+"/);
  });

  test("a config that names no rules is told the same", async () => {
    const dir = project("empty", { "jint.config.json": "{}" });
    const r = await runCli(["run", "a.ts"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("declares no rules");
    expect(r.stderr).toContain("jint:rules/naming: ");
  });

  test("a rule name given twice is an error naming both entries and the way out", async () => {
    const twice = project("twice", {
      "jint.config.json": JSON.stringify({ rules: ["is_greppable", "is_greppable"] }),
    });
    const r = await runCli(["run", "a.ts"], { cwd: twice });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("'is_greppable' is declared twice (rules[0] and rules[1])");
    expect(r.stderr).toContain("override: true");
  });

  test("capture needs no rules: no config and a rules-less config both capture", async () => {
    const bare = project("capture-bare", {});
    expect((await runCli(["capture", "a.ts"], { cwd: bare })).code).toBe(0);
    const rulesless = project("capture-rulesless", { "jint.config.json": "{}" });
    expect((await runCli(["capture", "a.ts"], { cwd: rulesless })).code).toBe(0);
  });
});
