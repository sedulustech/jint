/**
 * What the adapter and the run view share: the question shape the rules write, the fetch the
 * adapter runs on, and the wire name of a question. Where and with which key is data (endpoint.ts),
 * never a branch here.
 */

import type { Usage } from "../types.ts";

export type { Usage };

/**
 * The state as the judge reads it, on either wire. A rule that does not include the path
 * (includePath false) is asked without it, so the same code is the same request wherever the file
 * sits. A state that says nothing goes out as it is: a callback rule builds its own state and owns
 * what is in it. The flag itself never travels.
 */
export function stateData(ask: { state: object }): Record<string, unknown> {
  const { includePath, ...data } = ask.state as Record<string, unknown>;
  if (includePath === false) delete data.path;
  return data;
}

const FINAL_LINE_BREAKS = /(\r?\n)+$/;

/**
 * The state with the final line break of its content or source removed. A single trailing newline
 * moves the decision model's value by up to 0.2, so a file saved with one and the same file saved
 * without must be the same request. Only the final line breaks go; the rest of the text, trailing
 * spaces included, reaches the model as written.
 */
export function normalize<T extends object>(state: T): T {
  const text = state as { content?: unknown; source?: unknown };
  const out: Record<string, unknown> = { ...(state as Record<string, unknown>) };
  if (typeof text.content === "string") out.content = text.content.replace(FINAL_LINE_BREAKS, "");
  if (typeof text.source === "string") out.source = text.source.replace(FINAL_LINE_BREAKS, "");
  return out as T;
}

/**
 * A question with the whitespace around its instructions and each criterion removed. A trailing
 * space after a question mark moves the decision model's value by as much as 0.26, so a rule saved
 * with stray spaces and the same rule without must be the same request.
 */
export function normalizeQuestion<T extends QuestionSpec>(question: T): T {
  const out: Record<string, unknown> = { ...question };
  if (typeof question.instructions === "string") out.instructions = question.instructions.trim();
  const criteria = question.criteria;
  if (Array.isArray(criteria)) out.criteria = criteria.map((c) => c.trim());
  else if (criteria)
    out.criteria = Object.fromEntries(Object.entries(criteria).map(([k, v]) => [k, v.trim()]));
  return out as T;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

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

export const wireName = (i: number): string => `q${i}`;
