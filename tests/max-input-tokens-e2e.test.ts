import { describe, expect, jest, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./helpers/cli.ts";
import { scratchDir } from "./helpers/dir.ts";

jest.setTimeout(60_000);

// maxInputTokens sizes each call against a model's input window. The mock server enforces a window
// the way a small decision model does: a request over it gets 400 context_length_exceeded. Its
// tokenizer counts one token per 2 characters of the request JSON, twice jint's default. The same
// three functions run under a small and a large rule set: the room an element gets depends on the
// questions of the rules that apply to it.
const WINDOW = 4000;
const CHARS_PER_TOKEN = 2;
const PAD = "x".repeat(180);

function rule(n: number) {
  return {
    name: `rule_${n}`,
    kind: "choice",
    target: "functions",
    instructions: `Question ${n}. ${PAD.repeat(2)}`,
    criteria: { fine: `Fine. ${PAD}`, bad: `Bad. ${PAD}` },
    handle: { choices: { fine: "pass", bad: "warn" } },
  };
}

const SOURCE = [
  "export function small() {\n  return 1;\n}\n",
  `export function medium() {\n  return "${"m".repeat(3000)}";\n}\n`,
  `export function huge() {\n  return "${"h".repeat(9000)}";\n}\n`,
].join("\n");

function startWindowedServer() {
  let overWindow = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = (await request.json()) as {
        state: unknown;
        questions: Record<string, unknown>;
      };
      if (
        Math.ceil(JSON.stringify([body.state, body.questions]).length / CHARS_PER_TOKEN) > WINDOW
      ) {
        overWindow++;
        return Response.json(
          { error: { code: "context_length_exceeded", message: "input is over the window" } },
          { status: 400 },
        );
      }
      const answers = Object.fromEntries(
        Object.keys(body.questions).map((name) => [
          name,
          {
            type: "choice",
            choice: "fine",
            probabilities: { fine: 0.9, bad: 0.1 },
            confidence: 0.9,
            truncated: false,
          },
        ]),
      );
      return Response.json({ model: "m", answers, usage: { input_tokens: 1, output_tokens: 0 } });
    },
  });
  return {
    overWindow: () => overWindow,
    url: `http://127.0.0.1:${server.port}/v1/systemone`,
    stop: () => server.stop(true),
  };
}

async function runWith(
  ruleCount: number,
  maxInputTokens: number | undefined,
  charsPerToken?: number,
) {
  const dir = scratchDir(`jint-window-${Math.random().toString(36).slice(2)}`);
  const config = join(dir, "jint.config.json");
  const source = join(dir, "unit.ts");
  const rules = Array.from({ length: ruleCount }, (_, i) => rule(i + 1));
  const body: Record<string, unknown> = { rules: { use: rules } };
  if (maxInputTokens !== undefined) body.maxInputTokens = maxInputTokens;
  if (charsPerToken !== undefined) body.charsPerToken = charsPerToken;
  writeFileSync(config, JSON.stringify(body));
  writeFileSync(source, SOURCE);
  const server = startWindowedServer();
  try {
    const run = await runCli(["run", source, "--config", config, "--json"], {
      env: { JINT_API_URL: server.url, JINT_API_MODEL: "m", JINT_API_KEY: "" },
    });
    if (run.stdout === "") throw new Error(`no report: ${run.stderr}`);
    const report = JSON.parse(run.stdout);
    return { report, overWindow: server.overWindow(), stderr: run.stderr };
  } finally {
    server.stop();
  }
}

const judgedFunctions = (report: any): Set<string> =>
  new Set(report.classifications.map((c: any) => c.element?.label ?? c.input));

describe("maxInputTokens against a server with an input window", () => {
  test("an element's room depends on the rules that apply to it, and no call goes over the window", async () => {
    const few = await runWith(2, WINDOW, CHARS_PER_TOKEN);
    const many = await runWith(6, WINDOW, CHARS_PER_TOKEN);

    // nothing is ever sent over the window
    expect(few.overWindow).toBe(0);
    expect(many.overWindow).toBe(0);
    expect(few.report.errors ?? []).toHaveLength(0);
    expect(many.report.errors ?? []).toHaveLength(0);

    // 2 rules: small and medium fit, huge is skipped. 6 rules: only small fits.
    expect(judgedFunctions(few.report).size).toBe(2);
    expect(judgedFunctions(many.report).size).toBe(1);
    expect(few.report.classifications).toHaveLength(2 * 2);
    expect(many.report.classifications).toHaveLength(6);

    // each skip is named, with the window budget
    const skipNotes = (r: any) => r.notes.filter((n: string) => n.includes("skipped:"));
    expect(skipNotes(few.report)).toHaveLength(1);
    expect(skipNotes(many.report)).toHaveLength(2);
    expect(skipNotes(many.report)[0]).toContain(`${WINDOW}-token input window`);
  });

  test("the default of 4 characters per token undercounts this tokenizer, and the server refuses", async () => {
    const run = await runWith(6, WINDOW);
    expect(run.overWindow).toBeGreaterThan(0);
  });

  test("control: without the key the same run sends over the window and the server refuses", async () => {
    const run = await runWith(6, undefined);
    expect(run.overWindow).toBeGreaterThan(0);
    expect(run.report.errors.length).toBeGreaterThan(0);
  });
});
