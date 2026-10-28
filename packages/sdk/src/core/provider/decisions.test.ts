import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { ClassifyError, type Ask, type UnitState } from "../types.ts";
import { createClassifier } from "./client.ts";
import { decisionsAdapter, MODEL } from "./decisions.ts";
import type { Endpoint } from "./endpoint.ts";
import type { Fetch } from "./protocol.ts";

const URL_ = "https://api.openai.com/v1/decisions";
const PROVIDER: Endpoint = { url: URL_, apiKey: "k", notes: [] };
const adapterOver = (
  fetch: Fetch,
  provider = PROVIDER,
  log: (l: string) => void = () => {},
  limits?: { timeoutMs: number; maxRetries: number },
) => decisionsAdapter(provider, { fetch, log, limits });

const STATE = { path: "a.ts", content: "x" };
/** A reply that makes the client retry at once instead of after its backoff. */
const QUICK = { "retry-after-ms": "1" };

/** A fake Decisions endpoint: records what it was sent and answers with the given body. */
function fake(reply: unknown, status = 200) {
  const sent: {
    url: string;
    raw: string;
    body: any;
    auth: string | null;
    headers: Record<string, string>;
  }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({
      url,
      raw: String(init?.body),
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("Authorization"),
      headers: Object.fromEntries(new Headers(init?.headers)),
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (status !== 200) Object.assign(headers, QUICK);
    return new Response(JSON.stringify(reply), { status, headers });
  };
  return { sent, fetch };
}

const ask = (questions: Ask["questions"], state: Ask["state"] = STATE): Ask => ({
  state,
  questions,
});

describe("decisions adapter", () => {
  test("a noul goes as a predicate with its criteria in the question", async () => {
    const api = fake({
      model: "gpt-6-luna-2",
      answers: [{ type: "predicate", name: "q0", probability: 0.14 }],
      usage: { input_tokens: 9, output_tokens: 0 },
    });
    const asked = await adapterOver(api.fetch).ask(
      ask({
        "rule in L1-L9": {
          type: "noul",
          instructions: "Is it?",
          criteria: { true: "yes", false: "no" },
        },
      }),
    );
    expect(api.sent[0]!.url).toBe(URL_);
    expect(api.sent[0]!.auth).toBe("Bearer k");
    expect(api.sent[0]!.raw).toBe(
      JSON.stringify({
        model: MODEL,
        input: [{ role: "user", content: [{ type: "input_json", data: STATE }] }],
        questions: [{ type: "predicate", name: "q0", instructions: "Is it?\n\nYes: yes\nNo: no" }],
      }),
    );
    expect(asked).toEqual({
      model: "gpt-6-luna-2",
      answers: { "rule in L1-L9": { value: 0.14 } },
      usage: { input_tokens: 9, output_tokens: 0, cached_input_tokens: 0 },
    });
  });

  test("a choice goes with a fallback option, dropped and renormalized in the reply", async () => {
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
    const asked = await adapterOver(api.fetch).ask(
      ask({ r: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "" } } }),
    );
    expect(api.sent[0]!.raw).toBe(
      JSON.stringify({
        model: "gpt-6-luna",
        input: [{ role: "user", content: [{ type: "input_json", data: STATE }] }],
        questions: [
          {
            type: "choice",
            name: "q0",
            instructions: "Which?",
            choices: [
              { value: "a", description: "A" },
              { value: "b", description: "b" },
              { value: "none_of_these", description: "None of these fits" },
            ],
          },
        ],
      }),
    );
    const r = asked.answers.r as { value: number; choice: string; probabilities: any };
    expect(r.choice).toBe("a");
    expect(r.value).toBeCloseTo(0.75);
    expect(r.probabilities.a).toBeCloseTo(0.75);
    expect(r.probabilities.none_of_these).toBeUndefined();
  });

  test("a score goes over index-labelled levels and reads as the expected level", async () => {
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
    const asked = await adapterOver(api.fetch).ask(
      ask(
        { r: { type: "score", instructions: "How?", criteria: ["low", "mid", "high"] } },
        { path: "a.ts", source: 'const s = "q\\n";\n' },
      ),
    );
    expect(api.sent[0]!.raw).toBe(
      JSON.stringify({
        model: "gpt-6-luna",
        input: [
          {
            role: "user",
            content: [
              { type: "input_json", data: { path: "a.ts", source: 'const s = "q\\n";\n' } },
            ],
          },
        ],
        questions: [
          {
            type: "score",
            name: "q0",
            instructions: "How?",
            levels: [
              { label: "0", description: "low" },
              { label: "1", description: "mid" },
              { label: "2", description: "high" },
            ],
          },
        ],
      }),
    );
    expect(asked.answers.r).toEqual({
      value: 0.75,
      probabilities: { "0": 0.5, "1": 0.25, "2": 0.25 },
    });
  });

  test("a score and a choice carry the provider's confidence as sent; absent stays absent", async () => {
    const api = fake({
      answers: [
        {
          type: "score",
          name: "q0",
          confidence: 0.36,
          probabilities: [
            { value: "0", probability: 0.6 },
            { value: "1", probability: 0.37 },
            { value: "2", probability: 0.03 },
          ],
        },
        {
          type: "choice",
          name: "q1",
          choice: "a",
          confidence: 0.22,
          probabilities: [
            { value: "a", probability: 0.5 },
            { value: "b", probability: 0.5 },
          ],
        },
        { type: "predicate", name: "q2", confidence: 0.9, probability: 0.4 },
        {
          type: "score",
          name: "q3",
          probabilities: [
            { value: "0", probability: 1 },
            { value: "1", probability: 0 },
          ],
        },
      ],
    });
    const asked = await adapterOver(api.fetch).ask(
      ask(
        {
          s: { type: "score", instructions: "How?", criteria: ["low", "mid", "high"] },
          c: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "B" } },
          n: { type: "noul", instructions: "Is it?", criteria: { true: "y", false: "n" } },
          u: { type: "score", instructions: "How?", criteria: ["low", "high"] },
        },
        { path: "a.ts", source: "x" },
      ),
    );
    expect(asked.answers.s).toMatchObject({ confidence: 0.36 });
    expect(asked.answers.c).toMatchObject({ confidence: 0.22 });
    expect(asked.answers.n).toEqual({ value: 0.4 });
    expect(asked.answers.u).not.toHaveProperty("confidence");
  });

  test("a refusal marks only its own question; the others keep their readings", async () => {
    const api = fake({
      answers: [
        { type: "refusal", name: "q0" },
        { type: "predicate", name: "q1", probability: 0.3 },
      ],
      usage: { input_tokens: 9, output_tokens: 0, input_tokens_details: { cached_tokens: 7 } },
    });
    const asked = await adapterOver(api.fetch).ask(
      ask({
        refused: { type: "score", instructions: "How?", criteria: ["low", "high"] },
        kept: { type: "noul", instructions: "Is it?" },
      }),
    );
    expect(asked.answers).toEqual({ refused: { refused: true }, kept: { value: 0.3 } });
    expect(asked.usage.cached_input_tokens).toBe(7);
  });

  test("a missing answer, and a noul outside [0, 1], are invalid responses", async () => {
    const missing = fake({ answers: [] });
    const out = fake({ answers: [{ type: "predicate", name: "q0", probability: 1.5 }] });
    for (const api of [missing, out]) {
      const e = await adapterOver(api.fetch)
        .ask(ask({ r: { type: "noul", instructions: "Is it?" } }))
        .then(
          () => undefined,
          (x: unknown) => x as ClassifyError,
        );
      expect(e?.code).toBe("PROVIDER_RESPONSE_INVALID");
    }
  });

  test("an API error is mapped once the client's retries are spent", async () => {
    const api = fake({ error: { message: "slow down" } }, 429);
    const lines: string[] = [];
    const e = await adapterOver(api.fetch, PROVIDER, (l) => lines.push(l))
      .ask(ask({ r: { type: "noul", instructions: "Is it?" } }))
      .then(
        () => undefined,
        (x: unknown) => x as ClassifyError,
      );
    expect(e?.code).toBe("PROVIDER_UNAVAILABLE");
    expect(api.sent).toHaveLength(3);
    expect(lines.filter((l) => l.startsWith("provider backoff: "))).toHaveLength(2);
  });

  test("a timeout is an unreachable provider", async () => {
    const hang: Fetch = (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
      );
    const e = await adapterOver(hang, PROVIDER, () => {}, { timeoutMs: 20, maxRetries: 0 })
      .ask(ask({}))
      .then(
        () => undefined,
        (x: unknown) => x as ClassifyError,
      );
    expect(e?.code).toBe("PROVIDER_UNAVAILABLE");
    expect(e?.message).toContain("unreachable");
  });

  test("an abort signal stops the call", async () => {
    const hang: Fetch = (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
      );
    const controller = new AbortController();
    const pending = adapterOver(hang).ask(ask({}), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ClassifyError);
  });

  test("a url that does not end in /decisions is a setup error naming the field", () => {
    const odd = { ...PROVIDER, url: "http://x.test/v1/answers" };
    expect(() => adapterOver(fake({}).fetch, odd)).toThrow(/url must end in \/decisions/);
  });
});

/** The OPENAI_* variables the official client would read, set to values that must never be used. */
const HOSTILE: Record<string, string> = {
  OPENAI_API_KEY: "sk-hostile-key",
  OPENAI_ADMIN_KEY: "sk-hostile-admin",
  OPENAI_BASE_URL: "http://127.0.0.1:1/hostile",
  OPENAI_ORG_ID: "org-hostile",
  OPENAI_PROJECT_ID: "proj-hostile",
  OPENAI_WEBHOOK_SECRET: "whsec-hostile",
  OPENAI_LOG: "debug",
  OPENAI_CUSTOM_HEADERS: "X-Hostile: leaked",
};

const unit: UnitState = { path: "src/a.ts", content: "export const x = 1;\n", id: "L1-L2" };
const noul = { is_readable: { type: "noul", instructions: "Is it?" } } as const;

describe("through createClassifier", () => {
  /** Runs `body` with a scratch run dir and returns the text of every recorded file. */
  async function recorded(body: () => Promise<void>): Promise<{ name: string; text: string }[]> {
    const dir = mkdtempSync(`${tmpdir()}/jint-decisions-`);
    const prior = process.env.JINT_RUNS_DIR;
    process.env.JINT_RUNS_DIR = dir;
    try {
      await body();
      const run = `${dir}/${readdirSync(dir)[0]}`;
      return readdirSync(run).map((name) => ({
        name,
        text: readFileSync(`${run}/${name}`, "utf8"),
      }));
    } finally {
      if (prior === undefined) delete process.env.JINT_RUNS_DIR;
      else process.env.JINT_RUNS_DIR = prior;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("hostile OPENAI_* variables change neither the host, the key nor the headers", async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        seen.push({
          url: req.url,
          headers: Object.fromEntries(req.headers),
          body: await req.text(),
        });
        return Response.json({
          model: "gpt-6-luna",
          answers: [{ type: "predicate", name: "q0", probability: 0.4 }],
          usage: {
            input_tokens: 3,
            output_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
          },
        });
      },
    });
    const saved = Object.fromEntries(Object.keys(HOSTILE).map((k) => [k, process.env[k]]));
    Object.assign(process.env, HOSTILE);
    try {
      const files = await recorded(async () => {
        const answers = await createClassifier({
          apiKey: "configured-key",
          url: `http://127.0.0.1:${server.port}/v1/decisions`,
        })(unit, noul);
        expect((answers.is_readable as { value: number }).value).toBe(0.4);
      });
      expect(seen).toHaveLength(1);
      expect(new URL(seen[0]!.url).pathname).toBe("/v1/decisions");
      expect(seen[0]!.headers.authorization).toBe("Bearer configured-key");
      expect(JSON.stringify(seen[0]!.headers)).not.toMatch(/hostile|leaked|org-|proj-/i);
      expect(Object.keys(seen[0]!.headers).filter((h) => /openai|hostile/i.test(h))).toEqual([]);
      // no recorded file holds a key, an Authorization header or a hostile value
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(f.text).not.toMatch(/configured-key|Authorization|Bearer|hostile|leaked/i);
      }
      for (const [k, v] of Object.entries(HOSTILE)) expect(process.env[k]).toBe(v);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await server.stop(true);
    }
  });

  const through = (fetch: Fetch) =>
    createClassifier({ apiKey: "k", fetch })(unit, noul).then(
      () => undefined,
      (e: unknown) => e as ClassifyError,
    );
  const status = (code: number) => async () =>
    new Response(JSON.stringify({ error: { message: "no" } }), {
      status: code,
      headers: { "Content-Type": "application/json", ...QUICK },
    });

  test("401 -> PROVIDER_AUTH, without a retry", async () => {
    let calls = 0;
    const e = await through(async () => (calls++, status(401)()));
    expect(e?.code).toBe("PROVIDER_AUTH");
    expect(calls).toBe(1);
  });

  test("429 and 500 -> PROVIDER_UNAVAILABLE after the client's two retries", async () => {
    for (const code of [429, 500]) {
      let calls = 0;
      const e = await through(async () => (calls++, status(code)()));
      expect(e?.code).toBe("PROVIDER_UNAVAILABLE");
      expect(calls).toBe(3);
    }
  });

  test("400 -> PROVIDER_REQUEST_INVALID", async () => {
    expect((await through(status(400)))?.code).toBe("PROVIDER_REQUEST_INVALID");
  });

  test("a connection failure -> PROVIDER_UNAVAILABLE", async () => {
    const e = await through(async () => {
      throw new TypeError("fetch failed");
    });
    expect(e?.code).toBe("PROVIDER_UNAVAILABLE");
  });

  test("a refusal becomes a refused measurement", async () => {
    const answers = await createClassifier({
      apiKey: "k",
      fetch: async () =>
        Response.json({
          model: "gpt-6-luna",
          answers: [{ type: "refusal", name: "q0" }],
          usage: { input_tokens: 1, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
        }),
    })(unit, noul);
    expect(answers.is_readable).toEqual({ refused: true });
  });

  test("the recording is the real exchange, with the element id from the call and not upstream", async () => {
    const sent: { body: string; headers: Record<string, string> }[] = [];
    const reply = {
      model: "gpt-6-luna",
      answers: [{ type: "predicate", name: "q0", probability: 0.2 }],
      usage: { input_tokens: 4, output_tokens: 0, input_tokens_details: { cached_tokens: 1 } },
    };
    const files = await recorded(async () => {
      await createClassifier({
        apiKey: "k",
        fetch: async (_url, init) => {
          sent.push({
            body: String(init?.body),
            headers: Object.fromEntries(new Headers(init?.headers)),
          });
          return Response.json(reply);
        },
      })(unit, noul);
    });
    const file = JSON.parse(files.find((f) => /^\d+-files-a\.ts\.json$/.test(f.name))!.text);
    expect(Object.keys(file).sort()).toEqual(
      ["durationMs", "id", "questionIds", "request", "response", "status", "ts", "url"].sort(),
    );
    expect(file.id).toBe("L1-L2");
    expect(file.questionIds).toEqual(["is_readable"]);
    expect(file.url).toBe(URL_);
    expect(file.status).toBe(200);
    expect(file.request).toEqual(JSON.parse(sent[0]!.body));
    expect(file.request.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_json", data: { path: unit.path, content: unit.content } }],
      },
    ]);
    expect(file.response).toEqual(reply);
    // the id never travels upstream
    expect(JSON.stringify(sent[0])).not.toContain("L1-L2");
    expect(Object.keys(sent[0]!.headers).some((h) => /jint/i.test(h))).toBe(false);
    const manifest = files.find((f) => f.name === "manifest.json");
    expect(manifest).toBeUndefined(); // written by the CLI, not the classifier
  });
});
