import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveApiRequest, requestsRoot } from "./api.ts";

const get = async (path: string, root: string): Promise<Response> =>
  (await serveApiRequest(new Request("http://x" + path), { root })) as Response;

describe("requestsRoot default", () => {
  test("defaults to the SDK's runsBase (JINT_RUNS_DIR scratch, else the homedir store); opts override", () => {
    const withoutEnv = requestsRoot();
    if (process.env.JINT_RUNS_DIR !== undefined) {
      expect(withoutEnv).toBe(resolve(process.env.JINT_RUNS_DIR));
    } else {
      expect(withoutEnv.endsWith(join(".jint", "runs"))).toBe(true);
    }
    // options.root wins over the env default (tests, embedded servers)
    expect(requestsRoot({ root: "/tmp/opt-root" })).toBe(resolve("/tmp/opt-root"));
  });
});

describe("listRuns error surface", () => {
  test("missing root -> 200 with empty runs (absence is data), no path leak", async () => {
    const res = await get("/api/runs", join(tmpdir(), "definitely-not-here-12345"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[] };
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs).toEqual([]);
  });

  test("manifests list newest-first; legacy, config-less, and even manifest-less dirs are VISIBLE", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-ui-"));
    try {
      for (const id of ["100", "200", "300"]) {
        mkdirSync(join(root, id));
        writeFileSync(
          join(root, id, "manifest.json"),
          JSON.stringify({ configPath: `/cfg/${id}.json`, cwd: `/src/tree-${id}` }),
        );
        writeFileSync(join(root, id, "1700000000001-files.json"), "{}"); // a run has requests
      }
      // config-less run: VISIBLE, marked as default rules - never silently dropped
      mkdirSync(join(root, "500"));
      writeFileSync(join(root, "500", "manifest.json"), "{}");
      writeFileSync(join(root, "500", "1700000000001-files.json"), "{}");
      // migrated pre-store run: legacy manifest, no cwd/config - must NOT read as default rules
      mkdirSync(join(root, "600"));
      writeFileSync(
        join(root, "600", "manifest.json"),
        JSON.stringify({ configPath: null, ts: "600", legacy: true, argv: [] }),
      );
      writeFileSync(join(root, "600", "1700000000001-files.json"), "{}");
      // manifest-less dir still lists (guarded) as unknown-config, never throws
      mkdirSync(join(root, "400"));
      writeFileSync(join(root, "400", "1700000000001-files-cap.json"), "{}");
      writeFileSync(join(root, "stray.json"), "{}");
      const res = await get("/api/runs", root);
      const body = (await res.json()) as {
        runs: { id: string; configPath: string | null; cwd?: string; legacy?: boolean }[];
      };
      expect(body.runs.map((r) => r.id)).toEqual(["600", "500", "400", "300", "200", "100"]);
      expect(body.runs[0]!.legacy).toBe(true);
      expect(body.runs[0]!.configPath).toBeNull();
      expect(body.runs[1]!.legacy).toBe(false);
      expect(body.runs[1]!.configPath).toBeNull();
      // manifest-less: lists guarded as unknown-config, never throws, never fakes legacy
      expect(body.runs[2]!.configPath).toBeNull();
      expect(body.runs[2]!.legacy).toBe(false);
      expect(body.runs[3]!.configPath).toBe("/cfg/300.json");
      expect(body.runs[3]!.cwd).toBe("/src/tree-300");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("traversal rejected with 400", async () => {
    const res = await get("/api/runs/..%2f..%2fetc", tmpdir());
    expect(res.status).toBe(400);
  });
});

describe("getRun cells index", () => {
  test("cells are one rule x one input, severity joined span-aware, [] without a report", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-ui-cells-"));
    try {
      const dir = join(root, "100");
      mkdirSync(dir);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ configPath: "/c.json" }));
      const span = {
        start: { line: 4, column: 0 },
        end: { line: 10, column: 0 },
        startByte: 20,
        endByte: 200,
      };
      writeFileSync(
        join(dir, "report.json"),
        JSON.stringify({
          measurements: [
            {
              rule: "r_a",
              input: "src/x.ts",
              value: 0.9,
              element: { kind: "file", label: "L1-L10", span },
            },
            {
              rule: "r_b",
              input: "src/x.ts#abc",
              value: 0.1,
              element: { kind: "function", label: "d0", span },
            },
          ],
          findings: [{ rule: "r_a", input: "src/x.ts", severity: "warn" }],
          errors: [],
        }),
      );
      const res = await get("/api/runs/100", root);
      const body = (await res.json()) as {
        cells: {
          rule: string;
          input: string;
          file: string;
          element?: {
            kind: string;
            label: string;
            span: { start: { line: number }; end: { line: number } };
          };
          severity: string | null;
        }[];
      };
      expect(body.cells).toHaveLength(2);
      const a = body.cells.find((c) => c.rule === "r_a")!;
      expect(a).toMatchObject({
        input: "src/x.ts",
        file: "src/x.ts",
        element: { kind: "file" },
        severity: "warn",
      });
      const b = body.cells.find((c) => c.rule === "r_b")!;
      // the union variant IS the kind: no stringly field, the projection rides the cell
      expect(b).toMatchObject({
        input: "src/x.ts#abc",
        file: "src/x.ts",
        element: { kind: "function", label: "d0", span: { start: { line: 4 }, end: { line: 10 } } },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("nested run ids (fixture-pipeline generated/<case> layout)", () => {
  test("a request one level down lists, summarizes, and serves report under the nested id", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-ui-nested-"));
    const file = "1700000000001-elements-fn.ts.json";
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    try {
      const dir = join(root, "generated", "elements");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ configPath: "/elements.json" }));
      writeFileSync(
        join(dir, file),
        JSON.stringify({
          ts: "2026-01-01T00:00:00.000Z",
          request: {
            state: {
              path: "src/x.ts",
              source: "export function f() {}",
              id,
            },
            questions: { r_a: {} },
          },
        }),
      );
      writeFileSync(
        join(dir, "report.json"),
        JSON.stringify({
          measurements: [
            {
              rule: "r_a",
              input: `src/x.ts#${id}`,
              value: 0.1,
              element: {
                kind: "function",
                label: "d0",
                span: {
                  start: { line: 1, column: 0 },
                  end: { line: 1, column: 22 },
                  startByte: 0,
                  endByte: 22,
                },
              },
            },
          ],
          findings: [],
          errors: [],
        }),
      );
      const listed = (await (await get("/api/runs", root)).json()) as {
        runs: { id: string }[];
      };
      expect(listed.runs.map((r) => r.id)).toContain("generated/elements");
      const res = await get("/api/runs/generated/elements", root);
      const body = (await res.json()) as {
        id: string;
        cells: { rule: string; element?: { kind: string }; requestFile?: string }[];
      };
      expect(body.id).toBe("generated/elements");
      const cell = body.cells.find((c) => c.rule === "r_a")!;
      expect(cell.element?.kind).toBe("function");
      // uuid identity join: the cell names the ELEMENT request, not a file-tier fallback
      expect(cell.requestFile).toBe(file);
      const report = await get("/api/runs/generated/elements/report", root);
      expect(report.status).toBe(200);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("getRun kinds", () => {
  test("each rule's kind is its questions' wire type, keyed by the rule name", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-ui-kinds-"));
    try {
      const dir = join(root, "100");
      mkdirSync(dir);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ configPath: "/c.json" }));
      // an element question is keyed "<rule> in <element id>"; a file question by the bare rule
      writeFileSync(
        join(dir, "1700000000001-files.json"),
        JSON.stringify({
          request: {
            state: { path: "src/x.ts", id: "abc" },
            questions: {
              "r_choice in abc": { type: "choice" },
              "r_noul in abc": { type: "noul" },
            },
          },
        }),
      );
      writeFileSync(
        join(dir, "1700000000002-files.json"),
        JSON.stringify({
          request: { state: { path: "src/x.ts" }, questions: { r_score: { type: "score" } } },
        }),
      );
      const body = (await (await get("/api/runs/100", root)).json()) as {
        kinds: Record<string, string>;
      };
      expect(body.kinds).toEqual({ r_choice: "choice", r_noul: "noul", r_score: "score" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("getRun refused cells", () => {
  test("a refused measurement is a cell with no value and no verdict, handle-judged or not", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-ui-refused-"));
    try {
      const dir = join(root, "100");
      mkdirSync(dir);
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({
          configPath: "/c.json",
          handles: { r_a: { warn: { greater_than: 0.5 } } },
        }),
      );
      writeFileSync(
        join(dir, "report.json"),
        JSON.stringify({
          measurements: [
            { rule: "r_a", input: "src/x.ts", refused: true },
            { rule: "r_a", input: "src/y.ts", value: 0.9 },
          ],
          findings: [],
          errors: [],
        }),
      );
      const body = (await (await get("/api/runs/100", root)).json()) as {
        cells: Record<string, unknown>[];
      };
      const refused = body.cells.find((c) => c.input === "src/x.ts")!;
      expect(refused.refused).toBe(true);
      expect("value" in refused).toBe(false);
      expect("severity" in refused).toBe(false);
      expect(body.cells.find((c) => c.input === "src/y.ts")).toMatchObject({ severity: "warn" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("getRun choice cells", () => {
  test("a choice cell's value is its winning tier's sum; a close read is undecided", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-ui-choice-"));
    try {
      const dir = join(root, "100");
      mkdirSync(dir);
      const choices = { justified: "pass", digression: "error", provenance: "error" };
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({
          configPath: "/c.json",
          handles: {
            r_split: { choices },
            r_close: { choices, undecided: { margin: 0.2, level: "warn" } },
          },
        }),
      );
      // the provider picks justified (0.43), but the two error options hold 0.57 together
      const probabilities = { justified: 0.43, digression: 0.3, provenance: 0.27 };
      writeFileSync(
        join(dir, "report.json"),
        JSON.stringify({
          measurements: [
            { rule: "r_split", input: "src/x.ts", value: 0.43, choice: "justified", probabilities },
            { rule: "r_close", input: "src/x.ts", value: 0.43, choice: "justified", probabilities },
          ],
          findings: [],
          errors: [],
        }),
      );
      const body = (await (await get("/api/runs/100", root)).json()) as {
        cells: { rule: string; value: number; undecided?: boolean; pass?: boolean }[];
      };
      const split = body.cells.find((c) => c.rule === "r_split")!;
      expect(split.value).toBeCloseTo(0.57);
      expect(split.undecided).toBeUndefined();
      // 0.57 is under 1.5x 0.43: the read names its leading tier and is flagged undecided
      const close = body.cells.find((c) => c.rule === "r_close")!;
      expect(close).toMatchObject({ undecided: true });
      expect(close.pass).toBeUndefined();
      expect(close.value).toBeCloseTo(0.57);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
