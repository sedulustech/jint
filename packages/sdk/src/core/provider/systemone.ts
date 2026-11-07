/**
 * The adapter for the System One wire (`POST /v1/systemone`), asked through TypeSafe's official
 * client: its retries, backoff, timeouts and error classes are the vendor's, kept as they ship. The
 * same wire is served by TypeSafe's API and by Lemonade (FastFlowLM d3 and llama.cpp decision
 * models), so one adapter reaches every server that speaks it.
 *
 * A reply, a refusal or a failure all leave as an Asked or a ClassifyError; no vendor error type
 * escapes. A question the server answered with `truncated: true` was cut before it was read, so it
 * leaves as a refusal rather than a value.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  APIConnectionError,
  APIError,
  TypeSafeClient,
  TypeSafeError,
  choice,
  noul,
  score,
  type EntryType,
  type NoulQuestion,
  type Questions,
  type ScoreCriteria,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { ClassifyError, SetupError, type Adapter, type Ask } from "../types.ts";
import { type Endpoint } from "./endpoint.ts";
import { stateData, type Fetch, type QuestionSpec } from "./protocol.ts";
import { ATTEMPT_TIMEOUT_MS, MAX_RETRIES, statusError } from "./transport.ts";
import type { ClassifiedAnswer, Refusal } from "@jint/contract";

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

const SHAPES = {
  noul: { schema: NOUL_ANSWER, text: '{ type: "noul", noul: number 0..1 }' },
  score: { schema: SCORE_ANSWER, text: '{ type: "score", score, probabilities }' },
  choice: { schema: CHOICE_ANSWER, text: '{ type: "choice", choice, probabilities }' },
} as const;

/** The vendor's builders over one question; instructions are the text or JSON the rule wrote. */
function compile(questions: Record<string, QuestionSpec>): Questions {
  const out: Questions = {};
  for (const [name, q] of Object.entries(questions)) {
    const instructions = q.instructions as EntryType;
    if (q.type === "score") out[name] = score(instructions, q.criteria as ScoreCriteria);
    else if (q.type === "choice")
      out[name] = choice(instructions, q.criteria as Record<string, string>);
    else
      out[name] = noul(
        instructions as NonNullable<EntryType>,
        q.criteria as NoulQuestion["criteria"],
      );
  }
  return out;
}

const confidenceOf = (a: { confidence?: number }): { confidence?: number } =>
  typeof a.confidence === "number" && Number.isFinite(a.confidence)
    ? { confidence: a.confidence }
    : {};

function read(
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
    return { value: s.score, probabilities: s.probabilities, ...confidenceOf(s) };
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

export function mapSystemOneError(e: unknown, input: string): ClassifyError {
  if (e instanceof ClassifyError) return e;
  if (e instanceof APIError) return statusError(e.status, e.message, input, e);
  if (e instanceof APIConnectionError) {
    return new ClassifyError("PROVIDER_UNAVAILABLE", input, `provider unreachable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof TypeSafeError) {
    return new ClassifyError(
      "PROVIDER_REQUEST_INVALID",
      input,
      `provider call refused: ${e.message}`,
      {
        cause: e,
      },
    );
  }
  const detail = e instanceof Error ? e.message : String(e);
  return new ClassifyError("INTERNAL", input, `unexpected provider transport error: ${detail}`, {
    cause: e,
  });
}

/**
 * The client reads TYPESAFE_* variables (key, base url, default model, log level) when it is built.
 * Its options are passed explicitly, and the variables are hidden for the construction, so none can
 * steer or leak the request.
 */
function withoutTypeSafeEnv<T>(build: () => T): T {
  const held = Object.entries(process.env).filter(([k]) => k.startsWith("TYPESAFE_"));
  for (const [k] of held) delete process.env[k];
  try {
    return build();
  } finally {
    for (const [k, v] of held) process.env[k] = v;
  }
}

/**
 * The key a server that takes none is given, because the client insists on one (Lemonade's own
 * clients send this word).
 */
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
  const limits = transport.limits ?? { timeoutMs: ATTEMPT_TIMEOUT_MS, maxRetries: MAX_RETRIES };
  const config: TypeSafeClientConfig = {
    apiKey,
    baseURL,
    timeout: limits.timeoutMs,
    retry: { maxRetries: limits.maxRetries },
    fetch: transport.fetch,
    logLevel: "info",
    logger: {
      debug: () => {},
      // "retrying in 200ms (retry 1/2) after ..."
      info: (message, ...args) => {
        if (message.includes("retrying in"))
          transport.log(`provider backoff: ${message} ${args.join(" ")}`);
      },
      warn: (message, ...args) => transport.log(`provider warn: ${message} ${args.join(" ")}`),
      error: (message, ...args) => transport.log(`provider error: ${message} ${args.join(" ")}`),
    },
  };
  if (endpoint.model !== undefined) config.defaultModel = endpoint.model;
  const client = withoutTypeSafeEnv(() => new TypeSafeClient(config));
  return {
    async ask(ask: Ask, options) {
      try {
        const result = await client.systemOne(
          { state: stateData(ask) as NonNullable<EntryType>, questions: compile(ask.questions) },
          { signal: options?.signal },
        );
        const answers: Record<string, ClassifiedAnswer | Refusal> = {};
        for (const [name, spec] of Object.entries(ask.questions)) {
          answers[name] = read(
            name,
            spec,
            (result.answers as Record<string, unknown>)[name],
            ask.state.path,
          );
        }
        return {
          model: result.model,
          answers,
          usage: {
            input_tokens: result.usage.input_tokens ?? 0,
            output_tokens: result.usage.output_tokens ?? 0,
            cached_input_tokens: 0,
          },
        };
      } catch (e) {
        throw mapSystemOneError(e, ask.state.path);
      }
    },
  };
}
