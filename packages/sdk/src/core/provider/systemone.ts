/**
 * The adapter for the System One protocol (`POST /v1/systemone`), asked through the small client in
 * json-client.ts; only the vendor's types are imported from its package. The same protocol is
 * served by TypeSafe's API and by Lemonade (FastFlowLM d3 and llama.cpp decision models), so one
 * adapter reaches every server that speaks it.
 *
 * A reply, a refusal or a failure all leave as an Asked or a ClassifyError; no vendor error type
 * escapes. A question the server answered with `truncated: true` was cut before it was read, so it
 * leaves as a refusal rather than a value.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ClassifyError, SetupError, type Adapter, type Ask } from "../types.ts";
import { type Endpoint } from "./endpoint.ts";
import { ConnectionError, HttpError, RequestError, postJson } from "./json-client.ts";
import { stateData, type Fetch, type QuestionSpec } from "./protocol.ts";
import { ATTEMPT_TIMEOUT_MS, MAX_RETRIES, statusError } from "./transport.ts";
import type { ClassifiedAnswer, Refusal } from "@jint/contract";
import type { Questions } from "@typesafe-ai/sdk";

const SUFFIX = "/v1/systemone";

/** The client takes a root and adds the path itself, so the endpoint's url is cut back to it. */
function baseUrl({ url }: Endpoint): string {
  const bare = url.replace(/\/+$/, "");
  if (!bare.endsWith(SUFFIX)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `url must end in ${SUFFIX} (got ${url}) - set JINT_API_URL`,
    );
  }
  return bare.slice(0, -SUFFIX.length);
}

/** TypeSafe's own host: the only one that knows its default model. */
const isTypeSafeHost = (base: string): boolean => new URL(base).hostname === "api.typesafe.ai";

/** What TypeSafe's own host serves when no model is named (the vendor client's default). */
const TYPESAFE_DEFAULT_MODEL = "jev-latest";

const PROBABILITIES = Type.Record(Type.String(), Type.Number());
const SERVED = { truncated: Type.Optional(Type.Boolean()) };

const NOUL_ANSWER = Type.Object({
  type: Type.Literal("noul"),
  noul: Type.Number({ minimum: 0, maximum: 1 }),
  ...SERVED,
});
const SCORE_ANSWER = Type.Object({
  type: Type.Literal("score"),
  score: Type.Number(),
  probabilities: PROBABILITIES,
  confidence: Type.Optional(Type.Number()),
  ...SERVED,
});
const CHOICE_ANSWER = Type.Object({
  type: Type.Literal("choice"),
  choice: Type.String(),
  probabilities: PROBABILITIES,
  confidence: Type.Optional(Type.Number()),
  ...SERVED,
});
const REFUSAL_ANSWER = Type.Object({ type: Type.Literal("refusal") });

const REPLY = Type.Object({
  model: Type.String(),
  answers: Type.Record(Type.String(), Type.Unknown()),
  usage: Type.Optional(
    Type.Object({
      input_tokens: Type.Optional(Type.Number()),
      output_tokens: Type.Optional(Type.Number()),
    }),
  ),
});

const SHAPES = {
  noul: { schema: NOUL_ANSWER, text: '{ type: "noul", noul: number 0..1 }' },
  score: {
    schema: SCORE_ANSWER,
    text: '{ type: "score", score, probabilities }',
  },
  choice: {
    schema: CHOICE_ANSWER,
    text: '{ type: "choice", choice, probabilities }',
  },
} as const;

export function compile(questions: Record<string, QuestionSpec>): Questions {
  const out: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "score") {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2) {
        throw new RequestError(
          `Score question "${name}" needs criteria that are a list of at least two descriptions indexed by score from zero.`,
        );
      }
      out[name] = {
        type: "score",
        instructions: q.instructions,
        criteria: q.criteria,
      };
    } else if (q.type === "choice") {
      const criteria = q.criteria;
      if (
        typeof criteria !== "object" ||
        criteria === null ||
        Array.isArray(criteria) ||
        Object.keys(criteria).length === 0
      ) {
        throw new RequestError(
          `Choice question "${name}" needs criteria that are a nonempty map of labels to descriptions.`,
        );
      }
      out[name] = { type: "choice", instructions: q.instructions, criteria };
    } else {
      out[name] = {
        type: "noul",
        instructions: q.instructions,
        criteria: q.criteria,
      };
    }
  }
  return out as Questions;
}

const confidenceOf = (a: { confidence?: number }): { confidence?: number } =>
  typeof a.confidence === "number" && Number.isFinite(a.confidence)
    ? { confidence: a.confidence }
    : {};

export function read(
  name: string,
  spec: QuestionSpec,
  answer: unknown,
  input: string,
): ClassifiedAnswer | Refusal {
  if (Value.Check(REFUSAL_ANSWER, answer)) return { refused: true };
  const shape = SHAPES[spec.type];
  if (!Value.Check(shape.schema, answer)) {
    throw new ClassifyError(
      "PROVIDER_RESPONSE_INVALID",
      input,
      `provider answer '${name}' failed shape validation: expected ${shape.text}, got ${JSON.stringify(answer)}`,
    );
  }
  if ((answer as { truncated?: boolean }).truncated === true) return { refused: true };
  if (spec.type === "score") {
    const s = answer as Static<typeof SCORE_ANSWER>;
    return {
      value: s.score,
      probabilities: s.probabilities,
      ...confidenceOf(s),
    };
  }
  if (spec.type === "choice") {
    // the value is the selected option's probability; the label carries the verdict
    const c = answer as Static<typeof CHOICE_ANSWER>;
    return {
      value: c.probabilities[c.choice] ?? 0,
      choice: c.choice,
      probabilities: c.probabilities,
      ...confidenceOf(c),
    };
  }
  return { value: (answer as Static<typeof NOUL_ANSWER>).noul };
}

export function classifyErrorCausedBy(cause: unknown, input: string): ClassifyError {
  if (cause instanceof ClassifyError) return cause;
  if (cause instanceof HttpError) return statusError(cause.status, cause.message, input, cause);
  if (cause instanceof ConnectionError) {
    return new ClassifyError(
      "PROVIDER_UNAVAILABLE",
      input,
      `provider unreachable: ${cause.message}`,
      {
        cause,
      },
    );
  }
  if (cause instanceof RequestError) {
    return new ClassifyError(
      "PROVIDER_REQUEST_INVALID",
      input,
      `provider call refused: ${cause.message}`,
      {
        cause,
      },
    );
  }
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new ClassifyError("INTERNAL", input, `unexpected provider transport error: ${detail}`, {
    cause,
  });
}

const NO_KEY = "lemonade";

export function systemOneAdapter(
  endpoint: Endpoint,
  transport: {
    fetch: Fetch;
    log: (line: string) => void;
    limits?: { timeoutMs: number; maxRetries: number };
  },
): Adapter {
  const baseURL = baseUrl(endpoint);
  const apiKey = endpoint.apiKey ?? (endpoint.keyless ? NO_KEY : undefined);
  if (apiKey === undefined)
    throw new SetupError("CONFIG_INVALID", endpoint.unusable ?? "no API key");
  const ownHost = isTypeSafeHost(baseURL);
  if (endpoint.model === undefined && !ownHost) {
    throw new SetupError(
      "CONFIG_INVALID",
      `${new URL(baseURL).host} serves several models - set JINT_API_MODEL to the one to ask`,
    );
  }
  const limits = transport.limits ?? {
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  };
  return {
    async ask(ask: Ask, options) {
      try {
        const reply = await postJson({
          fetch: transport.fetch,
          baseUrl: baseURL,
          path: SUFFIX,
          apiKey,
          // no `assets` map is sent: state and question text travel as plain JSON
          body: {
            state: stateData(ask),
            questions: compile(ask.questions),
            model: endpoint.model ?? TYPESAFE_DEFAULT_MODEL,
          },
          signal: options?.signal,
          timeoutMs: limits.timeoutMs,
          maxRetries: limits.maxRetries,
          log: (line) => transport.log(`provider backoff: ${line}`),
        });
        if (!Value.Check(REPLY, reply)) {
          throw new ClassifyError(
            "PROVIDER_RESPONSE_INVALID",
            ask.state.path,
            `provider reply failed shape validation: expected { model, answers, usage }, got ${JSON.stringify(reply)?.slice(0, 200)}`,
          );
        }
        const answers: Record<string, ClassifiedAnswer | Refusal> = {};
        for (const [name, spec] of Object.entries(ask.questions)) {
          answers[name] = read(name, spec, reply.answers[name], ask.state.path);
        }
        return {
          model: reply.model,
          answers,
          usage: {
            input_tokens: reply.usage?.input_tokens ?? 0,
            output_tokens: reply.usage?.output_tokens ?? 0,
            cached_input_tokens: 0,
          },
        };
      } catch (cause) {
        throw classifyErrorCausedBy(cause, ask.state.path);
      }
    },
  };
}
