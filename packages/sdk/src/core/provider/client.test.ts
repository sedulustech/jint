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
const DIR = "tmp/provider-client-test";
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
      legend: { 0: "obvious", 1: "mostly clear", 2: "reconstructed intent", 3: "dense" },
    },
  },
  usage: { input_tokens: 10, output_tokens: 1 },
};

async function judgeOnce(fetchImpl: FetchLike): Promise<Record<string, ClassifiedAnswer>> {
  const classifier = createClassifier({
    provider: "systemone",
    apiKey: "test-key",
    fetch: fetchImpl,
  });
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
    const classifier = createClassifier({
      provider: "systemone",
      apiKey: "test-key",
      fetch: probe,
    });
    const answers = await classifier(state, scoreQuestions);
    expect(answers.is_readable?.value).toBe(2);
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

  test("choice questions compile to ChoiceQuestion and answers carry the selected option", async () => {
    const choiceQuestions: Record<string, QuestionSchema> = {
      is_comment_justified: {
        type: "choice",
        instructions: "Which option best describes the worst comment?",
        criteria: { justified: "states what the code does", wrong: "contradicted by the code" },
      },
    };
    let captured: RequestInit | null = null;
    const probe: FetchLike = async (_input, init) => {
      captured = init ?? {};
      return new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: {
            is_comment_justified: {
              type: "choice",
              choice: "wrong",
              probabilities: { justified: 0.3, wrong: 0.7 },
            },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const answers = await createClassifier({
      provider: "systemone",
      apiKey: "test-key",
      fetch: probe,
    })(state, choiceQuestions);
    // the value is the selected option's probability; the label carries the verdict
    expect(answers.is_comment_justified).toEqual({
      value: 0.7,
      choice: "wrong",
      probabilities: { justified: 0.3, wrong: 0.7 },
    });
    const body = JSON.parse(String(captured!.body));
    expect(body.questions.is_comment_justified.type).toBe("choice");
    expect(body.questions.is_comment_justified.criteria).toEqual({
      justified: "states what the code does",
      wrong: "contradicted by the code",
    });
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
    // the model judges the code, never jint's id: the id rides in a header the recorder keeps
    expect(body.state).toEqual({ path: "src/a.ts", content: "export const x = 1;\n" });
    expect(new Headers(captured!.init.headers).get("X-Jint-Id")).toBe(
      elementWireId({ start: { line: 1 }, end: { line: 2 } }),
    );
  });

  test("a missing key fails loud PROVIDER_AUTH at first call, naming the provider's keyEnv, not at import", async () => {
    const saved = { ...process.env };
    delete process.env.JINT_OPENAI_API_KEY;
    // the vendor client's own variable must never stand in for the provider's key
    process.env.TYPESAFE_API_KEY = "stray";
    process.env.OPENAI_API_KEY = "stray";
    try {
      for (const [provider, keyEnv] of [
        ["openai", "JINT_OPENAI_API_KEY"],
        ["systemone", "JINT_TYPESAFE_API_KEY"],
      ] as const) {
        delete process.env[keyEnv];
        const classifier = createClassifier({ provider }); // construction must not throw
        try {
          await classifier(state, questions);
          expect.unreachable();
        } catch (e) {
          expectClassifyError("PROVIDER_AUTH")(e);
          expect((e as ClassifyError).message).toContain(keyEnv);
        }
      }
    } finally {
      process.env = saved;
    }
  });

  test("an unknown provider fails at construction as a setup error", () => {
    expect(() => createClassifier({ provider: "nope" })).toThrow(/unknown provider 'nope'/);
  });

  test("the default provider asks the Decisions API at the table's url, with the provider's key", async () => {
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
    const saved = process.env.JINT_OPENAI_API_KEY;
    process.env.JINT_OPENAI_API_KEY = "env-key";
    try {
      const answers = await createClassifier({
        fetch: probe,
        providers: { openai: { url: "http://127.0.0.1:1/v1/decisions" } },
      })(state, { is_readable: { type: "noul", instructions: "Is it?" } });
      expect(answers.is_readable?.value).toBe(0.25);
      expect(seen[0]!.url).toBe("http://127.0.0.1:1/v1/decisions");
      expect(seen[0]!.auth).toBe("Bearer env-key");
      expect(seen[0]!.body.model).toBe("gpt-6-luna");
    } finally {
      if (saved === undefined) delete process.env.JINT_OPENAI_API_KEY;
      else process.env.JINT_OPENAI_API_KEY = saved;
    }
  });

  test("401 -> PROVIDER_AUTH", async () => {
    try {
      await judgeOnce(fakeFetch({ error: "bad key" }, 401));
      expect.unreachable();
    } catch (e) {
      expectClassifyError("PROVIDER_AUTH")(e);
    }
  });

  test("422 -> PROVIDER_REQUEST_INVALID", async () => {
    try {
      await judgeOnce(fakeFetch({ error: "bad question" }, 422));
      expect.unreachable();
    } catch (e) {
      expectClassifyError("PROVIDER_REQUEST_INVALID")(e);
    }
  });

  test("429 and 500 -> PROVIDER_UNAVAILABLE", async () => {
    try {
      await judgeOnce(fakeFetch({ error: "rate limited" }, 429));
      expect.unreachable();
    } catch (e) {
      expectClassifyError("PROVIDER_UNAVAILABLE")(e);
    }
    try {
      await judgeOnce(fakeFetch({ error: "server exploded" }, 500));
      expect.unreachable();
    } catch (e) {
      expectClassifyError("PROVIDER_UNAVAILABLE")(e);
    }
  });

  test("connection failure -> PROVIDER_UNAVAILABLE", async () => {
    const broken: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    try {
      await judgeOnce(broken);
      expect.unreachable();
    } catch (e) {
      expectClassifyError("PROVIDER_UNAVAILABLE")(e);
    }
  });

  test("a choice answer without its distribution -> PROVIDER_RESPONSE_INVALID", async () => {
    const choiceQuestions: Record<string, QuestionSchema> = {
      c: { type: "choice", instructions: "Which?", criteria: { a: "first", b: "second" } },
    };
    const body = {
      model: "jev-latest",
      answers: { c: { type: "choice", choice: "a" } },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    try {
      await createClassifier({ provider: "systemone", apiKey: "test-key", fetch: fakeFetch(body) })(
        state,
        choiceQuestions,
      );
      expect.unreachable();
    } catch (e) {
      expectClassifyError("PROVIDER_RESPONSE_INVALID")(e);
      expect((e as Error).message).toContain('{ type: "choice", choice, probabilities }');
    }
  });

  test("answer failing shape validation -> PROVIDER_RESPONSE_INVALID", async () => {
    const cases: unknown[] = [
      {
        model: "jev-latest",
        answers: { is_name_purposeful: { type: "score", score: 3 } },
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
      {
        // a score with no legend: the level texts the run view shows are missing
        model: "jev-latest",
        answers: {
          is_name_purposeful: { type: "score", score: 1, probabilities: { 0: 1 } },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { model: "jev-latest", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    for (const body of cases) {
      try {
        await judgeOnce(fakeFetch(body));
        expect.unreachable();
      } catch (e) {
        expectClassifyError("PROVIDER_RESPONSE_INVALID")(e);
      }
    }
  });
});
