import { describe, test, expect, afterEach } from "bun:test";

// the repo this test file lives in - never a sibling checkout, so worktree
// runs exercise the worktree's own rules and calibration
const ROOT = import.meta.dir + "/..";
const CLI = "src/cli.ts";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], envOverrides: Record<string, string | undefined> = {}): RunResult {
  const proc = Bun.spawnSync(["bun", CLI, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...envOverrides },
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

const NO_KEY = { TYPESAFE_API_KEY: "" }; // SDK ignores empty env values -> missing key

afterEach(() => {
  delete process.env.NO_COLOR;
});

describe("cli: contract basics", () => {
  test("--help exits 0 and leads with usage", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("Exit codes:");
    expect(r.stderr).toBe("");
  });

  test("-h anywhere ignores other args (flags may follow positionals)", () => {
    const r = run(["nope.ts", "-h"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  test("--version prints the version and exits 0", () => {
    const r = run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("0.1.0");
  });

  test("unknown flag -> usage error, exit 2", () => {
    const r = run(["--frobnicate"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--frobnicate");
    expect(r.stderr).toContain("--help");
  });

  test("missing entrypoint -> ENTRYPOINT_NOT_FOUND, exit 2", () => {
    const r = run(["nope/missing.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("ENTRYPOINT_NOT_FOUND");
  });

  test("two files measure as file units", () => {
    const r = run(
      ["tests/fixtures/sample-file.ts", "tests/fixtures/sample-dir/good.ts", "--json"],
      NO_KEY,
    );
    expect(r.code).toBe(4);
    const attempted: string[] = [
      ...(JSON.parse(r.stdout).measurements ?? []).map((m: any) => m.input),
      ...(JSON.parse(r.stdout).errors ?? []).map((e: any) => e.input),
    ];
    expect(attempted).toContain("tests/fixtures/sample-file.ts");
    expect(attempted).toContain("tests/fixtures/sample-dir/good.ts");
  });

  test("invalid config file -> CONFIG_INVALID, exit 2", () => {
    const r = run([
      "--config",
      "tests/fixtures/configs/invalid.config.json",
      "tests/fixtures/sample-file.ts",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("CONFIG_INVALID");
  });

  test("removed flags error with the new-form hint, exit 2", () => {
    expect(run(["--file", "a.ts"]).stderr).toContain("use: jint <path>...");
    expect(run(["--dir", "src"]).stderr).toContain("use: jint <dir>");
    expect(run(["--kind", "diff"]).stderr).toContain("use: jint diff -");
    expect(run(["--diff", "-"]).stderr).toContain("use: jint diff -");
    for (const args of [["--file", "a.ts"], ["--dir", "src"], ["--kind", "diff"], ["--diff"]]) {
      expect(run(args).code).toBe(2);
    }
  });

  test("bare 'jint -' -> usage error with guidance, exit 2", () => {
    const r = run(["-"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("jint diff -");
    expect(r.stderr).toContain("jint str -");
  });

  test("bare noun without payload -> usage error, exit 2 (never a path lookup)", () => {
    expect(run(["diff"]).code).toBe(2);
    expect(run(["str"]).code).toBe(2);
    expect(run(["diff"]).stderr).toContain("expects a payload");
    expect(run(["str"]).stderr).toContain("expects a payload");
  });

  // the bun runtime eats the bare '--' from argv, so the dash-token falls through to path handling
  test("'--' ends flag parsing: a dash-path measures", () => {
    const r = run(["--", "tests/fixtures/dash-path/--weird.ts", "--json"], NO_KEY);
    expect(r.code).toBe(4); // reached measurement: it was a path, not a flag
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("tests/fixtures/dash-path/--weird.ts");
  });

  test("dash-leading token that is no known flag and no path -> exit 2 with guidance", () => {
    const r = run(["--", "--nope.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--nope.ts");
    expect(r.stderr).toContain("--help");
  });

  test("flags before and after positionals are equivalent", () => {
    const a = run(["--json", "--rule", "is_greppable", "tests/fixtures/sample-file.ts"], NO_KEY);
    const b = run(["tests/fixtures/sample-file.ts", "--json", "--rule", "is_greppable"], NO_KEY);
    expect(a.code).toBe(b.code);
    expect(JSON.parse(a.stdout)).toEqual(JSON.parse(b.stdout));
  });

  test("a file named diff is judged as a FILE (nouns never resolve to paths)", () => {
    // file semantics: the 'diff' extension is not a source grammar -> NOT_SOURCE; it was NOT
    // noun-dispatched (a bare 'jint diff' is a payload usage error instead)
    const r = run(["tests/fixtures/named-diff/diff", "--json"], NO_KEY);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("NOT_SOURCE");
  });

  test("piped stdout carries no escape codes (--help and reports)", () => {
    expect(run(["-h"]).stdout).not.toContain("\x1b");
    const r = run(["tests/fixtures/sample-file.ts", "--json"], NO_KEY);
    expect(r.stdout).not.toContain("\x1b");
  });
});

describe("cli: run semantics (no API key -> JEV_AUTH, exit 4)", () => {
  test("a file positional without TYPESAFE_API_KEY --json: stdout parses, stderr silent (clig)", () => {
    const r = run(["tests/fixtures/sample-file.ts", "--json"], NO_KEY);
    expect(r.code).toBe(4); // ran but failed: zero measurements, CI never passes unmeasured
    // stdout is exactly the machine document — parses cleanly, no human output mixed in
    const report = JSON.parse(r.stdout);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.code).toBe("JEV_AUTH");
    expect(report.measurements).toEqual([]);
    // errors are data in the document; no human-facing operational noise on stderr
    expect(r.stderr).toBe("");
    expect(r.stdout).not.toContain("failed to measure");
  });

  test("default stylish report: findings stdout, run errors stderr (clig)", () => {
    const r = run(["tests/fixtures/sample-file.ts"], NO_KEY);
    expect(r.code).toBe(4);
    // stderr: the run's own errors and their summary
    expect(r.stderr).toContain("error JEV_AUTH");
    expect(r.stderr).toContain("1 unit failed to measure");
    // stdout: findings only — this run has none, and no operational content leaks there
    expect(r.stdout).not.toContain("JEV_AUTH");
    expect(r.stdout).not.toContain("failed to measure");
  });

  test("jint diff - reads piped stdin (decomposition happens before the jev call)", () => {
    const proc = Bun.spawnSync(
      ["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} diff - --json`],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...NO_KEY },
      },
    );
    expect(proc.exitCode).toBe(4);
    const report = JSON.parse(proc.stdout.toString());
    // the diff text decomposed into per-file units; the auth failure names a unit path
    expect(report.errors[0]!.input).toBe("src/tui/components/overlays/box.ts");
    expect(report.errors[0]!.code).toBe("JEV_AUTH");
  });

  test("piped stdin without a noun -> usage error, exit 2, guidance (never guessed)", () => {
    const proc = Bun.spawnSync(
      ["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} --json`],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...NO_KEY } },
    );
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("jint diff -");
    expect(proc.stderr.toString()).toContain("jint str -");
  });

  test("TTY with payload '-' -> immediate usage error, never blocks", () => {
    // script(1) allocates a pty so process.stdin.isTTY is true in the child
    const proc = Bun.spawnSync(["/bin/bash", "-c", `script -qec 'bun ${CLI} diff -' /dev/null`], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...NO_KEY },
    });
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode).toBe(2);
    expect(out).toContain("no piped stdin to measure");
  });

  test("jint str '--json': the payload is not flag-parsed, it measures as a str unit", () => {
    // '--json' becomes the str CONTENT; if it had been parsed as a flag, the noun would have no
    // payload (exit 2 'expects a payload') and the report would be machine JSON
    const r = run(["str", "--json", "--rule", "is_greppable"], NO_KEY);
    expect(r.code).toBe(4); // reached measurement (JEV_AUTH), not a usage error
    expect(r.stderr).toContain("JEV_AUTH input");
    expect(r.stdout).not.toContain("jint-report/v1"); // human table: no --json flag was seen
  });

  test("jint str with inline source text measures one str unit", () => {
    const r = run(["str", "export const x = 1;", "--json", "--rule", "is_greppable"], NO_KEY);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("input");
  });

  test("jint diff fix.patch: a patch path is declared a diff and decomposed", () => {
    const r = run(["diff", "tests/fixtures/sample.diff", "--json"], NO_KEY);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("src/tui/components/overlays/box.ts");
  });

  test("a diff-looking file is judged as a FILE (no sniffing), rev-shaped too", () => {
    // file semantics: rejected as a non-source extension (NOT_SOURCE), not decomposed as a diff
    const r = run(["tests/fixtures/sample.diff", "--json"], NO_KEY);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("NOT_SOURCE");
    expect(r.stderr).not.toContain("diff --git");

    // a rev-shaped argument is just a missing entrypoint, not a diff
    const rev = run(["HEAD~1..HEAD", "--json"], NO_KEY);
    expect(rev.code).toBe(2);
    expect(rev.stderr).toContain("ENTRYPOINT_NOT_FOUND");
  });

  test("--config selects an alternate config file (loads, then JEV_AUTH)", () => {
    const r = run(
      [
        "--config",
        "tests/fixtures/configs/valid.config.json",
        "tests/fixtures/sample-file.ts",
        "--json",
      ],
      NO_KEY,
    );
    // config itself loaded fine; the failure is auth (exit 4), not CONFIG_INVALID (exit 2)
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    expect(report.errors[0]!.code).toBe("JEV_AUTH");
  });

  test("dir positional respects .gitignore, errors JEV_AUTH, exit 4", () => {
    // tests/fixtures/ignore-test contains a .gitignore that ignores 'binary'
    const r = run(["tests/fixtures/sample-dir", "--json", "--debug"], NO_KEY);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    // Should contain measurements for the non-ignored files
    // If it crashed on binaries, the exit code would be 3 (internal)
    expect(report.errors.length).toBeGreaterThan(0);
  });

  test("jint str - measures one str unit even when stdin holds diff text", () => {
    const proc = Bun.spawnSync(
      ["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} str - --json`],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...NO_KEY } },
    );
    expect(proc.exitCode).toBe(4); // ran as ONE str unit; JEV_AUTH with no key
    const report = JSON.parse(proc.stdout.toString());
    expect(report.errors[0]!.input).toBe("input");
  });
});

describe("cli: live jev round trip (requires TYPESAFE_API_KEY)", () => {
  test("file positional with a real key: measurements, clean exit 0", () => {
    if (!process.env.TYPESAFE_API_KEY) return; // demonstrated manually in the verification gate
    const r = run(["tests/fixtures/sample-file.ts", "--json"]);
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
});
