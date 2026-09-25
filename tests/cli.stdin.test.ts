import { describe, test, expect, afterAll } from "bun:test";

// Piped-stdin str units: no input flags + non-TTY stdin = one str unit, never a diff.
// The jev adapter is pointed at a local mock of POST /v1/systemone so the runs measure for real.

const ROOT = import.meta.dir + "/..";
const CLI = "src/cli.ts";

const SNIPPET = [
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
].join("\n");

/** Mock of the vendor wire: answer every question in the request with a valid shape. */
const server = Bun.serve({
  port: 0,
  idleTimeout: 30,
  async fetch(req) {
    const body = (await req.json()) as {
      questions?: Record<string, { type?: string }>;
    };
    const answers: Record<string, unknown> = {};
    for (const [name, question] of Object.entries(body.questions ?? {})) {
      answers[name] =
        question.type === "score" ? { type: "score", score: 1 } : { type: "noul", noul: 0.8 };
    }
    return Response.json(
      { model: "jev-latest", answers, usage: { input_tokens: 1, output_tokens: 1 } },
      { headers: { "Content-Type": "application/json" } },
    );
  },
});

const MOCK_ENV = {
  TYPESAFE_API_KEY: "test-key",
  TYPESAFE_BASE_URL: `http://localhost:${server.port}`,
};

async function runWithStdin(
  stdin: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Async spawn: the mock jev server lives in THIS process — a synchronous wait would block
  // its event loop and the child would hang waiting for answers.
  const quoted = args.map((a) => `'${a}'`).join(" ");
  const proc = Bun.spawn(["/bin/bash", "-c", `printf '%s' "$STDIN" | bun ${CLI} ${quoted}`], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...MOCK_ENV, STDIN: stdin },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

afterAll(() => server.stop(true));

/** Rules-only-or-input probe config in a temp dir; returns the path. */
async function writeProbeConfig(config: Record<string, unknown>): Promise<string> {
  const path = `/tmp/jint-probe-config-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await Bun.write(path, JSON.stringify(config));
  return path;
}

describe("cli: piped stdin str unit", async () => {
  test("snippet | jint --json: parses, measurements present", async () => {
    const r = await runWithStdin(SNIPPET, ["--json"]);
    expect([0, 1]).toContain(r.code); // findings decide; the run itself measured
    const report = JSON.parse(r.stdout);
    expect(report.measurements.length).toBeGreaterThan(0);
    expect(report.measurements[0]!.input).toBe("input");
  });

  test("--language typescript with a rule filter: element measurements appear", async () => {
    const r = await runWithStdin(SNIPPET, [
      "--json",
      "--language",
      "typescript",
      "--rule",
      "is_function_srp",
    ]);
    const report = JSON.parse(r.stdout);
    const elements = report.measurements.filter((m: { stage?: string }) => m.stage === "element");
    expect(elements.length).toBeGreaterThan(0);
    expect(elements[0]!.input).toMatch(/^input#L\d/);
  });

  test("no --language: unit-scoped rules still measure, mapping fails in-band", async () => {
    const r = await runWithStdin(SNIPPET, ["--json", "--rule", "is_greppable"]);
    const report = JSON.parse(r.stdout);
    expect(report.measurements.length).toBeGreaterThan(0);
    expect(report.measurements.every((m: { stage?: string }) => m.stage === "file")).toBe(true);
    expect(report.errors.map((e: { code: string }) => e.code)).toContain("WALK_FAILED");
  });

  test("human output: same stylish table, identity 'input'", async () => {
    const r = await runWithStdin(SNIPPET, ["--rule", "is_greppable"]);
    expect(r.code).toBeLessThan(2); // the run happened; findings decide 0 vs 1
    // the failed unit names the stdin identity on stderr (stream discipline: errors there)
    expect(r.stderr).toContain("WALK_FAILED input");
    expect(r.stdout).not.toContain("WALK_FAILED");
  });

  test("config-only non-TTY: empty piped stdin falls through to config.input (no stdin read)", async () => {
    const configPath = await writeProbeConfig({ input: "tests/fixtures/sample-file.ts" });
    // stdin is piped but EMPTY: must not hard-error, must measure config.input
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
      "--file",
      "tests/fixtures/sample-dir/good.ts",
    ]);
    expect(r.code).toBeLessThan(2);
    const report = JSON.parse(r.stdout);
    const inputs = report.measurements.map((m: { input: string }) => m.input);
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i: string) => i.startsWith("tests/fixtures/sample-dir/good.ts"))).toBe(
      true,
    );
  });

  test("stdin beats config.input: piped snippet measures as the str unit, config ignored", async () => {
    const configPath = await writeProbeConfig({ input: "tests/fixtures/sample-file.ts" });
    const r = await runWithStdin(SNIPPET, [
      "--config",
      configPath,
      "--json",
      "--rule",
      "is_greppable",
    ]);
    expect(r.code).toBeLessThan(2);
    const report = JSON.parse(r.stdout);
    const inputs = report.measurements.map((m: { input: string }) => m.input);
    expect(inputs).toEqual(["input"]); // the stdin str unit, not the config file
  });

  test("piped stdin with --diff flag stays the diff door (stdin consumed by --diff -)", async () => {
    // stdin content is a diff here; explicit flag wins, no disambiguation
    const r = await runWithStdin("not a diff at all", ["--diff", "-", "--json"]);
    const report = JSON.parse(r.stdout);
    // decomposed as a diff: the JEV_AUTH-or-measurement unit names a diff path, or the diff
    // itself failed loudly - either way it was NOT treated as a str snippet named "input"
    const allInputs = [
      ...report.measurements.map((m: { input: string }) => m.input),
      ...report.errors.map((e: { input: string }) => e.input),
    ];
    expect(allInputs).not.toContain("input");
  });
});
