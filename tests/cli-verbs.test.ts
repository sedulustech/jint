import { describe, expect, jest, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capture } from "../packages/sdk/src/index.ts";
import { runCli, CLI_SRC as CLI } from "./helpers/cli.ts";
import { scratchDir } from "./helpers/dir.ts";

// The verb surface e2e: the spawned binary's capture and serve. capture is pinned against the
// SDK's own output for the same input; serve is pinned on its ONE behavior - the store's UI over
// the newest run, held until SIGINT. The resolution RULES (verb table, flag scope) are unit-pinned
// in packages/cli/src/cli.unit.test.ts.

jest.setTimeout(60_000);

const FIXTURE = join(import.meta.dir, "fixtures", "sample-file.ts");

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
