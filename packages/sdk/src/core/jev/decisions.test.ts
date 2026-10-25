import { describe, expect, test } from "bun:test";
import { decisionsFetch } from "./decisions.ts";

/** A fake Decisions endpoint: records what it was sent and answers with the given body. */
function fake(reply: unknown, status = 200) {
  const sent: { url: string; body: any; auth: string | null }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("Authorization"),
    });
    return new Response(JSON.stringify(reply), { status });
  };
  return { sent, fetch };
}

const ask = (f: ReturnType<typeof decisionsFetch>, questions: unknown) =>
  f("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: "Bearer k" },
    body: JSON.stringify({ model: "gpt-6-luna", state: { path: "a.ts", content: "x" }, questions }),
  });

describe("decisionsFetch", () => {
  test("a noul goes as a true/false choice and comes back as P(true)", async () => {
    const api = fake({
      answers: [
        {
          type: "choice",
          name: "q0",
          choice: "false",
          probabilities: [
            { value: "true", probability: 0.14 },
            { value: "false", probability: 0.86 },
          ],
        },
      ],
      usage: { input_tokens: 9, output_tokens: 0 },
    });
    const res = await ask(decisionsFetch(api.fetch), {
      "rule in L1-L9": {
        type: "noul",
        instructions: "Is it?",
        criteria: { true: "yes", false: "no" },
      },
    });
    expect(api.sent[0]!.url).toBe("https://api.openai.com/v1/decisions");
    expect(api.sent[0]!.auth).toBe("Bearer k");
    expect(api.sent[0]!.body.input).toBe('{"path":"a.ts","content":"x"}');
    expect(api.sent[0]!.body.questions[0].choices.map((c: any) => c.value)).toEqual([
      "true",
      "false",
    ]);
    expect(await res.json()).toEqual({
      model: "gpt-6-luna",
      answers: { "rule in L1-L9": { type: "noul", noul: 0.14 } },
      usage: { input_tokens: 9, output_tokens: 0, cached_input_tokens: 0 },
    });
  });

  test("a choice drops the fallback option and renormalizes", async () => {
    const api = fake({
      answers: [
        {
          type: "choice",
          name: "q0",
          choice: "a",
          probabilities: [
            { value: "a", probability: 0.6 },
            { value: "b", probability: 0.2 },
            { value: "none_of_these", probability: 0.2 },
          ],
        },
      ],
    });
    const res: any = await (
      await ask(decisionsFetch(api.fetch), {
        r: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "B" } },
      })
    ).json();
    expect(api.sent[0]!.body.questions[0].choices.at(-1).value).toBe("none_of_these");
    expect(res.answers.r.choice).toBe("a");
    expect(res.answers.r.probabilities.a).toBeCloseTo(0.75);
    expect(res.answers.r.confidence).toBeCloseTo(0.75);
  });

  test("a score is the expected level over index-labelled levels", async () => {
    const api = fake({
      answers: [
        {
          type: "score",
          name: "q0",
          probabilities: [
            { value: "0", probability: 0.5 },
            { value: "1", probability: 0.25 },
            { value: "2", probability: 0.25 },
          ],
        },
      ],
    });
    const res: any = await (
      await ask(decisionsFetch(api.fetch), {
        r: { type: "score", instructions: "How?", criteria: ["low", "mid", "high"] },
      })
    ).json();
    expect(api.sent[0]!.body.questions[0].levels).toEqual([
      { label: "0", description: "low" },
      { label: "1", description: "mid" },
      { label: "2", description: "high" },
    ]);
    expect(res.answers.r).toEqual({
      type: "score",
      score: 0.75,
      probabilities: { "0": 0.5, "1": 0.25, "2": 0.25 },
      confidence: 0.5,
    });
  });

  test("a refusal marks only its own question; the others keep their readings", async () => {
    const api = fake({
      answers: [
        { type: "refusal", name: "q0" },
        { type: "predicate", name: "q1", probability: 0.3 },
      ],
      usage: { input_tokens: 9, output_tokens: 0, input_tokens_details: { cached_tokens: 7 } },
    });
    const res = await ask(decisionsFetch(api.fetch), {
      refused: { type: "score", instructions: "How?", criteria: ["low", "high"] },
      kept: { type: "noul", instructions: "Is it?" },
    });
    const body: any = await res.json();
    expect(res.status).toBe(200);
    expect(body.answers).toEqual({
      refused: { type: "refusal" },
      kept: { type: "noul", noul: 0.3 },
    });
    expect(body.usage.cached_input_tokens).toBe(7);
  });

  test("an API error passes through with its status", async () => {
    const api = fake({ error: { message: "slow down" } }, 429);
    expect(
      (await ask(decisionsFetch(api.fetch), { r: { type: "noul", instructions: "Is it?" } }))
        .status,
    ).toBe(429);
  });
});
