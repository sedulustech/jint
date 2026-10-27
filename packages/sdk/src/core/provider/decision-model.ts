/**
 * The `decision-model` protocol: the AI gateway's native POST /v4/ai/decision-model, called with
 * plain fetch. The same questions as `decisions`, in the V4 decision-model format: the state as
 * text parts and the questions as a map keyed by wire name. It is used instead of the gateway's
 * OpenAI-compatible Decisions endpoint, which rewrites score level descriptions.
 *
 * Question translation and answer reading are the `decisions` protocol's: only the envelope
 * differs. Replies carry probabilities as a map and usage under usage / providerMetadata.
 */

import { SetupError, type Adapter, type Ask, type Asked } from "../types.ts";
import { toDecisions, type DecisionsAnswer } from "./decisions.ts";
import { wireName, type Fetch, type Usage } from "./protocol.ts";
import { readAnswers } from "./reading.ts";
import { ATTEMPT_TIMEOUT_MS, MAX_RETRIES, postJson, type Limits } from "./transport.ts";
import type { ResolvedProvider } from "./providers.ts";

type NativeQuestion =
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "boolean"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

/** The V4 question for one Decisions-shaped question. */
function toNative(q: ReturnType<typeof toDecisions>): NativeQuestion {
  const instructions = String(q.instructions);
  if (q.type === "score") {
    return { type: "score", instructions, criteria: q.levels.map((l) => l.description ?? "") };
  }
  if (q.type === "predicate") return { type: "boolean", instructions };
  return {
    type: "choice",
    instructions,
    criteria: Object.fromEntries(q.choices.map((c) => [String(c.value), c.description ?? ""])),
  };
}

export type NativeReply = {
  model?: string;
  answers?: Record<
    string,
    { type: string; choice?: string; probability?: number; probabilities?: Record<string, number> }
  >;
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: {
    openai?: {
      usage?: { input_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    };
    gateway?: { cost?: string | number };
  };
};

/** A native answer in the Decisions shape: the probabilities map becomes a value/probability list. */
export const asDecisions = (
  name: string,
  a: NonNullable<NativeReply["answers"]>[string],
): DecisionsAnswer => ({
  ...a,
  name,
  probabilities: Object.entries(a.probabilities ?? {}).map(([value, probability]) => ({
    value,
    probability,
  })),
});

/** The headers the wire format requires, beside the provider's own and the key. */
const wireHeaders = (model: string): Record<string, string> => ({
  "ai-gateway-protocol-version": "0.0.1",
  "ai-decision-model-specification-version": "4",
  "ai-model-id": model,
});

/** The decision-model request body for one ask: the state as one text part, questions by wire name. */
export function decisionModelBody(ask: Ask): unknown {
  return {
    stateParts: [{ type: "text", text: JSON.stringify(ask.state) }],
    questions: Object.fromEntries(
      Object.keys(ask.questions).map((name, i) => [
        wireName(i),
        toNative(toDecisions(wireName(i), ask.questions[name]!)),
      ]),
    ),
  };
}

/** What a reply used: the gateway's counts, falling back to the model provider's own. */
function usageOf(reply: NativeReply): Usage {
  const openai = reply.providerMetadata?.openai?.usage;
  const rawCost = reply.providerMetadata?.gateway?.cost;
  const cost = rawCost === undefined || rawCost === null ? NaN : Number(rawCost);
  const usage: Usage = {
    input_tokens: reply.usage?.inputTokens ?? openai?.input_tokens ?? 0,
    output_tokens: reply.usage?.outputTokens ?? 0,
    cached_input_tokens: openai?.input_tokens_details?.cached_tokens ?? 0,
  };
  if (Number.isFinite(cost)) usage.gateway_cost = cost;
  return usage;
}

/**
 * The adapter for a provider speaking the `decision-model` protocol, called with plain fetch. The
 * answers carry no confidence: the gateway returns none. `fetch` is the transport (the recorder
 * sits there); retry, the per-attempt timeout and error mapping are transport.ts's.
 */
export function decisionModelAdapter(
  provider: ResolvedProvider,
  transport: { fetch: Fetch; log: (line: string) => void; limits?: Limits },
): Adapter {
  const apiKey = provider.apiKey;
  if (apiKey === undefined)
    throw new SetupError("CONFIG_INVALID", `no ${provider.spec.keyEnv} set`);
  const limits = transport.limits ?? { timeoutMs: ATTEMPT_TIMEOUT_MS, maxRetries: MAX_RETRIES };
  return {
    async ask(ask, options): Promise<Asked> {
      const raw = await postJson(
        { ...transport, limits, input: ask.state.path, signal: options?.signal },
        provider.spec.url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...wireHeaders(provider.model),
            ...provider.spec.headers,
          },
          body: JSON.stringify(decisionModelBody(ask)),
        },
      );
      const reply = (typeof raw === "object" && raw !== null ? raw : {}) as NativeReply;
      return {
        model: reply.model ?? provider.model,
        answers: readAnswers(ask, (wire) => {
          const a = reply.answers?.[wire];
          return a === undefined ? undefined : asDecisions(wire, a);
        }),
        usage: usageOf(reply),
      };
    },
  };
}
