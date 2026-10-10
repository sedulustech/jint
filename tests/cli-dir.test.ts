import { describe, test, expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runCli, runCliSync } from "./helpers/cli.ts";
import { startMockJev } from "./helpers/mock-jev.ts";
import { rmScratchTree, scratchDir } from "./helpers/scratch.ts";

// a key with no reachable jev: the run walks, transport failures stay in-band
const NO_SERVICE = { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: "http://127.0.0.1:1" };

// Async spawn: tests run concurrently (test.concurrent) and a synchronous wait would serialize
// every CLI process behind the transport-failure retry chain each NO_SERVICE walk pays.
async function run(args: string[], env: Record<string, string | undefined> = {}) {
  return runCli(args, { env: { ...NO_SERVICE, ...env } });
}

describe("cli: dir walk ignores", () => {
  test.concurrent("ignored files never reach the report; resolver excludes them pre-jev", async () => {
    // No reachable jev: transport errors abort before measurements exist, but the report still
    // lists the units it attempted. Ignored files must not even be attempted.
    const r = await run(["tests/fixtures/sample-dir", "--json"]);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    const attempted: string[] = [
      ...(report.measurements ?? []).map((m: any) => m.input),
      ...(report.errors ?? []).map((d: any) => d.input),
    ].filter(Boolean);
    for (const p of attempted) {
      expect(p.includes("ignored.ts")).toBe(false);
      expect(p.includes("node_modules")).toBe(false);
      expect(p.includes("blob.bin")).toBe(false);
      expect(p.includes("photo.png")).toBe(false);
    }
  }, 30000);

  test.concurrent("config exclude anchors at the config dir: walking the excluded dir itself measures nothing", async () => {
    // git parity for scope patterns: a config exclude naming the tests subtree excludes the
    // whole walk even when the walk ROOT is that subtree (paths carry their config-relative prefix)
    const tmpRoot = scratchDir("jint-scope-base");
    try {
      await mkdir(join(tmpRoot, "tests", "sub"), { recursive: true });
      await Bun.write(join(tmpRoot, "tests", "sub", "x.ts"), "export const x = 1;\n");
      await Bun.write(
        join(tmpRoot, "jint.config.json"),
        JSON.stringify({ rules: ["is_greppable"], exclude: ["**/tests/**"] }),
      );
      const r = await runCli(
        [join(tmpRoot, "tests"), "--json", "--config", join(tmpRoot, "jint.config.json")],
        { env: NO_SERVICE },
      );
      expect(r.code).toBe(4);
      const report = JSON.parse(r.stdout);
      const attempted = [
        ...(report.measurements ?? []).map((m: any) => m.input),
        ...(report.errors ?? []).map((d: any) => d.input),
      ].filter(Boolean);
      expect(attempted).toEqual([]);
    } finally {
      rmScratchTree(tmpRoot);
    }
  });
  test.concurrent("rules-only config (no input) validates and runs with a directory positional", async () => {
    const configPath = "/tmp/jint-rules-only-config.json";
    require("node:fs").writeFileSync(
      configPath,
      JSON.stringify({ rules: ["is_greppable"], exclude: ["**/fixtures/**"] }),
    );
    // No key: the run reaches input resolution and the units (JEV_AUTH, exit 4) — NOT
    // CONFIG_INVALID (exit 2), which is what a rules-only config produced before input
    // became optional.
    const r = await run(["tests/fixtures/sample-dir", "--json", "--config", configPath]);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    expect(report.errors.some((e: any) => e.code === "JEV_UNAVAILABLE")).toBe(true);
  });

  // structural twin of the live calibration test: exclusions are CONTRACT (the walker owns
  // them, pre-jev), so the mock proves them keylessly; the live twin only adds real readings
  test("mocked jev: ignored files are absent from measurements", async () => {
    const jev = startMockJev();
    try {
      // Async spawn: the mock jev server lives in THIS process — a synchronous spawn would block
      // its event loop and the child would hang waiting for answers.
      // own config: the repo root config excludes the tests subtree on the config-relative
      // basis, which would (correctly) empty this walk - this test owns the walker contract
      const ownConfig = "/tmp/jint-walker-contract.json";
      require("node:fs").writeFileSync(ownConfig, JSON.stringify({ rules: ["is_greppable"] }));
      const proc = await runCli(["tests/fixtures/sample-dir", "--json", "--config", ownConfig], {
        env: { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: jev.baseUrl },
      });
      const report = JSON.parse(proc.stdout);
      const paths = (report.measurements ?? []).map((m: any) => m.input);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.some((p: string) => p.includes("ignored.ts"))).toBe(false);
      expect(paths.some((p: string) => p.includes("node_modules"))).toBe(false);
      expect(paths.some((p: string) => p.includes("blob.bin"))).toBe(false);
      expect(paths.some((p: string) => p.includes("photo.png"))).toBe(false);
    } finally {
      jev.stop();
    }
  });

  // live calibration twin: opt-in only (RUN_LIVE_TESTS=1 + key), never a silent skip
  test("with a real key: ignored files are absent from measurements", () => {
    if (process.env.RUN_LIVE_TESTS !== "1") return;
    if (!process.env.TYPESAFE_API_KEY) {
      throw new Error(
        "RUN_LIVE_TESTS=1 but TYPESAFE_API_KEY is unset - live tests never skip silently",
      );
    }
    const proc = runCliSync(["tests/fixtures/sample-dir", "--json"]);
    const report = JSON.parse(proc.stdout);
    const paths = (report.measurements ?? []).map((m: any) => m.input);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p: string) => p.includes("ignored.ts"))).toBe(false);
    expect(paths.some((p: string) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p: string) => p.includes("blob.bin"))).toBe(false);
    expect(paths.some((p: string) => p.includes("photo.png"))).toBe(false);
  }, 30000); // live jev round trip: real network latency, above bun's 5s default
});
