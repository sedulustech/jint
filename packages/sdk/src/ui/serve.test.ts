import { describe, test, expect, jest, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostAllowed, normalizeUiHost, startUi } from "./serve.ts";

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

  test("port precedence: option over JINT_UI_PORT; bare PORT is not read", async () => {
    process.env.PORT = "4111";
    process.env.JINT_UI_PORT = "4222";
    try {
      const viaEnv = await startUi({ distDir: tempDir("jint-ui-dist-") });
      try {
        expect(viaEnv.port).toBe(4222);
      } finally {
        viaEnv.close();
      }
      const viaOption = await startUi({ distDir: tempDir("jint-ui-dist-"), port: 4333 });
      try {
        expect(viaOption.port).toBe(4333);
      } finally {
        viaOption.close();
      }
      delete process.env.JINT_UI_PORT;
      const viaPortless = await startUi({ distDir: tempDir("jint-ui-dist-") });
      try {
        expect(viaPortless.port).not.toBe(4111); // bare PORT is no longer an integration
      } finally {
        viaPortless.close();
      }
    } finally {
      delete process.env.PORT;
      delete process.env.JINT_UI_PORT;
    }
  });

  test("binds loopback only by default", async () => {
    const ui = await startUi({ distDir: tempDir("jint-ui-dist-") });
    try {
      expect(ui.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(new URL(ui.url).hostname).toBe("127.0.0.1");
    } finally {
      ui.close();
    }
  });

  test("host option overrides the bind", async () => {
    const ui = await startUi({ distDir: tempDir("jint-ui-dist-"), host: "localhost" });
    try {
      expect(new URL(ui.url).hostname).toBe("localhost");
    } finally {
      ui.close();
    }
  });

  test("GET /api/runs answers 200 JSON from the runs store (JINT_RUNS_DIR scratch)", async () => {
    // the bun preload points JINT_RUNS_DIR at a pid-scoped scratch store: write a run into it
    const store = resolve(process.env.JINT_RUNS_DIR!);
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

  test("root option serves THAT store (an explicit-root store is visible)", async () => {
    const store = tempDir("jint-ui-store-");
    mkdirSync(join(store, "1700000000002-root-run"));
    writeFileSync(join(store, "1700000000002-root-run", "1700000000002-files.json"), "{}");
    const ui = await startUi({ distDir: tempDir("jint-ui-dist-"), root: store });
    try {
      const body = (await (await fetch(new URL("/api/runs", ui.url))).json()) as {
        runs: { id: string }[];
      };
      expect(body.runs.map((r) => r.id)).toEqual(["1700000000002-root-run"]);
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

  test("close() stops the server; a second close() is a no-op, never a throw", async () => {
    const ui = await startUi({ distDir: tempDir("jint-ui-dist-") });
    ui.close();
    expect(() => ui.close()).not.toThrow();
    const res = await fetch(new URL("/", ui.url)).catch((err: unknown) => err);
    expect(res).toBeInstanceOf(Error);
  });
});

describe("host option precedence and custom-host round trip", () => {
  test("host option beats JINT_UI_HOST; the bind follows the option", async () => {
    process.env.JINT_UI_HOST = "127.0.0.3";
    try {
      const ui = await startUi({ distDir: tempDir("jint-ui-dist-"), host: "127.0.0.2" });
      try {
        expect(ui.url).toContain("127.0.0.2:");
        expect(ui.url).not.toContain("127.0.0.3");
      } finally {
        ui.close();
      }
    } finally {
      delete process.env.JINT_UI_HOST;
    }
  });

  test("a custom bound host round-trips: its own Host is 200, a foreign Host is 403", async () => {
    const dist = tempDir("jint-ui-dist-");
    writeFileSync(join(dist, "index.html"), "<html><body>jint ui</body></html>");
    const ui = await startUi({ distDir: dist, host: "127.0.0.2" });
    try {
      const good = await fetch(new URL("/", ui.url));
      expect(good.status).toBe(200);
      const evil = await fetch(new URL("/", ui.url), { headers: { host: "evil.example" } });
      expect(evil.status).toBe(403);
    } finally {
      ui.close();
    }
  });
});

describe("hostAllowed", () => {
  test("localhost variants pass, port suffix optional", () => {
    for (const host of [
      "127.0.0.1:5178",
      "localhost",
      "localhost:4222",
      "[::1]",
      "[::1]:5178",
      "LOCALHOST:80",
    ]) {
      expect(hostAllowed(host, "127.0.0.1")).toBe(true);
    }
  });

  test("foreign hosts and a missing header are rejected", () => {
    for (const host of [
      "evil.example",
      "evil.example:80",
      "127.0.0.1.evil.example",
      "internal.lan:5178",
      null,
    ]) {
      expect(hostAllowed(host, "127.0.0.1")).toBe(false);
    }
  });

  test("the bound host is allowed when a custom host is set", () => {
    expect(hostAllowed("0.0.0.0:5178", "0.0.0.0")).toBe(true);
    expect(hostAllowed("evil.example:80", "0.0.0.0")).toBe(false);
  });
});

describe("normalizeUiHost", () => {
  test("hosts pass through; bracketed IPv6 is a host, not host:port", () => {
    for (const host of ["127.0.0.1", "localhost", "0.0.0.0", "[::1]", "::1"]) {
      expect(normalizeUiHost(host)).toBe(host);
    }
  });

  test("a :port suffix is rejected, naming the right var", () => {
    for (const host of ["0.0.0.0:5178", "localhost:4222", "[::1]:5178"]) {
      expect(() => normalizeUiHost(host)).toThrow("JINT_UI_PORT");
    }
  });
});

describe("host guard", () => {
  test("a spoofed Host is 403 before any dispatch; the real host answers", async () => {
    const dist = tempDir("jint-ui-dist-");
    writeFileSync(join(dist, "index.html"), "<html><body>jint ui</body></html>");
    const ui = await startUi({ distDir: dist });
    try {
      const evil = await fetch(new URL("/api/runs", ui.url), { headers: { host: "evil.example" } });
      expect(evil.status).toBe(403);
      const good = await fetch(new URL("/api/runs", ui.url));
      expect(good.status).toBe(200);
    } finally {
      ui.close();
    }
  });
});
