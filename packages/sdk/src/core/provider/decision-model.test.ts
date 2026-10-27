import { describe, expect, test } from "bun:test";
import { ClassifyError, type ClassifyErrorCode, type QuestionSchema } from "../types.ts";
import { decisionModelAdapter } from "./decision-model.ts";
import { PROVIDERS } from "./providers.ts";
import type { Fetch } from "./protocol.ts";

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

describe("decision-model adapter", () => {
  const PROVIDER = {
    name: "vercel",
    model: "openai/gpt-6-luna-decisions",
    apiKey: "gw-secret-key",
    notes: [],
    spec: {
      protocol: "decision-model" as const,
      url: SPEC.url,
      keyEnv: "JINT_AI_GATEWAY_API_KEY",
      model: "openai/gpt-6-luna-decisions",
    },
  };
  const state = { path: "a.ts", content: "export const x = 1;\n" };
  const questions: Record<string, QuestionSchema> = {
    n: { type: "noul", instructions: "Is it?", criteria: { true: "yes", false: "no" } },
    s: { type: "score", instructions: "How?", criteria: ["low", "mid", "high"] },
    c: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "B" } },
  };
  const reply = {
    model: "gpt-6-luna",
    answers: {
      q0: { type: "boolean", probability: 0.14 },
      q1: { type: "score", probabilities: { "0": 0.5, "1": 0.25, "2": 0.25 } },
      q2: { type: "choice", choice: "a", probabilities: { a: 0.6, b: 0.2, none_of_these: 0.2 } },
    },
    usage: { inputTokens: 12, outputTokens: 3 },
    providerMetadata: { gateway: { cost: "0.0042" } },
  };
  const quick = { timeoutMs: 200, maxRetries: 2 };
  const adapterOver = (fetch: Fetch, limits = quick, log: (l: string) => void = () => {}) =>
    decisionModelAdapter(PROVIDER, { fetch, log, limits });
  const seq = (...steps: (Response | Error)[]): { fetch: Fetch; calls: () => number } => {
    const bodies = steps.map((s) => (s instanceof Error ? undefined : s.clone()));
    let i = 0;
    return {
      calls: () => i,
      fetch: async () => {
        const step = steps[Math.min(i++, steps.length - 1)]!;
        if (step instanceof Error) throw step;
        const kept = bodies[Math.min(i - 1, bodies.length - 1)]!;
        return new Response(await kept.clone().text(), {
          status: kept.status,
          headers: kept.headers,
        });
      },
    };
  };
  const failure = async (p: Promise<unknown>) =>
    (await p.then(
      () => null,
      (e) => e,
    )) as ClassifyError;
  const status = (code: number, headers?: Record<string, string>) =>
    new Response(JSON.stringify({ error: { message: "nope" } }), { status: code, headers });

  test("sends the key and the version headers; answers carry no confidence", async () => {
    const api = fake(reply);
    const asked = await adapterOver(api.fetch).ask({ state, questions });
    expect(api.sent[0]!.headers).toMatchObject({
      authorization: "Bearer gw-secret-key",
      "content-type": "application/json",
      "ai-model-id": "openai/gpt-6-luna-decisions",
    });
    expect(asked.answers.n).toEqual({ value: 0.14 });
    expect(asked.answers.s).toMatchObject({ value: 0.75 });
    expect(asked.answers.c).toMatchObject({ choice: "a" });
    for (const a of Object.values(asked.answers)) expect(a).not.toHaveProperty("confidence");
    expect(asked.usage).toEqual({
      input_tokens: 12,
      output_tokens: 3,
      cached_input_tokens: 0,
      gateway_cost: 0.0042,
    });
    expect(asked.model).toBe("gpt-6-luna");
  });

  test("usage falls back to the model provider's count; no reported cost means no cost field", async () => {
    const api = fake({
      answers: { q0: { type: "boolean", probability: 0.3 } },
      providerMetadata: { openai: { usage: { input_tokens: 99 } } },
    });
    const asked = await adapterOver(api.fetch).ask({ state, questions: { n: questions.n! } });
    expect(asked.usage).toEqual({ input_tokens: 99, output_tokens: 0, cached_input_tokens: 0 });
  });

  test("a refusal keeps its place; a missing answer is PROVIDER_RESPONSE_INVALID", async () => {
    const refused = await adapterOver(fake({ answers: { q0: { type: "refusal" } } }).fetch).ask({
      state,
      questions: { n: questions.n! },
    });
    expect(refused.answers.n).toEqual({ refused: true });
    const e = await failure(adapterOver(fake({ answers: {} }).fetch).ask({ state, questions }));
    expect(e.code).toBe("PROVIDER_RESPONSE_INVALID");
  });

  test.each<[number, ClassifyErrorCode]>([
    [401, "PROVIDER_AUTH"],
    [403, "PROVIDER_AUTH"],
    [400, "PROVIDER_REQUEST_INVALID"],
    [422, "PROVIDER_REQUEST_INVALID"],
  ])("%d is %s and is not retried", async (code, expected) => {
    const api = seq(status(code));
    const e = await failure(adapterOver(api.fetch).ask({ state, questions }));
    expect(e.code).toBe(expected);
    expect(e.message).toContain("nope");
    expect(api.calls()).toBe(1);
  });

  test("429, 5xx and network failures retry twice, log the backoff, then are UNAVAILABLE", async () => {
    for (const step of [status(429, { "retry-after": "0" }), status(503, { "retry-after": "0" })]) {
      const api = seq(step);
      const lines: string[] = [];
      const e = await failure(
        adapterOver(api.fetch, quick, (l) => lines.push(l)).ask({ state, questions }),
      );
      expect(e.code).toBe("PROVIDER_UNAVAILABLE");
      expect(api.calls()).toBe(3);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toStartWith("provider backoff: ");
    }
    const down = seq(new TypeError("connection refused"));
    const e = await failure(
      adapterOver(down.fetch, { timeoutMs: 200, maxRetries: 1 }).ask({ state, questions }),
    );
    expect(e.code).toBe("PROVIDER_UNAVAILABLE");
    expect(down.calls()).toBe(2);
  });

  test("a retry that succeeds returns the answers", async () => {
    const api = seq(status(500, { "retry-after": "0" }), new Response(JSON.stringify(reply)));
    const asked = await adapterOver(api.fetch).ask({ state, questions });
    expect(asked.answers.n).toEqual({ value: 0.14 });
    expect(api.calls()).toBe(2);
  });

  test("an attempt that outlives the timeout is PROVIDER_TIMEOUT after its retries", async () => {
    let calls = 0;
    const hang: Fetch = (_url, init) => {
      calls++;
      return new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    };
    const e = await failure(
      adapterOver(hang, { timeoutMs: 15, maxRetries: 1 }, () => {}).ask({ state, questions }),
    );
    expect(e.code).toBe("PROVIDER_TIMEOUT");
    expect(calls).toBe(2);
  });

  test("the caller's signal abandons the call without a retry", async () => {
    const controller = new AbortController();
    let calls = 0;
    const hang: Fetch = (_url, init) => {
      calls++;
      return new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    };
    const pending = failure(
      adapterOver(hang).ask({ state, questions }, { signal: controller.signal }),
    );
    controller.abort();
    expect(await pending).toBeInstanceOf(Error);
    expect(calls).toBe(1);
  });

  test("a missing key is a setup error naming the key variable", () => {
    expect(() =>
      decisionModelAdapter(
        { ...PROVIDER, apiKey: undefined },
        { fetch: fake({}).fetch, log: () => {} },
      ),
    ).toThrow("JINT_AI_GATEWAY_API_KEY");
  });
});

describe("decision-model adapter keeps what the TypeSafe-translated path sent and read", () => {
  // Captured from that path (the translating fetch under the vendor client) on the same asks.
  const BODY =
    '{"stateParts":[{"type":"text","text":"{\\"path\\":\\"src/a.ts\\",\\"content\\":\\"export const x = 1;\\\\n\\"}"}],"questions":{"q0":{"type":"boolean","instructions":"Is it ok?\\n\\nYes: ok\\nNo: not ok"},"q1":{"type":"score","instructions":"How readable?","criteria":["bad","fair","good"]},"q2":{"type":"choice","instructions":"What kind?","criteria":{"a":"A","b":"B","none_of_these":"None of these fits"}},"q3":{"type":"score","instructions":"Unscorable?","criteria":["x","y"]}}}';

  const questions: Record<string, QuestionSchema> = {
    "is_ok in L1-L2": {
      type: "noul",
      instructions: "Is it ok?",
      criteria: { true: "ok", false: "not ok" },
    },
    readable: { type: "score", instructions: "How readable?", criteria: ["bad", "fair", "good"] },
    kind: { type: "choice", instructions: "What kind?", criteria: { a: "A", b: "B" } },
    refused: { type: "score", instructions: "Unscorable?", criteria: ["x", "y"] },
  };

  test("the request bytes and the readings for a predicate, a score, a choice and a refusal", async () => {
    const api = fake({
      model: "gpt-6-luna",
      answers: {
        q0: { type: "boolean", probability: 0.31 },
        q1: { type: "score", probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 } },
        q2: { type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.5, none_of_these: 0.3 } },
        q3: { type: "refusal" },
      },
    });
    const model = "openai/gpt-6-luna-decisions";
    const asked = await decisionModelAdapter(
      {
        name: "vercel",
        model,
        apiKey: "k",
        notes: [],
        spec: { ...PROVIDERS.vercel!, url: SPEC.url },
      },
      { fetch: api.fetch, log: () => {} },
    ).ask({ state: { path: "src/a.ts", content: "export const x = 1;\n" }, questions });

    expect(JSON.stringify(api.sent[0]!.body)).toBe(BODY);
    expect(api.sent[0]!.url).toBe(SPEC.url);
    expect(api.sent[0]!.headers).toMatchObject({
      "ai-gateway-protocol-version": "0.0.1",
      "ai-decision-model-specification-version": "4",
      "ai-model-id": model,
    });
    expect(asked.answers).toEqual({
      "is_ok in L1-L2": { value: 0.31 },
      readable: { value: 1.5999999999999999, probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 } },
      kind: {
        value: 0.7142857142857143,
        choice: "b",
        probabilities: { a: 0.28571428571428575, b: 0.7142857142857143 },
      },
      refused: { refused: true },
    });
  });
});
