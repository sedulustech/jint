import { describe, test, expect } from "bun:test";
import { lint } from "../src/core/lint.ts";
import { defaultConfig } from "../src/config/load.ts";
import { isVocabularyConsistent } from "../src/core/sensors/defaults.ts";

describe("cli: in-process unit tests", () => {
  test("config disable: is_vocabulary_consistent not called", async () => {
    const config = { ...defaultConfig(), input: "tests/fixtures/sample-file.ts" };
    const asked: string[] = [];
    const fakeJudge = async (state: any, questions: any) => {
      Object.keys(questions).forEach(k => asked.push(k));
      return { is_vocabulary_consistent: 0.9, is_name_purposeful: 0.9, is_greppable: 0.9, is_comment_business_context: 0.5, is_comment_narration: 0.1, is_comment_patching_readability: 0.1, will_comment_drift: 0.1, is_cognitively_complex: 0.1 };
    };

    const stream = lint({ config, disable: ["is_vocabulary_consistent"], judge: fakeJudge as any });
    for await (const _ of stream) {}
    expect(asked).not.toContain("is_vocabulary_consistent");
  });

  test("exclude propagation: path excluded not called", async () => {
    const config = { ...defaultConfig(), input: "tests/fixtures/sample-dir" };
    const asked: string[] = [];
    const fakeJudge = async (state: any, questions: any) => {
      asked.push(state.path);
      return { is_vocabulary_consistent: 0.9, is_name_purposeful: 0.9, is_greppable: 0.9, is_comment_business_context: 0.5, is_comment_narration: 0.1, is_comment_patching_readability: 0.1, will_comment_drift: 0.1, is_cognitively_complex: 0.1 };
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