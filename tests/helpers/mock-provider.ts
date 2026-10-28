/**
 * Shared mock of the Decisions API (startMockDecisions). Point the CLI at it via
 * mockDecisionsWire(baseUrl) (tests/helpers/cli.ts) and every classification is answered locally —
 * the suite runs fully keyless.
 *
 * Testing doctrine: mocked tests assert CONTRACT (exit codes, messages, wire shapes) and run
 * everywhere. Live tests assert MODEL BEHAVIOR (calibration) and run opt-in — see tests/README.md.
 */

export interface MockDecisionsRequest {
  /** The full parsed request body: model, input, questions (an array of named questions). */
  body: { model: string; input: unknown; questions: Record<string, unknown>[] };
  /** The state: the input_json part's data. */
  state: Record<string, unknown>;
  /** The questions asked, in order (named q0, q1 ... on the wire; the instructions tell them apart). */
  questions: Record<string, any>[];
}

export interface MockDecisionsOptions {
  /** Probability answered for predicate questions. Default 0.8. */
  predicate?: number;
  /** The level holding the score mass (0.8; its neighbours share the rest). Default 1. */
  level?: number;
  /** Selected value for choice questions. Default: the first value. */
  choice?: string;
  /** The `confidence` answered to a score or choice question, by name (q0, q1 ...). Default: none. */
  confidence?: Readonly<Record<string, number>>;
  /** Names of questions (q0, q1 ...) answered with a refusal. */
  refuse?: readonly string[];
  /** Answered to every request instead of answers: an HTTP status with an error body. */
  status?: number;
  /** Milliseconds each request waits before it is answered. */
  latencyMs?: number;
}

export interface MockDecisions {
  /** The server root; the provider url is `${baseUrl}/v1/decisions`. */
  baseUrl: string;
  stop: () => void;
  requests: MockDecisionsRequest[];
}

/**
 * Mock of the Decisions API (POST /v1/decisions) for the `openai` provider: reads the `questions`
 * array and answers each by name - predicate, score or choice probabilities, or a refusal.
 */
export function startMockDecisions(opts: MockDecisionsOptions = {}): MockDecisions {
  const requests: MockDecisionsRequest[] = [];
  const server = Bun.serve({
    port: 0,
    idleTimeout: 30,
    async fetch(req) {
      const body = (await req.json()) as MockDecisionsRequest["body"];
      const part = (body.input as { content?: { data?: Record<string, unknown> }[] }[])?.[0]
        ?.content?.[0];
      requests.push({ body, state: part?.data ?? {}, questions: body.questions });
      if (opts.latencyMs !== undefined) await Bun.sleep(opts.latencyMs);
      if (opts.status !== undefined) {
        return Response.json({ error: { message: "mock failure" } }, { status: opts.status });
      }
      const withConfidence = (name: string) =>
        opts.confidence?.[name] !== undefined ? { confidence: opts.confidence[name] } : {};
      const answers = body.questions.map((q) => {
        const name = String(q.name);
        if (opts.refuse?.includes(name)) return { type: "refusal", name };
        if (q.type === "score") {
          const levels = (q.levels as { label: string }[]).map((l) => l.label);
          const at = opts.level ?? 1;
          const rest = levels.length > 1 ? 0.2 / (levels.length - 1) : 0;
          return {
            type: "score",
            name,
            ...withConfidence(name),
            probabilities: levels.map((value, i) => ({
              value,
              probability: i === at ? 0.8 : rest,
            })),
          };
        }
        if (q.type === "choice") {
          const values = (q.choices as { value: string }[]).map((c) => c.value);
          const choice = opts.choice ?? values[0]!;
          return {
            type: "choice",
            name,
            choice,
            ...withConfidence(name),
            probabilities: values.map((value) => ({
              value,
              probability: value === choice ? 0.7 : 0.3 / (values.length - 1),
            })),
          };
        }
        return { type: "predicate", name, probability: opts.predicate ?? 0.8 };
      });
      return Response.json({
        model: body.model,
        answers,
        usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } },
      });
    },
  });
  return {
    baseUrl: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
    requests,
  };
}
