/**
 * Shared mock of the jev vendor wire (POST /v1/systemone). Point the CLI at baseUrl via
 * TYPESAFE_BASE_URL and every classification is answered locally — the suite runs fully keyless.
 *
 * Testing doctrine: mocked tests assert CONTRACT (exit codes, messages, wire shapes) and run
 * everywhere. Live tests assert MODEL BEHAVIOR (calibration) and run opt-in — see tests/README.md.
 *
 * The wire shape mirrors src/core/jev/client.ts: the request carries { state, questions } where
 * each question is a compiled { instructions, criteria } spec, and the response carries an answer
 * per question of shape { type: "noul", noul: 0..1 } or { type: "score", score: number }.
 */

export interface MockJevRequest {
  /** The full parsed request body (state, questions) — assert the wire, not our pre-SDK objects. */
  body: Record<string, unknown>;
  state: Record<string, unknown>;
  questions: Record<string, Record<string, unknown>>;
}

export interface MockJevOptions {
  /** Default answer for noul-type questions. Default 0.8. */
  noul?: number;
  /** Default answer for score-type questions. Default 1. */
  score?: number;
  /**
   * Per-question override: return a probability, or null to fall back to the defaults. Called with
   * the question name, the compiled question, and the whole request — a function of the incoming
   * question (rule name, state) for selective answers.
   */
  answerFor?: (q: {
    rule: string;
    question: Record<string, unknown>;
    request: MockJevRequest;
  }) => number | null;
}

export interface MockJev {
  /** Value for TYPESAFE_BASE_URL — the proven process-level injection for spawned CLIs. */
  baseUrl: string;
  stop: () => void;
  /** Every request the mock saw, in order. Assert the wire: state content, instructions, criteria. */
  requests: MockJevRequest[];
}

export function startMockJev(opts: MockJevOptions = {}): MockJev {
  const requests: MockJevRequest[] = [];
  const server = Bun.serve({
    port: 0,
    idleTimeout: 30,
    async fetch(req) {
      const body = (await req.json()) as {
        state?: Record<string, unknown>;
        questions?: Record<string, Record<string, unknown>>;
      };
      const entry: MockJevRequest = {
        body: body as Record<string, unknown>,
        state: body.state ?? {},
        questions: body.questions ?? {},
      };
      requests.push(entry);
      const answers: Record<string, unknown> = {};
      for (const [rule, question] of Object.entries(body.questions ?? {})) {
        const override = opts.answerFor?.({ rule, question, request: entry });
        answers[rule] =
          question.type === "score"
            ? { type: "score", score: override ?? opts.score ?? 1 }
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
