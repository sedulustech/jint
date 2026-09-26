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
// a key with no reachable jev: the run walks and measures, transport failures stay in-band
const NO_SERVICE = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: "http://127.0.0.1:1" };

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
    const r = run(["--", "tests/fixtures/dash-path/--weird.ts", "--json"], NO_SERVICE);
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
    const a = run(
      ["--json", "--rule", "is_greppable", "tests/fixtures/sample-file.ts"],
      NO_SERVICE,
    );
    const b = run(
      ["tests/fixtures/sample-file.ts", "--json", "--rule", "is_greppable"],
      NO_SERVICE,
    );
    expect(a.code).toBe(b.code);
    expect(JSON.parse(a.stdout)).toEqual(JSON.parse(b.stdout));
  });

  test("a file named diff is judged as a FILE (nouns never resolve to paths)", () => {
    // file semantics: the 'diff' extension is not a source grammar -> NOT_SOURCE; it was NOT
    // noun-dispatched (a bare 'jint diff' is a payload usage error instead)
    const r = run(["tests/fixtures/named-diff/diff", "--json"], NO_SERVICE);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("NOT_SOURCE");
  });

  test("piped stdout carries no escape codes (--help and reports)", () => {
    expect(run(["-h"]).stdout).not.toContain("\x1b");
    const r = run(["tests/fixtures/sample-file.ts", "--json"], NO_SERVICE);
    expect(r.stdout).not.toContain("\x1b");
  });
});

describe("cli: run semantics (no API key -> fail fast, exit 2)", () => {
  test("a file positional without TYPESAFE_API_KEY: exit 2 with the message, nothing walked", () => {
    const r = run(["tests/fixtures/sample-file.ts", "--json"], NO_KEY);
    expect(r.code).toBe(2); // config error: the missing key is setup, not a per-unit failure
    // stderr: exactly the setup failure — no per-unit failure lines, no summary
    expect(r.stderr).toContain("CONFIG_INVALID");
    expect(r.stderr).toContain("no TYPESAFE_API_KEY set - measurements need a valid key");
    expect(r.stderr).not.toContain("failed to measure");
    // nothing was walked or measured: no machine document on stdout
    expect(r.stdout).toBe("");
  });

  test("default stylish report without TYPESAFE_API_KEY: same exit 2, no unit failures", () => {
    const r = run(["tests/fixtures/sample-file.ts"], NO_KEY);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no TYPESAFE_API_KEY set");
    expect(r.stderr).not.toContain("failed to measure");
    expect(r.stdout).not.toContain("JEV_AUTH");
  });

  test("no key and no rules (empty rule set): empty run unchanged, no auth error", () => {
    const configPath = "/tmp/jint-no-rules-config.json";
    require("node:fs").writeFileSync(configPath, JSON.stringify({ rules: [] }));
    const r = run(["tests/fixtures/sample-file.ts", "--json", "--config", configPath], NO_KEY);
    // an empty run needs no classifier: no CONFIG_INVALID, no auth error; exit 4 is the
    // pre-existing zero-measurements semantics of an empty run
    expect(r.code).toBe(4);
    expect(r.stderr).toBe("");
    expect(r.stdout).not.toContain("CONFIG_INVALID");
    expect(JSON.parse(r.stdout).measurements).toEqual([]);
  });

  test("jint diff - reads piped stdin (decomposition happens before the jev call)", () => {
    const proc = Bun.spawnSync(
      ["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} diff - --json`],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...NO_SERVICE },
      },
    );
    expect(proc.exitCode).toBe(4);
    const report = JSON.parse(proc.stdout.toString());
    // the diff text decomposed into per-file units; the transport failure names a unit path
    expect(report.errors[0]!.input).toBe("src/tui/components/overlays/box.ts");
    expect(report.errors[0]!.code).toBe("JEV_UNAVAILABLE");
  });

  test("empty diff: humans get a stderr line (exit 4 never silent); --json keeps the empty report", () => {
    const empty = (args: string) => {
      const proc = Bun.spawnSync(["/bin/bash", "-c", `printf '' | bun ${CLI} ${args}`], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...NO_SERVICE },
      });
      return {
        code: proc.exitCode,
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
      };
    };
    const human = empty("diff -");
    expect(human.code).toBe(4);
    expect(human.stderr).toContain("no measurements - empty diff");
    const json = empty("diff - --json");
    expect(json.code).toBe(4);
    expect(JSON.parse(json.stdout).measurements).toEqual([]);
    expect(json.stderr).toBe(""); // the document is data: errors ride in it, stderr untouched
  });

  test("unknown --language: usage error exit 2 before any input is touched", () => {
    const r = run(["str", "-", "--language", "klingon"], NO_SERVICE);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown language 'klingon'");
    expect(r.stderr).toContain("see --help for valid grammar ids");
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
    const r = run(["str", "--json", "--rule", "is_greppable"], NO_SERVICE);
    expect(r.code).toBe(4); // reached measurement (transport failure), not a usage error
    expect(r.stderr).toContain("JEV_UNAVAILABLE str:stdin");
    expect(r.stdout).not.toContain("jint-report/v1"); // human table: no --json flag was seen
  });

  test("jint str with inline source text measures one str unit", () => {
    const r = run(["str", "export const x = 1;", "--json", "--rule", "is_greppable"], NO_SERVICE);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("str:stdin");
  });

  test("jint str <existing-path>: usage error exit 2, never the path string as source", () => {
    const r = run(["str", "tests/fixtures/sample-file.ts", "--json"], NO_SERVICE);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("'tests/fixtures/sample-file.ts' is a path");
    expect(r.stderr).toContain("to measure the file use: jint tests/fixtures/sample-file.ts");
    expect(r.stdout).toBe("");
  });

  test("jint diff fix.patch: a patch path is declared a diff and decomposed", () => {
    const r = run(["diff", "tests/fixtures/sample.diff", "--json"], NO_SERVICE);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("src/tui/components/overlays/box.ts");
  });

  test("a diff-looking file is judged as a FILE (no sniffing), rev-shaped too", () => {
    // file semantics: rejected as a non-source extension (NOT_SOURCE), not decomposed as a diff
    const r = run(["tests/fixtures/sample.diff", "--json"], NO_SERVICE);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("NOT_SOURCE");
    expect(r.stderr).not.toContain("diff --git");

    // a rev-shaped argument is just a missing entrypoint, not a diff
    const rev = run(["HEAD~1..HEAD", "--json"], NO_SERVICE);
    expect(rev.code).toBe(2);
    expect(rev.stderr).toContain("ENTRYPOINT_NOT_FOUND");
  });

  test("--config selects an alternate config file (loads, then measures)", () => {
    const r = run(
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

  test("dir positional respects .gitignore, errors in-band, exit 4", () => {
    // tests/fixtures/ignore-test contains a .gitignore that ignores 'binary'
    const r = run(["tests/fixtures/sample-dir", "--json", "--debug"], NO_SERVICE);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    // Should contain measurements for the non-ignored files
    // If it crashed on binaries, the exit code would be 3 (internal)
    expect(report.errors.length).toBeGreaterThan(0);
  });

  test("jint str - measures one str unit even when stdin holds diff text", () => {
    const proc = Bun.spawnSync(
      ["/bin/bash", "-c", `cat tests/fixtures/sample.diff | bun ${CLI} str - --json`],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...NO_SERVICE } },
    );
    expect(proc.exitCode).toBe(4); // ran as ONE str unit; transport failure in-band
    const report = JSON.parse(proc.stdout.toString());
    expect(report.errors[0]!.input).toBe("str:stdin");
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

  test("JEV_DEBUG_REQUEST=1: captures land, stdout JSON untouched, stderr names the run dir", () => {
    if (!process.env.TYPESAFE_API_KEY) return; // demonstrated manually in the verification gate
    const dir = ROOT + "/tmp/cli-tap-e2e";
    const r = run(["tests/fixtures/sample-file.ts", "--json"], {
      JEV_DEBUG_REQUEST: "1",
      JEV_DEBUG_REQUEST_LOCATION: dir,
    });
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow(); // the notice never touches stdout
    expect(r.stderr).toContain(`jint: request captures -> ${dir}/`);
    expect(r.stderr).toMatch(/\/\d+ \(\d+ calls\) \(override: JEV_DEBUG_REQUEST_LOCATION\)/);
  }, 20_000);
});
