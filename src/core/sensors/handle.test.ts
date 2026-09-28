import { describe, expect, test } from "bun:test";
import { SetupError } from "../types.ts";
import { checkNoulHandler, compileNoulHandler, compileScoreHandler } from "./handle.ts";

const NOUL = { fires_when: "true", warn_at: 0.3, error_at: 0.6 } as const;

describe("compileScoreHandler", () => {
  const handle = compileScoreHandler({ map: ["ok", "warn", "error"] }, ["c0", "c1", "c2"]);

  test("rounding is half-up (Math.round): x.5 rounds to the next level", () => {
    // 0.5 sits between level 0 and 1: half-up pins it to 1 (warn), not 0.
    expect(handle(0.5)).toEqual({ severity: "warn", message: "c1" });
    // 1.5 between 1 and 2: rounds up to 2 (error).
    expect(handle(1.5)).toEqual({ severity: "error", message: "c2" });
  });

  test("out-of-scale and NaN scores are impossible states - fail loud, never silent null", () => {
    // jev bounds score to the criteria count; a violation means the wire contract broke.
    expect(() => handle(3)).toThrow(SetupError);
    expect(() => handle(-1)).toThrow(/outside the criteria scale/);
    expect(() => handle(Number.NaN)).toThrow(/outside the criteria scale/);
  });

  test("checkNoulHandler: every failure mode names the exact field", () => {
    expect(checkNoulHandler({ ...NOUL, warn_at: 1.5 })).toMatch(/handle\.warn_at:.*\(0, 1\)/);
    expect(checkNoulHandler({ ...NOUL, error_at: 0 })).toMatch(/handle\.error_at:.*\(0, 1\)/);
    expect(checkNoulHandler({ ...NOUL, warn_at: 0.7, error_at: 0.5 })).toMatch(
      /handle\.warn_at:.*warn_at < error_at/,
    );
    expect(checkNoulHandler({ ...NOUL, silent_band: [0.6, 0.4] })).toMatch(
      /handle\.silent_band: must be ordered/,
    );
    expect(checkNoulHandler({ ...NOUL, silent_band: [0, 1] })).toMatch(
      /handle\.silent_band: must not cover the whole scale/,
    );
    expect(checkNoulHandler({ ...NOUL, silent_band: [0.2, 0.4] })).toMatch(
      /handle\.silent_band:.*contains handle\.warn_at/,
    );
    expect(checkNoulHandler({ ...NOUL, silent_band: [0.4, 0.75] })).toMatch(
      /handle\.silent_band:.*contains handle\.error_at/,
    );
    // A band clear of the thresholds is fine.
    expect(checkNoulHandler({ ...NOUL, silent_band: [0.05, 0.15] })).toBeNull();
  });

  test("compileNoulHandler: band suppresses only inside its range, thresholds stay effective", () => {
    const handle = compileNoulHandler({ ...NOUL, silent_band: [0.05, 0.15] });
    expect(handle(0.1)).toBeNull(); // defect inside the band: silent
    expect(handle(0.35)).toEqual({ severity: "warn" }); // below the band still surfaces
    expect(handle(0.7)).toEqual({ severity: "error" }); // above it too
  });
});
