/**
 * The `decisions` protocol: OpenAI's POST /v1/decisions, called through the official `openai`
 * client. Each System One request is translated into the Decisions format and each reply back.
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
import { SetupError } from "../types.ts";
import { ID_HEADER } from "./debug.ts";
import {
  wireName,
  type Ask,
  type Answered,
  type Fetch,
  type SystemOneQuestion,
} from "./protocol.ts";
import type { ResolvedProvider } from "./providers.ts";
import type { Decision, DecisionCreateParams } from "openai/resources/decisions";

const NONE = "none_of_these";

type Question = DecisionCreateParams["questions"][number];

/** The shape of an answer the conversion reads: the client's typed answers, and the vercel route's. */
export type DecisionsAnswer = {
  type: string;
  name: string | null;
  choice?: string | boolean;
  probability?: number;
  probabilities?: { value: string | boolean | number; probability: number }[];
};

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

/** The System One answer for one Decisions answer. */
export function fromDecisions(q: SystemOneQuestion, a: DecisionsAnswer): unknown {
  const shares: Record<string, number> = Object.fromEntries(
    (a.probabilities ?? []).map((o) => [String(o.value), o.probability]),
  );
  if (q.type === "noul") return { type: "noul", noul: a.probability ?? 0 };
  if (q.type === "score") {
    const score = Object.entries(shares).reduce((sum, [level, p]) => sum + Number(level) * p, 0);
    // System One echoes each level's text as the legend; the run view shows the levels from it.
    const legend = Object.fromEntries((q.criteria as string[]).map((text, i) => [String(i), text]));
    return { type: "score", score, legend, probabilities: shares };
  }
  delete shares[NONE];
  const total = Object.values(shares).reduce((s, p) => s + p, 0);
  const options = Object.keys(shares);
  const spread = Object.fromEntries(
    options.map((o) => [o, total > 0 ? shares[o]! / total : 1 / options.length]),
  );
  const choice =
    a.choice !== undefined && String(a.choice) in spread
      ? String(a.choice)
      : options.reduce((b, o) => (spread[o]! > spread[b]! ? o : b));
  return { type: "choice", choice, probabilities: spread };
}

/**
 * Per question, in System One's shape. The model refuses a score none of whose levels fits
 * (complexity of a plain data object); that question alone becomes a refusal.
 */
export function answersByName(
  ask: Ask,
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

/** The answers and usage the layer above expects, from the client's typed reply. */
export function answered(reply: Decision, ask: Ask): Answered {
  const byName = new Map(reply.answers.map((a) => [a.name, a]));
  return {
    model: reply.model,
    answers: answersByName(ask, (wire) => byName.get(wire)),
    usage: {
      input_tokens: reply.usage?.input_tokens ?? 0,
      output_tokens: reply.usage?.output_tokens ?? 0,
      cached_input_tokens: reply.usage?.input_tokens_details?.cached_tokens ?? 0,
    },
  };
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

const idHeader = (headers: ConstructorParameters<typeof Headers>[0]): Record<string, string> => {
  const id = new Headers(headers).get(ID_HEADER);
  return id === null ? {} : { [ID_HEADER]: id };
};

/** Per attempt, as the vendor client's own default. */
const ATTEMPT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
/** The outer (vendor) client's budget: the client's attempts and backoffs all happen inside it. */
export const DECISIONS_BUDGET_MS = 5 * 60_000;

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

/**
 * The fetch that answers a System One request by asking Decisions through the official client,
 * which sends the request through `base` (the wire tap). The client retries and times out; an error
 * it gives up on goes up as a response with the same status and body, so the layer above maps it as
 * it maps any provider failure. A connection failure or timeout is thrown.
 */
export function decisionsFetch(
  provider: ResolvedProvider,
  base: Fetch,
  log: (line: string) => void,
  limits: { timeoutMs: number; maxRetries: number } = {
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  },
): Fetch {
  const baseURL = baseUrl(provider);
  let client: OpenAI | undefined;
  const clientFor = (apiKey: string): OpenAI =>
    (client ??= withoutOpenAIEnv(
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
            base(
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
              init,
            ),
          logLevel: "info",
          logger: {
            debug: () => {},
            // "<request> 429 Too Many Requests in 12ms - retrying, 2 attempts remaining"
            info: (message, ...args) => {
              if (message.includes("retrying,"))
                log(`provider backoff: ${message} ${args.join(" ")}`);
            },
            warn: (message, ...args) => log(`provider warn: ${message} ${args.join(" ")}`),
            error: (message, ...args) => log(`provider error: ${message} ${args.join(" ")}`),
          },
        }),
    ));

  return async (_input, init) => {
    const sent = JSON.parse(String(init?.body)) as {
      model: string;
      state: unknown;
      questions: Record<string, SystemOneQuestion>;
    };
    const ask: Ask = {
      model: sent.model,
      input: typeof sent.state === "string" ? sent.state : JSON.stringify(sent.state),
      questions: sent.questions,
    };
    const apiKey = provider.apiKey;
    if (apiKey === undefined)
      throw new SetupError("CONFIG_INVALID", `no ${provider.spec.keyEnv} set`);
    const state = sent.state;
    const params: DecisionCreateParams = {
      model: sent.model,
      input:
        typeof state === "object" && state !== null && !Array.isArray(state)
          ? [
              {
                role: "user",
                content: [{ type: "input_json", data: state as Record<string, unknown> }],
              },
            ]
          : ask.input,
      questions: Object.keys(ask.questions).map((name, i) =>
        toDecisions(wireName(i), ask.questions[name]!),
      ),
    };
    try {
      const reply = await clientFor(apiKey).decisions.create(params, {
        // the run-scoped element id rides along, as it does to the recorder above
        headers: { ...provider.spec.headers, ...idHeader(init?.headers) },
        signal: init?.signal ?? undefined,
      });
      const done = answered(reply, ask);
      return new Response(
        JSON.stringify({
          model: done.model ?? sent.model,
          answers: done.answers,
          usage: done.usage,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (e) {
      if (e instanceof OpenAI.APIError && e.status !== undefined) {
        return new Response(JSON.stringify(e.error ?? { message: e.message }), {
          status: e.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw e;
    }
  };
}
