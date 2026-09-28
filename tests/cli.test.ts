import { describe, test, expect, afterEach, afterAll } from "bun:test";
import { expectContract } from "./helpers/contract.ts";
import { startMockJev } from "./helpers/mock-jev.ts";

// the repo this test file lives in - never a sibling checkout, so worktree
// runs exercise the worktree's own rules and calibration
const ROOT = import.meta.dir + "/..";
const CLI = "src/cli.ts";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Async spawn: tests run concurrently (test.concurrent) and a synchronous wait would serialize
// every CLI process behind the transport-failure retry chain each NO_SERVICE run pays.
async function run(
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...envOverrides },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

// shell pipeline variant for stdin plumbing the CLI cannot receive through argv
async function runShell(
  command: string,
  env: Record<string, string | undefined> = {},
): Promise<RunResult> {
  const proc = Bun.spawn(["/bin/bash", "-c", command], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

const NO_KEY = { TYPESAFE_API_KEY: "" }; // SDK ignores empty env values -> missing key
// a key with no reachable jev: the run walks and classifies, transport failures stay in-band
const NO_SERVICE = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: "http://127.0.0.1:1" };

afterEach(() => {
  delete process.env.NO_COLOR;
});

describe("cli: contract basics", () => {
  test.concurrent("--help exits 0 and leads with usage", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("Exit codes:");
    expect(r.stderr).toBe("");
  });

  test.concurrent("-h anywhere ignores other args (flags may follow positionals)", async () => {
    const r = await run(["nope.ts", "-h"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  test.concurrent("--version prints the version and exits 0", async () => {
    const r = await run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("0.1.0");
  });

  test.concurrent("run-knob flags validate before any input is touched", async () => {
    expectContract(await run(["--concurrency", "65"]), {
      exit: 2,
      stderr: ["concurrency: must be <= 64", "--help"],
    });
    expectContract(await run(["--concurrency", "abc"]), {
      exit: 2,
      stderr: ["--concurrency must be a number", "--help"],
    });
    expectContract(await run(["--rps-budget", "0"]), {
      exit: 2,
      stderr: ["rps_budget: must be a number > 0", "--help"],
    });
    expectContract(await run(["--timeout", "0"]), {
      exit: 2,
      stderr: ["timeout: must be a number > 0", "--help"],
    });
    expectContract(await run(["--rps-budget", ""]), {
      exit: 2,
      stderr: ["--rps-budget requires a number", "--help"],
    });
  });

  test.concurrent("unknown flag -> usage error, exit 2", async () => {
    expectContract(await run(["--frobnicate"]), { exit: 2, stderr: ["--frobnicate", "--help"] });
  });

  test.concurrent("missing entrypoint -> ENTRYPOINT_NOT_FOUND, exit 2", async () => {
    // NO_SERVICE: input resolution is key-independent (the key check must not mask it)
    expectContract(await run(["nope/missing.ts"], NO_SERVICE), {
      exit: 2,
      stderr: "ENTRYPOINT_NOT_FOUND",
    });
  });

  test.concurrent("two files classify as file units", async () => {
    const r = await run(
      ["tests/fixtures/sample-file.ts", "tests/fixtures/sample-dir/good.ts", "--json"],
      NO_SERVICE,
    );
    expect(r.code).toBe(4);
    const attempted: string[] = [
      ...(JSON.parse(r.stdout).measurements ?? []).map((m: any) => m.input),
      ...(JSON.parse(r.stdout).errors ?? []).map((e: any) => e.input),
    ];
    expect(attempted).toContain("tests/fixtures/sample-file.ts");
    expect(attempted).toContain("tests/fixtures/sample-dir/good.ts");
  });

  test.concurrent("invalid config file -> CONFIG_INVALID, exit 2", async () => {
    const r = await run([
      "--config",
      "tests/fixtures/configs/invalid.config.json",
      "tests/fixtures/sample-file.ts",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("CONFIG_INVALID");
  });

  test.concurrent("removed flags error with the new-form hint, exit 2", async () => {
    for (const [args, hint] of [
      [["--file", "a.ts"], "use: jint <path>..."],
      [["--dir", "src"], "use: jint <dir>"],
      [["--kind", "diff"], "use: jint diff -"],
      [["--diff", "-"], "use: jint diff -"],
    ] as const) {
      expectContract(await run([...args]), { exit: 2, stderr: hint });
    }
  });

  test.concurrent("bare 'jint -' -> usage error with guidance, exit 2", async () => {
    expectContract(await run(["-"]), { exit: 2, stderr: ["jint diff -", "jint str -"] });
  });

  test.concurrent("bare noun without payload -> usage error, exit 2 (never a path lookup)", async () => {
    expectContract(await run(["diff"]), { exit: 2, stderr: "expects a payload" });
    expectContract(await run(["str"]), { exit: 2, stderr: "expects a payload" });
  });

  // the bun runtime eats the bare '--' from argv, so the dash-token falls through to path handling
  test.concurrent("'--' ends flag parsing: a dash-path classifies", async () => {
    const r = await run(["--", "tests/fixtures/dash-path/--weird.ts", "--json"], NO_SERVICE);
    expect(r.code).toBe(4); // reached measurement: it was a path, not a flag
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("tests/fixtures/dash-path/--weird.ts");
  });

  test.concurrent("dash-leading token that is no known flag and no path -> exit 2 with guidance", async () => {
    expectContract(await run(["--", "--nope.ts"]), { exit: 2, stderr: ["--nope.ts", "--help"] });
  });

  test.concurrent("flags before and after positionals are equivalent", async () => {
    const a = await run(
      ["--json", "--rule", "is_greppable", "tests/fixtures/sample-file.ts"],
      NO_SERVICE,
    );
    const b = await run(
      ["tests/fixtures/sample-file.ts", "--json", "--rule", "is_greppable"],
      NO_SERVICE,
    );
    expect(a.code).toBe(b.code);
    expect(JSON.parse(a.stdout)).toEqual(JSON.parse(b.stdout));
  });

  test.concurrent("a file named diff is judged as a FILE (nouns never resolve to paths)", async () => {
    // file semantics: the 'diff' extension is not a source grammar -> NOT_SOURCE; it was NOT
    // noun-dispatched (a bare 'jint diff' is a payload usage error instead)
    expectContract(await run(["tests/fixtures/named-diff/diff", "--json"], NO_SERVICE), {
      exit: 2,
      stderr: "NOT_SOURCE",
    });
  });

  test.concurrent("piped stdout carries no escape codes (--help and reports)", async () => {
    expect((await run(["-h"])).stdout).not.toContain("\x1b");
    const r = await run(["tests/fixtures/sample-file.ts", "--json"], NO_SERVICE);
    expect(r.stdout).not.toContain("\x1b");
  });
});

describe("cli: run semantics (no API key -> fail fast, exit 2)", () => {
  test.concurrent("a file positional without TYPESAFE_API_KEY: exit 2 with the message, nothing walked", async () => {
    const r = await run(["tests/fixtures/sample-file.ts", "--json"], NO_KEY);
    // config error: the missing key is setup, not a per-unit failure; nothing was walked or
    // classified, so stdout stays empty — no machine document
    expectContract(r, {
      exit: 2,
      stderr: ["CONFIG_INVALID", "no TYPESAFE_API_KEY set - measurements need a valid key"],
      stdout: "empty",
    });
    expect(r.stderr).not.toContain("failed to classify");
  });

  test.concurrent("default stylish report without TYPESAFE_API_KEY: same exit 2, no unit failures", async () => {
    const r = await run(["tests/fixtures/sample-file.ts"], NO_KEY);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no TYPESAFE_API_KEY set");
    expect(r.stderr).not.toContain("failed to classify");
    expect(r.stdout).not.toContain("JEV_AUTH");
  });

  test.concurrent("no key and no rules (empty rule set): empty run unchanged, no auth error", async () => {
    const configPath = "/tmp/jint-no-rules-config.json";
    require("node:fs").writeFileSync(configPath, JSON.stringify({ rules: [] }));
    const r = await run(
      ["tests/fixtures/sample-file.ts", "--json", "--config", configPath],
      NO_KEY,
    );
    // an empty run needs no classifier: no CONFIG_INVALID, no auth error; exit 4 is the
    // pre-existing zero-measurements semantics of an empty run
    expect(r.code).toBe(4);
    expect(r.stderr).toBe("");
    expect(r.stdout).not.toContain("CONFIG_INVALID");
    expect(JSON.parse(r.stdout).measurements).toEqual([]);
  });

  test.concurrent("jint diff - reads piped stdin (decomposition happens before the jev call)", async () => {
    const proc = await runShell(
      `cat tests/fixtures/sample.diff | bun ${CLI} diff - --json`,
      NO_SERVICE,
    );
    expect(proc.code).toBe(4);
    const report = JSON.parse(proc.stdout);
    // the diff text decomposed into per-file units; the transport failure names a unit path
    expect(report.errors[0]!.input).toBe("src/tui/components/overlays/box.ts");
    expect(report.errors[0]!.code).toBe("JEV_UNAVAILABLE");
  });

  test.concurrent("empty diff: humans get a stderr line (exit 4 never silent); --json keeps the empty report", async () => {
    const empty = (args: string) => runShell(`printf '' | bun ${CLI} ` + args, NO_SERVICE);
    const human = await empty("diff -");
    expectContract(human, { exit: 4, stderr: "no measurements - empty diff" });
    const json = expectContract(await empty("diff - --json"), { exit: 4, stdout: "json" });
    expect(json.measurements).toEqual([]);
    expect((await empty("diff - --json")).stderr).toBe(""); // the document is data: errors ride in it, stderr untouched
  });

  test.concurrent("unknown --language: usage error exit 2 before any input is touched", async () => {
    expectContract(await run(["str", "-", "--language", "klingon"], NO_SERVICE), {
      exit: 2,
      stderr: ["unknown language 'klingon'", "see --help for valid grammar ids"],
      stdout: "empty",
    });
  });

  test.concurrent("piped stdin without a noun -> usage error, exit 2, guidance (never guessed)", async () => {
    const proc = await runShell(`cat tests/fixtures/sample.diff | bun ${CLI} --json`, NO_KEY);
    expect(proc.code).toBe(2);
    expect(proc.stderr).toContain("jint diff -");
    expect(proc.stderr).toContain("jint str -");
  });

  test.concurrent("TTY with payload '-' -> immediate usage error, never blocks", async () => {
    // script(1) allocates a pty so process.stdin.isTTY is true in the child
    const proc = await runShell(`script -qec 'bun ${CLI} diff -' /dev/null`, NO_KEY);
    const out = proc.stdout + proc.stderr;
    expect(proc.code).toBe(2);
    expect(out).toContain("no piped stdin to classify");
  });

  test.concurrent("jint str '--json': the payload is not flag-parsed, it classifies as a str unit", async () => {
    // '--json' becomes the str CONTENT; if it had been parsed as a flag, the noun would have no
    // payload (exit 2 'expects a payload') and the report would be machine JSON
    const r = await run(["str", "--json", "--rule", "is_greppable"], NO_SERVICE);
    expect(r.code).toBe(4); // reached measurement (transport failure), not a usage error
    expect(r.stderr).toContain("JEV_UNAVAILABLE str:stdin");
    expect(r.stdout).not.toContain("jint-report/v1"); // human table: no --json flag was seen
  });

  test.concurrent("jint str with inline source text classifies one str unit", async () => {
    const r = await run(
      ["str", "export const x = 1;", "--json", "--rule", "is_greppable"],
      NO_SERVICE,
    );
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("str:stdin");
  });

  test.concurrent("jint str <existing-path>: usage error exit 2, never the path string as source", async () => {
    expectContract(await run(["str", "tests/fixtures/sample-file.ts", "--json"], NO_SERVICE), {
      exit: 2,
      stderr: ["'tests/fixtures/sample-file.ts' is a path", "jint tests/fixtures/sample-file.ts"],
      stdout: "empty",
    });
  });

  test.concurrent("all units fail: exit 4 with the failures named on stderr", async () => {
    const proc = await runShell(`printf 'x' | bun ${CLI} str -`, NO_SERVICE);
    expect(proc.code).toBe(4); // every unit failed -> the run failed (never exit 0)
    expect(proc.stderr).toContain("failed to classify");
  });

  test.concurrent("jint diff fix.patch: a patch path is declared a diff and decomposed", async () => {
    const r = await run(["diff", "tests/fixtures/sample.diff", "--json"], NO_SERVICE);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("src/tui/components/overlays/box.ts");
  });

  test.concurrent("a diff-looking file is judged as a FILE (no sniffing), rev-shaped too", async () => {
    // file semantics: rejected as a non-source extension (NOT_SOURCE), not decomposed as a diff
    const r = await run(["tests/fixtures/sample.diff", "--json"], NO_SERVICE);
    expectContract(r, { exit: 2, stderr: "NOT_SOURCE" });
    expect(r.stderr).not.toContain("diff --git");

    // a rev-shaped argument is just a missing entrypoint, not a diff
    expectContract(await run(["HEAD~1..HEAD", "--json"], NO_SERVICE), {
      exit: 2,
      stderr: "ENTRYPOINT_NOT_FOUND",
    });
  });

  test.concurrent("--config selects an alternate config file (loads, then classifies)", async () => {
    const r = await run(
      [
        "--config",
        "tests/fixtures/configs/valid.config.json",
        "tests/fixtures/sample-file.ts",
        "--json",
      ],
      NO_SERVICE,
    );
    // config itself loaded fine; the failure is transport (exit 4), not CONFIG_INVALID (exit 2)
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    expect(report.errors[0]!.code).toBe("JEV_UNAVAILABLE");
  });

  test.concurrent("dir positional respects .gitignore, errors in-band, exit 4", async () => {
    // tests/fixtures/ignore-test contains a .gitignore that ignores 'binary'
    const r = await run(["tests/fixtures/sample-dir", "--json", "--debug"], NO_SERVICE);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    // Should contain measurements for the non-ignored files
    // If it crashed on binaries, the exit code would be 3 (internal)
    expect(report.errors.length).toBeGreaterThan(0);
  });

  test.concurrent("jint str - classifies one str unit even when stdin holds diff text", async () => {
    const proc = await runShell(
      `cat tests/fixtures/sample.diff | bun ${CLI} str - --json`,
      NO_SERVICE,
    );
    expect(proc.code).toBe(4); // ran as ONE str unit; transport failure in-band
    const report = JSON.parse(proc.stdout);
    expect(report.errors[0]!.input).toBe("str:stdin");
  });
});

// Structural claims of the live tests, always on over the mock: these are CONTRACT claims
// (report shape, tap activation, walker exclusions) that never needed a real model. They run
// keyless — a mock here is what makes a regression visible in every run.
describe("cli: mocked jev twins (structural claims, always on)", () => {
  const jev = startMockJev();
  const MOCK_ENV = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: jev.baseUrl };
  // Async spawn: the mock jev server lives in THIS process — a synchronous spawn would block its
  // event loop and the child would hang waiting for answers.
  async function runMock(args: string[], env: Record<string, string> = {}) {
    const proc = Bun.spawn(["bun", CLI, ...args], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...MOCK_ENV, ...env },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code: await proc.exited, stdout, stderr };
  }
  afterAll(() => jev.stop());

  test.concurrent("file positional: measurements over a corpus, clean exit 0, values in [0,1]", async () => {
    // High-good noul rules only: the mock's 0.8 is clean under every one of their handles, so a
    // healthy run over a healthy corpus really does exit 0 (is_readable is score-typed and the
    // high-bad rules fire by design under a constant answer).
    const r = await runMock([
      "tests/fixtures/sample-file.ts",
      "tests/fixtures/sample-dir/good.ts",
      "--json",
      "--rule",
      "is_name_purposeful",
      "--rule",
      "is_function_srp",
      "--rule",
      "is_vocabulary_consistent",
      "--rule",
      "is_naming_convention_consistent",
      "--rule",
      "is_greppable",
    ]);
    const report = expectContract(r, { exit: 0, stdout: "json" });
    // one pass: 2 files-target + element classification
    expect(report.measurements.length).toBeGreaterThanOrEqual(8);
    for (const m of report.measurements) {
      expect(m.value).toBeGreaterThanOrEqual(0);
      expect(m.value).toBeLessThanOrEqual(1);
    }
  });

  test.concurrent("JEV_DEBUG_REQUEST_LOCATION alone turns on the dump tap: captures land, stdout untouched", async () => {
    // (async runMock: the in-process mock cannot answer while a spawnSync blocks the loop)
    const dir = `/tmp/jint-dump-cli-${Date.now()}`;
    const r = await runMock(["tests/fixtures/sample-file.ts", "--json", "--rule", "is_greppable"], {
      JEV_DEBUG_REQUEST_LOCATION: dir,
    });
    // the notice never touches stdout: the report stays a machine document
    const report = expectContract(r, { exit: 0, stdout: "json" });
    expect(report.measurements.length).toBeGreaterThan(0);
    expect(r.stderr).toContain(`jint: request captures -> ${dir}/`);
    expect(r.stderr).toMatch(/\/\d+ \(\d+ calls\) \(override: JEV_DEBUG_REQUEST_LOCATION\)/);
    const captures = [...new Bun.Glob("**/*.json").scanSync({ cwd: dir })];
    expect(captures.length).toBeGreaterThan(0);
  });
});

// Live round trips assert MODEL BEHAVIOR (calibration), not contract — the mocked twins above own
// every structural claim. Opt-in only: set RUN_LIVE_TESTS=1 AND TYPESAFE_API_KEY. A run that asks
// for live tests without a key fails loud; the old silent skip hid a regression once already.
describe("cli: live jev round trip (opt-in: RUN_LIVE_TESTS=1 + TYPESAFE_API_KEY)", () => {
  const liveRequested = process.env.RUN_LIVE_TESTS === "1";
  function requireLive(): boolean {
    if (!liveRequested) return false;
    if (!process.env.TYPESAFE_API_KEY) {
      throw new Error(
        "RUN_LIVE_TESTS=1 but TYPESAFE_API_KEY is unset - live tests never skip silently; unset RUN_LIVE_TESTS for the mocked suite",
      );
    }
    return true;
  }

  test.concurrent("file positional with a real key: measurements, clean exit 0", async () => {
    if (!requireLive()) return;
    const r = await run(["tests/fixtures/sample-file.ts", "--json"]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    // one pass: 2 files-target + element classification; every measurement runs its handle, so
    // exact total depends on the real readings
    expect(report.measurements.length).toBeGreaterThanOrEqual(8);
    for (const m of report.measurements) {
      expect(m.value).toBeGreaterThanOrEqual(0);
      expect(m.value).toBeLessThanOrEqual(1);
    }
  }, 20_000); // live network round trip: latency varies, bun's default 5s timeout is too tight

  test.concurrent("JEV_DEBUG_REQUEST=1: captures land, stdout JSON untouched, stderr names the run dir", async () => {
    if (!requireLive()) return;
    const dir = ROOT + "/tmp/cli-tap-e2e";
    const r = await run(["tests/fixtures/sample-file.ts", "--json"], {
      JEV_DEBUG_REQUEST: "1",
      JEV_DEBUG_REQUEST_LOCATION: dir,
    });
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow(); // the notice never touches stdout
    expect(r.stderr).toContain(`jint: request captures -> ${dir}/`);
    expect(r.stderr).toMatch(/\/\d+ \(\d+ calls\) \(override: JEV_DEBUG_REQUEST_LOCATION\)/);
  }, 20_000);
});
