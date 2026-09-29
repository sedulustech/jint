import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApi } from "./handler.ts";

const get = async (path: string, root: string): Promise<Response> =>
  (await handleApi(new Request("http://x" + path), { root })) as Response;

describe("listRuns error surface", () => {
  test("missing root -> 200 with empty runs + hiddenLegacy 0 (absence is data), no path leak", async () => {
    const res = await get("/api/runs", join(tmpdir(), "definitely-not-here-12345"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[]; hiddenLegacy: number };
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs).toEqual([]);
    expect(body.hiddenLegacy).toBe(0);
  });

  test("manifest is REQUIRED: manifested runs list (newest first), manifest-less dirs are hidden", async () => {
    const root = mkdtempSync(join(tmpdir(), "jint-ui-"));
    try {
      for (const id of ["100", "200", "300"]) {
        mkdirSync(join(root, id));
        writeFileSync(
          join(root, id, "manifest.json"),
          JSON.stringify({ configPath: `/cfg/${id}.json` }),
        );
        writeFileSync(join(root, id, "1700000000001-files-cap.json"), "{}"); // a run has captures
      }
      mkdirSync(join(root, "400"));
      writeFileSync(join(root, "400", "1700000000001-files-cap.json"), "{}"); // legacy: captures, no manifest
      writeFileSync(join(root, "stray.json"), "{}");
      const res = await get("/api/runs", root);
      const body = (await res.json()) as {
        runs: { id: string; configPath: string }[];
        hiddenLegacy: number;
      };
      expect(body.runs.map((r) => r.id)).toEqual(["300", "200", "100"]);
      expect(body.runs[0]!.configPath).toBe("/cfg/300.json");
      expect(body.hiddenLegacy).toBe(1);
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
      writeFileSync(
        join(dir, "report.json"),
        JSON.stringify({
          measurements: [
            { rule: "r_a", input: "src/x.ts", value: 0.9 },
            { rule: "r_b", input: "src/x.ts#L1", value: 0.1 },
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
          kind: string;
          severity: string | null;
        }[];
      };
      expect(body.cells).toHaveLength(2);
      const a = body.cells.find((c) => c.rule === "r_a")!;
      expect(a).toMatchObject({
        input: "src/x.ts",
        file: "src/x.ts",
        kind: "file",
        severity: "warn",
      });
      const b = body.cells.find((c) => c.rule === "r_b")!;
      expect(b).toMatchObject({ input: "src/x.ts#L1", file: "src/x.ts", kind: "element" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("nested run ids (fixture-pipeline generated/<case> layout)", () => {
  test("a capture one level down lists, summarizes, and serves report under the nested id", async () => {
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
          measurements: [{ rule: "r_a", input: `src/x.ts#${id}`, value: 0.1 }],
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
        cells: { rule: string; kind: string; requestFile?: string }[];
      };
      expect(body.id).toBe("generated/elements");
      const cell = body.cells.find((c) => c.rule === "r_a")!;
      expect(cell.kind).toBe("element");
      // uuid identity join: the cell names the ELEMENT capture, not a file-tier fallback
      expect(cell.requestFile).toBe(file);
      const report = await get("/api/runs/generated/elements/report", root);
      expect(report.status).toBe(200);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
