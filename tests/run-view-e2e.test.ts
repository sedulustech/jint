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

function seedRun(
  files: Record<string, { body: object; mtimeMs?: number }>,
  extras: object = {},
  id = "100",
) {
  const dir = scratchDir("run-view");
  scratch.push(dir);
  const run = join(dir, "runs", ...id.split("/"));
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

type Served = { status: number; body: any };

/** The real `jint ui serve` over the seeded store: each route answered through HTTP. */
async function serveGet(
  seed: { store: string; dist: string },
  ...routes: string[]
): Promise<Served[]> {
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
    const answers: Served[] = [];
    for (const route of routes) {
      const res = await fetch(new URL(route, url));
      answers.push({ status: res.status, body: await res.json() });
    }
    return answers;
  } finally {
    proc.kill();
  }
}

async function readRun(seed: { store: string; dist: string }): Promise<RunBody> {
  return (await serveGet(seed, "api/runs/100"))[0]!.body as RunBody;
}

const elementOf = (kind: string, label: string) => ({
  kind,
  label,
  span: {
    start: { line: 4, column: 0 },
    end: { line: 10, column: 0 },
    startByte: 20,
    endByte: 200,
  },
});

const ELEMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

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
  test("cells: one rule x one input with the finding joined by full identity and the element riding the cell; no report, no cells", async () => {
    const seed = seedRun(
      {},
      {
        report: {
          classifications: [
            { rule: "r_a", input: "src/x.ts", value: 0.9, element: elementOf("file", "L1-L10") },
            {
              rule: "r_b",
              input: "src/x.ts#abc",
              value: 0.1,
              element: elementOf("function", "d0"),
            },
          ],
          findings: [{ rule: "r_a", input: "src/x.ts", severity: "warn" }],
          errors: [],
        },
      },
    );
    const { cells } = (await serveGet(seed, "api/runs/100"))[0]!.body;
    expect(cells).toHaveLength(2);
    expect(cells.find((c: any) => c.rule === "r_a")).toMatchObject({
      input: "src/x.ts",
      file: "src/x.ts",
      element: { kind: "file" },
      severity: "warn",
    });
    expect(cells.find((c: any) => c.rule === "r_b")).toMatchObject({
      input: "src/x.ts#abc",
      file: "src/x.ts",
      element: { kind: "function", label: "d0", span: { start: { line: 4 }, end: { line: 10 } } },
    });
    const bare = seedRun({ "1700000000001-a.json": { body: request({ path: "a.ts" }, {}) } });
    expect((await serveGet(bare, "api/runs/100"))[0]!.body.cells).toEqual([]);
  });

  test("a nested run id lists, serves its cells against the element request, and serves its report", async () => {
    const file = "1700000000001-elements-fn.ts.json";
    const seed = seedRun(
      {
        [file]: {
          body: request(
            { path: "src/x.ts", source: "export function f() {}", id: ELEMENT_ID },
            { r_a: {} },
          ),
        },
      },
      {
        report: {
          classifications: [
            {
              rule: "r_a",
              input: `src/x.ts#${ELEMENT_ID}`,
              value: 0.1,
              element: elementOf("function", "d0"),
            },
          ],
          findings: [],
          errors: [],
        },
      },
      "generated/elements",
    );
    const [list, run, report] = await serveGet(
      seed,
      "api/runs",
      "api/runs/generated/elements",
      "api/runs/generated/elements/report",
    );
    expect(list!.body.runs.map((r: { id: string }) => r.id)).toContain("generated/elements");
    expect(run!.body.id).toBe("generated/elements");
    const cell = run!.body.cells.find((c: any) => c.rule === "r_a");
    expect(cell.element.kind).toBe("function");
    expect(cell.requestFile).toBe(file);
    expect(report!.status).toBe(200);
  });

  test("a request whose wire state carries no path still joins its reading through the recorded path", async () => {
    const file = "1700000000001-elements-fn.ts.json";
    const seed = seedRun(
      {
        [file]: {
          body: {
            ...request({ source: "export function f() {}" }, { r_a: {} }),
            id: ELEMENT_ID,
            path: "src/x.ts",
          },
        },
      },
      {
        report: {
          classifications: [
            {
              rule: "r_a",
              input: `src/x.ts#${ELEMENT_ID}`,
              value: 0.1,
              element: elementOf("function", "d0"),
            },
          ],
          findings: [],
          errors: [],
        },
      },
    );
    const run = (await serveGet(seed, "api/runs/100"))[0]!.body;
    expect(run.results[0].path).toBe("src/x.ts");
    expect(run.cells.find((c: any) => c.rule === "r_a").requestFile).toBe(file);
  });

  test("a refused classification is a cell with no value and no verdict, handle-judged or not", async () => {
    const seed = seedRun(
      {},
      {
        manifest: { handles: { r_a: { warn: { greater_than: 0.5 } } } },
        report: {
          classifications: [
            { rule: "r_a", input: "src/x.ts", refused: true },
            { rule: "r_a", input: "src/y.ts", value: 0.9 },
          ],
          findings: [],
          errors: [],
        },
      },
    );
    const { cells } = (await serveGet(seed, "api/runs/100"))[0]!.body;
    const refused = cells.find((c: any) => c.input === "src/x.ts");
    expect(refused.refused).toBe(true);
    expect("value" in refused).toBe(false);
    expect("severity" in refused).toBe(false);
    expect(cells.find((c: any) => c.input === "src/y.ts")).toMatchObject({ severity: "warn" });
  });

  test("a choice cell's value is its winning tier's sum; a close read is undecided", async () => {
    const choices = { justified: "pass", digression: "error", provenance: "error" };
    const probabilities = { justified: 0.43, digression: 0.3, provenance: 0.27 };
    const read = { input: "src/x.ts", value: 0.43, choice: "justified", probabilities };
    const seed = seedRun(
      {},
      {
        manifest: {
          handles: {
            r_split: { choices },
            r_close: { choices, undecided: { margin: 0.2, level: "warn" } },
          },
        },
        report: {
          classifications: [
            { rule: "r_split", ...read },
            { rule: "r_close", ...read },
          ],
          findings: [],
          errors: [],
        },
      },
    );
    const { cells } = (await serveGet(seed, "api/runs/100"))[0]!.body;
    const split = cells.find((c: any) => c.rule === "r_split");
    expect(split.value).toBeCloseTo(0.57);
    expect(split.undecided).toBeUndefined();
    const close = cells.find((c: any) => c.rule === "r_close");
    expect(close).toMatchObject({ undecided: true });
    expect(close.pass).toBeUndefined();
    expect(close.value).toBeCloseTo(0.57);
  });

  test("a report written before readings were called classifications reads as classifications, in the report route and the cells", async () => {
    const seed = seedRun(
      {},
      {
        report: {
          measurements: [{ rule: "r_a", input: "src/x.ts", value: 0.1 }],
          findings: [],
          errors: [],
        },
      },
    );
    const [run, report] = await serveGet(seed, "api/runs/100", "api/runs/100/report");
    expect(report!.body.measurements).toBeUndefined();
    expect(report!.body.classifications).toEqual([{ rule: "r_a", input: "src/x.ts", value: 0.1 }]);
    expect(run!.body.cells.map((c: any) => `${c.rule} ${c.input}`)).toEqual(["r_a src/x.ts"]);
  });
});
