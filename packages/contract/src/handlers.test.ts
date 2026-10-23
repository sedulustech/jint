import { describe, expect, test } from "bun:test";
import {
  checkChoiceHandler,
  checkNoulHandler,
  handleSeverity,
  handleTier,
  readChoice,
  ruleTargets,
  type ChoiceHandlerData,
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

describe("handleSeverity - noul, error-only (no warn tier)", () => {
  test("fires error past the threshold, silent otherwise", () => {
    const errorOnly: NoulHandlerData = { error: { greater_than: 0.6 } };
    expect(handleSeverity(0.61, errorOnly)).toBe("error");
    expect(handleSeverity(0.6, errorOnly)).toBeNull();
    expect(handleSeverity(0.2, errorOnly)).toBeNull();
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

describe("handleSeverity - choice", () => {
  const choice: ChoiceHandlerData = {
    choices: {
      justified: "pass",
      loose: "warn",
      wrong: { level: "error", message: "Rewrite it." },
    },
  };

  test("the selected option's tier is the verdict; the value plays no part", () => {
    expect(handleSeverity(0.9, choice, "justified")).toBeNull();
    expect(handleSeverity(0.2, choice, "loose")).toBe("warn");
    expect(handleSeverity(0.2, choice, "wrong")).toBe("error");
    expect(handleTier(0.9, choice, "wrong")).toEqual({ severity: "error", message: "Rewrite it." });
  });

  test("a missing or unknown option degrades to silent (the engine fails loud upstream)", () => {
    expect(handleSeverity(0.9, choice)).toBeNull();
    expect(handleSeverity(0.9, choice, "absent")).toBeNull();
  });
});

describe("readChoice - probabilities grouped by tier", () => {
  const data: ChoiceHandlerData = {
    choices: {
      justified: "pass",
      contradicted: { level: "error", message: "Rewrite the contradicted sentence." },
      historical: { level: "error", message: "Remove the history." },
    },
  };

  test("the tier with the most probability wins, even when a pass option is the top option", () => {
    // justified is the single most probable option (0.43), but the error tier holds 0.57
    const fired = readChoice(data, "justified", {
      justified: 0.43,
      contradicted: 0.17,
      historical: 0.4,
    });
    expect(fired).toEqual({ severity: "error", message: "Remove the history." });
  });

  test("the message comes from the most probable option within the winning tier", () => {
    const fired = readChoice(data, "contradicted", {
      justified: 0.1,
      contradicted: 0.5,
      historical: 0.4,
    });
    expect(fired?.message).toBe("Rewrite the contradicted sentence.");
  });

  test("an undecided tier fires when the top tier leads the runner-up by less than `margin`", () => {
    const withUndecided: ChoiceHandlerData = {
      ...data,
      undecided: { margin: 0.2, level: "warn", message: "Read it against the code." },
    };
    // error 0.57 vs pass 0.43: a 0.14 lead, under 0.2
    expect(
      readChoice(withUndecided, "justified", {
        justified: 0.43,
        contradicted: 0.17,
        historical: 0.4,
      }),
    ).toEqual({ severity: "warn", message: "Read it against the code.", undecided: true });
    // error 0.83 vs pass 0.17: a 0.66 lead - decided
    expect(
      readChoice(withUndecided, "contradicted", {
        justified: 0.17,
        contradicted: 0.43,
        historical: 0.4,
      }),
    ).toEqual({ severity: "error", message: "Rewrite the contradicted sentence." });
  });

  test("an undecided tier at pass stays silent", () => {
    const silent: ChoiceHandlerData = { ...data, undecided: { margin: 0.2, level: "pass" } };
    expect(
      readChoice(silent, "justified", { justified: 0.45, contradicted: 0.3, historical: 0.25 }),
    ).toBe(null);
  });
});

describe("checkChoiceHandler", () => {
  const labels = ["justified", "wrong"];

  test("one tier per option label, at least one non-pass", () => {
    expect(
      checkChoiceHandler({ choices: { justified: "pass", wrong: "error" } }, labels),
    ).toBeNull();
  });

  test("every failure names the field and the labels involved", () => {
    expect(checkChoiceHandler({ choices: { justified: "pass" } }, labels)).toContain("wrong");
    expect(
      checkChoiceHandler({ choices: { justified: "pass", wrong: "error", extra: "warn" } }, labels),
    ).toContain("extra");
    expect(
      checkChoiceHandler({ choices: { justified: "pass", wrong: { level: "pass" } } }, labels),
    ).toContain("non-pass");
    expect(
      checkChoiceHandler(
        { choices: { justified: "pass", wrong: "error" }, undecided: { margin: 1, level: "warn" } },
        labels,
      ),
    ).toContain("handle.undecided.margin");
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
