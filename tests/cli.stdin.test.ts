import { describe, test, expect, afterAll } from "bun:test";
import { expectContract } from "./helpers/contract.ts";

// Piped-stdin units: the kind is DECLARED by a noun (jint str - / jint diff -); the str noun
// carries one str unit. The jev adapter is pointed at a local mock of POST /v1/systemone so the
// runs classify for real.

const ROOT = import.meta.dir + "/..";
const CLI = "src/cli.ts";

const SNIPPET = [
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
].join("\n");

/** The noul value every mocked answer carries; tests set it to steer finding severity. */
let mockAnswer = 0.8;
/** The last wire body the mock saw, for pinning the exact request bytes. */
let lastWireBody: Record<string, unknown> | null = null;

/** Mock of the vendor wire: answer every question in the request with a valid shape. */
const server = Bun.serve({
  port: 0,
  idleTimeout: 30,
  async fetch(req) {
    const body = (await req.json()) as {
      questions?: Record<string, { type?: string }>;
    };
    lastWireBody = body as Record<string, unknown>;
    const answers: Record<string, unknown> = {};
    for (const [name, question] of Object.entries(body.questions ?? {})) {
      answers[name] =
        question.type === "score"
          ? { type: "score", score: 1 }
          : { type: "noul", noul: mockAnswer };
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

afterAll(() => server.stop(true));

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

  test("--language typescript with a rule filter: element measurements appear", async () => {
    const r = await runWithStdin(SNIPPET, [
      "--json",
      "--language",
      "typescript",
      "--rule",
      "is_function_srp",
      "str",
      "-",
    ]); /* flags around the noun are equivalent */
    const report = JSON.parse(r.stdout);
    const elements = report.measurements.filter((m: { stage?: string }) => m.stage === "element");
    expect(elements.length).toBeGreaterThan(0);
    expect(elements[0]!.input).toMatch(/^str:stdin#L\d/);
  });

  test("no --language: unit-scoped rules still classify, mapping fails in-band", async () => {
    const r = await runWithStdin(SNIPPET, ["str", "-", "--json", "--rule", "is_greppable"]);
    const report = JSON.parse(r.stdout);
    expect(report.measurements.length).toBeGreaterThan(0);
    expect(report.measurements.every((m: { stage?: string }) => m.stage === "file")).toBe(true);
    expect(report.errors.map((e: { code: string }) => e.code)).toContain("WALK_FAILED");
  });

  test("human output: same stylish table, identity 'str:stdin'", async () => {
    const r = await runWithStdin(SNIPPET, ["str", "-", "--rule", "is_greppable"]);
    // classified, but the unit also failed to map (no --language): exit 4. The failed unit names
    // the stdin identity on stderr (stream discipline), and the message names the real condition
    // and the remedy (stdin has no extension to map)
    expectContract(r, {
      exit: 4,
      stderr: [
        "WALK_FAILED str:stdin",
        "cannot infer a grammar for piped stdin - declare it with --language",
      ],
    });
    expect(r.stdout).not.toContain("WALK_FAILED");
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
    expect(r.code).toBe(4); // classified, but the unit also failed to map (no --language)
    const report = JSON.parse(r.stdout);
    const inputs = report.measurements.map((m: { input: string }) => m.input);
    expect(inputs).toEqual(["str:stdin"]); // the stdin str unit, not the config file
  });

  test("jint diff - is decomposed as a diff, never a str unit", async () => {
    // stdin content is a diff here; the declared kind wins
    const r = await runWithStdin("not a diff at all", ["diff", "-", "--json"]);
    const report = JSON.parse(r.stdout);
    // decomposed as a diff: the JEV_AUTH-or-measurement unit names a diff path, or the diff
    // itself failed loudly - either way it was NOT treated as a str snippet named str:stdin
    const allInputs = [
      ...report.measurements.map((m: { input: string }) => m.input),
      ...report.errors.map((e: { input: string }) => e.input),
    ];
    expect(allInputs).not.toContain("str:stdin");
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
    lastWireBody = null;
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
    const state = lastWireBody!.state as Record<string, unknown>;
    expect(state.content).toBe(SNIPPET); // the state is the content, never the arg string
    expect(state.path).toBe("str:stdin");
    const questions = lastWireBody!.questions as Record<string, Record<string, unknown>>;
    const names = Object.keys(questions);
    expect(names.some((n) => n.startsWith("is_greppable"))).toBe(true);
    expect(questions[names[0]!]!.criteria).toBeDefined(); // compiled, not raw spec
  });

  test("partial failure (classified + WALK_FAILED) exits 4 even with zero error findings", async () => {
    // is_greppable alone: one file-stage measurement, mock 0.8 is clean under its high-good
    // handle (warn 0.75 / error 0.6), so exit 4 can only come from the failed unit
    const r = await runWithStdin(SNIPPET, ["str", "-", "--json", "--rule", "is_greppable"]);
    const report = JSON.parse(r.stdout);
    expect(report.measurements.length).toBeGreaterThan(0); // it classified
    expect(report.errors.map((e: { code: string }) => e.code)).toContain("WALK_FAILED");
    expect(r.code).toBe(4); // a half-classified run is a failed run
  });

  test("JEV_DEBUG_REQUEST_LOCATION alone turns on dumping for the str path, with the notice", async () => {
    const dumpDir = `/tmp/jint-dump-e2e-${Date.now()}`;
    const r = await runWithStdin(SNIPPET, ["str", "-", "--json", "--rule", "is_greppable"], {
      JEV_DEBUG_REQUEST_LOCATION: dumpDir,
    });
    expect(r.code).toBe(4); // classified, but the unit also failed to map (no --language)
    const captures = [...new Bun.Glob("**/*.json").scanSync({ cwd: dumpDir })];
    expect(captures.length).toBeGreaterThan(0);
    const capture = JSON.parse(await Bun.file(`${dumpDir}/${captures[0]}`).text());
    expect((capture.request.state as Record<string, unknown>).content).toBe(SNIPPET);
    expect(r.stderr).toContain("request captures ->");
    expect(r.stderr).toContain(dumpDir);
  });
});
