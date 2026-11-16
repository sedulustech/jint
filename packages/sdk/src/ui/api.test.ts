import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveApiRequest, requestsRoot } from "./api.ts";

const STARTED = "2023-11-14T22:13:20.001Z";
/** A run still recording: no manifest yet, so its start comes from its UUIDv7 id. */
const RECORDING = "018bcfe5-6801-7000-8000-000000000001";

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
          JSON.stringify({
            configPath: `/cfg/${id}.json`,
            cwd: `/src/tree-${id}`,
            createdAt: STARTED,
          }),
        );
        writeFileSync(join(root, id, "1700000000001-files.json"), "{}"); // a run has requests
      }
      // config-less run: VISIBLE, marked as default rules - never silently dropped
      mkdirSync(join(root, "500"));
      writeFileSync(join(root, "500", "manifest.json"), JSON.stringify({ createdAt: STARTED }));
      writeFileSync(join(root, "500", "1700000000001-files.json"), "{}");
      // migrated pre-store run: legacy manifest, no cwd/config - must NOT read as default rules
      mkdirSync(join(root, "600"));
      writeFileSync(
        join(root, "600", "manifest.json"),
        JSON.stringify({ configPath: null, createdAt: STARTED, legacy: true, argv: [] }),
      );
      writeFileSync(join(root, "600", "1700000000001-files.json"), "{}");
      mkdirSync(join(root, RECORDING));
      writeFileSync(join(root, RECORDING, "1700000000001-files-cap.json"), "{}");
      writeFileSync(join(root, "stray.json"), "{}");
      const res = await get("/api/runs", root);
      const body = (await res.json()) as {
        runs: {
          id: string;
          createdAt: string;
          configPath: string | null;
          cwd?: string;
          legacy?: boolean;
        }[];
      };
      expect(body.runs.map((r) => r.id)).toEqual(["600", "500", "300", "200", "100", RECORDING]);
      expect(body.runs[0]!.legacy).toBe(true);
      expect(body.runs[0]!.configPath).toBeNull();
      expect(body.runs[1]!.legacy).toBe(false);
      expect(body.runs[1]!.configPath).toBeNull();
      expect(body.runs[2]!.configPath).toBe("/cfg/300.json");
      expect(body.runs[2]!.cwd).toBe("/src/tree-300");
      // manifest-less: lists as unknown-config, never fakes legacy, starts when its id says
      expect(body.runs[5]!.configPath).toBeNull();
      expect(body.runs[5]!.legacy).toBe(false);
      expect(body.runs[5]!.createdAt).toBe(STARTED);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("traversal rejected with 400", async () => {
    const res = await get("/api/runs/..%2f..%2fetc", tmpdir());
    expect(res.status).toBe(400);
  });
});
