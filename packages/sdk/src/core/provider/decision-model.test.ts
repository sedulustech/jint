import { describe, expect, test } from "bun:test";
import { ClassifyError, type ClassifyErrorCode, type QuestionSchema } from "../types.ts";
import { createClassifier } from "./client.ts";
import { decisionModel, decisionModelAdapter } from "./decision-model.ts";
import { protocolFetch, type Fetch } from "./protocol.ts";
import { PROVIDERS } from "./providers.ts";

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

describe("decision-model adapter against the old path", () => {
  /** A gateway that answers each question by its type, deterministically; records the bytes. */
  function gateway() {
    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fetch: Fetch = async (url, init) => {
      const body = String(init?.body);
      const headers = Object.fromEntries(new Headers(init?.headers));
      sent.push({ url, headers, body });
      const asked = JSON.parse(body).questions as Record<
        string,
        { type: string; criteria?: object }
      >;
      const answers = Object.fromEntries(
        Object.entries(asked).map(([wire, q], i) => {
          if (i === 3) return [wire, { type: "refusal" }];
          if (q.type === "boolean") return [wire, { type: "boolean", probability: 0.31 }];
          if (q.type === "score") {
            return [wire, { type: "score", probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 } }];
          }
          return [
            wire,
            { type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.5, none_of_these: 0.3 } },
          ];
        }),
      );
      return new Response(
        JSON.stringify({
          model: "gpt-6-luna",
          answers,
          usage: { inputTokens: 40, outputTokens: 4 },
          providerMetadata: { gateway: { cost: "0.001" } },
        }),
      );
    };
    return { sent, fetch };
  }

  const state = { path: "src/a.ts", content: "export const x = 1;\n", id: "wire-id" };
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

  test("the same request bytes and the same readings as the translated TypeSafe path", async () => {
    const oldGateway = gateway();
    const newGateway = gateway();
    const apiKey = "gw-secret-key";
    const model = "openai/gpt-6-luna-decisions";
    const old = await createClassifier({
      provider: "systemone",
      apiKey,
      model,
      fetch: protocolFetch(decisionModel, SPEC, oldGateway.fetch),
      log: () => {},
    })(state, questions);
    const { id: _id, ...judged } = state;
    const asked = await decisionModelAdapter(
      { name: "vercel", model, apiKey, notes: [], spec: { ...PROVIDERS.vercel!, url: SPEC.url } },
      { fetch: newGateway.fetch, log: () => {} },
    ).ask({ state: judged, questions });

    expect(newGateway.sent).toHaveLength(1);
    expect(newGateway.sent[0]!.url).toBe(oldGateway.sent[0]!.url);
    expect(newGateway.sent[0]!.body).toBe(oldGateway.sent[0]!.body);
    for (const h of [
      "authorization",
      "content-type",
      "ai-gateway-protocol-version",
      "ai-decision-model-specification-version",
      "ai-model-id",
    ]) {
      expect(newGateway.sent[0]!.headers[h]).toBe(oldGateway.sent[0]!.headers[h]);
    }
    expect(asked.answers).toEqual(old);
    expect(asked.answers["refused"]).toEqual({ refused: true });
    expect(asked.answers["kind"]).toMatchObject({ choice: "b" });
  });
});
