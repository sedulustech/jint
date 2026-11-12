import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_SRC } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";

const scratch: string[] = [];
afterAll(() => scratch.forEach(rmScratchTree));

const START = "2024-01-01T00:00:00.000Z";
const START_MS = Date.parse(START);

type Row = {
  file: string;
  path: string | null;
  elementId: string | null;
  element: boolean;
  rules: string[];
  durationMs: number | null;
  maxProb: number | null;
  minProb: number | null;
  answers: number[];
  severity: "warn" | "error" | null;
  severities: Record<string, "warn" | "error" | null>;
};
type RunBody = { results: Row[]; kinds: Record<string, string> };

function seedRun(files: Record<string, { body: object; mtimeMs?: number }>, extras: object = {}) {
  const dir = scratchDir("run-view");
  scratch.push(dir);
  const run = join(dir, "runs", "100");
  mkdirSync(run, { recursive: true });
  const { manifest, report } = extras as { manifest?: object; report?: object };
  writeFileSync(join(run, "manifest.json"), JSON.stringify({ configPath: "/c.json", ...manifest }));
  if (report !== undefined) writeFileSync(join(run, "report.json"), JSON.stringify(report));
  for (const [name, { body, mtimeMs }] of Object.entries(files)) {
    writeFileSync(join(run, name), JSON.stringify(body));
    if (mtimeMs !== undefined) utimesSync(join(run, name), mtimeMs / 1000, mtimeMs / 1000);
  }
  const dist = join(dir, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<html></html>");
  return { store: join(dir, "runs"), dist };
}

/** The real `jint ui serve` over the seeded store: GET /api/runs/100 through HTTP. */
async function readRun(seed: { store: string; dist: string }): Promise<RunBody> {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "..", CLI_SRC), "ui", "serve"], {
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, JINT_RUNS_DIR: seed.store, JINT_UI_DIST: seed.dist },
  });
  try {
    const decoder = new TextDecoder();
    const reader = proc.stderr.getReader();
    let text = "";
    const deadline = Date.now() + 30_000;
    let url: string | undefined;
    while (url === undefined && Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
      url = /jint: ui -> (\S+)/.exec(text)?.[1];
    }
    if (url === undefined) throw new Error(`serve printed no url: ${text}`);
    return (await (await fetch(new URL("api/runs/100", url))).json()) as RunBody;
  } finally {
    proc.kill();
  }
}

const request = (state: object, questions: object, extra: object = {}) => ({
  ts: START,
  request: { state, questions },
  ...extra,
});

describe("the run read model, served by the real `ui serve`", () => {
  test("duration: a recorded value wins; else the file's age since its timestamp; implausible or unknown is null", async () => {
    const seed = seedRun({
      "1700000000001-recorded.json": {
        body: request({ path: "a.ts" }, { r: { type: "noul" } }, { durationMs: 321 }),
      },
      "1700000000002-aged.json": {
        body: request({ path: "b.ts" }, { r: { type: "noul" } }),
        mtimeMs: START_MS + 1500,
      },
      "1700000000003-copied.json": {
        body: request({ path: "c.ts" }, { r: { type: "noul" } }),
        mtimeMs: START_MS + 61_000,
      },
      "1700000000004-untimed.json": {
        body: { request: { state: { path: "d.ts" }, questions: { r: { type: "noul" } } } },
        mtimeMs: START_MS + 1500,
      },
    });
    const byPath = Object.fromEntries((await readRun(seed)).results.map((r) => [r.path, r]));
    expect(byPath["a.ts"]!.durationMs).toBe(321);
    expect(byPath["b.ts"]!.durationMs).toBe(1500);
    expect(byPath["c.ts"]!.durationMs).toBeNull();
    expect(byPath["d.ts"]!.durationMs).toBeNull();
  });

  test("identity: the recorded path and id beat the state's; an element id falls back to the question key; kinds come from question types", async () => {
    const seed = seedRun({
      "1700000000001-recorded.json": {
        body: {
          ...request(
            { path: "state.ts", id: "state-id" },
            { "r_noul in key-id": { type: "noul" } },
          ),
          path: "recorded.ts",
          id: "recorded-id",
        },
      },
      "1700000000002-state.json": {
        body: request(
          { path: "s.ts", id: "from-state" },
          { "r_choice in key-id": { type: "choice" } },
        ),
      },
      "1700000000003-key.json": {
        body: request({ path: "k.ts", source: "x" }, { "r_score in key-id": { type: "score" } }),
      },
      "1700000000004-file.json": {
        body: request({ path: "f.ts" }, { r_file: { type: "noul" } }),
      },
    });
    const run = await readRun(seed);
    const byFile = Object.fromEntries(run.results.map((r) => [r.file, r]));
    expect(byFile["1700000000001-recorded.json"]).toMatchObject({
      path: "recorded.ts",
      elementId: "recorded-id",
      rules: ["r_noul"],
    });
    expect(byFile["1700000000002-state.json"]!.elementId).toBe("from-state");
    expect(byFile["1700000000003-key.json"]).toMatchObject({ elementId: "key-id", element: true });
    expect(byFile["1700000000004-file.json"]).toMatchObject({ elementId: null, element: false });
    expect(run.kinds).toEqual({
      r_noul: "noul",
      r_choice: "choice",
      r_score: "score",
      r_file: "noul",
    });
  });

  test("answers: noul, a choice's selected probability and a normalized score join one sorted summary", async () => {
    const seed = seedRun({
      "1700000000001-mixed.json": {
        body: request(
          { path: "a.ts" },
          {
            r_noul: { type: "noul" },
            r_choice: { type: "choice" },
            r_score: { type: "score", criteria: ["zero", "one", "two", "three", "four"] },
            r_levelless: { type: "score" },
          },
          {
            response: {
              answers: {
                r_noul: { noul: 0.9 },
                r_choice: { choice: "x", probabilities: { x: 0.4, y: 0.6 } },
                r_score: { score: 1 },
                r_levelless: { score: 2 },
              },
            },
          },
        ),
      },
    });
    const [row] = (await readRun(seed)).results;
    expect(row!.answers).toEqual([0.25, 0.4, 0.9]);
    expect(row).toMatchObject({ minProb: 0.25, maxProb: 0.9 });
  });

  test("severity: a finding is the verdict; else the manifest handle read on that input; the worst rule wins; no proof is null", async () => {
    const seed = seedRun(
      {
        "1700000000001-both.json": {
          body: request(
            { path: "a.ts" },
            { r_found: { type: "noul" }, r_projected: { type: "noul" } },
          ),
        },
        "1700000000002-none.json": {
          body: request({ path: "b.ts" }, { r_unjudged: { type: "noul" } }),
        },
        "1700000000003-sibling.json": {
          body: request(
            { path: "c.ts", id: "e1", source: "x" },
            { "r_projected in e1": { type: "noul" } },
          ),
        },
      },
      {
        manifest: {
          handles: {
            r_projected: { warn: { greater_than: 0.5 } },
            r_found: { warn: { greater_than: 0.5 } },
          },
        },
        report: {
          classifications: [
            { rule: "r_found", input: "a.ts", value: 0.1 },
            { rule: "r_projected", input: "a.ts", value: 0.7 },
            { rule: "r_projected", input: "c.ts#e2", value: 0.9 },
          ],
          findings: [{ rule: "r_found", input: "a.ts", severity: "error" }],
          errors: [],
        },
      },
    );
    const byPath = Object.fromEntries((await readRun(seed)).results.map((r) => [r.path, r]));
    expect(byPath["a.ts"]).toMatchObject({
      severity: "error",
      severities: { r_found: "error", r_projected: "warn" },
    });
    expect(byPath["b.ts"]).toMatchObject({ severity: null, severities: { r_unjudged: null } });
    expect(byPath["c.ts"]!.severity).toBeNull();
  });
});
