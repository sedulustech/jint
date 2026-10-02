import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveApiRequest, requestsRoot } from "./handler.ts";

const get = async (path: string, root: string): Promise<Response> =>
  (await serveApiRequest(new Request("http://x" + path), { root })) as Response;

describe("requestsRoot default", () => {
  test("defaults to the homedir store ~/.jint/runs; opts override (no env fallback)", () => {
    delete process.env.JINT_REQUESTS_DIR;
    expect(requestsRoot().endsWith(join(".jint", "runs"))).toBe(true);
    // env is IGNORED now: the override is opts.root only
    process.env.JINT_REQUESTS_DIR = "/tmp/env-root";
    expect(requestsRoot().endsWith(join(".jint", "runs"))).toBe(true);
    expect(requestsRoot({ root: "/tmp/opt-root" })).toBe(resolve("/tmp/opt-root"));
    delete process.env.JINT_REQUESTS_DIR;
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
