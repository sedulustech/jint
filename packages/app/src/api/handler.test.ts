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
