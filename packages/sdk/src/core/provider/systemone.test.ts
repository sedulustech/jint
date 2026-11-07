import { describe, expect, test } from "bun:test";
import { ClassifyError, type Ask } from "../types.ts";
import { systemOneAdapter } from "./systemone.ts";
import type { Endpoint } from "./endpoint.ts";
import type { Fetch } from "./protocol.ts";

const LOCAL: Endpoint = {
  url: "http://localhost:13305/v1/systemone",
  protocol: "systemone",
  model: "d3-lite-FLM",
  apiKey: undefined,
  keyless: true,
  notes: [],
};
const STATE = { path: "a.ts", content: "x", includePath: true };

const ask = (questions: Ask["questions"], state: Ask["state"] = STATE): Ask => ({
  state,
  questions,
});

/** A fake System One server: records what it was sent and answers with the given body. */
function fake(reply: unknown, status = 200) {
  const sent: { url: string; body: any; auth: string | null; encoding: string | null }[] = [];
  const fetch: Fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    sent.push({
      url,
      body: JSON.parse(String(init?.body)),
      auth: headers.get("Authorization"),
      encoding: headers.get("Content-Encoding"),
    });
    const extra: Record<string, string> = status === 200 ? {} : { "retry-after-ms": "1" };
    return new Response(JSON.stringify(reply), {
      status,
      headers: { "Content-Type": "application/json", ...extra },
    });
  };
  return { sent, fetch };
}
const over = (fetch: Fetch, endpoint = LOCAL) =>
  systemOneAdapter(endpoint, {
    fetch,
    log: () => {},
    limits: { timeoutMs: 5_000, maxRetries: 1 },
  });

const QUESTIONS: Ask["questions"] = {
  angry: { type: "noul", instructions: "Is it angry?", criteria: { true: "yes", false: "no" } },
  urgency: { type: "score", instructions: "How urgent?", criteria: ["later", "now"] },
  route: { type: "choice", instructions: "Who?", criteria: { billing: "pay", shipping: "box" } },
};
const REPLY = {
  model: "d3-lite-FLM",
  answers: {
    angry: { type: "noul", noul: 0.878, truncated: false },
    urgency: {
      type: "score",
      score: 0.387,
      probabilities: { "0": 0.7, "1": 0.3 },
      confidence: 0.43,
      legend: { "0": "later", "1": "now" },
      truncated: false,
    },
    route: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.96, shipping: 0.04 },
      confidence: 0.83,
      truncated: false,
    },
  },
  usage: { input_tokens: 326, output_tokens: 0 },
};

describe("system one adapter", () => {
  test("asks /v1/systemone with the questions as the rule wrote them, and reads each answer", async () => {
    const api = fake(REPLY);
    const asked = await over(api.fetch).ask(ask(QUESTIONS));
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]!.url).toBe("http://localhost:13305/v1/systemone");
    expect(api.sent[0]!.body.model).toBe("d3-lite-FLM");
    // the state is the object, the flag stays behind, and the questions keep their names
    expect(api.sent[0]!.body.state).toEqual({ path: "a.ts", content: "x" });
    expect(api.sent[0]!.body.questions.route).toMatchObject({
      type: "choice",
      criteria: { billing: "pay", shipping: "box" },
    });
    expect(api.sent[0]!.body.questions.urgency.criteria).toEqual(["later", "now"]);
    expect(asked.model).toBe("d3-lite-FLM");
    expect(asked.usage).toEqual({ input_tokens: 326, output_tokens: 0, cached_input_tokens: 0 });
    expect(asked.answers.angry).toEqual({ value: 0.878 });
    expect(asked.answers.urgency).toEqual({
      value: 0.387,
      probabilities: { "0": 0.7, "1": 0.3 },
      confidence: 0.43,
    });
    expect(asked.answers.route).toEqual({
      value: 0.96,
      choice: "billing",
      probabilities: { billing: 0.96, shipping: 0.04 },
      confidence: 0.83,
    });
  });

  test("a server with no key gets the placeholder, a keyed one its key", async () => {
    const keyless = fake(REPLY);
    await over(keyless.fetch).ask(ask(QUESTIONS));
    expect(keyless.sent[0]!.auth).toBe("Bearer lemonade");
    expect(keyless.sent[0]!.encoding).toBeNull();
    const keyed = fake(REPLY);
    await over(keyed.fetch, { ...LOCAL, apiKey: "secret", keyless: undefined }).ask(ask(QUESTIONS));
    expect(keyed.sent[0]!.auth).toBe("Bearer secret");
    expect(keyed.sent[0]!.encoding).toBeNull();
  });

  test("a refusal, and an answer cut before it was read, are refusals", async () => {
    const api = fake({
      ...REPLY,
      answers: {
        ...REPLY.answers,
        angry: { type: "refusal" },
        route: { ...REPLY.answers.route, truncated: true },
      },
    });
    const asked = await over(api.fetch).ask(ask(QUESTIONS));
    expect(asked.answers.angry).toEqual({ refused: true });
    expect(asked.answers.route).toEqual({ refused: true });
    expect(asked.answers.urgency).toMatchObject({ value: 0.387 });
  });

  test("a wrong-shaped answer is a response-invalid error naming the question", async () => {
    const api = fake({ ...REPLY, answers: { ...REPLY.answers, angry: { type: "noul", noul: 7 } } });
    const failure = await over(api.fetch)
      .ask(ask(QUESTIONS))
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ClassifyError);
    expect(failure.code).toBe("PROVIDER_RESPONSE_INVALID");
    expect(failure.message).toContain("'angry'");
  });

  test("statuses map onto the failure taxonomy", async () => {
    const code = async (status: number) =>
      (
        await over(fake({ error: "x" }, status).fetch)
          .ask(ask(QUESTIONS))
          .catch((e) => e)
      ).code;
    expect(await code(401)).toBe("PROVIDER_AUTH");
    expect(await code(400)).toBe("PROVIDER_REQUEST_INVALID");
    expect(await code(503)).toBe("PROVIDER_UNAVAILABLE");
  });

  test("a url without /v1/systemone, or a server with several models and no model, fails at setup", () => {
    const noop = fake(REPLY).fetch;
    expect(() => over(noop, { ...LOCAL, url: "http://localhost:13305/systemone" })).toThrow(
      "/v1/systemone",
    );
    expect(() => over(noop, { ...LOCAL, model: undefined })).toThrow("JINT_API_MODEL");
  });

  test("TYPESAFE_* variables in the environment never steer the request", async () => {
    process.env.TYPESAFE_API_KEY = "leak";
    process.env.TYPESAFE_BASE_URL = "https://elsewhere.test";
    try {
      const api = fake(REPLY);
      await over(api.fetch).ask(ask(QUESTIONS));
      expect(api.sent[0]!.url).toBe("http://localhost:13305/v1/systemone");
      expect(api.sent[0]!.auth).toBe("Bearer lemonade");
    } finally {
      delete process.env.TYPESAFE_API_KEY;
      delete process.env.TYPESAFE_BASE_URL;
    }
  });
});
