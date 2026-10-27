import { describe, expect, test } from "bun:test";
import { decisionModel } from "./decision-model.ts";
import { protocolFetch } from "./protocol.ts";

const SPEC = { url: "https://ai-gateway.vercel.sh/v4/ai/decision-model" };

/** A fake decision-model endpoint: records what it was sent and answers with the given body. */
function fake(reply: unknown, status = 200) {
  const sent: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      body: JSON.parse(String(init?.body)),
      headers: Object.fromEntries(new Headers(init?.headers)),
    });
    return new Response(JSON.stringify(reply), { status });
  };
  return { sent, fetch };
}

const ask = (api: ReturnType<typeof fake>, questions: unknown) =>
  protocolFetch(
    decisionModel,
    SPEC,
    api.fetch,
  )("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: "Bearer k" },
    body: JSON.stringify({
      model: "openai/gpt-6-luna-decisions",
      state: { path: "a.ts", content: "x" },
      questions,
    }),
  });

describe("decision-model protocol", () => {
  test("the request carries the version headers, the model id and V4 questions", async () => {
    const api = fake({ answers: {} });
    await ask(api, {
      "rule in L1-L9": {
        type: "noul",
        instructions: "Is it?",
        criteria: { true: "yes", false: "no" },
      },
      sized: { type: "score", instructions: "How?", criteria: ["low", "high"] },
      pick: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "" } },
    });
    const [call] = api.sent;
    expect(call!.url).toBe(SPEC.url);
    expect(call!.headers).toMatchObject({
      authorization: "Bearer k",
      "ai-gateway-protocol-version": "0.0.1",
      "ai-decision-model-specification-version": "4",
      "ai-model-id": "openai/gpt-6-luna-decisions",
    });
    expect(call!.body).toEqual({
      stateParts: [{ type: "text", text: '{"path":"a.ts","content":"x"}' }],
      questions: {
        q0: { type: "boolean", instructions: "Is it?\n\nYes: yes\nNo: no" },
        q1: { type: "score", instructions: "How?", criteria: ["low", "high"] },
        q2: {
          type: "choice",
          instructions: "Which?",
          criteria: { a: "A", b: "b", none_of_these: "None of these fits" },
        },
      },
    });
  });

  test("answers read from probability maps; usage and the gateway cost ride along", async () => {
    const api = fake({
      model: "gpt-6-luna",
      answers: {
        q0: { type: "boolean", probability: 0.14 },
        q1: { type: "score", probabilities: { "0": 0.5, "1": 0.25, "2": 0.25 } },
        q2: { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.2, none_of_these: 0.2 } },
      },
      usage: { inputTokens: 12, outputTokens: 3 },
      providerMetadata: {
        openai: { usage: { input_tokens: 99, input_tokens_details: { cached_tokens: 5 } } },
        gateway: { cost: "0.0042" },
      },
    });
    const body: any = await (
      await ask(api, {
        n: { type: "noul", instructions: "Is it?" },
        s: { type: "score", instructions: "How?", criteria: ["low", "mid", "high"] },
        c: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "B" } },
      })
    ).json();
    expect(body.answers.n).toEqual({ type: "noul", noul: 0.14 });
    expect(body.answers.s.score).toBeCloseTo(0.75);
    expect(body.answers.s.legend).toEqual({ "0": "low", "1": "mid", "2": "high" });
    expect(body.answers.c.choice).toBe("a");
    expect(body.answers.c.probabilities.a).toBeCloseTo(0.75);
    expect(body.usage).toEqual({
      input_tokens: 12,
      output_tokens: 3,
      cached_input_tokens: 5,
      gateway_cost: 0.0042,
    });
  });

  test("usage falls back to the provider's own count; no cost reported means no cost field", async () => {
    const api = fake({
      answers: { q0: { type: "boolean", probability: 0.3 } },
      providerMetadata: { openai: { usage: { input_tokens: 99 } } },
    });
    const body: any = await (
      await ask(api, { r: { type: "noul", instructions: "Is it?" } })
    ).json();
    expect(body.usage).toEqual({ input_tokens: 99, output_tokens: 0, cached_input_tokens: 0 });
  });

  test("a refusal marks only its own question", async () => {
    const api = fake({
      answers: { q0: { type: "refusal" }, q1: { type: "boolean", probability: 0.3 } },
    });
    const body: any = await (
      await ask(api, {
        refused: { type: "score", instructions: "How?", criteria: ["low", "high"] },
        kept: { type: "noul", instructions: "Is it?" },
      })
    ).json();
    expect(body.answers).toEqual({
      refused: { type: "refusal" },
      kept: { type: "noul", noul: 0.3 },
    });
  });

  test("an API error passes through with its status", async () => {
    const api = fake({ error: { message: "slow down" } }, 429);
    expect((await ask(api, { r: { type: "noul", instructions: "Is it?" } })).status).toBe(429);
  });
});
