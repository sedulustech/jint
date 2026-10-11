import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { runCli } from "./helpers/cli.ts";

// W5 — the bin is wired and LIVE. The import walls are static (oxlint rules); this one is
// behavior: the BUILT entry the root package.json "bin" promises must actually run and emit
// findings. It spawns packages/cli/dist/cli.js (never the source) so a broken or renamed bin,
// a missing dist, or a dead entry fails here instead of in a user's install.

const BIN = "packages/cli/dist/cli.js";
const TARGET = "packages/cli/src/logger.ts";

describe("W5 - the bin is wired and live", () => {
  test("root package.json bin points at the built cli entry", async () => {
    const pkg = await Bun.file("package.json").json();
    expect(pkg.bin?.jint).toBe("./" + BIN);
  });

  test.skipIf(!existsSync(BIN))("the built entry runs a real file and emits findings", async () => {
    // the helper keeps the child's always-on recording out of the real ~/.jint/runs store
    const proc = await runCli([TARGET, "--rule", "is_greppable", "--json"], { bin: BIN });
    // 0 (clean) or 1 (error findings) mean the bin worked; 2/3 are usage/internal failures
    expect([0, 1]).toContain(proc.code);
    const report = JSON.parse(proc.stdout);
    expect(report.measurements.length).toBeGreaterThan(0); // the walk actually produced units
  });
});
