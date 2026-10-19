import { describe, expect, test } from "bun:test";
import {
  checkNoulHandler,
  handleSeverity,
  ruleTargets,
  type HandlerData,
  type NoulHandlerData,
  type RuleTarget,
  type ScoreHandlerData,
} from "./index.ts";

// fires when P(true) rises above the ceilings
const gt: NoulHandlerData = { warn: { greater_than: 0.6 }, error: { greater_than: 0.8 } };
// fires when P(true) DROPS below the floors (e.g. a documentation claim)
const lt: NoulHandlerData = { warn: { less_than: 0.4 }, error: { less_than: 0.3 } };
const score: ScoreHandlerData = { map: ["pass", "warn", "error"] };

describe("handleSeverity - noul, greater_than", () => {
  test("thresholds are strict on the firing side; error is the narrower region", () => {
    expect(handleSeverity(0.6, gt)).toBeNull();
    expect(handleSeverity(0.61, gt)).toBe("warn");
    expect(handleSeverity(0.8, gt)).toBe("warn");
    expect(handleSeverity(0.81, gt)).toBe("error");
  });
});

describe("handleSeverity - noul, less_than (the polarity lives in the operator)", () => {
  test("low readings fire; high readings pass", () => {
    expect(handleSeverity(0.4, lt)).toBeNull();
    expect(handleSeverity(0.39, lt)).toBe("warn");
    expect(handleSeverity(0.3, lt)).toBe("warn");
    expect(handleSeverity(0.29, lt)).toBe("error");
    expect(handleSeverity(0.8, lt)).toBeNull(); // the acceptance case: high noul = pass
  });
});

describe("handleSeverity - silent_band", () => {
  test("suppresses before thresholds (inclusive, raw p)", () => {
    const banded: NoulHandlerData = {
      warn: { greater_than: 0.6 },
      error: { greater_than: 0.8 },
      silent_band: [0.2, 0.4],
    };
    expect(handleSeverity(0.2, banded)).toBeNull();
    expect(handleSeverity(0.4, banded)).toBeNull();
    expect(handleSeverity(0.7, banded)).toBe("warn"); // above the band, fires
    expect(handleSeverity(0.1, banded)).toBeNull(); // below the band, nothing fires
  });
});

describe("handleSeverity - score", () => {
  test("levels map by rounded index; pass is silent", () => {
    expect(handleSeverity(0, score)).toBeNull();
    expect(handleSeverity(1, score)).toBe("warn");
    expect(handleSeverity(2, score)).toBe("error");
    expect(handleSeverity(1.4, score)).toBe("warn");
  });

  test("out-of-range degrades to silent (the engine fails loud upstream)", () => {
    expect(handleSeverity(3, score)).toBeNull();
    expect(handleSeverity(-1, score)).toBeNull();
  });
});

describe("checkNoulHandler", () => {
  test("valid data -> null", () => {
    expect(checkNoulHandler(gt)).toBeNull();
    expect(checkNoulHandler(lt)).toBeNull();
    expect(checkNoulHandler({ warn: { greater_than: 0.6 } })).toBeNull();
    expect(checkNoulHandler({ ...gt, silent_band: [0.1, 0.3] })).toBeNull();
  });

  test("conditions carry exactly one operator, within (0, 1)", () => {
    expect(checkNoulHandler({ warn: {} })).toMatch(/must declare one operator/);
    expect(checkNoulHandler({ warn: { greater_than: 0.5, less_than: 0.2 } })).toMatch(
      /exactly one operator/,
    );
    expect(checkNoulHandler({ warn: { greater_than: 1 } })).toMatch(/within \(0, 1\)/);
  });

  test("error is the narrower region, per direction", () => {
    expect(checkNoulHandler({ warn: { greater_than: 0.8 }, error: { greater_than: 0.6 } })).toMatch(
      /warn < error/,
    );
    expect(checkNoulHandler({ warn: { less_than: 0.3 }, error: { less_than: 0.4 } })).toMatch(
      /warn > error/,
    );
  });

  test("band invariants: ordered, not the whole scale, no thresholds inside", () => {
    expect(checkNoulHandler({ ...gt, silent_band: [0.9, 0.2] })).toMatch(/ordered/);
    expect(checkNoulHandler({ ...gt, silent_band: [0, 1] })).toMatch(/whole scale/);
    expect(checkNoulHandler({ ...gt, silent_band: [0.55, 0.65] })).toMatch(
      /contains the warn threshold/,
    );
  });
});

test("HandlerData accepts both forms structurally", () => {
  const both: readonly HandlerData[] = [gt, score];
  expect(both).toHaveLength(2);
});

describe("ruleTargets - the runtime face of the RuleTarget union", () => {
  // The compile-time half of the pin: Record<RuleTarget, true> requires a key per union member,
  // so a new member without an entry here fails `tsc` (missing key), and an entry that is not a
  // member fails it too (the array element type). The runtime half below ties this record to the
  // exported array, so neither face can drift from the other.
  const _exhaustive: Record<RuleTarget, true> = {
    files: true,
    functions: true,
    classes: true,
    methods: true,
    types: true,
    bindings: true,
    definitions: true,
    comments: true,
    "loose-comments": true,
    imports: true,
  };
  // Same pin in assignment form: ruleTargets' element type must stay exactly RuleTarget.
  const _all: readonly RuleTarget[] = ruleTargets;

  test("every union member is registered exactly once; no extras, no duplicates", () => {
    expect([...ruleTargets].sort()).toEqual(Object.keys(_exhaustive).sort());
    expect(new Set(ruleTargets).size).toBe(ruleTargets.length);
    for (const target of ruleTargets) expect(_exhaustive[target]).toBe(true);
    expect(_all).toBe(ruleTargets);
  });
});
