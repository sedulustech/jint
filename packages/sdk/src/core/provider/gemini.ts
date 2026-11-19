/**
 * The adapter for Google's Gemini Decisions API (`POST /v1beta/decisions`). Its questions and
 * answers are the System One shapes, so the compiler and the answer reader are systemone.ts's. Four
 * things differ: the state goes in `input` as text, the key goes in `x-goog-api-key`, a noul's
 * criteria are named `true_description` and `false_description`, and the reply names no model.
 *
 * Gemini has no refusal answer: a safety block is a 400 whose message names the block, so it fails
 * the call like any other 400.
 */

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ClassifyError, SetupError, type Adapter, type Ask } from "../types.ts";
import { type Endpoint } from "./endpoint.ts";
import { postJson } from "./json-client.ts";
import { stateData, wireName, type Fetch, type QuestionSpec } from "./protocol.ts";
import { classifyErrorCausedBy, compile, read } from "./systemone.ts";
import { ATTEMPT_TIMEOUT_MS, MAX_RETRIES } from "./transport.ts";
import type { ClassifiedAnswer, Refusal } from "@jint/contract";

export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/decisions";
export const GEMINI_MODEL = "gemini-decision-1";
const PATH = "/v1beta/decisions";

const REPLY = Type.Object({
  answers: Type.Record(Type.String(), Type.Unknown()),
  usage: Type.Optional(Type.Object({ total_input_tokens: Type.Optional(Type.Number()) })),
});

function baseUrl({ url }: Endpoint): string {
  const bare = url.replace(/\/+$/, "");
  if (!bare.endsWith(PATH)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `url must end in ${PATH} (got ${url}) - set JINT_API_URL`,
    );
  }
  return bare.slice(0, -PATH.length);
}

/**
 * System One's questions under their wire names (Gemini takes only `[A-Za-z0-9_-]` ids, and a
 * rule's question name has spaces), with a noul's criteria under Gemini's names.
 */
function geminiQuestions(questions: Record<string, QuestionSpec>): Record<string, unknown> {
  const compiled = compile(questions) as Record<string, { type: string; criteria?: unknown }>;
  return Object.fromEntries(
    Object.values(compiled).map((q, i) => {
      if (q.type !== "noul" || q.criteria === undefined) return [wireName(i), q];
      const { true: yes, false: no } = q.criteria as { true?: string; false?: string };
      return [wireName(i), { ...q, criteria: { true_description: yes, false_description: no } }];
    }),
  );
}

export function geminiAdapter(
  endpoint: Endpoint,
  transport: {
    fetch: Fetch;
    log: (line: string) => void;
    limits?: { timeoutMs: number; maxRetries: number };
  },
): Adapter {
  const base = baseUrl(endpoint);
  const apiKey = endpoint.apiKey;
  if (apiKey === undefined)
    throw new SetupError("CONFIG_INVALID", endpoint.unusable ?? "no API key");
  const model = endpoint.model ?? GEMINI_MODEL;
  const limits = transport.limits ?? { timeoutMs: ATTEMPT_TIMEOUT_MS, maxRetries: MAX_RETRIES };
  return {
    async ask(ask: Ask, options) {
      let reply: unknown;
      try {
        reply = await postJson({
          fetch: transport.fetch,
          baseUrl: base,
          path: PATH,
          apiKey,
          keyHeader: "x-goog-api-key",
          body: {
            model,
            input: JSON.stringify(stateData(ask)),
            questions: geminiQuestions(ask.questions),
          },
          signal: options?.signal,
          timeoutMs: limits.timeoutMs,
          maxRetries: limits.maxRetries,
          log: (line) => transport.log(`provider backoff: ${line}`),
        });
      } catch (cause) {
        throw classifyErrorCausedBy(cause, ask.state.path);
      }
      if (!Value.Check(REPLY, reply)) {
        throw new ClassifyError(
          "PROVIDER_RESPONSE_INVALID",
          ask.state.path,
          `provider reply failed shape validation: expected { answers, usage }, got ${JSON.stringify(reply)?.slice(0, 200)}`,
        );
      }
      const answers: Record<string, ClassifiedAnswer | Refusal> = {};
      Object.entries(ask.questions).forEach(([name, spec], i) => {
        answers[name] = read(name, spec, reply.answers[wireName(i)], ask.state.path);
      });
      return {
        model,
        answers,
        usage: { ...EMPTY_USAGE, input_tokens: reply.usage?.total_input_tokens ?? 0 },
      };
    },
  };
}

const EMPTY_USAGE = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
