import { describe, expect, jest, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "./helpers/cli.ts";
import { scratchDir } from "./helpers/dir.ts";

jest.setTimeout(60_000);

// A run against a server that speaks the System One wire (what Lemonade and TypeSafe serve): the
// url's last segment picks the wire, a server on this machine needs no key, and the model is named
// by JINT_API_MODEL. The server is a real HTTP one, so the vendor client's own transport runs.
const RULE = {
  name: "is_comment_justified",
  kind: "choice",
  target: "files",
  instructions: "Which option best describes the worst comment?",
  criteria: { justified: "Every comment states what the code does.", contradicted: "A lie." },
  handle: { choices: { justified: "pass", contradicted: "error" } },
};

function startSystemOne() {
  const seen: { url: string; auth: string | null; body: any }[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = (await request.json()) as {
        questions: Record<string, { type: string; criteria?: Record<string, string> }>;
      };
      seen.push({
        url: new URL(request.url).pathname,
        auth: request.headers.get("Authorization"),
        body,
      });
      const answers = Object.fromEntries(
        Object.entries(body.questions).map(([name]) => [
          name,
          {
            type: "choice",
            choice: "contradicted",
            probabilities: { justified: 0.1, contradicted: 0.9 },
            confidence: 0.8,
            truncated: false,
          },
        ]),
      );
      return Response.json({
        model: "d3-lite-FLM",
        answers,
        usage: { input_tokens: 12, output_tokens: 0 },
      });
    },
  });
  return {
    seen,
    url: `http://127.0.0.1:${server.port}/v1/systemone`,
    stop: () => server.stop(true),
  };
}

describe("jint run against a System One server", () => {
  test("asks /v1/systemone with the named model and no key, and reports the classification", async () => {
    const dir = scratchDir(`jint-systemone-${Math.random().toString(36).slice(2)}`);
    const config = join(dir, "jint.config.json");
    const source = join(dir, "unit.ts");
    writeFileSync(config, JSON.stringify({ rules: { use: [RULE] } }));
    writeFileSync(source, "// returns two\nexport const one = 1;\n");
    const server = startSystemOne();
    try {
      const run = await runCli(["run", source, "--config", config, "--json"], {
        env: {
          JINT_API_URL: server.url,
          JINT_API_MODEL: "d3-lite-FLM",
          JINT_API_KEY: "",
          // an exported OpenAI key is never sent to a local server
          OPENAI_API_KEY: "sk-must-not-travel",
        },
      });
      expect(run.stderr).not.toMatch(/provider (error|warn|backoff)/);
      expect(run.code).toBe(1); // the rule's error finding fails the run
      const report = JSON.parse(run.stdout);
      expect(report.classifications[0]).toMatchObject({
        rule: RULE.name,
        choice: "contradicted",
        confidence: 0.8,
      });
      expect(report.findings).toHaveLength(1);
      // the verdict follows the exit code: an error finding fails the run and its one input
      expect(report.status).toBe("fail");
      expect(report.inputs).toEqual([{ input: source, status: "fail" }]);
      // what the run used rides the report, and the manifest says the same
      expect(report.run.model).toBe("d3-lite-FLM");
      expect(report.run.usage).toEqual({ input: 12, output: 0, cached: 0 });
      expect(report.run.durationMs).toBeGreaterThanOrEqual(0);
      const manifest = JSON.parse(readFileSync(join(report.run.dir, "manifest.json"), "utf8"));
      expect(manifest.model).toBe(report.run.model);
      expect(manifest.usage).toEqual(report.run.usage);
      expect(server.seen.length).toBeGreaterThan(0);
      for (const call of server.seen) {
        expect(call.url).toBe("/v1/systemone");
        expect(call.auth).toBe("Bearer lemonade");
        expect(call.body.model).toBe("d3-lite-FLM");
      }
    } finally {
      server.stop();
    }
  });

  test("a server with several models and no model named fails at setup, saying what to set", async () => {
    const dir = scratchDir(`jint-systemone-${Math.random().toString(36).slice(2)}`);
    const config = join(dir, "jint.config.json");
    const source = join(dir, "unit.ts");
    writeFileSync(config, JSON.stringify({ rules: { use: [RULE] } }));
    writeFileSync(source, "export const one = 1;\n");
    const server = startSystemOne();
    try {
      const run = await runCli(["run", source, "--config", config, "--json"], {
        env: { JINT_API_URL: server.url, JINT_API_MODEL: "", JINT_API_KEY: "" },
      });
      expect(run.code).not.toBe(0);
      expect(run.stderr + run.stdout).toContain("JINT_API_MODEL");
      expect(server.seen).toHaveLength(0);
    } finally {
      server.stop();
    }
  });
});
