import { describe, test, jest, expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runCli, mockDecisionsWire, hasLiveKey } from "./helpers/cli.ts";
import { rmScratchTree, scratchDir } from "./helpers/dir.ts";
import { startMockDecisions } from "./helpers/mock-provider.ts";

// every test here spawns CLI processes: the per-test timeout matches the spawn ceiling
// (60s), so the framework clock cannot undercut a healthy run on a slow runner
jest.setTimeout(60_000);

// a key with no reachable provider: the run walks, transport failures stay in-band
const NO_SERVICE = mockDecisionsWire("http://127.0.0.1:1");

// Async spawn: tests run concurrently (test.concurrent) and a synchronous wait would serialize
// every CLI process behind the transport-failure retry chain each NO_SERVICE walk pays.
async function run(args: string[], env: Record<string, string | undefined> = {}) {
  return runCli(args, { env: { ...NO_SERVICE, ...env } });
}

describe("cli: dir walk ignores", () => {
  // The input accounting (run.input): the flat decided shape, over a config that owns every
  // scope - include, exclude, and the walker's own skips. No reachable provider: the run still walks,
  // the report still carries the accounting (transport failures abort measurements, not input).
  test.concurrent("run.input: flat shape, per-glob exclusion, reason-keyed skips", async () => {
    const tmpRoot = scratchDir("jint-input-summary");
    try {
      await mkdir(join(tmpRoot, "src"), { recursive: true });
      await Bun.write(join(tmpRoot, "src", "good.ts"), "export const x = 1;\n");
      await Bun.write(join(tmpRoot, "src", "more.ts"), "export const y = 2;\n");
      await Bun.write(join(tmpRoot, "src", "note.md"), "# md\n");
      await Bun.write(
        join(tmpRoot, "jint.config.json"),
        JSON.stringify({
          rules: { include: ["**/*.ts"], exclude: ["**/more.ts"], use: ["is_greppable"] },
        }),
      );
      const r = await runCli(
        ["run", join(tmpRoot, "src"), "--json", "--config", join(tmpRoot, "jint.config.json")],
        {
          env: NO_SERVICE,
        },
      );
      const report = JSON.parse(r.stdout);
      expect(report.run.input).toEqual({
        discovered: 3,
        included: 1,
        excluded: [{ glob: "**/more.ts", count: 1 }],
        skipped: [{ reason: "NOT_IN_INCLUDE", count: 1 }],
        admitted: [{ by: "config", count: 1 }],
      });
      // the human mirror rides stderr exactly when something was dropped (non-json mode; the
      // --json document carries the structured run.input instead - one artifact, two projections)
      const human = await runCli(
        ["run", join(tmpRoot, "src"), "--config", join(tmpRoot, "jint.config.json")],
        {
          env: NO_SERVICE,
        },
      );
      expect(human.stderr).toContain(
        "input: 1 of 3 files (1 excluded by config, skipped: NOT_IN_INCLUDE 1)",
      );
    } finally {
      await rmScratchTree(tmpRoot);
    }
  }, 30000);

  // The field trial's silent-empty papercut, regressed at the CLI: a config include that filters
  // EVERY file must be LOUD on stderr (the accounting names the scope), never a bare exit 0.
  test.concurrent("capture <dir> with an include that matches nothing: loud, naming the scope", async () => {
    const tmpRoot = scratchDir("jint-capture-empty");
    try {
      await mkdir(join(tmpRoot, "src"), { recursive: true });
      await Bun.write(join(tmpRoot, "src", "lib.rs"), "fn a() -> u32 { 1 }\n");
      await Bun.write(join(tmpRoot, "src", "main.rs"), "fn b() -> u32 { 2 }\n");
      await Bun.write(
        join(tmpRoot, "jint.config.json"),
        JSON.stringify({ rules: { include: ["**/*.py"], use: ["is_greppable"] } }),
      );
      const r = await runCli([
        "capture",
        join(tmpRoot, "src"),
        "--config",
        join(tmpRoot, "jint.config.json"),
      ]);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("input: 0 of 2 files (skipped: NOT_IN_INCLUDE 2)");
      expect(r.stderr).toContain("outside every scope [**/*.py]");
    } finally {
      await rmScratchTree(tmpRoot);
    }
  }, 30000);
  test.concurrent("ignored files never reach the report; resolver excludes them pre-provider", async () => {
    // No reachable provider: transport errors abort before measurements exist, but the report still
    // lists the units it attempted. Ignored files must not even be attempted.
    const r = await run(["run", "tests/fixtures/sample-dir", "--json"]);
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
        JSON.stringify({
          rules: { exclude: ["**/tests/**"], use: ["is_greppable"] },
        }),
      );
      const r = await runCli(
        ["run", join(tmpRoot, "tests"), "--json", "--config", join(tmpRoot, "jint.config.json")],
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
      JSON.stringify({
        rules: { exclude: ["**/fixtures/**"], use: ["is_greppable"] },
      }),
    );
    // No key: the run reaches input resolution and the units (PROVIDER_AUTH, exit 4) — NOT
    // CONFIG_INVALID (exit 2), which is what a rules-only config produced before input
    // became optional.
    const r = await run(["run", "tests/fixtures/sample-dir", "--json", "--config", configPath]);
    expect(r.code).toBe(4);
    const report = JSON.parse(r.stdout);
    expect(report.errors.some((e: any) => e.code === "PROVIDER_UNAVAILABLE")).toBe(true);
  });

  // structural twin of the live calibration test: exclusions are CONTRACT (the walker owns
  // them, pre-provider), so the mock proves them keylessly; the live twin only adds real readings
  test("mocked provider: ignored files are absent from measurements", async () => {
    const provider = startMockDecisions();
    try {
      // Async spawn: the mock provider server lives in THIS process — a synchronous spawn would block
      // its event loop and the child would hang waiting for answers.
      // own config: the repo root config excludes the tests subtree on the config-relative
      // basis, which would (correctly) empty this walk - this test owns the walker contract
      const ownConfig = "/tmp/jint-walker-contract.json";
      require("node:fs").writeFileSync(
        ownConfig,
        JSON.stringify({ rules: { use: ["is_greppable"] } }),
      );
      const proc = await runCli(
        ["run", "tests/fixtures/sample-dir", "--json", "--config", ownConfig],
        {
          env: mockDecisionsWire(provider.baseUrl),
        },
      );
      const report = JSON.parse(proc.stdout);
      const paths = (report.measurements ?? []).map((m: any) => m.input);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.some((p: string) => p.includes("ignored.ts"))).toBe(false);
      expect(paths.some((p: string) => p.includes("node_modules"))).toBe(false);
      expect(paths.some((p: string) => p.includes("blob.bin"))).toBe(false);
      expect(paths.some((p: string) => p.includes("photo.png"))).toBe(false);
    } finally {
      provider.stop();
    }
  });

  // live calibration twin: opt-in only (RUN_LIVE_TESTS=1 + key), never a silent skip
  test("with a real key: ignored files are absent from measurements", async () => {
    if (process.env.RUN_LIVE_TESTS !== "1") return;
    if (!hasLiveKey()) {
      throw new Error(
        "RUN_LIVE_TESTS=1 but no API key opens the endpoint - live tests never skip silently",
      );
    }
    const proc = await runCli(["run", "tests/fixtures/sample-dir", "--json"]);
    const report = JSON.parse(proc.stdout);
    const paths = (report.measurements ?? []).map((m: any) => m.input);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p: string) => p.includes("ignored.ts"))).toBe(false);
    expect(paths.some((p: string) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p: string) => p.includes("blob.bin"))).toBe(false);
    expect(paths.some((p: string) => p.includes("photo.png"))).toBe(false);
  }, 30000); // live provider round trip: real network latency, above bun's 5s default
});
