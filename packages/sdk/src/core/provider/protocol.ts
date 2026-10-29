/**
 * What the adapter and the run view share: the question shape the rules write, the fetch the
 * adapter runs on, and the wire name of a question. Where and with which key is data (endpoint.ts),
 * never a branch here.
 */

import type { Usage } from "../types.ts";

export type { Usage };

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One question as a rule writes it: a type, the claim to judge, and what its answers mean. */
export type QuestionSpec = {
  type: "noul" | "choice" | "score";
  instructions: unknown;
  criteria?: Readonly<Record<string, string>> | readonly string[];
};

/**
 * A noul's question text on the wire: the Decisions API's predicate has no criteria field, so what
 * a yes and a no mean is folded into its instructions.
 */
export function foldCriteria(
  instructions: string,
  criteria: Readonly<Record<string, string>> = {},
): string {
  const meaning = [
    criteria.true && `Yes: ${criteria.true}`,
    criteria.false && `No: ${criteria.false}`,
  ].filter(Boolean);
  return meaning.length ? `${instructions}\n\n${meaning.join("\n")}` : instructions;
}

/**
 * The inverse of foldCriteria, for the run view: the instructions and the yes/no meaning a recorded
 * predicate carried. A text that was never folded comes back as its instructions alone.
 */
export function unfoldCriteria(text: string): {
  instructions: string;
  criteria?: { true?: string; false?: string };
} {
  const at = text.search(/\n\n(?:Yes|No): /);
  if (at < 0) return { instructions: text };
  const rest = text.slice(at + 2);
  const noAt = rest.lastIndexOf("\nNo: ");
  const criteria: { true?: string; false?: string } = {};
  if (rest.startsWith("Yes: ")) {
    criteria.true = rest.slice("Yes: ".length, noAt < 0 ? undefined : noAt);
    if (noAt >= 0) criteria.false = rest.slice(noAt + "\nNo: ".length);
  } else {
    criteria.false = rest.slice("No: ".length);
  }
  return { instructions: text.slice(0, at), criteria };
}

/** The wire name of the i-th question: rule names carry spaces and ranges, the wire gets positions. */
export const wireName = (i: number): string => `q${i}`;
