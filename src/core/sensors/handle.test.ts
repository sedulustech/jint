import { describe, expect, test } from "bun:test";
import { SetupError } from "../types.ts";
import { checkNoulHandler, compileNoulHandler, compileScoreHandler } from "./handle.ts";

const NOUL = { warn: { greater_than: 0.3 }, error: { greater_than: 0.6 } } as const;

describe("compileScoreHandler", () => {
  const handle = compileScoreHandler({ map: ["pass", "warn", "error"] });

  test("rounding is half-up (Math.round): x.5 rounds to the next level", () => {
    // 0.5 sits between level 0 and 1: half-up pins it to 1 (warn), not 0.
    expect(handle({ value: 0.5 })).toEqual({ severity: "warn" });
    // 1.5 between 1 and 2: rounds up to 2 (error).
    expect(handle({ value: 1.5 })).toEqual({ severity: "error" });
  });

  test("out-of-scale and NaN scores are impossible states - fail loud, never silent null", () => {
    // jev bounds score to the criteria count; a violation means the wire contract broke.
    expect(() => handle({ value: 3 })).toThrow(SetupError);
    expect(() => handle({ value: -1 })).toThrow(/outside the criteria scale/);
    expect(() => handle({ value: Number.NaN })).toThrow(/outside the criteria scale/);
  });

  test("checkNoulHandler: every failure mode names the exact field", () => {
    expect(checkNoulHandler({ ...NOUL, warn: { greater_than: 1.5 } })).toMatch(
      /handle\.warn:.*\(0, 1\)/,
    );
    expect(checkNoulHandler({ ...NOUL, error: { greater_than: 0 } })).toMatch(
      /handle\.error:.*\(0, 1\)/,
    );
    expect(checkNoulHandler({ warn: { greater_than: 0.7 }, error: { greater_than: 0.5 } })).toMatch(
      /handle\.warn\/error:.*warn < error/,
    );
    expect(checkNoulHandler({ ...NOUL, silent_band: [0.6, 0.4] })).toMatch(
      /handle\.silent_band: must be ordered/,
    );
    expect(checkNoulHandler({ ...NOUL, silent_band: [0, 1] })).toMatch(
      /handle\.silent_band: must not cover the whole scale/,
    );
    expect(checkNoulHandler({ ...NOUL, silent_band: [0.2, 0.4] })).toMatch(
      /handle\.silent_band:.*contains the warn threshold/,
    );
    expect(checkNoulHandler({ ...NOUL, silent_band: [0.4, 0.75] })).toMatch(
      /handle\.silent_band:.*contains the error threshold/,
    );
    // A band clear of the thresholds is fine.
    expect(checkNoulHandler({ ...NOUL, silent_band: [0.05, 0.15] })).toBeNull();
  });

  test("compileNoulHandler: band suppresses only inside its range, thresholds stay effective", () => {
    const handle = compileNoulHandler({ ...NOUL, silent_band: [0.05, 0.15] });
    expect(handle({ value: 0.1 })).toBeNull(); // inside the band: silent
    expect(handle({ value: 0.35 })).toEqual({ severity: "warn" }); // above the band still surfaces
    expect(handle({ value: 0.7 })).toEqual({ severity: "error" }); // past the error threshold too
  });
});
