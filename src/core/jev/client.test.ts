import { describe, test, expect } from "bun:test";
import {
  RequestError,
  type RequestErrorCode,
  type QuestionSpec,
  type UnitState,
} from "../types.ts";
import { createJudge } from "./client.ts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

import { blockWireId } from "../sensors/measure.ts";

const state: UnitState = {
  path: "src/a.ts",
  content: "export const x = 1;\n",
  id: blockWireId("export const x = 1;\n"),
};
const questions: Record<string, QuestionSpec> = {
  is_name_purposeful: {
    type: "noul",
    instructions: { a1b2c3d4: "Judge the syntax unit mapped to this id against the criteria." },
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

async function judgeOnce(fetchImpl: FetchLike): Promise<Record<string, number>> {
  const judge = createJudge({ apiKey: "test-key", fetch: fetchImpl });
  return await judge(state, questions);
}

function expectRequestError(code: RequestErrorCode): (e: unknown) => void {
  return (e) => {
    expect(e).toBeInstanceOf(RequestError);
    expect((e as RequestError).code).toBe(code);
  };
}

describe("createJudge", () => {
  test("happy path: noul answers keyed by question name", async () => {
    const answers = await judgeOnce(fakeFetch(happyBody));
    expect(answers.is_name_purposeful).toBe(0.72);
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
    expect(body.questions.is_name_purposeful.instructions).toEqual({
      a1b2c3d4: "Judge the syntax unit mapped to this id against the criteria.",
    });
    expect(body.questions.is_name_purposeful.criteria).toEqual({
      true: "the property holds",
      false: "the property does not hold",
    });
    expect(body.state).toEqual({
      path: "src/a.ts",
      content: "export const x = 1;\n",
      id: blockWireId("export const x = 1;\n"),
    });
  });

  test("missing TYPESAFE_API_KEY fails loud JEV_AUTH at first call, not at import", async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const judge = createJudge(); // construction must not throw
      try {
        await judge(state, questions);
        expect.unreachable();
      } catch (e) {
        expectRequestError("JEV_AUTH")(e);
        expect((e as RequestError).message).toContain("TYPESAFE_API_KEY");
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
      expectRequestError("JEV_AUTH")(e);
    }
  });

  test("422 -> JEV_REQUEST_INVALID", async () => {
    try {
      await judgeOnce(fakeFetch({ error: "bad question" }, 422));
      expect.unreachable();
    } catch (e) {
      expectRequestError("JEV_REQUEST_INVALID")(e);
    }
  });

  test("429 and 500 -> JEV_UNAVAILABLE", async () => {
    try {
      await judgeOnce(fakeFetch({ error: "rate limited" }, 429));
      expect.unreachable();
    } catch (e) {
      expectRequestError("JEV_UNAVAILABLE")(e);
    }
    try {
      await judgeOnce(fakeFetch({ error: "server exploded" }, 500));
      expect.unreachable();
    } catch (e) {
      expectRequestError("JEV_UNAVAILABLE")(e);
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
      expectRequestError("JEV_UNAVAILABLE")(e);
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
        expectRequestError("JEV_RESPONSE_INVALID")(e);
      }
    }
  });
});
