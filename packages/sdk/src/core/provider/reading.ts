/**
 * Reading a Decisions answer: what a reply's answer means for the question it answers. Pure and
 * free of the client, so the run view reads recorded replies with the same code the adapter reads
 * live ones.
 */

import type { SystemOneQuestion } from "./protocol.ts";
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
  q: SystemOneQuestion,
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

/** The System One answer for one Decisions answer (the vercel route's shape). */
export function fromDecisions(q: SystemOneQuestion, a: DecisionsAnswer): unknown {
  const r = readAnswer(q, a) as ClassifiedAnswer | undefined;
  if (r === undefined) throw new Error("provider choice answer carries no options");
  if (q.type === "noul") return { type: "noul", noul: r.value };
  if (q.type === "score") {
    // System One echoes each level's text as the legend; the run view shows the levels from it.
    const legend = Object.fromEntries(
      (q.criteria as readonly string[]).map((text, i) => [String(i), text]),
    );
    return { type: "score", score: r.value, legend, probabilities: r.probabilities };
  }
  return { type: "choice", choice: r.choice, probabilities: r.probabilities };
}
