import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_SRC, mockDecisionsWire, runCli } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// A run prints the address of its own run when a UI server is up for the store it wrote to: the
// real `jint serve` held in the background, real runs against a mock endpoint. The address is
// read, not built, by the agent: report.run.url and a `ui ->` line on stderr.

const scratch: string[] = [];
afterAll(() => scratch.forEach(rmScratchTree));

function setup() {
  const dir = scratchDir("run-url");
  scratch.push(dir);
  const store = join(dir, "runs");
  const seeded = join(store, "1700000000001-seed");
  mkdirSync(seeded, { recursive: true });
  writeFileSync(join(seeded, "1700000000001-files.json"), "{}");
  const dist = join(dir, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<html><body>jint ui</body></html>");
  const source = join(dir, "sample.ts");
  writeFileSync(source, "export const one = 1;\n");
  const config = join(dir, "jint.config.json");
  writeFileSync(
    config,
    JSON.stringify({
      input: source,
      rules: {
        use: [
          {
            name: "is_probe",
            instructions: "Is it short?",
            criteria: { true: "it holds", false: "it does not hold" },
            target: "files",
            handle: { warn: { greater_than: 0.5 } },
          },
        ],
      },
    }),
  );
  return { dir, store, dist, config, cache: join(dir, "cache") };
}

type Setup = ReturnType<typeof setup>;

/** The held `jint serve` for the store; resolves with its url once it prints it. */
async function holdServe(s: Setup) {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "..", CLI_SRC), "serve"], {
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, JINT_RUNS_DIR: s.store, JINT_UI_DIST: s.dist },
  });
  const decoder = new TextDecoder();
  const reader = proc.stderr.getReader();
  let text = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
    const url = /jint: ui -> (\S+)/.exec(text)?.[1];
    if (url !== undefined) return { proc, url };
  }
  proc.kill();
  throw new Error(`serve printed no url: ${text}`);
}

const run = (s: Setup, baseUrl: string, store: string = s.store) =>
  runCli(["run", "--config", s.config, "--json"], {
    env: { ...mockDecisionsWire(baseUrl), JINT_CACHE_DIR: s.cache, JINT_RUNS_DIR: store },
  });

describe("a run names its own run in the running UI server", () => {
  test("with a server up: the url is in the report and on stderr, and it serves; after it stops, none", async () => {
    const s = setup();
    const provider = startMockDecisions({ predicate: 0.8 });
    const serve = await holdServe(s);
    try {
      const withServer = await run(s, provider.baseUrl);
      const report = JSON.parse(withServer.stdout);
      const runId = report.run.id as string;
      expect(report.run.url).toBe(new URL(`runs/${runId}`, serve.url).href);
      expect(withServer.stderr).toContain(`jint: ui -> ${report.run.url}`);
      expect((await fetch(report.run.url)).status).toBe(200);

      serve.proc.kill("SIGINT");
      expect(await serve.proc.exited).toBe(0);

      const afterStop = await run(s, provider.baseUrl);
      expect(JSON.parse(afterStop.stdout).run.url).toBeUndefined();
      expect(afterStop.stderr).not.toContain("jint: ui ->");
    } finally {
      serve.proc.kill();
      provider.stop();
    }
  });

  test("a server that died without cleaning up leaves no url", async () => {
    const s = setup();
    const provider = startMockDecisions({ predicate: 0.8 });
    const serve = await holdServe(s);
    try {
      serve.proc.kill("SIGKILL");
      await serve.proc.exited;
      const report = JSON.parse((await run(s, provider.baseUrl)).stdout);
      expect(report.run.url).toBeUndefined();
    } finally {
      provider.stop();
    }
  });

  test("a run written to another store gets no url from this store's server", async () => {
    const s = setup();
    const provider = startMockDecisions({ predicate: 0.8 });
    const serve = await holdServe(s);
    try {
      const other = join(s.dir, "other-runs");
      const report = JSON.parse((await run(s, provider.baseUrl, other)).stdout);
      expect(report.run.url).toBeUndefined();
    } finally {
      serve.proc.kill();
      provider.stop();
    }
  });
});
