/**
 * The `decisions` protocol: OpenAI's POST /v1/decisions. Each System One request is translated into
 * the Decisions format and each reply back.
 *
 * A noul is asked as a predicate, the API's yes/no form. A predicate has no criteria field, so a
 * noul's criteria are folded into its question as what a yes and a no mean. A choice gets a
 * fallback option the API needs when none fits; its mass is dropped and the rest renormalized. A
 * score level is labelled by its index. A refused question keeps its place as a refusal, so only
 * its own rule loses the reading.
 */

import {
  wireName,
  type Ask,
  type Answered,
  type Protocol,
  type SystemOneQuestion,
} from "./protocol.ts";

const NONE = "none_of_these";

export type DecisionsAnswer = {
  type: string;
  name: string;
  choice?: string;
  probability?: number;
  probabilities?: { value: string; probability: number }[];
};

/** The Decisions question for one System One question, under a wire-safe name. */
export function toDecisions(name: string, q: SystemOneQuestion): Record<string, unknown> {
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
    (a.probabilities ?? []).map((o) => [o.value, o.probability]),
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
    a.choice !== undefined && a.choice in spread
      ? a.choice
      : options.reduce((b, o) => (spread[o]! > spread[b]! ? o : b));
  return { type: "choice", choice, probabilities: spread };
}

type DecisionsReply = {
  model?: string;
  answers?: DecisionsAnswer[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
};

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

export const decisions: Protocol = {
  request: (ask) => ({
    headers: {},
    body: {
      model: ask.model,
      input: ask.input,
      questions: Object.keys(ask.questions).map((name, i) =>
        toDecisions(wireName(i), ask.questions[name]!),
      ),
    },
  }),
  reply(raw, ask): Answered {
    const reply = raw as DecisionsReply;
    const byName = new Map((reply.answers ?? []).map((a) => [a.name, a]));
    return {
      model: reply.model,
      answers: answersByName(ask, (wire) => byName.get(wire)),
      usage: {
        input_tokens: reply.usage?.input_tokens ?? 0,
        output_tokens: reply.usage?.output_tokens ?? 0,
        cached_input_tokens: reply.usage?.input_tokens_details?.cached_tokens ?? 0,
      },
    };
  },
};
