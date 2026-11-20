/**
 * The Decisions adapter: OpenAI-style POST /v1/decisions, called through the official `openai`
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

import { inspect } from "node:util";
import OpenAI from "openai";
import { ClassifyError, SetupError, type Adapter, type Ask } from "../types.ts";
import { hashOf, type AnswerStore, type StoredAnswer } from "./answer-cache.ts";
import { type Endpoint } from "./endpoint.ts";
import { foldCriteria, stateData, questionKey, type Fetch, type QuestionSpec } from "./protocol.ts";
import { NONE, readAnswer, readAnswers, fromDecisions, type DecisionsAnswer } from "./reading.ts";
import { ATTEMPT_TIMEOUT_MS, MAX_RETRIES, statusError } from "./transport.ts";
import type { ClassifiedAnswer, Refusal } from "@jint/contract";

export { fromDecisions, readAnswer, type DecisionsAnswer };
import type { Decision, DecisionCreateParams } from "openai/resources/decisions";

export const MODEL = "gpt-6-luna";

type Question = DecisionCreateParams["questions"][number];

/** The Decisions question for one question, under its question key. */
export function toDecisions(name: string, q: QuestionSpec): Question {
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
    const asked = foldCriteria(instructions, (q.criteria ?? {}) as Record<string, string>);
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

/** The setup error for a url the client cannot be pointed at: it takes a root, we hold an endpoint. */
function baseUrl({ url }: Endpoint): string {
  if (!url.endsWith("/decisions")) {
    throw new SetupError(
      "CONFIG_INVALID",
      `url must end in /decisions (got ${url}) - set the config key url or JINT_API_URL`,
    );
  }
  return url.slice(0, -"/decisions".length);
}

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

export function decisionsErrorCausedBy(e: unknown, input: string): ClassifyError {
  if (e instanceof ClassifyError) return e;
  if (e instanceof OpenAI.APIConnectionError) {
    return new ClassifyError("PROVIDER_UNAVAILABLE", input, `provider unreachable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof OpenAI.APIError) return statusError(e.status, e.message, input, e);
  const detail = e instanceof Error ? e.message : String(e);
  return new ClassifyError("INTERNAL", input, `unexpected provider transport error: ${detail}`, {
    cause: e,
  });
}

/** The Decisions request for one ask: the state as one input_json part, one question per name. */
export function decisionsParams(model: string, ask: Ask): DecisionCreateParams {
  const data = stateData(ask);
  return {
    model,
    input: [{ role: "user", content: [{ type: "input_json", data }] }],
    questions: Object.keys(ask.questions).map((name, i) =>
      toDecisions(questionKey(i), ask.questions[name]!),
    ),
  };
}

export function cacheKey(
  endpoint: string,
  model: string,
  state: Ask["state"],
  name: string,
  q: Ask["questions"][string],
) {
  const alone = decisionsParams(model, { state, questions: { [name]: q } });
  return hashOf(`${endpoint}\n${JSON.stringify(alone)}`);
}

/** What the answer cache needs of its caller: the store, the endpoint, and the hit recorder. */
export interface AnswerCaching {
  store: AnswerStore;
  /** UrlIdentity of the endpoint asked. */
  endpoint: string;
  /** Runs a call that carries only the questions `names` (the recorder names its positions). */
  scope?: <T>(names: string[], body: () => Promise<T>) => Promise<T>;
  /** Called with the questions a hit covers and the exchange it stands for (request, stored reply). */
  hit?: (names: string[], exchange: { request: unknown; response: unknown }) => void;
}

const withoutName = ({ name: _name, ...answer }: DecisionsAnswer) => answer;

/** Each question's cache key and stored answer by position, and the names no stored answer covers. */
type Lookup = {
  names: string[];
  keys: string[];
  held: (StoredAnswer | undefined)[];
  missing: string[];
};

/** The ask narrowed to the questions `names`. */
const only = (ask: Ask, names: string[]): Ask => ({
  state: ask.state,
  questions: Object.fromEntries(names.map((n) => [n, ask.questions[n]!])),
});

/**
 * The stored answer for question `name` when it still reads, else undefined: a miss. An entry that
 * throws when read is logged with the error and asked again.
 */
function storedAnswer(
  store: AnswerStore,
  key: string,
  name: string,
  q: QuestionSpec,
  log: (line: string) => void,
): StoredAnswer | undefined {
  const entry = store.get(key);
  if (entry === undefined) return undefined;
  try {
    return readAnswer(q, { ...entry.answer, name }) === undefined ? undefined : entry;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log(`answer cache: entry ${key} does not read, asking again: ${detail}`);
    return undefined;
  }
}

const firstHeld = (lookup: Lookup) => lookup.held.find((e) => e !== undefined);

function answersInAskOrder(
  { names, held, missing }: Lookup,
  reply: Decision | undefined,
): (DecisionsAnswer | undefined)[] {
  const fresh = new Map(reply?.answers.map((a) => [a.name, a]));
  return names.map((n, i): DecisionsAnswer | undefined =>
    held[i] !== undefined
      ? { ...held[i]!.answer, name: questionKey(i) }
      : fresh.get(questionKey(missing.indexOf(n))),
  );
}

function markCached(answers: Record<string, ClassifiedAnswer | Refusal>, { names, held }: Lookup) {
  names.forEach((n, i) => {
    if (held[i] !== undefined) answers[n] = { ...answers[n]!, cached: true };
  });
  return answers;
}

function storeFresh(
  cache: AnswerCaching,
  { names, keys, held }: Lookup,
  raw: (DecisionsAnswer | undefined)[],
  model: string,
) {
  const at = new Date().toISOString();
  names.forEach((_, i) => {
    if (held[i] === undefined)
      cache.store.put(keys[i]!, { at, model, answer: withoutName(raw[i]!) });
  });
}

/**
 * Tells the cache's hit recorder which questions stored answers covered, as the exchange they stand
 * for.
 */
function reportHits(cache: AnswerCaching, model: string, ask: Ask, lookup: Lookup) {
  const { names, held } = lookup;
  const hits = names.flatMap((n, i) => (held[i] === undefined ? [] : [n]));
  if (hits.length === 0) return;
  cache.hit?.(hits, {
    request: decisionsParams(model, only(ask, hits)),
    response: {
      model: firstHeld(lookup)!.model,
      answers: names.flatMap((n, i) =>
        held[i] === undefined ? [] : [{ ...held[i]!.answer, name: questionKey(hits.indexOf(n)) }],
      ),
    },
  });
}

const usageOf = (reply: Decision | undefined) => ({
  input_tokens: reply?.usage?.input_tokens ?? 0,
  output_tokens: reply?.usage?.output_tokens ?? 0,
  cached_input_tokens: reply?.usage?.input_tokens_details?.cached_tokens ?? 0,
});

/** The official client, pointed at the endpoint, its requests through `fetch`, its logs to `log`. */
function decisionsClient(
  apiKey: string,
  baseURL: string,
  limits: { timeoutMs: number; maxRetries: number },
  transport: { fetch: Fetch; log: (line: string) => void },
): OpenAI {
  return withoutOpenAIEnv(
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
        logger: clientLogger(transport.log),
      }),
  );
}

/** A log line's arguments in full: a string as it is, an error or object with its detail. */
const logged = (args: unknown[]) =>
  args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 4 }))).join(" ");

/** The client's logger: retries, warnings and errors go to `log`; debug output is dropped. */
function clientLogger(log: (line: string) => void) {
  return {
    debug: () => {},
    // "<request> 429 Too Many Requests in 12ms - retrying, 2 attempts remaining"
    info: (message: string, ...args: unknown[]) => {
      if (message.includes("retrying,")) log(`provider backoff: ${message} ${logged(args)}`);
    },
    warn: (message: string, ...args: unknown[]) => log(`provider warn: ${message} ${logged(args)}`),
    error: (message: string, ...args: unknown[]) =>
      log(`provider error: ${message} ${logged(args)}`),
  };
}

/**
 * The adapter for the Decisions endpoint. `fetch` is the client's transport (the recorder sits
 * there); the client retries and times out per attempt. A reply, a refusal, or a failure all leave
 * as an Asked or a ClassifyError.
 */
export function decisionsAdapter(
  endpoint: Endpoint,
  transport: {
    fetch: Fetch;
    log: (line: string) => void;
    limits?: { timeoutMs: number; maxRetries: number };
    cache?: AnswerCaching;
  },
): Adapter {
  const baseURL = baseUrl(endpoint);
  const model = endpoint.model ?? MODEL;
  const apiKey = endpoint.apiKey;
  if (apiKey === undefined)
    throw new SetupError("CONFIG_INVALID", endpoint.unusable ?? "no API key");
  const limits = transport.limits ?? {
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  };
  const client = decisionsClient(apiKey, baseURL, limits, transport);
  const cache = transport.cache;
  const lookUp = (ask: Ask): Lookup => {
    const names = Object.keys(ask.questions);
    const keys = cache
      ? names.map((n) => cacheKey(cache.endpoint, model, ask.state, n, ask.questions[n]!))
      : [];
    const held = names.map((n, i) =>
      cache
        ? storedAnswer(cache.store, keys[i]!, questionKey(i), ask.questions[n]!, transport.log)
        : undefined,
    );
    const missing = names.flatMap((n, i) => (held[i] === undefined ? [n] : []));
    return { names, keys, held, missing };
  };
  /** The endpoint's reply for the questions no stored answer covers; an ask of none still goes out. */
  const askMissing = (ask: Ask, lookup: Lookup, signal?: AbortSignal) => {
    const { names, missing } = lookup;
    if (names.length > 0 && missing.length === 0) return Promise.resolve(undefined);
    const scope = cache?.scope ?? ((_names, body) => body());
    return scope(missing, () =>
      client.decisions.create(decisionsParams(model, only(ask, missing)), {
        signal,
      }),
    );
  };
  return {
    async ask(ask, options) {
      try {
        const lookup = lookUp(ask);
        const reply = await askMissing(ask, lookup, options?.signal);
        const raw = answersInAskOrder(lookup, reply);
        const answers = markCached(
          readAnswers(ask, (key) => raw[Number(key.slice(1))]),
          lookup,
        );
        if (cache !== undefined) {
          storeFresh(cache, lookup, raw, reply?.model ?? model);
          reportHits(cache, model, ask, lookup);
        }
        return {
          model: reply?.model ?? firstHeld(lookup)?.model ?? model,
          answers,
          usage: usageOf(reply),
        };
      } catch (cause) {
        throw decisionsErrorCausedBy(cause, ask.state.path);
      }
    },
  };
}
