import { describe, test, expect } from "bun:test";
import { classify, type ClassifyOutcome } from "./classify.ts";
import { SetupError, type Classifier, type Rule } from "./types.ts";

const SOURCE = [
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "",
  "export function sub(a: number, b: number): number {",
  "  return a - b;",
  "}",
].join("\n");

/** A handle that would fire on every reading — proves classify() never applies it. */
const loudHandle = () => "error" as const;

const noulFileRule: Rule = {
  name: "r_file",
  target: "files",
  handle: loudHandle,
  criteria: { true: "true side", false: "false side" },
};

const choiceFunctionRule: Rule = {
  name: "r_fn",
  kind: "choice",
  target: "functions",
  handle: loudHandle,
  instructions: "Score the function.",
  criteria: ["obvious", "mostly clear", "dense"],
};

/** Fake classifier: answers every question with the rule's value; records the states it judged. */
function fakeClassifier(values: Record<string, number>, states: unknown[] = []): Classifier {
  return async (state, questions) => {
    states.push(state);
    const out: Record<string, number> = {};
    for (const key of Object.keys(questions)) {
      const rule = key.includes(" in ") ? key.slice(0, key.indexOf(" in ")) : key;
      out[key] = values[rule]!;
    }
    return out;
  };
}

describe("classify", () => {
  test("unit-scoped noul rule: one whole-source call, raw measurement, handle never applied", async () => {
    const states: unknown[] = [];
    const outcome: ClassifyOutcome = await classify(SOURCE, [noulFileRule], {
      language: "typescript",
      classifier: fakeClassifier({ r_file: 0.7 }, states),
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.measurements).toEqual([
      { rule: "r_file", input: "input", value: 0.7, stage: "file" },
    ]);
    // one state: the whole source, nothing array-shaped
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({ path: "input", content: SOURCE, id: "L1-L7" });
    // measurement-only door: no severity, no signal, no handle application anywhere
    const json = JSON.stringify(outcome);
    expect(json).not.toContain("severity");
    expect(outcome.errors).toEqual([]);
  });

  test("choice rule over functions: one call per element, inventory derived from source", async () => {
    const states: unknown[] = [];
    const outcome = await classify(SOURCE, [choiceFunctionRule], {
      path: "src/maths.ts", // grammar detected from the extension
      classifier: fakeClassifier({ r_fn: 2 }, states),
    });
    expect(outcome.errors).toEqual([]);
    // one call per element (two functions), never one matrix call
    expect(states).toHaveLength(2);
    expect(outcome.measurements).toHaveLength(2);
    expect(outcome.measurements.every((m) => m.stage === "element")).toBe(true);
    expect(outcome.measurements.every((m) => m.value === 2)).toBe(true);
    expect(outcome.measurements.every((m) => m.input.startsWith("src/maths.ts#L"))).toBe(true);
    // element states are single-element sources (with attached content), under the file path
    for (const state of states) {
      expect((state as { path: string }).path).toBe("src/maths.ts");
      expect((state as { source: string }).source).toContain("return");
    }
    // inventory exposed: two definitions parsed from the source
    expect(outcome.inventory).toBeDefined();
    expect(outcome.inventory!.definitions).toHaveLength(2);
  });

  test("path option carries identity; language option overrides grammar detection", async () => {
    const outcome = await classify(SOURCE, [choiceFunctionRule], {
      path: "snippet.txt",
      language: "typescript",
      classifier: fakeClassifier({ r_fn: 1 }),
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.inventory).toBeDefined();
    expect(outcome.measurements.every((m) => m.input.startsWith("snippet.txt#L"))).toBe(true);
  });

  test("no resolvable language: WALK_FAILED in-band, unit-scoped rules still measured, inventory omitted", async () => {
    const states: unknown[] = [];
    const outcome = await classify("just some text", [noulFileRule, choiceFunctionRule], {
      classifier: fakeClassifier({ r_file: 0.9, r_fn: 1 }, states),
    });
    // the whole-source rule measured anyway
    expect(outcome.measurements).toEqual([
      { rule: "r_file", input: "input", value: 0.9, stage: "file" },
    ]);
    // the mapping failure is a value, not a throw
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]!.code).toBe("WALK_FAILED");
    expect(outcome.inventory).toBeUndefined();
  });

  test("unparseable source with explicit language: WALK_FAILED in-band, unit-scoped rules still measured", async () => {
    const outcome = await classify("((( not code", [noulFileRule, choiceFunctionRule], {
      language: "typescript",
      classifier: fakeClassifier({ r_file: 0.9, r_fn: 1 }),
    });
    expect(outcome.measurements).toEqual([
      { rule: "r_file", input: "input", value: 0.9, stage: "file" },
    ]);
    expect(outcome.errors.map((e) => e.code)).toEqual(["WALK_FAILED"]);
    expect(outcome.inventory).toBeUndefined();
  });

  test("empty source is a setup failure, thrown", async () => {
    await expect(
      classify("", [noulFileRule], { classifier: fakeClassifier({}) }),
    ).rejects.toBeInstanceOf(SetupError);
  });
});
