import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mockDecisionsWire, runCli } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// Named files and a piped path list are scope-checked by the config's rules scope; --unscoped
// measures them as given, and a rule's own include scopes it either way. The run header states
// which applied, so a run that measured nothing says why up front.

const scratch: string[] = [];
afterAll(() => scratch.forEach(rmScratchTree));

const rule = (name: string, include?: string[]) => ({
  name,
  instructions: "Is it short?",
  criteria: { true: "it is short", false: "it is long" },
  target: "files",
  handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.9 } },
  include,
});

function project(rules: ReturnType<typeof rule>[]) {
  const dir = scratchDir("run-scope");
  scratch.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "src", "a.test.ts"), "export const t = 1;\n");
  writeFileSync(
    join(dir, "jint.config.json"),
    JSON.stringify({ rules: { exclude: ["**/*.test.ts"], use: rules } }),
  );
  return dir;
}

async function run(dir: string, baseUrl: string, args: string[], stdin?: string) {
  return runCli(["run", ...args, "--json"], {
    cwd: dir,
    stdin,
    env: {
      ...mockDecisionsWire(baseUrl),
      JINT_CACHE_DIR: join(dir, "cache"),
      JINT_RUNS_DIR: join(dir, "runs"),
    },
  });
}

const measuredPaths = (stdout: string): string[] =>
  [...new Set((JSON.parse(stdout).measurements as { input: string }[]).map((m) => m.input))].sort();

describe("run scope: named files and a path list are scope-checked, --unscoped measures as given", () => {
  test("a named file the rules scope excludes is not measured, and the header and one note say why", async () => {
    const provider = startMockDecisions({ predicate: 0.5 });
    const dir = project([rule("is_short_probe")]);
    const r = await run(dir, provider.baseUrl, ["src/a.test.ts"]);
    provider.stop();
    expect(measuredPaths(r.stdout)).toEqual([]);
    expect(r.stderr).toContain("rules scope: include none; exclude **/*.test.ts");
    expect(r.stderr).toContain("scope-checked: the rules scope applies (--unscoped measures them");
    // --json carries notes in the report, not on stderr; one note per skipped file, naming the way out
    const notes: string[] = JSON.parse(r.stdout).notes.filter((n: string) =>
      n.startsWith("src/a.test.ts"),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("the unscoped option measures it anyway");
  });

  test("a path list is scope-checked the same way: the excluded entry is skipped, the rest measured", async () => {
    const provider = startMockDecisions({ predicate: 0.5 });
    const dir = project([rule("is_short_probe")]);
    const r = await run(
      dir,
      provider.baseUrl,
      ["paths", "-"],
      "src/a.test.ts\nsrc/a.ts\nREADME.md\n",
    );
    provider.stop();
    expect(measuredPaths(r.stdout)).toEqual(["src/a.ts"]);
    expect(r.stderr).toContain("path list, 3 paths - scope-checked");
  });

  test("--unscoped measures the list as given, and the header says so", async () => {
    const provider = startMockDecisions({ predicate: 0.5 });
    const dir = project([rule("is_short_probe")]);
    const r = await run(
      dir,
      provider.baseUrl,
      ["paths", "-", "--unscoped"],
      "src/a.test.ts\nsrc/a.ts\nREADME.md\n",
    );
    provider.stop();
    expect(measuredPaths(r.stdout)).toEqual(["src/a.test.ts", "src/a.ts"]);
    expect(r.stderr).toContain("path list, 3 paths - measured as given (--unscoped)");
  });

  test("--unscoped measures a named file the scope excludes", async () => {
    const provider = startMockDecisions({ predicate: 0.5 });
    const dir = project([rule("is_short_probe")]);
    const r = await run(dir, provider.baseUrl, ["src/a.test.ts", "--unscoped"]);
    provider.stop();
    expect(measuredPaths(r.stdout)).toEqual(["src/a.test.ts"]);
  });

  test("a rule's own include still scopes it under --unscoped", async () => {
    const provider = startMockDecisions({ predicate: 0.5 });
    const dir = project([rule("is_short_probe", ["**/a.ts"])]);
    const r = await run(
      dir,
      provider.baseUrl,
      ["paths", "-", "--unscoped"],
      "src/a.test.ts\nsrc/a.ts\n",
    );
    provider.stop();
    expect(measuredPaths(r.stdout)).toEqual(["src/a.ts"]);
  });

  test("--unscoped on a directory is a usage error: a walk is always scoped", async () => {
    const provider = startMockDecisions({ predicate: 0.5 });
    const dir = project([rule("is_short_probe")]);
    const r = await run(dir, provider.baseUrl, ["src", "--unscoped"]);
    provider.stop();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--unscoped applies to named files and a path list");
  });
});
