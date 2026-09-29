import { describe, expect, test } from "bun:test";
import { decompose, type WalkElement } from "../input/walk.ts";
import { rulesForElement } from "../sensors/classify.ts";
import {
  resolveAllTsTargets,
  runTsRules,
  tsElementsOf,
  type ResolvedTsTarget,
  type ResolvedTsTargets,
} from "./execute.ts";
import type { AnyState, ClassifiedAnswer, Classifier, QuestionSpec } from "../types.ts";
import type { TsElement, TsRule } from "./sdk.ts";

/** Splits a unit inventory by path the way lint hands it over (one file here). */
async function oneFile(
  source: string,
  path = "src/fixture.ts",
): Promise<Map<string, readonly WalkElement[]>> {
  const inv = await decompose(source, "typescript");
  return new Map([[path, [...inv.definitions, ...inv.comments, ...inv.imports]]]);
}

const SOURCE = [
  "export function alpha() {",
  "  return 1;",
  "}",
  "",
  "export const beta = () => 2;",
  "",
  "",
  "// a standalone comment (two blank lines keep it standalone)",
].join("\n");

interface Call {
  state: AnyState;
  questions: Record<string, QuestionSpec>;
}

/** A classifier that records calls and answers a fixed probability per rule. */
function fakeClassifier(value: number, calls: Call[] = [], error: Error | null = null): Classifier {
  return async (state, questions) => {
    calls.push({ state, questions });
    if (error !== null) throw error;
    const answers: Record<string, ClassifiedAnswer> = {};
    for (const name of Object.keys(questions)) answers[name] = { value };
    return answers;
  };
}

/** Narrows a resolved entry to its targets (tests only ever resolve valid rules). */
function targetsOf(resolved: ResolvedTsTarget): readonly TsElement[] {
  expect("targets" in resolved).toBe(true);
  return "targets" in resolved ? resolved.targets : [];
}

const spec = (state: Record<string, unknown>) => ({
  instructions: "i",
  criteria: { true: "t", false: "f" },
  state,
});

async function run(
  rule: TsRule,
  inventory: Map<string, readonly WalkElement[]>,
  classifier: Classifier,
): Promise<Awaited<ReturnType<typeof runTsRules>>> {
  const resolved: ResolvedTsTargets = resolveAllTsTargets([rule], inventory);
  return runTsRules([rule], resolved, classifier, () => false);
}

function ruleOf(patch: Partial<TsRule>): TsRule {
  return {
    name: "is_test_rule",
    target: "comments",
    classify: () => spec({ source: "x" }),
    handle: { warn: { greater_than: 0.5 }, error: { greater_than: 0.9 } },
    ...patch,
  } as TsRule;
}

describe("cross-tier target consistency (the drift killer)", () => {
  /** A fixture with comment-role elements AND a code element carrying an attachedComment. */
  const COMMENTED = [
    "// leading run consumed into alpha",
    "export function alpha() {",
    "  return 1;",
    "}",
    "",
    "",
    "// a standalone comment (two blank lines keep it standalone)",
  ].join("\n");

  test("JSON-tier rulesForElement and TS-tier selection return the SAME element set for every element target", async () => {
    const inv = await decompose(COMMENTED, "typescript");
    const inventory = [...inv.definitions, ...inv.comments, ...inv.imports];
    // alpha carries the leading comment: target "comments" must match it in BOTH tiers.
    expect(inventory.some((e) => (e.attachedComment?.length ?? 0) > 0)).toBe(true);
    expect(inventory.some((e) => e.role === "comment")).toBe(true);
    const fakeRule = (target: string) =>
      ({
        name: "consistency_probe",
        target,
        classify: () => ({ instructions: "i", criteria: { true: "t", false: "f" }, state: {} }),
      }) as never;
    for (const target of ["comments", "functions", "definitions", "imports"] as const) {
      const jsonPicked = inventory.filter((e) => rulesForElement([fakeRule(target)], e).length > 0);
      const resolved = resolveAllTsTargets(
        [fakeRule(target)],
        new Map([["src/fixture.ts", inventory]]),
      );
      const tsPicked = targetsOf([...resolved.values()][0]!);
      expect(tsPicked.map((e) => e.id).sort()).toEqual(jsonPicked.map((e) => e.label).sort());
    }
  });
});

describe("resolveAllTsTargets", () => {
  test("a string target filters the full inventory by role", async () => {
    const inventory = await oneFile(SOURCE);
    const resolved = resolveAllTsTargets([ruleOf({})], inventory);
    const resolvedRule = [...resolved.values()][0]!;
    expect("targets" in resolvedRule && resolvedRule.targets).toHaveLength(1);
    expect("targets" in resolvedRule && resolvedRule.targets[0]?.id).toBe("c0");
    expect("targets" in resolvedRule && resolvedRule.targets[0]?.role).toBe("comment");
  });

  test("oversized elements never enter TS targets (same backstop as the JSON tier)", async () => {
    const inv = await oneFile(SOURCE);
    const oversized: WalkElement = {
      ...[...inv.get("src/fixture.ts")!][0]!,
      label: "d9",
      oversized: true,
    };
    const inventory = [...inv.get("src/fixture.ts")!, oversized];
    for (const target of ["comments", "functions", "definitions", "imports"] as const) {
      const resolved = resolveAllTsTargets(
        [ruleOf({ target })],
        new Map([["src/fixture.ts", inventory]]),
      );
      const targets = targetsOf([...resolved.values()][0]!);
      expect(targets.some((e) => e.id === "d9")).toBe(false);
    }
    // ...and not even the function-selection form sees it: the view excludes the element.
    const seen = resolveAllTsTargets(
      [ruleOf({ target: (elements) => elements })],
      new Map([["src/fixture.ts", inventory]]),
    );
    const all = targetsOf([...seen.values()][0]!);
    expect(all.some((e) => e.id === "d9")).toBe(false);
  });

  test("a dangling parent label throws instead of silently nulling", () => {
    const dangling = {
      label: "d0",
      span: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 1 },
        startByte: 0,
        endByte: 1,
      },
      content: "x",
      nodeType: "function_declaration",
      role: "function",
      internalCommentCount: 0,
      parent: "d99",
    } as WalkElement;
    expect(() => tsElementsOf([dangling], "src/fixture.ts")).toThrow(/d99/);
  });

  test("the function form receives the FULL inventory and is evaluated ONCE", async () => {
    const inventory = await oneFile(SOURCE);
    let evaluations = 0;
    let seen: readonly TsElement[] = [];
    const rule = ruleOf({
      target: (elements) => {
        evaluations++;
        seen = elements;
        return elements.filter((e) => e.role === "function");
      },
    });
    const resolved = resolveAllTsTargets([rule], inventory);
    const resolvedRule = [...resolved.values()][0]!;
    expect(evaluations).toBe(1);
    expect(seen).toHaveLength(3); // 2 functions + 1 standalone comment = full walk inventory
    expect("targets" in resolvedRule && resolvedRule.targets).toHaveLength(2);
  });

  test("a throwing target function resolves to RULE_FAILED, not a crash", async () => {
    const inventory = await oneFile(SOURCE);
    const rule = ruleOf({
      target: () => {
        throw new Error("bad selection");
      },
      handleClassification: () => [],
    });
    const phase = await run(rule, inventory, fakeClassifier(0.9));
    expect(phase.events).toHaveLength(1);
    expect(phase.events[0]?.type).toBe("error");
    expect(phase.events[0]?.type === "error" && phase.events[0].error.code).toBe("RULE_FAILED");
  });
});

describe("tsElementsOf — materialized parent view", () => {
  test("TsElement.parent links a nested element to its owner; top-level is null", async () => {
    const inv = await decompose(
      ["class Widget {", "  render(): string {", "    return 'x';", "  }", "}"].join("\n"),
      "typescript",
    );
    const inventory = [...inv.definitions, ...inv.comments, ...inv.imports];
    const elements = tsElementsOf(inventory, "src/w.ts");
    const klass = elements.find((e) => e.role === "type")!;
    const method = elements.find((e) => e.role === "function")!;
    expect(klass.parent).toBeNull();
    expect(method.parent?.id).toBe(klass.id);
    // The parent chain materializes the SAME view (shared element identity).
    expect(method.parent?.source).toBe(klass.source);
  });
});

describe("runTsRules — impossible state fails loud", () => {
  test("a rule missing from the resolution map throws (never a silent skip)", async () => {
    const inventory = await oneFile(SOURCE);
    const rule = ruleOf({});
    await expect(runTsRules([rule], new Map(), fakeClassifier(0.9), () => false)).rejects.toThrow(
      /no resolution entry/,
    );
    void inventory;
  });
});

// Review 396888e finding 3: scoping is a cross-tier feature — the TS tier must be TESTED, not
// just compiled. Zero-cost filtering on BOTH selection paths, and the note the JSON tier emits.
describe("per-rule scoping on the TS tier", () => {
  test("zero-cost: a scoped-out element costs zero jev calls (grammar path)", async () => {
    const inventory = await oneFile(SOURCE, "tests/fixture.ts");
    const calls: Call[] = [];
    const phase = await run(
      ruleOf({ exclude: ["tests/**"] }),
      inventory,
      fakeClassifier(0.8, calls),
    );
    expect(calls).toHaveLength(0);
    expect(phase.events.some((e) => e.type === "measurement")).toBe(false);
    // the gap is signal: one run-level note names the rule and the skipped count
    const notes = phase.events.filter((e) => e.type === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type === "note" && notes[0].note).toBe(
      'ts rule "is_test_rule": scope excluded 1 element(s)',
    );
  });

  test("zero-cost: scoping filters selection-function picks before any call", async () => {
    const inventory = await oneFile(SOURCE, "tests/fixture.ts");
    const calls: Call[] = [];
    const phase = await run(
      ruleOf({
        target: (elements) => elements, // picks everything; the scope subtracts
        exclude: ["tests/**"],
      }),
      inventory,
      fakeClassifier(0.8, calls),
    );
    expect(calls).toHaveLength(0);
    expect(phase.events.some((e) => e.type === "note" && e.note.includes("scope excluded"))).toBe(
      true,
    );
  });

  test("an in-scope rule emits no note and judges normally", async () => {
    const inventory = await oneFile(SOURCE, "src/fixture.ts");
    const calls: Call[] = [];
    const phase = await run(
      ruleOf({ exclude: ["tests/**"] }),
      inventory,
      fakeClassifier(0.8, calls),
    );
    expect(calls).toHaveLength(1);
    expect(phase.events.some((e) => e.type === "note")).toBe(false);
  });
});

describe("runTsRules — JEV_RESPONSE_INVALID guard", () => {
  test("a missing answer streams JEV_RESPONSE_INVALID, never a measurement", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(ruleOf({}), inventory, async () => ({}));
    expect(phase.events).toHaveLength(1);
    expect(phase.events[0]?.type).toBe("error");
    expect(phase.events[0]?.type === "error" && phase.events[0].error.code).toBe(
      "JEV_RESPONSE_INVALID",
    );
  });

  test("a non-finite answer streams JEV_RESPONSE_INVALID too", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(ruleOf({}), inventory, async (_s, q) =>
      Object.fromEntries(Object.keys(q).map((k) => [k, { value: Number.NaN }])),
    );
    expect(
      phase.events.some((e) => e.type === "error" && e.error.code === "JEV_RESPONSE_INVALID"),
    ).toBe(true);
    expect(phase.events.some((e) => e.type === "measurement")).toBe(false);
  });
});

describe("walk-first resolution (multi-file)", () => {
  test("the target function sees the inventories of EVERY walked file: resolution runs after the full walk", async () => {
    const a = await oneFile(SOURCE, "src/a.ts");
    const b = await oneFile(SOURCE, "src/b.ts");
    const inventory = new Map([...a, ...b]);
    let seenPaths: string[] = [];
    const rule = ruleOf({
      target: (elements) => {
        seenPaths = [...new Set(elements.map((e) => e.path))];
        return elements.filter((e) => e.role === "comment");
      },
    });
    const resolved = resolveAllTsTargets([rule], inventory);
    const targets = targetsOf([...resolved.values()][0]!);
    // Both files were fully walked BEFORE resolution: one comment per file, both visible.
    expect(seenPaths.sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(targets.map((t) => t.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("runTsRules — classification", () => {
  test("fan-out: N targets -> N classifier invocations, one question each, slice-of-one state", async () => {
    const inventory = await oneFile(SOURCE);
    const calls: Call[] = [];
    const phase = await run(
      ruleOf({ target: ["functions", "comments"] }),
      inventory,
      fakeClassifier(0.8, calls),
    );
    expect(calls).toHaveLength(3); // 2 functions + 1 comment
    for (const call of calls) {
      expect(Object.keys(call.questions)).toEqual(["is_test_rule"]);
      expect(call.questions["is_test_rule"]?.type).toBe("noul");
    }
    const measurements = phase.events.filter((e) => e.type === "measurement");
    expect(measurements).toHaveLength(3);
  });

  test("state synthesis is free: the composed state reaches the classifier verbatim", async () => {
    const inventory = await oneFile(SOURCE);
    const calls: Call[] = [];
    await run(
      ruleOf({
        classify: (self, ctx) =>
          spec({
            comment: self.source,
            total: ctx.targets.length,
            made_up: { a: 1 },
          }) as never,
      }),
      inventory,
      fakeClassifier(0.8, calls),
    );
    expect(calls[0]?.state as unknown as Record<string, unknown>).toEqual({
      comment: "// a standalone comment (two blank lines keep it standalone)",
      total: 1,
      made_up: { a: 1 },
    });
  });

  test("measurements bind to the target's span", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(ruleOf({}), inventory, fakeClassifier(0.8));
    const measurement = phase.events.find((e) => e.type === "measurement");
    expect(measurement?.type === "measurement" && measurement.measurement.input).toBe(
      "src/fixture.ts#L8",
    );
  });

  test("a throwing classify is RULE_FAILED per element; the run continues", async () => {
    const inventory = await oneFile(SOURCE);
    const calls: Call[] = [];
    let n = 0;
    const phase = await run(
      ruleOf({
        target: ["functions", "comments"],
        classify: (self) => {
          n++;
          if (n === 1) throw new Error("rule bug");
          return spec({ source: self.source });
        },
      }),
      inventory,
      fakeClassifier(0.8, calls),
    );
    const errors = phase.events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type === "error" && errors[0].error.code).toBe("RULE_FAILED");
    expect(errors[0]?.type === "error" && errors[0].error.message).toContain("rule bug");
    expect(calls).toHaveLength(2); // the other two elements still classified
  });

  test("a Promise from sync-only classify is a contract violation (RULE_FAILED)", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(
      ruleOf({
        classify: (() => Promise.resolve(spec({}))) as unknown as TsRule["classify"],
        handleClassification: () => [],
      }),
      inventory,
      fakeClassifier(0.8),
    );
    expect(phase.events.some((e) => e.type === "error" && e.error.code === "RULE_FAILED")).toBe(
      true,
    );
  });

  test("a spec schema violation fails loud naming the rule and the element", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(
      ruleOf({
        classify: () => ({ instructions: "i", criteria: { true: "t" }, state: {} }) as never,
        handleClassification: () => [],
      }),
      inventory,
      fakeClassifier(0.8),
    );
    const error = phase.events.find((e) => e.type === "error");
    expect(error?.type === "error" && error.error.code).toBe("RULE_FAILED");
    expect(error?.type === "error" && error.error.message).toContain('ts rule "is_test_rule"');
    expect(error?.type === "error" && error.error.message).toContain("src/fixture.ts#");
    expect(error?.type === "error" && error.error.message).toContain("criteria");
  });

  test("an oversized state part is skipped with a note, never sent", async () => {
    const inventory = await oneFile(SOURCE);
    const calls: Call[] = [];
    const phase = await run(
      ruleOf({ classify: () => spec({ blob: "x".repeat(8001) }) }),
      inventory,
      fakeClassifier(0.8, calls),
    );
    expect(calls).toHaveLength(0);
    expect(phase.events.some((e) => e.type === "note" && e.note.includes("blob"))).toBe(true);
  });

  test("a classifier transport error streams as its JEV code", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(ruleOf({}), inventory, fakeClassifier(0, [], new Error("down")));
    const error = phase.events.find((e) => e.type === "error");
    expect(error?.type === "error" && error.error.code).toBe("INTERNAL");
  });
});

describe("runTsRules — policy", () => {
  test("declarative handle: findings bind to the target's span", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(ruleOf({}), inventory, fakeClassifier(0.8));
    const findings = phase.events.filter((e) => e.type === "finding");
    expect(findings).toHaveLength(1);
    const finding = findings[0]?.type === "finding" ? findings[0].finding : null;
    expect(finding?.severity).toBe("warn");
    expect(finding?.location?.input).toBe("src/fixture.ts");
    expect(finding?.location?.span.start.line).toBe(8);
  });

  test("declarative handle below warn_at stays silent (measurement only)", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(
      ruleOf({ handle: { warn: { greater_than: 0.9 }, error: { greater_than: 0.95 } } }),
      inventory,
      fakeClassifier(0.8),
    );
    expect(phase.events.filter((e) => e.type === "finding")).toHaveLength(0);
    expect(phase.events.filter((e) => e.type === "measurement")).toHaveLength(1);
  });

  test("handleClassification runs ONCE, results aligned with targets, message/data ride the finding", async () => {
    const inventory = await oneFile(SOURCE);
    const calls: Array<{ results: readonly unknown[] }> = [];
    const phase = await run(
      ruleOf({
        target: ["functions", "comments"],
        handle: undefined,
        handleClassification: (results) => {
          calls.push({ results });
          return results.map((r, i) => ({
            severity: r.type === "noul" && r.noul > 0.7 ? ("error" as const) : null,
            message: "why #" + String(i),
            data: { index: i },
          }));
        },
      }),
      inventory,
      fakeClassifier(0.8),
    );
    expect(calls).toHaveLength(1); // ONCE, not per element
    expect(calls[0]?.results).toHaveLength(3);
    const findings = phase.events.filter((e) => e.type === "finding");
    expect(findings).toHaveLength(3);
    const first = findings[0]?.type === "finding" ? findings[0].finding : null;
    expect(first?.severity).toBe("error");
    expect(first?.data).toEqual({ index: 0 });
  });

  test("a wrong-length decisions array is RULE_FAILED", async () => {
    const inventory = await oneFile(SOURCE);
    const phase = await run(
      ruleOf({ handle: undefined, handleClassification: () => [] }),
      inventory,
      fakeClassifier(0.8),
    );
    const error = phase.events.find((e) => e.type === "error");
    expect(error?.type === "error" && error.error.code).toBe("RULE_FAILED");
    expect(error?.type === "error" && error.error.message).toContain("one decision per result");
  });
});
