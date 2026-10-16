import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { rmSync } from "node:fs";
import {
  ClassifyError,
  type ClassifiedAnswer,
  type ClassifyErrorCode,
  type QuestionSchema,
  type UnitState,
} from "../types.ts";
import { createClassifier } from "./client.ts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The recorder is always-on; the suite injects a scratch dir so nothing lands in ~/.jint/runs. */
const DIR = "tmp/jev-client-test";
beforeAll(() => rmSync(DIR, { recursive: true, force: true }));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

import { elementWireId } from "../rules/classify.ts";

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

/** Fake transport: answers the way POST /v1/systemone would. */
function fakeFetch(body: unknown, status = 200): FetchLike {
  return async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const happyBody = {
  model: "jev-latest",
  answers: { is_name_purposeful: { type: "noul", noul: 0.72 } },
  usage: { input_tokens: 10, output_tokens: 1 },
};

const scoreQuestions: Record<string, QuestionSchema> = {
  is_readable: {
    type: "score",
    instructions: "How easy is source to read?",
    criteria: ["obvious", "mostly clear", "reconstructed intent", "dense"],
  },
};

const scoreBody = {
  model: "jev-latest",
  answers: {
    is_readable: {
      type: "score",
      score: 2,
      probabilities: { 0: 0.05, 1: 0.2, 2: 0.7, 3: 0.05 },
      confidence: 0.9,
    },
  },
  usage: { input_tokens: 10, output_tokens: 1 },
};

async function judgeOnce(fetchImpl: FetchLike): Promise<Record<string, ClassifiedAnswer>> {
  const classifier = createClassifier({ apiKey: "test-key", fetch: fetchImpl });
  return await classifier(state, questions);
}

function expectClassifyError(code: ClassifyErrorCode): (e: unknown) => void {
  return (e) => {
    expect(e).toBeInstanceOf(ClassifyError);
    expect((e as ClassifyError).code).toBe(code);
  };
}

describe("createClassifier", () => {
  test("happy path: noul answers keyed by question name", async () => {
    const answers = await judgeOnce(fakeFetch(happyBody));
    expect(answers.is_name_purposeful?.value).toBe(0.72);
  });

  test("score questions compile to ScoreQuestion and answers extract the score", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const probe: FetchLike = async (input, init) => {
      captured = { url: String(input), init: init ?? {} };
      return new Response(JSON.stringify(scoreBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const classifier = createClassifier({ apiKey: "test-key", fetch: probe });
    const answers = await classifier(state, scoreQuestions);
    expect(answers.is_readable?.value).toBe(2);
    expect(answers.is_readable?.confidence).toBe(0.9);
    expect(answers.is_readable?.probabilities).toEqual({ 0: 0.05, 1: 0.2, 2: 0.7, 3: 0.05 });
    const body = JSON.parse(String(captured!.init.body));
    expect(body.questions.is_readable.type).toBe("score");
    expect(body.questions.is_readable.criteria).toEqual([
      "obvious",
      "mostly clear",
      "reconstructed intent",
      "dense",
    ]);
  });

  test("sends questions in SDK noul shape over POST /v1/systemone", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const probe: FetchLike = async (input, init) => {
      captured = { url: String(input), init: init ?? {} };
      return new Response(JSON.stringify(happyBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    await judgeOnce(probe);
    expect(captured!.url).toContain("/v1/systemone");
    const body = JSON.parse(String(captured!.init.body));
    expect(body.questions.is_name_purposeful.type).toBe("noul");
    expect(body.questions.is_name_purposeful.instructions).toBe(
      "Judge the syntax unit against the criteria.",
    );
    expect(body.questions.is_name_purposeful.criteria).toEqual({
      true: "the property holds",
      false: "the property does not hold",
    });
    expect(body.state).toEqual({
      path: "src/a.ts",
      content: "export const x = 1;\n",
      id: elementWireId({ start: { line: 1 }, end: { line: 2 } }),
    });
  });

  test("missing TYPESAFE_API_KEY fails loud JEV_AUTH at first call, not at import", async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const classifier = createClassifier(); // construction must not throw
      try {
        await classifier(state, questions);
        expect.unreachable();
      } catch (e) {
        expectClassifyError("JEV_AUTH")(e);
        expect((e as ClassifyError).message).toContain("TYPESAFE_API_KEY");
      }
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  test("401 -> JEV_AUTH", async () => {
    try {
      await judgeOnce(fakeFetch({ error: "bad key" }, 401));
      expect.unreachable();
    } catch (e) {
      expectClassifyError("JEV_AUTH")(e);
    }
  });

  test("422 -> JEV_REQUEST_INVALID", async () => {
    try {
      await judgeOnce(fakeFetch({ error: "bad question" }, 422));
      expect.unreachable();
    } catch (e) {
      expectClassifyError("JEV_REQUEST_INVALID")(e);
    }
  });

  test("429 and 500 -> JEV_UNAVAILABLE", async () => {
    try {
      await judgeOnce(fakeFetch({ error: "rate limited" }, 429));
      expect.unreachable();
    } catch (e) {
      expectClassifyError("JEV_UNAVAILABLE")(e);
    }
    try {
      await judgeOnce(fakeFetch({ error: "server exploded" }, 500));
      expect.unreachable();
    } catch (e) {
      expectClassifyError("JEV_UNAVAILABLE")(e);
    }
  });

  test("connection failure -> JEV_UNAVAILABLE", async () => {
    const broken: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    try {
      await judgeOnce(broken);
      expect.unreachable();
    } catch (e) {
      expectClassifyError("JEV_UNAVAILABLE")(e);
    }
  });

  test("answer failing shape validation -> JEV_RESPONSE_INVALID", async () => {
    const cases: unknown[] = [
      {
        model: "jev-latest",
        answers: { is_name_purposeful: { type: "score", score: 3 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      {
        model: "jev-latest",
        answers: {
          is_name_purposeful: { type: "score", score: 1, confidence: 0.9 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      {
        model: "jev-latest",
        answers: {
          is_name_purposeful: { type: "score", score: 1, probabilities: { 0: 0.5, 1: 0.5 } },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      {
        model: "jev-latest",
        answers: { is_name_purposeful: { type: "noul", noul: 1.5 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { model: "jev-latest", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    for (const body of cases) {
      try {
        await judgeOnce(fakeFetch(body));
        expect.unreachable();
      } catch (e) {
        expectClassifyError("JEV_RESPONSE_INVALID")(e);
      }
    }
  });
});
