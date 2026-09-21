import { describe, test, expect } from "bun:test";
import { lint } from "../src/core/lint.ts";
import { defaultConfig } from "../src/config/load.ts";
import { naming_consistency } from "../src/core/sensors/defaults.ts";

describe("cli: in-process unit tests", () => {
  test("config disable: naming_consistency not called", async () => {
    const config = { ...defaultConfig(), input: "tests/fixtures/sample-file.ts" };
    const asked: string[] = [];
    const fakeJudge = async (state: any, questions: any) => {
      Object.keys(questions).forEach(k => asked.push(k));
      return { naming_consistency: 0.9, naming_precision: 0.9, greppable_identifiers: 0.9, excessive_comments: 0.1, cognitive_complexity: 0.1 };
    };

    const stream = lint({ config, disable: ["naming_consistency"], judge: fakeJudge as any });
    for await (const _ of stream) {}
    expect(asked).not.toContain("naming_consistency");
  });

  test("exclude propagation: path excluded not called", async () => {
    const config = { ...defaultConfig(), input: "tests/fixtures/sample-dir" };
    const asked: string[] = [];
    const fakeJudge = async (state: any, questions: any) => {
      asked.push(state.path);
      return { naming_consistency: 0.9, naming_precision: 0.9, greppable_identifiers: 0.9, excessive_comments: 0.1, cognitive_complexity: 0.1 };
    };

    // tests/fixtures/sample-dir/good.ts
    const stream = lint({ 
        config, 
        exclude: ["**/good.ts"], 
        judge: fakeJudge as any 
    });
    for await (const _ of stream) {}
    expect(asked.some(p => p.endsWith("good.ts"))).toBe(false);
  });
});