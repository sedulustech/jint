/**
 * What the protocol adapters share: the question shape the rules write (System One's, kept as the
 * lingua franca of the questions), the fetch they run on, and the wire name of a question. A
 * protocol's adapter knows its wire format and nothing about who serves it: where, with which key
 * and which headers is the provider table's data (providers.ts), never a branch here.
 */

import type { Usage } from "../types.ts";

export type { Usage };

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One System One question, as the vendor SDK serializes it. */
export type SystemOneQuestion = {
  type: "noul" | "choice" | "score";
  instructions: unknown;
  criteria?: Readonly<Record<string, string>> | readonly string[];
};

/** The wire name of the i-th question: rule names carry spaces and ranges, the wire gets positions. */
export const wireName = (i: number): string => `q${i}`;
