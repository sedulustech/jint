/**
 * Shared mock of the provider vendor wire (POST /v1/systemone). Point the CLI at baseUrl via
 * mockWire(baseUrl) (tests/helpers/cli.ts) and every classification is answered locally — the suite
 * runs fully keyless.
 *
 * Testing doctrine: mocked tests assert CONTRACT (exit codes, messages, wire shapes) and run
 * everywhere. Live tests assert MODEL BEHAVIOR (calibration) and run opt-in — see tests/README.md.
 *
 * The wire shape mirrors src/core/provider/client.ts: the request carries { state, questions }
 * where each question is a compiled { instructions, criteria } spec, and the response carries an
 * answer per question of shape { type: "noul", noul: 0..1 }, { type: "score", score: number }, or {
 * type: "choice", choice: label }.
 */

export interface MockProviderRequest {
  /** The full parsed request body (state, questions) — assert the wire, not our pre-SDK objects. */
  body: Record<string, unknown>;
  state: Record<string, unknown>;
  questions: Record<string, Record<string, unknown>>;
}

export interface MockProviderOptions {
  /** Default answer for noul-type questions. Default 0.8. */
  noul?: number;
  /** Default answer for score-type questions. Default 1. */
  score?: number;
  /** Selected option for choice-type questions. Default: the question's first option label. */
  choice?: string;
  /**
   * Per-question override: return a probability, or null to fall back to the defaults. Called with
   * the question name, the compiled question, and the whole request — a function of the incoming
   * question (rule name, state) for selective answers.
   */
  answerFor?: (q: {
    rule: string;
    question: Record<string, unknown>;
    request: MockProviderRequest;
  }) => number | null;
}

export interface MockProvider {
  /**
   * The server address for mockWire - the url the systemone provider is pointed at in a spawned
   * CLI.
   */
  baseUrl: string;
  stop: () => void;
  /** Every request the mock saw, in order. Assert the wire: state content, instructions, criteria. */
  requests: MockProviderRequest[];
}

/** A choice answer: the selected option holds 0.7, the rest share 0.3 evenly. */
function choiceAnswer(question: Record<string, unknown>, selected: string | undefined) {
  const labels = Object.keys((question.criteria ?? {}) as Record<string, unknown>);
  const choice = selected ?? labels[0]!;
  const rest = labels.length > 1 ? 0.3 / (labels.length - 1) : 0;
  const probabilities = Object.fromEntries(labels.map((l) => [l, l === choice ? 0.7 : rest]));
  return { type: "choice", choice, probabilities };
}

export function startMockProvider(opts: MockProviderOptions = {}): MockProvider {
  const requests: MockProviderRequest[] = [];
  const server = Bun.serve({
    port: 0,
    idleTimeout: 30,
    async fetch(req) {
      const body = (await req.json()) as {
        state?: Record<string, unknown>;
        questions?: Record<string, Record<string, unknown>>;
      };
      const entry: MockProviderRequest = {
        body: body as Record<string, unknown>,
        state: body.state ?? {},
        questions: body.questions ?? {},
      };
      requests.push(entry);
      const answers: Record<string, unknown> = {};
      for (const [rule, question] of Object.entries(body.questions ?? {})) {
        const override = opts.answerFor?.({ rule, question, request: entry });
        // score answers carry the full distribution (the wire requires it); the mock mass sits
        // on level 1 with the score summarized around it
        answers[rule] =
          question.type === "score"
            ? {
                type: "score",
                score: override ?? opts.score ?? 1,
                probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 },
                // provider echoes each level's text back as the legend
                legend: Object.fromEntries(
                  ((question.criteria as string[] | undefined) ?? []).map((t, i) => [String(i), t]),
                ),
              }
            : question.type === "choice"
              ? choiceAnswer(question, opts.choice)
              : { type: "noul", noul: override ?? opts.noul ?? 0.8 };
      }
      return Response.json(
        { model: "jev-mock", answers, usage: { input_tokens: 1, output_tokens: 1 } },
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });
  return {
    baseUrl: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
    requests,
  };
}

export interface MockDecisionsRequest {
  /** The full parsed request body: model, input, questions (an array of named questions). */
  body: { model: string; input: unknown; questions: Record<string, unknown>[] };
  /** The state: the input_json part's data. */
  state: Record<string, unknown>;
}

export interface MockDecisionsOptions {
  /** Probability answered for predicate questions. Default 0.8. */
  predicate?: number;
  /** The level holding the score mass (0.8; its neighbours share the rest). Default 1. */
  level?: number;
  /** Selected value for choice questions. Default: the first value. */
  choice?: string;
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
      requests.push({ body, state: part?.data ?? {} });
      if (opts.latencyMs !== undefined) await Bun.sleep(opts.latencyMs);
      if (opts.status !== undefined) {
        return Response.json({ error: { message: "mock failure" } }, { status: opts.status });
      }
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
