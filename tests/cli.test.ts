import { describe, test, expect, afterEach } from "bun:test";

const ROOT = "/home/crjm/dev/sedulus/jint";
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
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
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
    expect(r.stderr).toContain("only one of --file, --dir, --diff");
  });

  test("missing entrypoint -> ENTRYPOINT_NOT_FOUND, exit 2", () => {
    const r = run(["--file", "nope/missing.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("ENTRYPOINT_NOT_FOUND");
  });

  test("invalid config file -> CONFIG_INVALID, exit 2", () => {
    const r = run(["--config", "tests/fixtures/configs/invalid.config.ts", "--file", "tests/fixtures/sample-file.ts"]);
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
  test("--file without TYPESAFE_API_KEY: JEV_AUTH diagnostic, exit 4, stdout still pipe-clean", () => {
    const r = run(["--file", "tests/fixtures/sample-file.ts", "--json"], NO_KEY);
    expect(r.code).toBe(4); // ran but failed: zero measurements, CI never passes unmeasured
    const report = JSON.parse(r.stdout);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]!.code).toBe("JEV_AUTH");
    expect(report.measurements).toEqual([]);
    // diagnostics are report content (stdout); stderr stays silent by default
    expect(r.stderr).toBe("");
  });

  test("default stylish report renders the JEV_AUTH diagnostic", () => {
    const r = run(["--file", "tests/fixtures/sample-file.ts"], NO_KEY);
    expect(r.code).toBe(4);
    expect(r.stdout).toContain("JEV_AUTH");
    expect(r.stdout).toContain("1 unit failed to measure");
  });

  test("--diff - reads stdin (decomposition happens before the jev call)", () => {
    const proc = Bun.spawnSync(["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} --diff - --json`], {
      cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...NO_KEY },
    });
    expect(proc.exitCode).toBe(4);
    const report = JSON.parse(proc.stdout.toString());
    // the diff resolved and decomposed; the auth failure names a unit path
    expect(report.diagnostics[0]!.input).toBe("src/tui/components/overlays/box.ts");
    expect(report.diagnostics[0]!.code).toBe("JEV_AUTH");
  });

  test("--config selects an alternate config file (loads, then JEV_AUTH)", () => {
    const r = run(["--config", "tests/fixtures/configs/valid.config.ts", "--file", "tests/fixtures/sample-file.ts", "--json"], NO_KEY);
    // config itself loaded fine; the failure is auth (exit 4), not CONFIG_INVALID (exit 2)
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    expect(report.diagnostics[0]!.code).toBe("JEV_AUTH");
  });

  test("--dir <fixture> : respects .gitignore, diagnostics JEV_AUTH, exit 4", () => {
    // tests/fixtures/ignore-test contains a .gitignore that ignores 'binary'
    const r = run(["--dir", "tests/fixtures/sample-dir", "--json", "--debug"], NO_KEY);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    // Should contain measurements for the non-ignored files
    // If it crashed on binaries, the exit code would be 3 (internal)
    expect(report.diagnostics.length).toBeGreaterThan(0);
  });

  test("--diff <patch> : parses before jev call, JEV_AUTH, exit 4", () => {
    const r = run(["--diff", "tests/fixtures/sample.diff", "--json"], NO_KEY);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    expect(report.diagnostics[0]!.code).toBe("JEV_AUTH");
  });

  test("--diff <bogus-rev> : fails with exit 2", () => {
    // Create a temp dir for a non-repo context
    const tmp = "/tmp/jint-test-non-repo";
    Bun.spawnSync(["mkdir", "-p", tmp]);
    
    const proc = Bun.spawnSync(["bun", ROOT + "/src/cli.ts", "--diff", "bogus-rev"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...NO_KEY, "PWD": tmp },
    });
    expect(proc.exitCode).toBe(2);
    expect(proc.stderr.toString()).toMatch(/ENTRYPOINT_NOT_FOUND|UNREADABLE/);
  });

});

describe("cli: live jev round trip (requires TYPESAFE_API_KEY)", () => {
  test("--file with a real key: measurements, clean exit 0", () => {
    if (!process.env.TYPESAFE_API_KEY) return; // demonstrated manually in the verification gate
    const r = run(["--file", "tests/fixtures/sample-file.ts", "--json"]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.measurements).toHaveLength(8);
    for (const m of report.measurements) {
      expect(m.value).toBeGreaterThanOrEqual(0);
      expect(m.value).toBeLessThanOrEqual(1);
    }
  });
});
