import { describe, test, expect, jest, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUi } from "./serve.ts";

jest.setTimeout(60_000);

// scratch stores/dist dirs this file creates
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

describe("startUi", () => {
  test("port 0 -> an ephemeral port with a real port in the url", async () => {
    const ui = await startUi({ distDir: tempDir("jint-ui-dist-") });
    try {
      expect(ui.port).toBeGreaterThan(0);
      expect(ui.url).toContain(":" + ui.port);
    } finally {
      ui.close();
    }
  });

  test("GET /api/runs answers 200 JSON from the runs store (JEV_DIR scratch)", async () => {
    // the bun preload points JEV_DIR at a pid-scoped scratch store: write a run into it
    const store = process.env.JEV_DIR;
    expect(store).toBeDefined();
    mkdirSync(join(store!, "1700000000001-files-run"), { recursive: true });
    writeFileSync(join(store!, "1700000000001-files-run", "1700000000001-files.json"), "{}");
    const ui = await startUi({ distDir: tempDir("jint-ui-dist-") });
    try {
      const res = await fetch(new URL("/api/runs", ui.url));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runs: { id: string }[] };
      expect(body.runs.map((r) => r.id)).toContain("1700000000001-files-run");
    } finally {
      ui.close();
    }
  });

  test("serves index.html from distDir (SPA fallback)", async () => {
    const dist = tempDir("jint-ui-dist-");
    writeFileSync(join(dist, "index.html"), "<html><body>jint ui</body></html>");
    const ui = await startUi({ distDir: dist });
    try {
      const res = await fetch(new URL("/", ui.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("jint ui");
    } finally {
      ui.close();
    }
  });

  test("close() stops the server", async () => {
    const ui = await startUi({ distDir: tempDir("jint-ui-dist-") });
    ui.close();
    const res = await fetch(new URL("/", ui.url)).catch((err: unknown) => err);
    expect(res).toBeInstanceOf(Error);
  });
});
