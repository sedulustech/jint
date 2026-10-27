/**
 * The `decision-model` protocol: the AI gateway's native POST /v4/ai/decision-model. The same
 * questions as `decisions`, in the V4 decision-model format: the state as text parts and the
 * questions as a map keyed by wire name. It is used instead of the gateway's OpenAI-compatible
 * Decisions endpoint, which rewrites score level descriptions.
 *
 * Question translation and answer normalization are the `decisions` protocol's: only the envelope
 * differs. Replies carry probabilities as a map and usage under usage / providerMetadata.
 */

import { toDecisions, answersByName, type DecisionsAnswer } from "./decisions.ts";
import { wireName, type Answered, type Protocol, type Usage } from "./protocol.ts";

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

type NativeReply = {
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
const asDecisions = (
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

export const decisionModel: Protocol = {
  request: (ask) => ({
    headers: {
      "ai-gateway-protocol-version": "0.0.1",
      "ai-decision-model-specification-version": "4",
      "ai-model-id": ask.model,
    },
    body: {
      stateParts: [{ type: "text", text: ask.input }],
      questions: Object.fromEntries(
        Object.keys(ask.questions).map((name, i) => [
          wireName(i),
          toNative(toDecisions(wireName(i), ask.questions[name]!)),
        ]),
      ),
    },
  }),
  reply(raw, ask): Answered {
    const reply = raw as NativeReply;
    const openai = reply.providerMetadata?.openai?.usage;
    const rawCost = reply.providerMetadata?.gateway?.cost;
    const cost = rawCost === undefined || rawCost === null ? NaN : Number(rawCost);
    const usage: Usage = {
      input_tokens: reply.usage?.inputTokens ?? openai?.input_tokens ?? 0,
      output_tokens: reply.usage?.outputTokens ?? 0,
      cached_input_tokens: openai?.input_tokens_details?.cached_tokens ?? 0,
    };
    if (Number.isFinite(cost)) usage.gateway_cost = cost;
    return {
      model: reply.model,
      answers: answersByName(ask, (wire) => {
        const a = reply.answers?.[wire];
        return a === undefined ? undefined : asDecisions(wire, a);
      }),
      usage,
    };
  },
};
