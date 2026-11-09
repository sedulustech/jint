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

/**
 * The state with its content's final line break removed. The decision model's reading moves with a
 * single trailing newline (up to 0.2 on Luna, measured on this repo), so a file saved with one and
 * the same file saved without must be the same request. Only the final line breaks go; the rest of
 * the content, trailing spaces included, reaches the model as written.
 */
export function normalize<T extends object>(state: T): T {
  const content = (state as { content?: unknown }).content;
  if (typeof content !== "string") return state;
  return { ...state, content: content.replace(/(\r?\n)+$/, "") };
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
