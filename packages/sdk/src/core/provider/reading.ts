/**
 * Reading a Decisions answer: what a reply's answer means for the question it answers. Pure and
 * free of the client, so the run view reads recorded replies with the same code the adapter reads
 * live ones.
 */

import { ClassifyError, type Ask } from "../types.ts";
import { wireName } from "./protocol.ts";
import type { QuestionSpec } from "./protocol.ts";
import type { ClassifiedAnswer, Refusal } from "@jint/contract";

/** The fallback option a choice is asked with; its mass is dropped from the reading. */
export const NONE = "none_of_these";

/** The shape of an answer the conversion reads: the client's typed answers, and the vercel route's. */
export type DecisionsAnswer = {
  type: string;
  name: string | null;
  choice?: string | boolean;
  probability?: number;
  probabilities?: { value: string | boolean | number; probability: number }[];
};

/**
 * The answer the rules read for one Decisions answer. A noul is its probability, a score the
 * expected level over its distribution, a choice the selected option's share once the fallback
 * option's mass is dropped and the rest renormalized.
 */
export function readAnswer(
  q: QuestionSpec,
  a: DecisionsAnswer,
): ClassifiedAnswer | Refusal | undefined {
  if (a.type === "refusal") return { refused: true };
  const shares: Record<string, number> = Object.fromEntries(
    (a.probabilities ?? []).map((o) => [String(o.value), o.probability]),
  );
  if (q.type === "noul") return { value: a.probability ?? 0 };
  if (q.type === "score") {
    const value = Object.entries(shares).reduce((sum, [level, p]) => sum + Number(level) * p, 0);
    return { value, probabilities: shares };
  }
  delete shares[NONE];
  const total = Object.values(shares).reduce((s, p) => s + p, 0);
  const options = Object.keys(shares);
  if (options.length === 0) return undefined;
  const probabilities = Object.fromEntries(
    options.map((o) => [o, total > 0 ? shares[o]! / total : 1 / options.length]),
  );
  const choice =
    a.choice !== undefined && String(a.choice) in probabilities
      ? String(a.choice)
      : options.reduce((b, o) => (probabilities[o]! > probabilities[b]! ? o : b));
  return { value: probabilities[choice] ?? 0, choice, probabilities };
}

/** The run view's answer shape for one Decisions answer (what the recorded `response` is read as). */
export function fromDecisions(q: QuestionSpec, a: DecisionsAnswer): unknown {
  const r = readAnswer(q, a) as ClassifiedAnswer | undefined;
  if (r === undefined) throw new Error("provider choice answer carries no options");
  if (q.type === "noul") return { type: "noul", noul: r.value };
  if (q.type === "score") {
    // the legend carries each level's text; the run view shows the levels from it
    const legend = Object.fromEntries(
      (q.criteria as readonly string[]).map((text, i) => [String(i), text]),
    );
    return { type: "score", score: r.value, legend, probabilities: r.probabilities };
  }
  return { type: "choice", choice: r.choice, probabilities: r.probabilities };
}

/**
 * Each question's answer from a reply's answers, found by wire name; a missing or wrong-shaped one
 * is a PROVIDER_RESPONSE_INVALID for the whole ask.
 */
export function readAnswers(
  ask: Ask,
  find: (wire: string) => DecisionsAnswer | undefined,
): Record<string, ClassifiedAnswer | Refusal> {
  const input = ask.state.path;
  const out: Record<string, ClassifiedAnswer | Refusal> = {};
  Object.entries(ask.questions).forEach(([name, spec], i) => {
    const a = find(wireName(i));
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

/** The token counts the model's own provider reports, as a gateway relays them. */
export type UpstreamUsage = {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};

/**
 * A gateway reply's `providerMetadata` is keyed by who produced each part: the gateway's own entry
 * (`gateway`, cost) and the model provider's (its name, usage). The model provider's name is data,
 * so this takes the first entry that is not the gateway's and carries usage.
 */
export function upstreamUsage(metadata: unknown): UpstreamUsage | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  for (const [name, entry] of Object.entries(metadata)) {
    if (name === "gateway" || typeof entry !== "object" || entry === null) continue;
    const usage = (entry as { usage?: unknown }).usage;
    if (typeof usage === "object" && usage !== null) return usage as UpstreamUsage;
  }
  return undefined;
}
