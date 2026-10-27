/**
 * The `decisions` protocol: OpenAI's POST /v1/decisions, called through the official `openai`
 * client directly. The adapter turns each ask into the Decisions format and each reply into the
 * answers the rules read.
 *
 * The state travels as an `input_json` part of one user message, the documented form for structured
 * data (a string would be JSON inside JSON).
 *
 * A noul is asked as a predicate, the API's yes/no form. A predicate has no criteria field, so a
 * noul's criteria are folded into its question as what a yes and a no mean. A choice gets a
 * fallback option the API needs when none fits; its mass is dropped and the rest renormalized. A
 * score level is labelled by its index. A refused question keeps its place as a refusal, so only
 * its own rule loses the reading.
 */

import OpenAI from "openai";
import { ClassifyError, SetupError, type Adapter, type Ask, type Asked } from "../types.ts";
import { wireName, type Fetch, type SystemOneQuestion, type WireAsk } from "./protocol.ts";
import { NONE, readAnswer, fromDecisions, type DecisionsAnswer } from "./reading.ts";
import type { ResolvedProvider } from "./providers.ts";

export { fromDecisions, readAnswer, type DecisionsAnswer };
import type { ClassifiedAnswer, Refusal } from "@jint/contract";
import type { Decision, DecisionCreateParams } from "openai/resources/decisions";

type Question = DecisionCreateParams["questions"][number];

/** The Decisions question for one System One question, under a wire-safe name. */
export function toDecisions(name: string, q: SystemOneQuestion): Question {
  const instructions =
    typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions);
  if (q.type === "score") {
    const levels = (q.criteria as string[]).map((description, i) => ({
      label: String(i),
      description,
    }));
    return { type: "score", name, instructions, levels };
  }
  if (q.type === "noul") {
    const c = (q.criteria ?? {}) as Record<string, string>;
    const meaning = [c.true && `Yes: ${c.true}`, c.false && `No: ${c.false}`].filter(Boolean);
    const asked = meaning.length ? `${instructions}\n\n${meaning.join("\n")}` : instructions;
    return { type: "predicate", name, instructions: asked };
  }
  const choices = Object.entries(q.criteria as Record<string, string>).map(
    ([value, description]) => ({
      value,
      description: description || value,
    }),
  );
  return {
    type: "choice",
    name,
    instructions,
    choices: [...choices, { value: NONE, description: "None of these fits" }],
  };
}

/**
 * Per question, in System One's shape. The model refuses a score none of whose levels fits
 * (complexity of a plain data object); that question alone becomes a refusal.
 */
export function answersByName(
  ask: WireAsk,
  find: (wire: string) => DecisionsAnswer | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(ask.questions).map((name, i) => {
      const a = find(wireName(i));
      if (a?.type === "refusal") return [name, { type: "refusal" }];
      return [name, a === undefined ? undefined : fromDecisions(ask.questions[name]!, a)];
    }),
  );
}

/** The setup error for a url the client cannot be pointed at: it takes a root, we hold an endpoint. */
function baseUrl(provider: ResolvedProvider): string {
  const { url } = provider.spec;
  if (!url.endsWith("/decisions")) {
    throw new SetupError(
      "CONFIG_INVALID",
      `provider '${provider.name}': url must end in /decisions (got ${url}) - set providers.${provider.name}.url or JINT_PROVIDER_URL`,
    );
  }
  return url.slice(0, -"/decisions".length);
}

/** Per attempt, as the vendor client's own default. */
const ATTEMPT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

/**
 * The official client reads OPENAI_* variables (key, base url, org, project, webhook secret, admin
 * key, log level, custom headers) when it is built. Its options are passed explicitly, and the
 * variables are hidden for the synchronous construction, so none can steer or leak the request.
 */
function withoutOpenAIEnv<T>(build: () => T): T {
  const held = Object.entries(process.env).filter(([k]) => k.startsWith("OPENAI_"));
  for (const [k] of held) delete process.env[k];
  try {
    return build();
  } finally {
    for (const [k, v] of held) process.env[k] = v;
  }
}

/** The ClassifyError a failed call is, by the client's error type; a ClassifyError passes as is. */
export function mapDecisionsError(e: unknown, input: string): ClassifyError {
  if (e instanceof ClassifyError) return e;
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) {
    return new ClassifyError(
      "PROVIDER_AUTH",
      input,
      `provider rejected the API key: ${e.message}`,
      { cause: e },
    );
  }
  if (e instanceof OpenAI.BadRequestError || e instanceof OpenAI.UnprocessableEntityError) {
    return new ClassifyError(
      "PROVIDER_REQUEST_INVALID",
      input,
      `provider rejected the request: ${e.message}`,
      { cause: e },
    );
  }
  if (e instanceof OpenAI.APIConnectionError) {
    return new ClassifyError("PROVIDER_UNAVAILABLE", input, `provider unreachable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof OpenAI.APIError) {
    return new ClassifyError("PROVIDER_UNAVAILABLE", input, `provider unavailable: ${e.message}`, {
      cause: e,
    });
  }
  const detail = e instanceof Error ? e.message : String(e);
  return new ClassifyError("INTERNAL", input, `unexpected provider transport error: ${detail}`, {
    cause: e,
  });
}

/** The Decisions request for one ask: the state as one input_json part, one question per name. */
export function decisionsParams(model: string, ask: Ask): DecisionCreateParams {
  return {
    model,
    input: [{ role: "user", content: [{ type: "input_json", data: { ...ask.state } }] }],
    questions: Object.keys(ask.questions).map((name, i) =>
      toDecisions(wireName(i), ask.questions[name]!),
    ),
  };
}

/** Each question's answer from the reply, matched by wire name; a wrong-shaped one is invalid. */
function answersOf(reply: Decision, ask: Ask): Asked["answers"] {
  const byName = new Map(reply.answers.map((a) => [a.name, a]));
  const input = ask.state.path;
  const out: Record<string, ClassifiedAnswer | Refusal> = {};
  Object.entries(ask.questions).forEach(([name, spec], i) => {
    const a = byName.get(wireName(i));
    const answer = a === undefined ? undefined : readAnswer(spec, a);
    // A missing answer, or a noul outside [0, 1], is the model's reply failing the contract.
    const outOfRange =
      spec.type === "noul" && answer !== undefined && "value" in answer
        ? !(answer.value >= 0 && answer.value <= 1)
        : false;
    if (answer === undefined || outOfRange) {
      throw new ClassifyError(
        "PROVIDER_RESPONSE_INVALID",
        input,
        `provider answer '${name}' failed shape validation: expected ${spec.type}, got ${JSON.stringify(a)}`,
      );
    }
    out[name] = answer;
  });
  return out;
}

/**
 * The adapter for a provider speaking the `decisions` protocol. `fetch` is the client's transport
 * (the recorder sits there); the client retries and times out per attempt. A reply, a refusal, or a
 * failure all leave as an Asked or a ClassifyError.
 */
export function decisionsAdapter(
  provider: ResolvedProvider,
  transport: {
    fetch: Fetch;
    log: (line: string) => void;
    limits?: { timeoutMs: number; maxRetries: number };
  },
): Adapter {
  const baseURL = baseUrl(provider);
  const apiKey = provider.apiKey;
  if (apiKey === undefined)
    throw new SetupError("CONFIG_INVALID", `no ${provider.spec.keyEnv} set`);
  const limits = transport.limits ?? { timeoutMs: ATTEMPT_TIMEOUT_MS, maxRetries: MAX_RETRIES };
  const client = withoutOpenAIEnv(
    () =>
      new OpenAI({
        apiKey,
        baseURL,
        organization: null,
        project: null,
        webhookSecret: null,
        adminAPIKey: null,
        maxRetries: limits.maxRetries,
        timeout: limits.timeoutMs,
        fetch: (input, init) =>
          transport.fetch(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            init,
          ),
        logLevel: "info",
        logger: {
          debug: () => {},
          // "<request> 429 Too Many Requests in 12ms - retrying, 2 attempts remaining"
          info: (message, ...args) => {
            if (message.includes("retrying,"))
              transport.log(`provider backoff: ${message} ${args.join(" ")}`);
          },
          warn: (message, ...args) => transport.log(`provider warn: ${message} ${args.join(" ")}`),
          error: (message, ...args) =>
            transport.log(`provider error: ${message} ${args.join(" ")}`),
        },
      }),
  );
  return {
    async ask(ask, options) {
      try {
        const reply = await client.decisions.create(decisionsParams(provider.model, ask), {
          headers: provider.spec.headers,
          signal: options?.signal,
        });
        return {
          model: reply.model ?? provider.model,
          answers: answersOf(reply, ask),
          usage: {
            input_tokens: reply.usage?.input_tokens ?? 0,
            output_tokens: reply.usage?.output_tokens ?? 0,
            cached_input_tokens: reply.usage?.input_tokens_details?.cached_tokens ?? 0,
          },
        };
      } catch (e) {
        throw mapDecisionsError(e, ask.state.path);
      }
    },
  };
}
