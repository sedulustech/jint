import { describe, expect, test } from "bun:test";
import { validateConfig } from "../../src/config/load.ts";
import { collectReport, lint } from "../../src/core/lint.ts";
import type { AnyState, Classifier, QuestionSpec } from "../../src/core/types.ts";

// The proof rule runs the real pipeline end to end: config tsRules -> jint:sdk load -> walk ->
// pairing via element.parent -> classifier. The classifier is a stub that records the composed
// state (the pairing is asserted ON THE WIRE SHAPE, not on model behavior).

const RULE = new URL("./is-comment-paired.ts", import.meta.url).pathname;
const FIXTURE = new URL("./fixtures/paired.py", import.meta.url).pathname;

describe("is_comment_paired_with_code (example)", () => {
  test("judges the docstring TOGETHER WITH the code it annotates, and the finding binds", async () => {
    const states: AnyState[] = [];
    const classifier: Classifier = async (state, questions: Record<string, QuestionSpec>) => {
      states.push(state);
      const answers: Record<string, number> = {};
      for (const name of Object.keys(questions)) answers[name] = 0.9; // error above error_at 0.85
      return answers;
    };
    const config = validateConfig(
      { input: FIXTURE, rules: [], tsRules: [RULE], apiKey: "unused" },
      "example.config.json",
    );
    const report = await collectReport(lint({ config, classifier }));
    // The docstring element, judged with its annotated code as composed state: the pairing.
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      comment: '"""Return the active users from the database."""',
    });
    expect(String((states[0] as unknown as Record<string, unknown>).annotated)).toContain(
      "fetch_active_users",
    );
    // Stub 0.9 > error_at 0.85 -> error finding, bound to the docstring's span.
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.severity).toBe("error");
    expect(report.findings[0]?.location?.input).toBe(FIXTURE);
    expect(report.findings[0]?.location?.span.start.line).toBe(2);
  });
});
