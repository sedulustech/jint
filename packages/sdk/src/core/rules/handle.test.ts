import { describe, expect, test } from "bun:test";
import { InternalError, type RuleKind } from "../types.ts";
import {
  checkNoulHandler,
  compileDataHandle,
  compileNoulHandler,
  compileScoreHandler,
  type HandlerData,
} from "./handle.ts";

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
    // the provider bounds score to the criteria count; a violation means the wire contract broke.
    expect(() => handle({ value: 3 })).toThrow(InternalError);
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

  test("error-only noul handle: validates, fires error past the threshold, passes otherwise", () => {
    const data = { error: { greater_than: 0.6, message: "split it" } };
    expect(checkNoulHandler(data)).toBeNull();
    const handle = compileNoulHandler(data);
    expect(handle({ value: 0.7 })).toEqual({ severity: "error", message: "split it" });
    expect(handle({ value: 0.6 })).toBeNull(); // strict: exactly at the threshold stays silent
    expect(handle({ value: 0.3 })).toBeNull(); // no warn tier: below error is a pass
    const low = compileNoulHandler({ error: { less_than: 0.2 } });
    expect(low({ value: 0.1 })).toEqual({ severity: "error" });
    expect(low({ value: 0.5 })).toBeNull();
  });

  test("a noul handle declares at least one tier: neither warn nor error is rejected", () => {
    expect(checkNoulHandler({})).toMatch(/^handle: must declare at least one tier/);
    expect(checkNoulHandler({ silent_band: [0.1, 0.2] })).toMatch(/at least one tier/);
  });

  test("silent_band checks run against the declared tiers only (error-only handle)", () => {
    expect(checkNoulHandler({ error: { greater_than: 0.6 }, silent_band: [0.5, 0.7] })).toMatch(
      /handle\.silent_band:.*contains the error threshold/,
    );
    expect(checkNoulHandler({ error: { greater_than: 0.6 }, silent_band: [0.1, 0.2] })).toBeNull();
  });
});

describe("compileDataHandle - choice", () => {
  const CHOICES = { justified: "pass", wrong: { level: "error", message: "Rewrite it." } } as const;
  const LABELS = ["justified", "wrong"];
  const compile = (handle: HandlerData, kind: RuleKind, criteria = LABELS) =>
    compileDataHandle(handle, "r", "cfg", kind, criteria);

  test("the selected option's tier fires, carrying its message", () => {
    const handle = compile({ choices: CHOICES }, "choice");
    expect(handle({ value: 0.7, choice: "wrong" })).toEqual({
      severity: "error",
      message: "Rewrite it.",
    });
    expect(handle({ value: 0.7, choice: "justified" })).toBeNull();
  });

  test("an unknown or missing option is an impossible state - fail loud", () => {
    const handle = compile({ choices: CHOICES }, "choice");
    expect(() => handle({ value: 0.7, choice: "absent" })).toThrow(InternalError);
    expect(() => handle({ value: 0.7 })).toThrow(InternalError);
  });

  test("labels must match the options; at least one tier must be non-pass", () => {
    expect(() => compile({ choices: { justified: "pass" } }, "choice")).toThrow(
      /no tier for option/,
    );
    expect(() => compile({ choices: { justified: "pass", wrong: "pass" } }, "choice")).toThrow(
      /non-pass/,
    );
  });

  test("the handle form must match the rule kind", () => {
    expect(() => compile({ choices: CHOICES }, "score")).toThrow(
      /a choice handler on a score rule/,
    );
    expect(() => compile({ map: ["pass", "error"] }, "choice")).toThrow(
      /a score handler on a choice rule/,
    );
    expect(() => compile({ error: { greater_than: 0.6 } }, "choice")).toThrow(
      /a noul handler on a choice rule/,
    );
  });
});
