import { describe, test, expect } from "bun:test";

// the repo this test file lives in - never a sibling checkout, so worktree
// runs exercise the worktree's own sensors and calibration
const ROOT = import.meta.dir + "/..";
const CLI = "src/cli.ts";
const NO_KEY = { TYPESAFE_API_KEY: "" };

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const proc = Bun.spawnSync(["bun", CLI, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...NO_KEY, ...env },
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("cli: --dir ignores", () => {
  test("ignored files never reach the report; resolver excludes them pre-jev", () => {
    // No key: JEV_AUTH aborts before measurements exist, but the report still
    // lists the units it attempted. Ignored files must not even be attempted.
    const r = run(["--dir", "tests/fixtures/sample-dir", "--json"]);
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
  });

  test("with a real key: ignored files are absent from measurements", () => {
    if (!process.env.TYPESAFE_API_KEY) {
      console.log("skip: requires TYPESAFE_API_KEY");
      return;
    }
    const proc = Bun.spawnSync(["bun", CLI, "--dir", "tests/fixtures/sample-dir", "--json"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    const report = JSON.parse(proc.stdout.toString());
    const paths = (report.measurements ?? []).map((m: any) => m.input);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p: string) => p.includes("ignored.ts"))).toBe(false);
    expect(paths.some((p: string) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p: string) => p.includes("blob.bin"))).toBe(false);
    expect(paths.some((p: string) => p.includes("photo.png"))).toBe(false);
  });
});
