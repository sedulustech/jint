import { describe, expect, jest, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture } from "../packages/sdk/src/index.ts";
import { runCli, CLI_SRC as CLI } from "./helpers/cli.ts";
import { scratchDir } from "./helpers/dir.ts";

// The verb surface e2e: the spawned binary's capture and serve, and the flagship verb-resolution
// contract (a missing or unknown first positional is a loud usage error naming the fix). capture is
// pinned against the SDK's own output for the same input; serve is pinned on its ONE behavior -
// the store's UI over the newest run, held until SIGINT.

jest.setTimeout(60_000);

const FIXTURE = join(import.meta.dir, "fixtures", "sample-file.ts");

describe("cli verbs e2e — resolution: the first positional IS the command", () => {
  test("jint . is a usage error naming the jint run form (no implicit verb)", async () => {
    const r = await runCli(["."], { timeout: 60_000 });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("'.' is not a verb");
    expect(r.stderr).toContain("use: jint run .");
  });

  test("bare jint asks for a verb, naming the three", async () => {
    const r = await runCli([], { timeout: 60_000 });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("a verb is required");
    expect(r.stderr).toContain("jint run");
    expect(r.stderr).toContain("jint serve");
    expect(r.stderr).toContain("jint capture <path>");
  });

  test("a flag the verb does not take: exit 2 naming the flag and the verb", async () => {
    const r = await runCli(["capture", FIXTURE, "--rule", "is_reused"], { timeout: 60_000 });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--rule does not apply to capture");
  });

  test("'--ui' is rejected with the serve pointer", async () => {
    const r = await runCli(["run", FIXTURE, "--ui"], { timeout: 60_000 });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("'--ui' was removed");
    expect(r.stderr).toContain("serve replaces it");
    expect(r.stderr).toContain("jint serve");
  });

  test("a bare '-' anywhere in run's operands names the input-noun forms", async () => {
    const r = await runCli(["run", "diff", "-"], { timeout: 60_000 });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("bare '-' is undeclared");
    expect(r.stderr).toContain("jint run str -");
    expect(r.stderr).toContain("jint run paths -");
  });
});

describe("cli verbs e2e — capture through the spawned binary", () => {
  test("capture over a fixture with --json: byte shape matches the SDK capture() elements", async () => {
    const r = await runCli(["capture", FIXTURE, "--json"], { timeout: 60_000 });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    // the CLI is a thin print: the document's elements ARE the SDK's CapturedElement array for
    // the same target - same walk, same grammar, same spans
    expect(JSON.parse(r.stdout)).toEqual({ elements: await capture(FIXTURE) });
  });

  test("capture lines: one line per element, pipe-clean (single file: no input column)", async () => {
    const r = await runCli(["capture", FIXTURE], { timeout: 60_000 });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines.length).toBe((await capture(FIXTURE)).length);
    for (const line of lines) {
      // grammar kind L<start>-L<end> name|'-' - the span keeps both lines for a stable column
      expect(line).toMatch(
        /^(typescript|tsx|python|markdown|php|go|cpp|c|css) \S+ L\d+-L\d+ (\S+.*|-)$/,
      );
    }
  });

  // promoted from the deleted capture-output unit describe: the input column appears exactly
  // when the run covers more than one file. A scratch tree (the fixture dirs hold uncovered
  // extensions - Makefile, .txt - which a DIR run skips with the coverage note; an explicit FILE
  // still fails loud MISSING_GRAMMAR).
  test("capture over a dir covering more than one file: every line carries the input column", async () => {
    const dir = scratchDir("jint-capture-multi");
    writeFileSync(join(dir, "one.ts"), "function one() {}\n");
    writeFileSync(join(dir, "two.ts"), "function two(x: number) {\n  return x;\n}\n");
    const r = await runCli(["capture", dir], { timeout: 60_000 });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2); // one element per file is enough - the set below proves both contributed
    const inputs = new Set<string>();
    for (const line of lines) {
      const cols = line.split(" ");
      expect(cols).toHaveLength(5); // grammar kind span name input
      expect(cols[2]).toMatch(/^L\d+-L\d+$/);
      inputs.add(cols[4]!);
    }
    expect([...inputs].sort()).toEqual(["one.ts", "two.ts"]);
  });

  test("capture over a dir holding an unclaimable file: exit 0, elements on stdout, one note on stderr", async () => {
    const dir = scratchDir("jint-capture-sweep");
    writeFileSync(join(dir, "one.ts"), "function one() {}\n");
    writeFileSync(join(dir, "data.json"), '{"a":1}\n');
    const r = await runCli(["capture", dir], { timeout: 60_000 });
    // the strays never kill the run: the claimed file's elements are the payload (exit 0)
    expect(r.code).toBe(0);
    // one CLAIMED file only (the stray never reaches extraction), so the line keeps the
    // single-file shape - no input column
    expect(r.stdout.trimEnd()).toBe("typescript function L1-L1 one");
    // the folded skip line rides stderr in the emitter's note voice; stdout stays pipe-clean
    expect(r.stderr).toBe("jint: note: not parsed (no grammar): .json\n");
  });

  test("capture --queries with a foreign grammar's .scm: loud exit 2 naming both grammars", async () => {
    const dir = scratchDir("jint-capture-cross");
    writeFileSync(join(dir, "code.ts"), "// one comment\nfunction f() {}\n");
    const cssScm = join(
      import.meta.dir,
      "..",
      "packages",
      "sdk",
      "src",
      "core",
      "grammars",
      "embedded",
      "css",
      "queries.scm",
    );
    const r = await runCli(["capture", join(dir, "code.ts"), "--queries", cssScm], {
      timeout: 60_000,
    });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("is the queries.scm of css");
    expect(r.stderr).toContain("not typescript");
  });
});

describe("cli verbs e2e — serve: the store's UI, held", () => {
  // a seeded store (one request-bearing run dir) and a scratch UI dist: serve needs both
  const store = scratchDir("jint-serve-store");
  const seeded = join(store, "1700000000001-seed");
  mkdirSync(seeded, { recursive: true });
  writeFileSync(join(seeded, "1700000000001-files.json"), "{}");
  const dist = scratchDir("jint-serve-dist");
  writeFileSync(join(dist, "index.html"), "<html><body>jint ui</body></html>");
  const SERVE_ENV = { JINT_RUNS_DIR: store, JINT_UI_DIST: dist };

  test("no runs in the store: loud exit 2 naming the store", async () => {
    const empty = scratchDir("jint-serve-empty");
    const r = await runCli(["serve"], {
      env: { ...SERVE_ENV, JINT_RUNS_DIR: empty },
      timeout: 60_000,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`no runs in the store (${empty})`);
    expect(r.stderr).toContain("jint run records one");
    expect(r.stdout).toBe("");
  });

  test("any argument is a usage error: serve takes none", async () => {
    const r = await runCli(["serve", "1700000000001"], { env: SERVE_ENV, timeout: 60_000 });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("serve takes no arguments");
  });

  test("no-hold gate: the url line on stderr, exit 0, no deep link", async () => {
    const r = await runCli(["serve"], {
      env: { ...SERVE_ENV, JINT_UI_NO_HOLD: "1" },
      timeout: 60_000,
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("jint: ui -> http://localhost:");
    expect(r.stderr).not.toContain("/runs/");
  });

  // The held path, for real: no NO_HOLD gate — spawn, wait for the url line, prove the printed
  // URL actually serves the store behind it (the page renders; the API lists the seeded run),
  // then SIGINT and require exit 0 (the hold is just the viewer leaving). Import-side spawn
  // because runCli drains both pipes to EOF, which never comes while the server holds.
  test("held serve: the printed url serves the store's runs; SIGINT exits 0", async () => {
    const proc = Bun.spawn(["bun", CLI, "serve"], {
      cwd: join(import.meta.dir, ".."),
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
      env: { ...process.env, ...SERVE_ENV },
    });
    try {
      const decoder = new TextDecoder();
      const reader = proc.stderr.getReader();
      let stderrText = "";
      let url: string | undefined;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrText += decoder.decode(value);
        url = /jint: ui -> (\S+)/.exec(stderrText)?.[1];
        if (url !== undefined) break;
      }
      expect(url).toBeDefined();
      // base url only: the app opens the store's newest run first, no route coupling
      expect(url).not.toContain("/runs/");
      const page = await fetch(url!);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("jint ui");
      const api = (await (await fetch(new URL("/api/runs", url))).json()) as {
        runs: { id: string }[];
      };
      expect(api.runs.map((run) => run.id)).toContain("1700000000001-seed");
      proc.kill("SIGINT");
      expect(await proc.exited).toBe(0);
    } finally {
      proc.kill();
    }
  });
});
