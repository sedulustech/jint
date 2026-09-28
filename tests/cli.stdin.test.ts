import { describe, test, expect, afterAll } from "bun:test";
import { expectContract } from "./helpers/contract.ts";
import { startMockJev } from "./helpers/mock-jev.ts";

// Piped-stdin units: the kind is DECLARED by a noun (jint str -) or the changed-list form
// (jint -); the str noun
// carries one str unit. The jev adapter is pointed at a local mock of POST /v1/systemone so the
// runs classify for real.

const ROOT = import.meta.dir + "/..";
const CLI = "src/cli.ts";

const SNIPPET = [
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
].join("\n");

/** The shared mock of the vendor wire; requests[] pins the exact request bytes per test. */
const jev = startMockJev();

const MOCK_ENV = {
  TYPESAFE_API_KEY: "test-key",
  TYPESAFE_BASE_URL: jev.baseUrl,
};

async function runWithStdin(
  stdin: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Async spawn: the mock jev server lives in THIS process — a synchronous wait would block
  // its event loop and the child would hang waiting for answers.
  const quoted = args.map((a) => `'${a}'`).join(" ");
  const proc = Bun.spawn(["/bin/bash", "-c", `printf '%s' "$STDIN" | bun ${CLI} ${quoted}`], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...MOCK_ENV, STDIN: stdin, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

afterAll(() => jev.stop());

/** Rules-only-or-input probe config in a temp dir; returns the path. */
async function writeProbeConfig(config: Record<string, unknown>): Promise<string> {
  const path = `/tmp/jint-probe-config-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await Bun.write(path, JSON.stringify(config));
  return path;
}

describe("cli: piped stdin str unit", async () => {
  test("snippet | jint --json: parses, measurements present", async () => {
    const r = await runWithStdin(SNIPPET, ["str", "-", "--json"]);
    expect([0, 1]).toContain(r.code); // findings decide; the run itself classified
    const report = JSON.parse(r.stdout);
    expect(report.measurements.length).toBeGreaterThan(0);
    expect(report.measurements[0]!.input).toBe("str:stdin");
  });

  test("an element-target rule still judges the str unit whole: no grammar, no elements", async () => {
    const before = jev.requests.length;
    const r = await runWithStdin(SNIPPET, [
      "--json",
      "--language",
      "typescript",
      "--rule",
      "is_function_srp",
      "str",
      "-",
    ]); /* flags around the noun are equivalent */
    expect(r.code).toBeLessThan(2);
    const report = JSON.parse(r.stdout);
    // the str unit is its own inventory: the rule's target cannot route it into parsing
    expect(report.measurements.length).toBeGreaterThan(0);
    expect(report.measurements.every((m: { stage?: string }) => m.stage === "file")).toBe(true);
    expect(report.measurements.every((m: { input: string }) => m.input === "str:stdin")).toBe(true);
    // no grammar ever requested: every wire call carries the whole snippet as state.content,
    // never an element state ({path, source})
    const seen = jev.requests.slice(before);
    expect(seen.length).toBeGreaterThan(0);
    for (const wire of seen) {
      expect(wire.state.content).toBe(SNIPPET);
      expect(wire.state.source).toBeUndefined();
      expect(String(wire.state.path)).toBe("str:stdin");
    }
  });

  test("no --language: the str unit classifies whole, no mapping failure", async () => {
    const r = await runWithStdin(SNIPPET, ["str", "-", "--json", "--rule", "is_greppable"]);
    const report = JSON.parse(r.stdout);
    expect(report.measurements.length).toBeGreaterThan(0);
    expect(report.measurements.every((m: { stage?: string }) => m.stage === "file")).toBe(true);
    expect(report.errors).toEqual([]); // the WALK_FAILED + --language remedy never fires for str
  });

  test("human output: same stylish table, identity 'str:stdin', clean exit", async () => {
    const r = await runWithStdin(SNIPPET, ["str", "-", "--rule", "is_greppable"]);
    // the str unit is its own inventory: classified whole, nothing failed, mock reading clean
    expectContract(r, { exit: 0 }); // stderr carries only the request-tap notice, no errors
    expect(r.stdout).toContain("no findings"); // the stylish table rendered, one clean measurement
    expect(r.stdout + r.stderr).not.toContain("WALK_FAILED");
  });

  test("config-only non-TTY: empty piped stdin falls through to config.input (no stdin read)", async () => {
    const configPath = await writeProbeConfig({ input: "tests/fixtures/sample-file.ts" });
    // stdin is piped but EMPTY: must not hard-error, must classify config.input
    const r = await runWithStdin("", ["--config", configPath, "--json", "--rule", "is_greppable"]);
    expect(r.code).toBeLessThan(2);
    const report = JSON.parse(r.stdout);
    const inputs = report.measurements.map((m: { input: string }) => m.input);
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i: string) => i.startsWith("tests/fixtures/sample-file.ts"))).toBe(true);
  });

  test("flags override config.input", async () => {
    const configPath = await writeProbeConfig({ input: "tests/fixtures/sample-file.ts" });
    const r = await runWithStdin("", [
      "--config",
      configPath,
      "--json",
      "--rule",
      "is_greppable",
      "tests/fixtures/sample-dir/good.ts",
    ]); // a positional path overrides config.input
    expect(r.code).toBeLessThan(2);
    const report = JSON.parse(r.stdout);
    const inputs = report.measurements.map((m: { input: string }) => m.input);
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i: string) => i.startsWith("tests/fixtures/sample-dir/good.ts"))).toBe(
      true,
    );
  });

  test("stdin beats config.input: piped snippet classifies as the str unit, config ignored", async () => {
    const configPath = await writeProbeConfig({ input: "tests/fixtures/sample-file.ts" });
    const r = await runWithStdin(SNIPPET, [
      "str",
      "-",
      "--config",
      configPath,
      "--json",
      "--rule",
      "is_greppable",
    ]);
    expect(r.code).toBeLessThan(2); // classified whole; nothing failed to map
    const report = JSON.parse(r.stdout);
    const inputs = report.measurements.map((m: { input: string }) => m.input);
    expect(inputs).toEqual(["str:stdin"]); // the stdin str unit, not the config file
  });

  test("the diff noun is removed: 'jint diff -' is a mistyped-flag usage error", async () => {
    const r = await runWithStdin("not a diff at all", ["diff", "-", "--json"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown option or missing path '-'");
  });

  test("jint - reads the stdin changed-file list (never a str snippet)", async () => {
    const r = await runWithStdin("tests/fixtures/sample-file.ts\n", [
      "-",
      "--json",
      "--rule",
      "is_greppable",
    ]);
    expect(r.code).toBe(0); // the mock jev classifies the listed file cleanly
    const report = JSON.parse(r.stdout);
    const allInputs = [
      ...report.measurements.map((m: { input: string }) => m.input),
      ...report.errors.map((e: { input: string }) => e.input),
    ];
    // the list selected the subject; stdin was NOT treated as a str snippet named str:stdin
    expect(allInputs).not.toContain("str:stdin");
    expect(allInputs.length).toBeGreaterThan(0);
  });

  test("unknown --language: usage error, exit 2, names the language and the remedy", async () => {
    const r = await runWithStdin(SNIPPET, ["str", "-", "--json", "--language", "klingon"]);
    // exit-code contract: unknown language is usage/config, before any input is touched
    expectContract(r, {
      exit: 2,
      stderr: ["unknown language 'klingon'", "see --help for valid grammar ids"],
      stdout: "empty",
    });
  });

  test("jint str <existing-path> is rejected: inline source or '-' only, file remedy named", async () => {
    const r = await runWithStdin("", [
      "str",
      "tests/fixtures/sample-file.ts",
      "--json",
      "--rule",
      "is_greppable",
    ]);
    expectContract(r, {
      exit: 2,
      stderr: ["is a path", "jint tests/fixtures/sample-file.ts"],
      stdout: "empty",
    });
  });

  test("the wire carries the real stdin content, path str:stdin, and the compiled question", async () => {
    const before = jev.requests.length;
    const r = await runWithStdin(SNIPPET, [
      "str",
      "-",
      "--json",
      "--rule",
      "is_greppable",
      "--language",
      "typescript",
    ]);
    expect(r.code).toBeLessThan(2);
    const seen = jev.requests.slice(before);
    expect(seen.length).toBeGreaterThan(0);
    const wire = seen[seen.length - 1]!;
    const state = wire.state;
    expect(state.content).toBe(SNIPPET); // the state is the content, never the arg string
    expect(state.path).toBe("str:stdin");
    const questions = wire.questions;
    const names = Object.keys(questions);
    expect(names.some((n) => n.startsWith("is_greppable"))).toBe(true);
    expect(questions[names[0]!]!.criteria).toBeDefined(); // compiled, not raw spec
  });

  test("the str unit never fails the run: clean classification, zero errors", async () => {
    // is_greppable alone: one file-stage measurement, mock 0.8 is clean under its high-good
    // handle (warn 0.75 / error 0.6); the old grammar race would add a WALK_FAILED and exit 4
    const r = await runWithStdin(SNIPPET, ["str", "-", "--json", "--rule", "is_greppable"]);
    const report = JSON.parse(r.stdout);
    expect(report.measurements.length).toBeGreaterThan(0); // it classified
    expect(report.errors).toEqual([]);
    expect(r.code).toBe(0);
  });

  test("str - with a files-target config rule measures deterministically (20/20 spawns)", async () => {
    // regression pin: a files-target config rule used to route the str unit through grammar
    // mapping and WALK_FAILED it (exit 4) — the rule's target conflated with the input kind.
    // The outcome also raced per run; 20 identical spawns must now all measure the piped text.
    const configPath = await writeProbeConfig({
      rules: [
        {
          name: "is_noul_documented",
          criteria: { true: "documents a noul value", false: "it does not" },
          target: "files",
          handle: { fires_when: "true", warn_at: 0.5, error_at: 0.7 },
        },
      ],
      exclude: [],
    });
    const before = jev.requests.length;
    for (let i = 0; i < 20; i++) {
      const r = await runWithStdin("- **noul** - the number the model returns per question", [
        "str",
        "-",
        "--config",
        configPath,
        "--json",
      ]);
      expect(r.code).toBeLessThan(2);
      const report = JSON.parse(r.stdout);
      expect(report.errors).toEqual([]);
      expect(report.measurements).toHaveLength(1);
      expect(report.measurements[0]!.input).toBe("str:stdin");
      expect(report.measurements[0]!.rule).toBe("is_noul_documented");
    }
    // one whole-unit call per spawn, each carrying the exact piped text as the state
    const seen = jev.requests.slice(before);
    expect(seen).toHaveLength(20);
    for (const wire of seen) {
      expect(wire.state.content).toBe("- **noul** - the number the model returns per question");
      expect(wire.state.path).toBe("str:stdin");
      expect(Object.keys(wire.questions)[0]).toContain("is_noul_documented");
    }
  });

  test("JEV_DEBUG_REQUEST_LOCATION alone turns on dumping for the str path, with the notice", async () => {
    const dumpDir = `/tmp/jint-dump-e2e-${Date.now()}`;
    const r = await runWithStdin(SNIPPET, ["str", "-", "--json", "--rule", "is_greppable"], {
      JEV_DEBUG_REQUEST_LOCATION: dumpDir,
    });
    expect(r.code).toBeLessThan(2); // classified whole; nothing failed to map
    const captures = [...new Bun.Glob("**/*.json").scanSync({ cwd: dumpDir })];
    expect(captures.length).toBeGreaterThan(0);
    const capture = JSON.parse(await Bun.file(`${dumpDir}/${captures[0]}`).text());
    expect((capture.request.state as Record<string, unknown>).content).toBe(SNIPPET);
    expect(r.stderr).toContain("request captures ->");
    expect(r.stderr).toContain(dumpDir);
  });
});
