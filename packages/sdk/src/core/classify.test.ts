import { describe, test, expect } from "bun:test";
import { classify, type ClassifyOutcome } from "./classify.ts";
import { SetupError, type Classifier, type HandleResult, type Rule } from "./types.ts";
import type { ClassifiedAnswer } from "@jint/contract";

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
const loudHandle = (): HandleResult => ({ severity: "error" });

const noulFileRule: Rule = {
  name: "r_file",
  instructions: "Is this file the thing its name promises?",
  target: "files",
  handle: loudHandle,
  criteria: { true: "true side", false: "false side" },
};

const scoreFunctionRule: Rule = {
  name: "r_fn",
  kind: "score",
  target: "functions",
  handle: loudHandle,
  instructions: "Score the function.",
  criteria: ["obvious", "mostly clear", "dense"],
};

/** Fake classifier: answers every question with the rule's value; records the states it judged. */
function fakeClassifier(values: Record<string, number>, states: unknown[] = []): Classifier {
  return async (state, questions) => {
    states.push(state);
    const out: Record<string, ClassifiedAnswer> = {};
    for (const key of Object.keys(questions)) {
      const rule = key.includes(" in ") ? key.slice(0, key.indexOf(" in ")) : key;
      out[key] = { value: values[rule]! };
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
      {
        rule: "r_file",
        input: "input",
        value: 0.7,
        element: {
          kind: "file",
          label: "L1-L7",
          span: {
            start: { line: 1, column: 0 },
            end: { line: 7, column: 0 },
            startByte: 0,
            endByte: SOURCE.length,
          },
        },
      },
    ]);
    // one state: the whole source, nothing array-shaped
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({ path: "input", content: SOURCE, id: "L1-L7" });
    // measurement-only scope: no severity, no finding, no handle application anywhere
    const json = JSON.stringify(outcome);
    expect(json).not.toContain("severity");
    expect(outcome.errors).toEqual([]);
  });

  test("score rule over functions: one call per element, inventory derived from source", async () => {
    const states: unknown[] = [];
    const outcome = await classify(SOURCE, [scoreFunctionRule], {
      path: "src/maths.ts", // grammar detected from the extension
      classifier: fakeClassifier({ r_fn: 2 }, states),
    });
    expect(outcome.errors).toEqual([]);
    // one call per element (two functions), never one matrix call
    expect(states).toHaveLength(2);
    expect(outcome.measurements).toHaveLength(2);
    expect(
      outcome.measurements.every((m) => m.element !== undefined && m.element.kind === "function"),
    ).toBe(true);
    expect(outcome.measurements.every((m) => m.value === 2)).toBe(true);
    expect(outcome.measurements.every((m) => /^src\/maths\.ts#[0-9a-f-]{36}$/.test(m.input))).toBe(
      true,
    );
    // element states are single-element sources (with attached content), under the file path
    for (const state of states) {
      expect((state as { path: string }).path).toBe("src/maths.ts");
      expect((state as { source: string }).source).toContain("return");
      expect(typeof (state as { id: unknown }).id).toBe("string");
    }
    // inventory exposed: two definitions parsed from the source
    expect(outcome.inventory).toBeDefined();
    expect(outcome.inventory!.definitions).toHaveLength(2);
  });

  test("path option carries identity; language option overrides grammar detection", async () => {
    const outcome = await classify(SOURCE, [scoreFunctionRule], {
      path: "snippet.txt",
      language: "typescript",
      classifier: fakeClassifier({ r_fn: 1 }),
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.inventory).toBeDefined();
    expect(outcome.measurements.every((m) => /^snippet\.txt#[0-9a-f-]{36}$/.test(m.input))).toBe(
      true,
    );
  });

  test("no resolvable language with an element-target rule -> MISSING_GRAMMAR setup error", async () => {
    const thrown = await classify("just some text", [noulFileRule, scoreFunctionRule], {
      classifier: fakeClassifier({ r_file: 0.9, r_fn: 1 }),
    }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(SetupError);
    expect((thrown as SetupError).code).toBe("MISSING_GRAMMAR");
    expect((thrown as Error).message).toContain("declare it with the language option");
  });

  test("unparseable source with explicit language: WALK_FAILED in-band, unit-scoped rules still classified", async () => {
    const outcome = await classify("((( not code", [noulFileRule, scoreFunctionRule], {
      language: "typescript",
      classifier: fakeClassifier({ r_file: 0.9, r_fn: 1 }),
    });
    expect(outcome.measurements).toEqual([
      {
        rule: "r_file",
        input: "input",
        value: 0.9,
        element: {
          kind: "file",
          label: "L1",
          span: {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 0 },
            startByte: 0,
            endByte: 12,
          },
        },
      },
    ]);
    expect(outcome.errors.map((e) => e.code)).toEqual(["WALK_FAILED"]);
    expect(outcome.inventory).toBeUndefined();
  });

  test("oversized element: zero rules, zero calls, counted in-band", async () => {
    const states: unknown[] = [];
    const definitionsRule: Rule = {
      name: "r_def",
      kind: "score",
      target: "definitions",
      handle: loudHandle,
      instructions: "Score the definition.",
      criteria: ["clear", "mixed", "muddled"],
    };
    const big =
      "const big = [" +
      Array.from({ length: 3000 }, () => '"' + "x".repeat(40) + '"').join(", ") +
      "];";
    const outcome = await classify(big, [definitionsRule], {
      path: "src/big.ts",
      classifier: fakeClassifier({ r_def: 1 }, states),
    });
    // the oversized element is never judged: no call, no measurement, no error — the named skip
    // is the in-band signal (design: composite body-size fix, the hard size backstop)
    expect(states).toHaveLength(0);
    expect(outcome.measurements).toHaveLength(0);
    expect(outcome.errors).toHaveLength(0);
    expect(outcome.oversized).toHaveLength(1);
    expect(outcome.oversized[0]).toMatchObject({
      label: "d0",
      capture: "binding",
      chars: big.length,
    });
  });

  test("empty source is a setup failure, thrown", async () => {
    await expect(
      classify("", [noulFileRule], { classifier: fakeClassifier({}) }),
    ).rejects.toBeInstanceOf(SetupError);
  });
});
