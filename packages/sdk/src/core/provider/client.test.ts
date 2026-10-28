import { describe, test, expect } from "bun:test";
import { elementWireId } from "../rules/classify.ts";
import {
  ClassifyError,
  type ClassifiedAnswer,
  type QuestionSchema,
  type UnitState,
} from "../types.ts";
import { createClassifier } from "./client.ts";

const state: UnitState = {
  path: "src/a.ts",
  content: "export const x = 1;\n",
  id: elementWireId({ start: { line: 1 }, end: { line: 2 } }),
};
const questions: Record<string, QuestionSchema> = {
  is_name_purposeful: {
    type: "noul",
    instructions: "Judge the syntax unit against the criteria.",
    criteria: { true: "the property holds", false: "the property does not hold" },
  },
};

describe("createClassifier", () => {
  test("a missing key fails loud PROVIDER_AUTH at first call, naming JINT_PROVIDER_KEY, not at import", async () => {
    const saved = { ...process.env };
    // the client's own variable must never stand in for the key
    process.env.OPENAI_API_KEY = "stray";
    delete process.env.JINT_PROVIDER_KEY;
    try {
      const classifier = createClassifier(); // construction must not throw
      try {
        await classifier(state, questions);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ClassifyError);
        expect((e as ClassifyError).code).toBe("PROVIDER_AUTH");
        expect((e as ClassifyError).message).toContain("JINT_PROVIDER_KEY");
      }
    } finally {
      process.env = saved;
    }
  });

  test("the classifier asks the Decisions API at the url, with the key", async () => {
    const seen: { url: string; auth: string | null; body: any }[] = [];
    const probe = async (url: string, init?: RequestInit) => {
      seen.push({
        url,
        auth: new Headers(init?.headers).get("Authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(
        JSON.stringify({
          answers: [{ type: "predicate", name: "q0", probability: 0.25 }],
          usage: { input_tokens: 1, output_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const saved = process.env.JINT_PROVIDER_KEY;
    process.env.JINT_PROVIDER_KEY = "env-key";
    try {
      const answers = await createClassifier({
        fetch: probe,
        url: "http://127.0.0.1:1/v1/decisions",
      })(state, { is_readable: { type: "noul", instructions: "Is it?" } });
      expect((answers.is_readable as ClassifiedAnswer).value).toBe(0.25);
      expect(seen[0]!.url).toBe("http://127.0.0.1:1/v1/decisions");
      expect(seen[0]!.auth).toBe("Bearer env-key");
      expect(seen[0]!.body.model).toBe("gpt-6-luna");
      expect(seen[0]!.body.input).toEqual([
        {
          role: "user",
          content: [{ type: "input_json", data: { path: state.path, content: state.content } }],
        },
      ]);
    } finally {
      if (saved === undefined) delete process.env.JINT_PROVIDER_KEY;
      else process.env.JINT_PROVIDER_KEY = saved;
    }
  });
});
