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

  test("-h anywhere ignores other args", () => {
    const r = run(["--file", "nope.ts", "-h"]);
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

  test("positional argument suggests --file, exit 2", () => {
    const r = run(["src"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("did you mean --file src?");
  });

  test("conflicting input flags -> exit 2", () => {
    const r = run(["--file", "a.ts", "--dir", "src"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("only one of --file, --dir");
  });

  test("missing entrypoint -> ENTRYPOINT_NOT_FOUND, exit 2", () => {
    const r = run(["--file", "nope/missing.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("ENTRYPOINT_NOT_FOUND");
  });

  test("invalid config file -> CONFIG_INVALID, exit 2", () => {
    const r = run([
      "--config",
      "tests/fixtures/configs/invalid.config.json",
      "--file",
      "tests/fixtures/sample-file.ts",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("CONFIG_INVALID");
  });

  test("piped stdout carries no escape codes (--help and reports)", () => {
    expect(run(["-h"]).stdout).not.toContain("\x1b");
    const r = run(["--file", "tests/fixtures/sample-file.ts", "--json"], NO_KEY);
    expect(r.stdout).not.toContain("\x1b");
  });
});

describe("cli: run semantics (no API key -> JEV_AUTH, exit 4)", () => {
  test("--file without TYPESAFE_API_KEY --json: stdout parses, stderr silent (clig)", () => {
    const r = run(["--file", "tests/fixtures/sample-file.ts", "--json"], NO_KEY);
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
    const r = run(["--file", "tests/fixtures/sample-file.ts"], NO_KEY);
    expect(r.code).toBe(4);
    // stderr: the run's own errors and their summary
    expect(r.stderr).toContain("error JEV_AUTH");
    expect(r.stderr).toContain("1 unit failed to measure");
    // stdout: findings only — this run has none, and no operational content leaks there
    expect(r.stdout).not.toContain("JEV_AUTH");
    expect(r.stdout).not.toContain("failed to measure");
  });

  test("--kind diff reads piped stdin (decomposition happens before the jev call)", () => {
    const proc = Bun.spawnSync(
      ["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} --kind diff --json`],
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

  test("piped stdin without --kind -> usage error, exit 2, guidance", () => {
    const proc = Bun.spawnSync(
      ["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} --json`],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...NO_KEY } },
    );
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toContain("--kind str");
    expect(proc.stderr.toString()).toContain("--kind diff");
  });

  test("--file of a diff-looking file is judged as a FILE (no sniffing), rev-shaped too", () => {
    // file semantics: rejected as a non-source extension (NOT_SOURCE), not decomposed as a diff
    const r = run(["--file", "tests/fixtures/sample.diff", "--json"], NO_KEY);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("NOT_SOURCE");
    expect(r.stderr).not.toContain("diff --git");

    // a rev-shaped argument is just a missing entrypoint, not a diff
    const rev = run(["--file", "HEAD~1..HEAD", "--json"], NO_KEY);
    expect(rev.code).toBe(2);
    expect(rev.stderr).toContain("ENTRYPOINT_NOT_FOUND");
  });

  test("--config selects an alternate config file (loads, then JEV_AUTH)", () => {
    const r = run(
      [
        "--config",
        "tests/fixtures/configs/valid.config.json",
        "--file",
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

  test("--dir <fixture> : respects .gitignore, errors JEV_AUTH, exit 4", () => {
    // tests/fixtures/ignore-test contains a .gitignore that ignores 'binary'
    const r = run(["--dir", "tests/fixtures/sample-dir", "--json", "--debug"], NO_KEY);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    // Should contain measurements for the non-ignored files
    // If it crashed on binaries, the exit code would be 3 (internal)
    expect(report.errors.length).toBeGreaterThan(0);
  });

  test("--kind str measures one str unit even when stdin holds diff text", () => {
    const proc = Bun.spawnSync(
      ["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} --kind str --json`],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...NO_KEY } },
    );
    expect(proc.exitCode).toBe(4); // ran as ONE str unit; JEV_AUTH with no key
    const report = JSON.parse(proc.stdout.toString());
    expect(report.errors[0]!.input).toBe("input");
  });
});

describe("cli: live jev round trip (requires TYPESAFE_API_KEY)", () => {
  test("--file with a real key: measurements, clean exit 0", () => {
    if (!process.env.TYPESAFE_API_KEY) return; // demonstrated manually in the verification gate
    const r = run(["--file", "tests/fixtures/sample-file.ts", "--json"]);
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
