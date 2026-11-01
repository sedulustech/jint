import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serveApiRequest } from "../packages/sdk/src/ui/api.ts";
import { mockDecisionsWire, runCli } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// The answer cache through the real CLI: what reaches the endpoint on a rerun, after an edit, with
// --no-cache, with a damaged store, and across keys and hosts. The mock counts the requests.

const scratch: string[] = [];
afterAll(() => scratch.forEach(rmScratchTree));

const SOURCE = `export function alpha(a: number): number {\n  return a + 1;\n}\n\nexport function beta(b: string): string {\n  return b.trim();\n}\n`;

const rule = (name: string, instructions: string) => ({
  name,
  instructions,
  criteria: { true: "it holds", false: "it does not hold" },
  target: "functions",
  handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.9 } },
});

/** A project with one source file and a config naming `rules`; returns what a run needs. */
function project(rules: ReturnType<typeof rule>[]) {
  const dir = scratchDir("answer-cache");
  scratch.push(dir);
  const source = join(dir, "sample.ts");
  writeFileSync(source, SOURCE);
  const config = join(dir, "jint.config.json");
  const setRules = (next: ReturnType<typeof rule>[]) =>
    writeFileSync(config, JSON.stringify({ input: source, rules: { use: next } }));
  setRules(rules);
  mkdirSync(join(dir, "cache"));
  return { dir, source, config, cache: join(dir, "cache"), runs: join(dir, "runs"), setRules };
}

type Project = ReturnType<typeof project>;

const run = (p: Project, baseUrl: string, args: string[] = [], env: Record<string, string> = {}) =>
  runCli(["run", "--config", p.config, "--json", ...args], {
    env: {
      ...mockDecisionsWire(baseUrl),
      JINT_CACHE_DIR: p.cache,
      JINT_RUNS_DIR: p.runs,
      ...env,
    },
  });

const readings = (stdout: string): Record<string, number> =>
  Object.fromEntries(
    (
      JSON.parse(stdout).measurements as { rule: string; value: number; element: { span: any } }[]
    ).map((m) => [`${m.rule}@${m.element.span.startByte}`, m.value]),
  );

/** The run dirs the store holds, oldest first, with their record files. */
function runDirs(p: Project) {
  return readdirSync(p.runs)
    .sort()
    .map((id) => {
      const dir = join(p.runs, id);
      const records = readdirSync(dir)
        .filter((f) => f !== "manifest.json" && f !== "report.json")
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
      return { manifest: JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")), records };
    });
}

/** One run as the run view serves it, with what differs per run (element ids, file names) erased. */
async function served(p: Project, index: number) {
  const get = async (path: string) =>
    (await serveApiRequest(new Request(`http://view${path}`), {
      root: p.runs,
    }))!.json() as Promise<any>;
  const id = readdirSync(p.runs).sort()[index]!;
  const run = await get(`/api/runs/${id}`);
  const perRun = (value: unknown) =>
    JSON.stringify(value)
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "ID")
      .replace(/\d{13}-[a-z]+-[^"]+\.json/g, "FILE");
  const files = readdirSync(join(p.runs, id)).filter((f) => !/manifest|report/.test(f));
  const requests = await Promise.all(files.map((f) => get(`/api/runs/${id}/requests/${f}`)));
  return {
    // what the view shows of a yes/no question: its instructions and what a yes and a no mean
    noul: [
      ...new Set(
        requests.flatMap((r) =>
          Object.values<any>(r.request.questions)
            .filter((q) => q.type === "noul")
            .map((q) => JSON.stringify([q.instructions, q.criteria])),
        ),
      ),
    ].sort(),
    cells: Object.values(run.cells).map(perRun).sort(),
    requestCount: run.requestCount,
    // each request file served: how many questions it asks and how many answers it holds
    shapes: requests.map((r) => [
      Object.keys(r.request.questions).length,
      Object.keys(r.response.answers).length,
    ]),
  };
}

describe("answer cache", () => {
  test("a rerun of unchanged code sends nothing, reads the same, and records the hits", async () => {
    const provider = startMockDecisions({ predicate: 0.62 });
    const p = project([
      rule("is_alpha_probe", "Is it short?"),
      rule("is_beta_probe", "Is it named well?"),
    ]);
    const first = await run(p, provider.baseUrl);
    const sent = provider.requests.length;
    expect(sent).toBeGreaterThan(0);
    expect(first.stderr).not.toContain("from the cache");

    const second = await run(p, provider.baseUrl);
    provider.stop();
    expect(provider.requests.length).toBe(sent);
    expect(second.code).toBe(first.code);
    expect(readings(second.stdout)).toEqual(readings(first.stdout));
    expect(second.stderr).toMatch(/\(0 calls, \d+ answers from the cache\)/);

    const [, rerun] = runDirs(p);
    expect(rerun!.records.length).toBeGreaterThan(0);
    for (const record of rerun!.records) {
      expect(record).toMatchObject({ cached: true, status: 200 });
      expect(record.response.usage).toBeUndefined();
    }
    expect(rerun!.manifest.usage).toEqual({ input: 0, output: 0, cached: 0 });
  });

  test("the run view reads a run served from the cache like the run that filled it", async () => {
    const provider = startMockDecisions({ predicate: 0.62 });
    const p = project([
      rule("is_alpha_probe", "Is it short?"),
      rule("is_beta_probe", "Is it named well?"),
    ]);
    await run(p, provider.baseUrl);
    await run(p, provider.baseUrl);
    provider.stop();

    const [fresh, cached] = [await served(p, 0), await served(p, 1)];
    expect(fresh.cells.length).toBeGreaterThan(0);
    expect(cached.cells).toEqual(fresh.cells);
    // a yes/no question reads as its instructions and its meanings, not as one folded text
    const meaning = { true: "it holds", false: "it does not hold" };
    expect(fresh.noul).toEqual(
      ["Is it named well?", "Is it short?"].map((q) => JSON.stringify([q, meaning])),
    );
    expect(cached.noul).toEqual(fresh.noul);
    expect(cached.requestCount).toBe(fresh.requestCount);
    expect(cached.shapes.sort()).toEqual(fresh.shapes.sort());
    // every request in it is answered: no question without its answer
    for (const [asked, answered] of cached.shapes) expect(answered).toBe(asked);
  });

  test("editing one rule's wording asks only that rule's question", async () => {
    const provider = startMockDecisions({ predicate: 0.7 });
    const p = project([
      rule("is_alpha_probe", "Is it short?"),
      rule("is_beta_probe", "Is it named well?"),
    ]);
    const first = await run(p, provider.baseUrl);
    const sent = provider.requests.length;

    p.setRules([
      rule("is_alpha_probe", "Is it short?"),
      rule("is_beta_probe", "Is it named clearly?"),
    ]);
    const second = await run(p, provider.baseUrl);
    provider.stop();

    const asked = provider.requests.slice(sent);
    expect(asked.length).toBeGreaterThan(0);
    for (const request of asked) {
      expect(request.questions).toHaveLength(1);
      expect(String(request.questions[0]!.instructions)).toContain("named clearly");
    }
    const unchanged = (r: Record<string, number>) =>
      Object.entries(r).filter(([k]) => k.startsWith("is_alpha_probe"));
    expect(unchanged(readings(second.stdout))).toEqual(unchanged(readings(first.stdout)));
    expect(second.stderr).toMatch(/\d+ answers from the cache/);

    // the run that mixed hits and misses reads whole in the view: every cell, every question answered
    const [before, mixed] = [await served(p, 0), await served(p, 1)];
    expect(mixed.cells).toEqual(before.cells);
    for (const [asked, answered] of mixed.shapes) expect(answered).toBe(asked);
  });

  test("--no-cache asks everything again", async () => {
    const provider = startMockDecisions();
    const p = project([rule("is_alpha_probe", "Is it short?")]);
    await run(p, provider.baseUrl);
    const sent = provider.requests.length;
    const bypass = await run(p, provider.baseUrl, ["--no-cache"]);
    provider.stop();
    expect(provider.requests.length).toBe(sent * 2);
    expect(bypass.stderr).not.toContain("from the cache");
  });

  test("a damaged store is a miss, never a failure", async () => {
    const provider = startMockDecisions();
    const p = project([rule("is_alpha_probe", "Is it short?")]);
    const first = await run(p, provider.baseUrl);
    const sent = provider.requests.length;
    for (const shard of readdirSync(p.cache)) {
      for (const file of readdirSync(join(p.cache, shard))) {
        writeFileSync(join(p.cache, shard, file), "{ not json");
      }
    }
    const second = await run(p, provider.baseUrl);
    provider.stop();
    expect(provider.requests.length).toBe(sent * 2);
    expect(second.code).toBe(first.code);
    expect(readings(second.stdout)).toEqual(readings(first.stdout));
  });

  test("the API key is not part of the key; the endpoint host is", async () => {
    const one = startMockDecisions();
    const two = startMockDecisions();
    const p = project([rule("is_alpha_probe", "Is it short?")]);
    await run(p, one.baseUrl);
    const sent = one.requests.length;

    await run(p, one.baseUrl, [], { JINT_API_KEY: "another-key" });
    expect(one.requests.length).toBe(sent);

    await run(p, two.baseUrl);
    one.stop();
    two.stop();
    expect(two.requests.length).toBe(sent);
  });
});
