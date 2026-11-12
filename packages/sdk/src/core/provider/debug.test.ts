import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inCall, recordRequests, recordRunManifest, recordSummary } from "./debug.ts";

const DIR = "tmp/provider-record-test";
/** RunsBase() resolves the store to an absolute path. */
const ABS = resolve(DIR);

function listRequests(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory())
      out.push(...listRequests(`${dir}/${entry.name}`).map((f) => `${entry.name}/${f}`));
    else out.push(entry.name);
  }
  return out.sort();
}

function passthrough(): (input: string, init?: RequestInit) => Promise<Response> {
  return async () =>
    new Response(JSON.stringify({ model: "m-1", answers: {}, usage: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

async function recordOnce(
  config: ReturnType<typeof recordRequests>,
  state: Record<string, unknown>,
): Promise<void> {
  await config.fetch!("https://api.test/v1/decisions", {
    method: "POST",
    body: JSON.stringify({
      state,
      questions: { is_name_purposeful: { type: "noul", instructions: "names are precise" } },
      model: "m",
    }),
  });
}

// Recording is ALWAYS-ON, so every test pins JINT_RUNS_DIR at the tmp store; the one default-location
// test repoints HOME instead, so nothing ever lands in the real ~/.jint/runs.
beforeEach(() => {
  process.env.JINT_RUNS_DIR = DIR;
  rmSync(DIR, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.JINT_RUNS_DIR;
  delete process.env.HOME;
  rmSync(DIR, { recursive: true, force: true });
});

describe("recordRequests", () => {
  test("a JINT_RUNS_DIR override moves the run dir; recording is always on", async () => {
    const config = recordRequests({ fetch: passthrough() });
    expect(recordSummary()).not.toBeNull();
    await recordOnce(config, { path: "a.ts", content: "x" });
    expect(listRequests(DIR)).toHaveLength(1);
  });

  test("writes one pretty-printed request per call, named <unixts>-<kind>-<file>.json", async () => {
    const config = recordRequests({ fetch: passthrough() });
    await recordOnce(config, { path: "src/a.ts", content: "export const x = 1;" });

    const list = listRequests(DIR);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/^\d+\/\d+-files-a\.ts\.json$/);

    const request = JSON.parse(readFileSync(`${DIR}/${list[0]}`, "utf8"));
    expect(request.url).toBe("https://api.test/v1/decisions");
    expect(request.status).toBe(200);
    expect(request.request.state.path).toBe("src/a.ts");
    expect(request.request.model).toBe("m");
    expect(request.response.model).toBe("m-1");
  });

  test("state shape drives the kind: single-element source -> elements, else files", async () => {
    const config = recordRequests({ fetch: passthrough() });
    await recordOnce(config, { path: "a.ts", source: "x" });
    await recordOnce(config, { path: "b.ts", content: "x" });

    const list = listRequests(DIR);
    expect(list.some((f) => f.endsWith("-elements-a.ts.json"))).toBe(true);
    expect(list.some((f) => f.endsWith("-files-b.ts.json"))).toBe(true);
  });

  test("two runs that start in the same millisecond get different run dirs", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const first = recordRequests({ fetch: passthrough() });
      const firstDir = recordSummary()!.dir;
      const second = recordRequests({ fetch: passthrough() });
      const secondDir = recordSummary()!.dir;
      expect(secondDir).not.toBe(firstDir);
      expect(firstDir).toBe(`${ABS}/1700000000000`);
      // the next free millisecond: still a timestamp, still sorts after the first
      expect(secondDir).toBe(`${ABS}/1700000000001`);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
    } finally {
      clock.mockRestore();
    }
  });

  test("eight runs in one millisecond each keep their own requests and manifest", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const dirs: string[] = [];
      for (let i = 0; i < 8; i++) {
        const config = recordRequests({ fetch: passthrough() });
        dirs.push(recordSummary()!.dir);
        await recordOnce(config, { path: `run${i}.ts`, content: "x" });
        recordRunManifest({ configPath: null, cwd: `/run${i}`, argv: [], ts: "t" });
      }
      expect(new Set(dirs).size).toBe(8);
      for (let i = 0; i < 8; i++) {
        const files = readdirSync(dirs[i]!);
        expect(files.filter((f) => f.endsWith("-files-run" + i + ".ts.json"))).toHaveLength(1);
        expect(files.filter((f) => f.endsWith(".json") && f !== "manifest.json")).toHaveLength(1);
        expect(JSON.parse(readFileSync(`${dirs[i]}/manifest.json`, "utf8")).cwd).toBe(`/run${i}`);
      }
    } finally {
      clock.mockRestore();
    }
  });

  test("a run never takes over a dir that already exists", () => {
    const clock = spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      mkdirSync(`${DIR}/1700000000000`, { recursive: true });
      writeFileSync(`${DIR}/1700000000000/report.json`, "{}");
      recordRequests({ fetch: passthrough() });
      expect(recordSummary()!.dir).toBe(`${ABS}/1700000000001`);
      expect(readdirSync(`${DIR}/1700000000000`)).toEqual(["report.json"]);
    } finally {
      clock.mockRestore();
    }
  });

  test("same-millisecond collisions get a suffix, never concatenated", async () => {
    const config = recordRequests({ fetch: passthrough() });
    const body = JSON.stringify({
      state: { path: "a.ts", content: "x" },
      questions: { q: { type: "noul", instructions: "x" } },
    });
    await Promise.all([
      config.fetch!("https://api.test/v1/decisions", { method: "POST", body }),
      config.fetch!("https://api.test/v1/decisions", { method: "POST", body }),
      config.fetch!("https://api.test/v1/decisions", { method: "POST", body }),
    ]);

    const list = listRequests(DIR);
    expect(list).toHaveLength(3);
    for (const f of list) {
      expect(() => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"))).not.toThrow();
    }
  });

  test("a failing store never breaks the observed call", async () => {
    process.env.JINT_RUNS_DIR = "/proc/definitely-not-writable";
    const config = recordRequests({ fetch: passthrough() });
    const response = await config.fetch!("https://api.test/v1/decisions", {
      method: "POST",
      body: JSON.stringify({ state: { path: "a.ts", content: "x" }, questions: {} }),
    });
    expect(response.status).toBe(200);
  });

  test("summary: dir + written count after recording (override location flagged)", async () => {
    const config = recordRequests({ fetch: passthrough() });
    expect(recordSummary()).toEqual({
      dir: expect.any(String),
      count: 0,
      cached: 0,
      override: true,
    });

    await recordOnce(config, { path: "a.ts", content: "x" });
    await recordOnce(config, { path: "a.ts", content: "x" });

    const summary = recordSummary()!;
    expect(summary.dir).toMatch(
      new RegExp(`(.*?)${DIR.replace(/[.*+?^{}()|[\]\\]/g, "\\$&")}/\\d+$`),
    );
    expect(summary.count).toBe(2);
    expect(summary.override).toBe(true);
  });

  test("a call through a provider's own client records the real exchange, redacted, per attempt", async () => {
    const reply = { model: "m", answers: [], usage: { input_tokens: 3, output_tokens: 1 } };
    let attempt = 0;
    const config = recordRequests({
      fetch: async () =>
        attempt++ === 0
          ? new Response(JSON.stringify({ error: "slow" }), { status: 429 })
          : new Response(JSON.stringify(reply), { status: 200 }),
    });
    const body = JSON.stringify({ model: "m", input: "x", questions: [] });
    await inCall({ id: "L1-L2", path: "src/a.ts", source: "x" }, ["rule in L1-L2"], async () => {
      for (let i = 0; i < 2; i++) {
        await config.fetch!("https://user:pw@api.test/v1/decisions?key=sk-secret", {
          method: "POST",
          headers: { Authorization: "Bearer sk-secret" },
          body,
        });
      }
    });
    const list = listRequests(DIR);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatch(/^\d+\/\d+-elements-a\.ts(-1)?\.json$/);
    const texts = list.map((f) => readFileSync(`${DIR}/${f}`, "utf8"));
    const files = texts.map((t) => JSON.parse(t));
    const failed = files.find((f) => f.status === 429);
    const ok = files.find((f) => f.status === 200);
    expect(Object.keys(ok).sort()).toEqual(
      [
        "durationMs",
        "id",
        "path",
        "questionIds",
        "request",
        "response",
        "status",
        "ts",
        "url",
      ].sort(),
    );
    expect(ok.id).toBe("L1-L2");
    expect(ok.questionIds).toEqual(["rule in L1-L2"]);
    expect(ok.url).toBe("https://api.test/v1/decisions");
    expect(ok.request).toEqual(JSON.parse(body));
    expect(ok.response).toEqual(reply);
    expect(failed.response).toEqual({ error: "slow" });
    for (const t of texts)
      for (const secret of ["sk-secret", "Bearer", "pw@"]) expect(t).not.toContain(secret);
  });

  test("the run's token totals read the Decisions usage shape; the manifest records the model sent and the host", async () => {
    const config = recordRequests(
      {
        fetch: async () =>
          new Response(
            JSON.stringify({
              model: "m-reply",
              answers: [],
              usage: {
                input_tokens: 40,
                output_tokens: 4,
                input_tokens_details: { cached_tokens: 8 },
              },
            }),
          ),
      },
      { model: "m-sent", host: "api.test" },
    );
    await inCall({ id: "L1", path: "src/a.ts", source: "x" }, ["r"], () =>
      config.fetch!("https://api.test/v1/decisions", { method: "POST", body: "{}" }),
    );
    recordRunManifest({ configPath: null, cwd: ".", argv: [], ts: "t" });
    const manifest = JSON.parse(readFileSync(`${recordSummary()!.dir}/manifest.json`, "utf8"));
    expect(manifest.usage).toEqual({ input: 40, output: 4, cached: 8 });
    expect(manifest.model).toBe("m-reply");
    expect(manifest.providerHost).toBe("api.test");
    expect(manifest).not.toHaveProperty("provider");
  });
});
