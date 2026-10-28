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

/** The wire name of the i-th question: rule names carry spaces and ranges, the wire gets positions. */
export const wireName = (i: number): string => `q${i}`;
