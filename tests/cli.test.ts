import { describe, test, jest, expect, afterEach, afterAll } from "bun:test";
import { runCli, runShell, CLI_SRC as CLI } from "./helpers/cli.ts";
import { expectContract } from "./helpers/contract.ts";
import { startMockProvider } from "./helpers/mock-provider.ts";

// the repo this test file lives in - never a sibling checkout, so worktree
// runs exercise the worktree's own rules and calibration
const ROOT = import.meta.dir + "/..";

// the shared scratch dir: every file that writes into tmp/ creates it through the helper -
// relying on a sibling file's mkdir was the CI flake (file-order dependency on a fresh checkout)
import { rmScratchFile, scratchFile } from "./helpers/dir.ts";

// every test here spawns CLI processes: the per-test timeout matches the spawn ceiling
// (60s), so the framework clock cannot undercut a healthy run on a slow runner
jest.setTimeout(60_000);

// Async spawn: tests run concurrently (test.concurrent) and a synchronous wait would serialize
// every CLI process behind the transport-failure retry chain each NO_SERVICE run pays.
// Generous ceiling: every run here boots a whole bun process, and on a loaded CI runner a
// spawn alone has burned seconds before the CLI's own work starts.
async function run(args: string[], env: Record<string, string | undefined> = {}) {
  return runCli(args, { env, timeout: 60_000 });
}

const NO_KEY = { TYPESAFE_API_KEY: "" }; // SDK ignores empty env values -> missing key
// a key with no reachable provider: the run walks and classifies, transport failures stay in-band
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
    expectContract(await run(["run", "--concurrency", "65"]), {
      exit: 2,
      stderr: ["concurrency: must be <= 64", "--help"],
    });
    expectContract(await run(["run", "--concurrency", "abc"]), {
      exit: 2,
      stderr: ["--concurrency must be a number", "--help"],
    });
    expectContract(await run(["run", "--timeout", "0"]), {
      exit: 2,
      stderr: ["timeout: must be a number > 0", "--help"],
    });
  });

  test.concurrent("unknown flag -> usage error, exit 2", async () => {
    expectContract(await run(["--frobnicate"]), { exit: 2, stderr: ["--frobnicate", "--help"] });
  });

  test.concurrent("missing entrypoint -> ENTRYPOINT_NOT_FOUND, exit 2", async () => {
    // NO_SERVICE: input resolution is key-independent (the key check must not mask it)
    const r = await run(["run", "nope/missing.ts"], NO_SERVICE);
    expectContract(r, { exit: 2, stderr: "ENTRYPOINT_NOT_FOUND" });
    // pre-flight ordering: a run that cannot start prints its error ALONE - the rubric
    // block (deliberate for runs that proceed) never buries the actionable line
    expect(r.stderr).not.toContain("measuring with");
  });

  test.concurrent("unknown --rule -> CONFIG_INVALID alone, no rubric pre-print", async () => {
    const r = await run(
      ["run", "--rule", "not_a_rule", "packages/sdk/src/core/types.ts"],
      NO_SERVICE,
    );
    expectContract(r, { exit: 2, stderr: 'unknown rule "not_a_rule"' });
    expect(r.stderr).not.toContain("measuring with");
  });

  test.concurrent("two files classify as file units", async () => {
    const r = await run(
      [
        "run",
        "tests/fixtures/sample-file.ts",
        "tests/fixtures/sample-dir/good.ts",
        "--json",
        "--config",
        "tests/fixtures/configs/scopes-open.json",
      ],
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
      "run",
      "--config",
      "tests/fixtures/configs/invalid.config.json",
      "tests/fixtures/sample-file.ts",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("CONFIG_INVALID");
  });

  test.concurrent("removed flags are just unknown flags: ONE consistent error, exit 2", async () => {
    // no bespoke per-flag hints; an unknown flag is an unknown flag, naming the token
    for (const args of [
      ["--file", "a.ts"],
      ["--dir", "src"],
      ["--kind", "diff"],
      ["--diff", "-"],
      ["--changed", "list.txt"],
    ]) {
      expectContract(await run([...args]), {
        exit: 2,
        stderr: ["unknown option or missing path", "--help"],
      });
    }
  });

  test.concurrent("bare 'jint -' is undeclared: usage error naming jint paths -", async () => {
    const proc = await runCli(["-"], { env: NO_KEY, stdin: "" });
    expect(proc.code).toBe(2);
    expect(proc.stderr).toContain("jint run paths -");
  });

  test.concurrent("a paths payload that is not '-' -> usage error naming the piped form", async () => {
    expectContract(await run(["run", "paths", "definitely-not-here.txt"]), {
      exit: 2,
      stderr: ["'definitely-not-here.txt' is not a payload", "jint run paths - < list.txt"],
      stdout: "empty",
    });
  });

  test.concurrent("two nouns in one run -> usage error, exit 2 (nothing follows the payload)", async () => {
    expectContract(await run(["run", "str", "-", "paths", "-"]), {
      exit: 2,
      stderr: "nothing may follow the payload",
    });
    expectContract(await run(["run", "paths", "-", "str", "-"]), {
      exit: 2,
      stderr: "nothing may follow the payload",
    });
  });

  // the bun runtime eats a LEADING bare '--' from argv, so the flags must ride before it
  test.concurrent("'--' ends flag parsing: a dash-path classifies", async () => {
    const r = await run(
      [
        "run",
        "--json",
        "--config",
        "tests/fixtures/configs/scopes-open.json",
        "--",
        "tests/fixtures/dash-path/--weird.ts",
      ],
      NO_SERVICE,
    );
    expect(r.code).toBe(4); // reached measurement: it was a path, not a flag
    expect(JSON.parse(r.stdout).errors[0]!.input).toBe("tests/fixtures/dash-path/--weird.ts");
  });

  test.concurrent("dash-leading token that is no known flag and no path -> exit 2 with guidance", async () => {
    expectContract(await run(["run", "--", "--nope.ts"]), {
      exit: 2,
      stderr: ["--nope.ts", "--help"],
    });
  });

  test.concurrent("flags before and after positionals are equivalent", async () => {
    const a = await run(
      [
        "--json",
        "--rule",
        "is_greppable",
        "run",
        "tests/fixtures/sample-file.ts",
        "--config",
        "tests/fixtures/configs/scopes-open.json",
      ],
      NO_SERVICE,
    );
    const b = await run(
      [
        "run",
        "tests/fixtures/sample-file.ts",
        "--json",
        "--rule",
        "is_greppable",
        "--config",
        "tests/fixtures/configs/scopes-open.json",
      ],
      NO_SERVICE,
    );
    expect(a.code).toBe(b.code);
    // element inputs carry run-scoped uuids (element-identity design); the run pointer carries a
    // per-spawn timestamp id: strip both before comparing
    const strip = (s: string) => {
      const parsed = JSON.parse(s.replace(/[0-9a-f-]{36}/g, "UUID"));
      delete parsed.run; // the run pointer carries a per-spawn timestamp id
      return parsed;
    };
    expect(strip(a.stdout)).toEqual(strip(b.stdout));
    // two CLI spawns, each fetching a dead base URL: this is the only case that pays
    // the boot cost twice, so it needs more than bun's 5s default on a loaded runner
  }, 30000);

  test.concurrent("a file named diff is judged as a FILE (nouns never resolve to paths)", async () => {
    // file semantics: the 'diff' extension is not a source grammar -> MISSING_GRAMMAR; it was NOT
    // noun-dispatched (a bare noun is a payload usage error instead)
    expectContract(
      await run(
        [
          "run",
          "tests/fixtures/named-diff/diff",
          "--json",
          "--config",
          "tests/fixtures/configs/scopes-open.json",
        ],
        NO_SERVICE,
      ),
      {
        exit: 2,
        stderr: "MISSING_GRAMMAR",
      },
    );
  });

  // NO_SERVICE points at a dead base URL and the CLI performs a real fetch; connection
  // latency varies on loaded CI runners, so this test gets a generous ceiling (bun's 5s
  // default flaked here on ubuntu-latest, and the CLI's own spawn carries its own timeout)
  test.concurrent("piped stdout carries no escape codes (--help and reports)", async () => {
    expect((await run(["-h"])).stdout).not.toContain("\x1b");
    const r = await run(["run", "tests/fixtures/sample-file.ts", "--json"], NO_SERVICE);
    expect(r.stdout).not.toContain("\x1b");
  }, 30000);
});

describe("cli: run semantics (no API key -> fail fast, exit 2)", () => {
  test.concurrent("a file positional without TYPESAFE_API_KEY: exit 2 with the message, nothing walked", async () => {
    const r = await run(["run", "tests/fixtures/sample-file.ts", "--json"], NO_KEY);
    // config error: the missing key is setup, not a per-unit failure; nothing was walked or
    // classified, so stdout stays empty — no machine document
    expectContract(r, {
      exit: 2,
      stderr: ["CONFIG_INVALID", "no TYPESAFE_API_KEY set - measurements need a valid key"],
      stdout: "empty",
    });
    expect(r.stderr).not.toContain("failed to classify");
  });

  test.concurrent("default raw-line stdout without TYPESAFE_API_KEY: same exit 2, no unit failures", async () => {
    const r = await run(["run", "tests/fixtures/sample-file.ts"], NO_KEY);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no TYPESAFE_API_KEY set");
    expect(r.stderr).not.toContain("failed to classify");
    expect(r.stdout).not.toContain("PROVIDER_AUTH");
  });

  test.concurrent("config resolving to zero rules: CONFIG_NO_RULES, exit 2 (an empty run is an error, not a headline)", async () => {
    const configPath = "/tmp/jint-no-rules-config.json";
    require("node:fs").writeFileSync(configPath, JSON.stringify({ rules: [] }));
    const r = await run(
      ["run", "tests/fixtures/sample-file.ts", "--json", "--config", configPath],
      NO_KEY,
    );
    // The old contract (empty rule set = legal, empty measurements, exit 4) enshrined the
    // "0 rules" nonsense run: nothing could ever be measured. A run that would measure
    // nothing is now a named setup error, like every config problem.
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("CONFIG_NO_RULES");
    expect(r.stdout).not.toContain("CONFIG_NO_RULES"); // errors ride stderr, stdout stays data
  });

  test.concurrent("jint paths - reads the stdin path list: the list IS the judged subject", async () => {
    const proc = await runCli(["run", "paths", "-", "--json", "--rule", "is_greppable"], {
      env: NO_SERVICE,
      stdin: "tests/fixtures/sample-file.ts\n",
    });
    expect(proc.code).toBe(4);
    const report = JSON.parse(proc.stdout);
    // the listed file was judged: the transport failure names it (subject came from the list)
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]!.input.startsWith("tests/fixtures/sample-file.ts")).toBe(true);
  });

  test.concurrent("a path-list entry that is not in the walk is a NOTE, never silence", async () => {
    const proc = await runCli(["run", "paths", "-", "--json", "--rule", "is_greppable"], {
      env: NO_SERVICE,
      stdin: "tests/fixtures/sample-file.ts\nno/such/file.ts\n",
    });
    expect(proc.code).toBe(4);
    const report = JSON.parse(proc.stdout);
    expect(
      report.notes.some(
        (n: string) => n.includes("not found in the walk") && n.includes("no/such/file.ts"),
      ),
    ).toBe(true);
  });

  test.concurrent("jint paths - < file: the piped list IS the judged subject", async () => {
    const list = scratchFile("cli-paths-list") + ".txt";
    require("node:fs").writeFileSync(list, "tests/fixtures/sample-file.ts\n");
    const proc = await runCli(["run", "paths", "-", "--json", "--rule", "is_greppable"], {
      env: NO_SERVICE,
      stdin: { file: list },
    });
    expect(proc.code).toBe(4);
    const report = JSON.parse(proc.stdout);
    // the transport failure names the listed file: the piped list, not a file argument, selected it
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]!.input.startsWith("tests/fixtures/sample-file.ts")).toBe(true);
    rmScratchFile(list);
  });

  test.concurrent("a noun that is not FIRST -> usage error, exit 2 (no mid-list noun)", async () => {
    // the old order-free form (jint <dir> paths <file>) is gone: the list can never select
    // alongside another input, because the noun IS the whole input declaration
    expectContract(await run(["run", "tests/fixtures/sample-dir", "paths", "-"]), {
      exit: 2,
      stderr: "a noun is the FIRST positional",
      stdout: "empty",
    });
  });

  test.concurrent("a path list whose entries ALL miss the walk: exit 4 (ran, measured nothing), notes in-band", async () => {
    const proc = await runCli(["run", "paths", "-", "--json", "--rule", "is_greppable"], {
      env: NO_SERVICE,
      stdin: "no/such/a.ts\nno/such/b.ts\n",
    });
    // error taxonomy: the run RAN and measured nothing -> exit 4, not exit 2 (usage/config)
    expect(proc.code).toBe(4);
    const report = JSON.parse(proc.stdout);
    expect(report.measurements).toEqual([]);
    for (const p of ["no/such/a.ts", "no/such/b.ts"]) {
      expect(
        report.notes.some((n: string) => n.includes("not found in the walk") && n.includes(p)),
      ).toBe(true);
    }
  });

  test.concurrent("--diff-patch is gone: unknown flag, exit 2", async () => {
    expectContract(await run(["run", "tests/fixtures/sample-file.ts", "--diff-patch", "p.patch"]), {
      exit: 2,
      stderr: "unknown option",
    });
  });

  test.concurrent("unknown --language: usage error exit 2 before any input is touched", async () => {
    expectContract(await run(["run", "str", "-", "--language", "klingon"], NO_SERVICE), {
      exit: 2,
      // same shape as the SDK's unknown-language throws: message, capped valid list, code
      stderr: [
        "unknown language 'klingon'",
        "valid: typescript, tsx, python, markdown, php, go ...",
        "[MISSING_GRAMMAR]",
      ],
      stdout: "empty",
    });
  });

  test.concurrent("piped stdin without a noun -> usage error, exit 2, guidance (never guessed)", async () => {
    const proc = await runCli(["run", "--json"], {
      env: NO_KEY,
      stdin: { file: "tests/fixtures/sample.diff" },
    });
    expect(proc.code).toBe(2);
    expect(proc.stderr).toContain("jint run str -");
    expect(proc.stderr).toContain("jint run paths -");
  });

  test.concurrent("TTY with payload '-' -> immediate usage error, never blocks", async () => {
    // script(1) allocates a pty so process.stdin.isTTY is true in the child.
    // The ONLY shell escape hatch left: this test needs a pseudo-TTY (a TTY stdin the CLI must
    // refuse to read), and no argv spawn can provide one. util-linux script takes -e -c and the
    // command as a single arg; the BSD/macOS script takes the command positionally — two spellings.
    const script =
      process.platform === "darwin"
        ? `script -q /dev/null bun ${CLI} run str -`
        : `script -qec 'bun ${CLI} run str -' /dev/null`;
    const proc = await runShell(script, NO_KEY);
    const out = proc.stdout + proc.stderr;
    expect(proc.code).toBe(2);
    expect(out).toContain("no piped stdin to read");
  });

  test.concurrent("jint run str --json: the flag parses, so the noun has no payload (usage error)", async () => {
    // inside run there is no noun ride: a flag-looking token after the noun IS parsed as a flag,
    // and the noun is left without its '-' payload - still loud, still naming the remedy
    expectContract(await run(["run", "str", "--json"]), {
      exit: 2,
      stderr: ["expects a payload", "jint run str -"],
      stdout: "empty",
    });
  });

  test.concurrent("jint run str -- --json: a flag-shaped payload is still not the payload", async () => {
    // the payload rule stays uniform: after -- the token reaches the noun verbatim, and anything
    // but '-' is a usage error - never inline source, never a parsed flag riding the noun
    expectContract(await run(["run", "str", "--", "--json"]), {
      exit: 2,
      stderr: ["'--json' is not a payload", "jint run str -"],
      stdout: "empty",
    });
  });

  test.concurrent("jint run str has no inline payload: source must be piped (jint run str -)", async () => {
    expectContract(await run(["run", "str", "export const x = 1;"]), {
      exit: 2,
      stderr: ["'export const x = 1;' is not a payload", "jint run str -"],
      stdout: "empty",
    });
  });

  test.concurrent("jint run str <existing-path>: usage error exit 2 (nouns never resolve to paths)", async () => {
    expectContract(await run(["run", "str", "tests/fixtures/sample-file.ts"]), {
      exit: 2,
      stderr: ["'tests/fixtures/sample-file.ts' is not a payload", "jint run str -"],
      stdout: "empty",
    });
  });

  test.concurrent("all units fail: exit 4 with the failures named on stderr", async () => {
    const proc = await runCli(["run", "str", "-"], { env: NO_SERVICE, stdin: "x" });
    expect(proc.code).toBe(4); // every unit failed -> the run failed (never exit 0)
    // raw-line stderr: the failed unit renders as its own error line; totals stay zero-findings
    expect(proc.stderr).toMatch(/error PROVIDER_\w+ str:stdin:/);
    expect(proc.stderr).toContain("jint: 0 problems (0 errors, 0 warnings)");
  });

  test.concurrent("a patch file is just a file: MISSING_GRAMMAR, never decomposed (there is no diff noun)", async () => {
    const r = await run(["run", "diff", "tests/fixtures/sample.diff", "--json"], NO_SERVICE);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("file not found: diff");
  });

  test.concurrent("a diff-looking file is judged as a FILE (no sniffing), rev-shaped too", async () => {
    // file semantics: rejected as a non-source extension (MISSING_GRAMMAR), not decomposed as a diff
    const r = await run(
      [
        "run",
        "tests/fixtures/sample.diff",
        "--json",
        "--config",
        "tests/fixtures/configs/scopes-open.json",
      ],
      NO_SERVICE,
    );
    expectContract(r, { exit: 2, stderr: "MISSING_GRAMMAR" });
    expect(r.stderr).not.toContain("diff --git");

    // a rev-shaped argument is just a missing entrypoint, not a diff
    expectContract(await run(["run", "HEAD~1..HEAD", "--json"], NO_SERVICE), {
      exit: 2,
      stderr: "ENTRYPOINT_NOT_FOUND",
    });
  });

  test.concurrent("--config selects an alternate config file (loads, then classifies)", async () => {
    const r = await run(
      [
        "run",
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
    expect(report.errors[0]!.code).toBe("PROVIDER_UNAVAILABLE");
  });

  test.concurrent("dir positional respects .gitignore, errors in-band, exit 4", async () => {
    // tests/fixtures/ignore-test contains a .gitignore that ignores 'binary'
    // own config: the root config excludes tests subtree on the config-relative basis (which
    // would correctly empty this walk) - this test asserts walker/gitignore behavior, not that
    const ownConfig = "/tmp/jint-gitignore-contract.json";
    require("node:fs").writeFileSync(ownConfig, JSON.stringify({ rules: ["is_greppable"] }));
    const r = await run(
      ["run", "tests/fixtures/sample-dir", "--json", "--debug", "--config", ownConfig],
      NO_SERVICE,
    );
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    // Should contain measurements for the non-ignored files
    // If it crashed on binaries, the exit code would be 3 (internal)
    expect(report.errors.length).toBeGreaterThan(0);
  }, 30000);

  test.concurrent("jint str - classifies one str unit even when stdin holds diff text", async () => {
    const proc = await runCli(["run", "str", "-", "--json"], {
      env: NO_SERVICE,
      stdin: { file: "tests/fixtures/sample.diff" },
    });
    expect(proc.code).toBe(4); // ran as ONE str unit; transport failure in-band
    const report = JSON.parse(proc.stdout);
    expect(report.errors[0]!.input).toBe("str:stdin");
  });
});

// Structural claims of the live tests, always on over the mock: these are CONTRACT claims
// (report shape, tap activation, walker exclusions) that never needed a real model. They run
// keyless — a mock here is what makes a regression visible in every run.
describe("cli: mocked provider twins (structural claims, always on)", () => {
  const provider = startMockProvider();
  const MOCK_ENV = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: provider.baseUrl };
  // Async spawn: the mock provider server lives in THIS process — a synchronous spawn would block its
  // event loop and the child would hang waiting for answers.
  async function runMock(args: string[], env: Record<string, string> = {}) {
    return runCli(args, { env: { ...MOCK_ENV, ...env }, timeout: 60_000 });
  }
  afterAll(() => provider.stop());
  test.concurrent("recording persists report.json: the exact stdout --json bytes, next to the requests", async () => {
    const { rmSync } = await import("node:fs");
    const dir = ROOT + "/tmp/cli-tap-report";
    rmSync(dir, { recursive: true, force: true }); // no stale run dirs from past invocations
    const r = await runMock(
      [
        "run",
        "tests/fixtures/sample-file.ts",
        "--json",
        "--rule",
        "is_greppable",
        "--config",
        "tests/fixtures/configs/scopes-open.json",
      ],
      {
        JINT_RUNS_DIR: dir,
      },
    );
    expect(r.code).toBe(0);
    // the stderr notice names THIS run's dir; report.json sits next to the requests
    const runDir = /requests -> (.+) \(\d+ calls\)/.exec(r.stderr)?.[1];
    expect(runDir).toBeTruthy();
    const report = JSON.parse(
      await (await import("node:fs/promises")).readFile(`${runDir}/report.json`, "utf8"),
    );
    // the persisted document is BYTE-IDENTICAL to stdout --json: one serializer, one truth
    const reportBytes = await (
      await import("node:fs/promises")
    ).readFile(`${runDir}/report.json`, "utf8");
    expect(reportBytes).toBe(r.stdout);
    expect(report).toEqual(JSON.parse(r.stdout));
    // The run pointer rides the same bytes: run.dir names THIS run's store dir, run.id its id;
    // run.input is the accounting (a single explicit file: discovered, included, no drops).
    expect(report.run).toEqual({
      id: runDir!.split("/").pop(),
      dir: runDir,
      input: {
        discovered: 1,
        included: 1,
        excluded: [],
        skipped: [],
        admitted: [{ by: "config", count: 1 }],
      },
    });
  });

  test.concurrent("file positional: measurements over a corpus, clean exit 0, values in [0,1]", async () => {
    // High-good noul rules only: the mock's 0.8 is clean under every one of their handles, so a
    // healthy run over a healthy corpus really does exit 0 (is_readable is score-typed and the
    // high-bad rules fire by design under a constant answer).
    const r = await runMock([
      "run",
      "tests/fixtures/sample-file.ts",
      "tests/fixtures/sample-dir/good.ts",
      "--json",
      "--config",
      "tests/fixtures/configs/scopes-open.json",
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

  test.concurrent("JINT_RUNS_DIR moves the run dir: captures land under the override, stdout untouched", async () => {
    // (async runMock: the in-process mock cannot answer while a spawnSync blocks the loop)
    const dir = `/tmp/jint-dump-cli-${Date.now()}`;
    // DEFAULT stdout (no --json): raw lines are the projection; report.json persists anyway
    const r = await runMock(
      [
        "run",
        "tests/fixtures/sample-file.ts",
        "--rule",
        "is_greppable",
        "--config",
        "tests/fixtures/configs/scopes-open.json",
      ],
      {
        JINT_RUNS_DIR: dir,
      },
    );
    expectContract(r, { exit: 0, stdout: "lines" });
    expect(r.stderr).toContain(`jint: requests -> ${dir}/`);
    expect(r.stderr).toMatch(/\(\d+ calls\) \(override: JINT_RUNS_DIR\)/);
    // the canonical artifact lands in the run dir even on raw-line runs
    const reportPath = [...new Bun.Glob("**/report.json").scanSync({ cwd: dir })][0]!;
    const reportJson = await (
      await import("node:fs/promises")
    ).readFile(`${dir}/${reportPath}`, "utf8");
    expect(() => JSON.parse(reportJson)).not.toThrow();
    const captures = [...new Bun.Glob("**/*.json").scanSync({ cwd: dir })];
    // report.json is written for EVERY recording run — persistence is not gated on --json
    expect(captures.some((f) => f.endsWith("report.json"))).toBe(true);
    expect(captures.some((f) => f.endsWith("manifest.json"))).toBe(true);
    expect(captures.length).toBeGreaterThan(2); // the recorded requests
    expect(r.stdout).not.toContain("{"); // raw lines, never json on default stdout
  });
});

// Live round trips assert MODEL BEHAVIOR (calibration), not contract — the mocked twins above own
// every structural claim. Opt-in only: set RUN_LIVE_TESTS=1 AND TYPESAFE_API_KEY. A run that asks
// for live tests without a key fails loud; the old silent skip hid a regression once already.
describe("cli: live provider round trip (opt-in: RUN_LIVE_TESTS=1 + TYPESAFE_API_KEY)", () => {
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
    const r = await run(["run", "tests/fixtures/sample-file.ts", "--json"]);
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

  test.concurrent("always-on recording: captures land, stdout JSON untouched, stderr names the run dir", async () => {
    if (!requireLive()) return;
    const dir = ROOT + "/tmp/cli-tap-e2e";
    const r = await run(["run", "tests/fixtures/sample-file.ts", "--json"], {
      JINT_RUNS_DIR: dir,
    });
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow(); // the notice never touches stdout
    expect(r.stderr).toContain(`jint: requests -> ${dir}/`);
    expect(r.stderr).toMatch(/\/\d+ \(\d+ calls\) \(override: JINT_RUNS_DIR\)/);
  }, 20_000);
});
