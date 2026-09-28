import { describe, expect, test } from "bun:test";
import { decompose, type InventoryElement } from "../input/walk.ts";
import { resolveAllTsTargets, runTsRules, type ResolvedTsTargets } from "./execute.ts";
import type { AnyState, Classifier, QuestionSpec } from "../types.ts";
import type { TsElement, TsRule } from "./sdk.ts";

/** Splits a unit inventory by path the way lint hands it over (one file here). */
async function oneFile(
  source: string,
  path = "src/fixture.ts",
): Promise<Map<string, readonly InventoryElement[]>> {
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
    const answers: Record<string, number> = {};
    for (const name of Object.keys(questions)) answers[name] = value;
    return answers;
  };
}

const spec = (state: Record<string, unknown>) => ({
  instructions: "i",
  criteria: { true: "t", false: "f" },
  state,
});

async function run(
  rule: TsRule,
  inventory: Map<string, readonly InventoryElement[]>,
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
    handle: { warn_at: 0.5, error_at: 0.9 },
    ...patch,
  } as TsRule;
}

describe("resolveAllTsTargets", () => {
  test("a string target filters the full inventory by role", async () => {
    const inventory = await oneFile(SOURCE);
    const resolved = resolveAllTsTargets([ruleOf({})], inventory);
    const resolvedRule = [...resolved.values()][0]!;
    expect("targets" in resolvedRule && resolvedRule.targets).toHaveLength(1);
    expect("targets" in resolvedRule && resolvedRule.targets[0]?.id).toBe("c0");
    expect("targets" in resolvedRule && resolvedRule.targets[0]?.role).toBe("comment");
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
      ruleOf({ handle: { warn_at: 0.9, error_at: 0.95 } }),
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
    expect(first?.message).toBe("why #0");
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
