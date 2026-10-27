/**
 * The protocol seam: one adapter per wire format, behind one small interface. The vendor SDK speaks
 * System One only, so a protocol adapter translates each System One request into its wire format
 * and each reply back; the rest of the adapter, the recorder and every reading stay in System One's
 * shape.
 *
 * An adapter knows its wire format and nothing about who serves it: where, with which key and which
 * headers is the provider table's data (providers.ts), never a branch here.
 */

import type { Usage } from "../types.ts";
import type { ProviderSpec } from "./providers.ts";

export type { Usage };

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One System One question, as the vendor SDK serializes it. */
export type SystemOneQuestion = {
  type: "noul" | "choice" | "score";
  instructions: unknown;
  criteria?: Readonly<Record<string, string>> | readonly string[];
};

export interface WireAsk {
  model: string;
  /** The state, serialized: exactly what the model judges. */
  input: string;
  questions: Record<string, SystemOneQuestion>;
}

export interface Answered {
  model?: string;
  /** Per question name, in System One's answer shape; a refused question is `{ type: "refusal" }`. */
  answers: Record<string, unknown>;
  usage: Usage;
}

export interface Protocol {
  /** The request body and the headers the wire format itself requires. */
  request(ask: WireAsk): { headers: Record<string, string>; body: unknown };
  /** The reply, parsed into answers and usage. */
  reply(raw: unknown, ask: WireAsk): Answered;
}

/** The wire name of the i-th question: rule names carry spaces and ranges, the wire gets positions. */
export const wireName = (i: number): string => `q${i}`;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * A fetch that takes System One requests and answers them through the given protocol, posting to
 * the provider's url with its headers. Errors pass through with their status, so the vendor client
 * retries and maps them as usual.
 */
export function protocolFetch(
  protocol: Protocol,
  spec: Pick<ProviderSpec, "url" | "headers">,
  base: Fetch = (input, init) => fetch(input, init),
): Fetch {
  return async (_input, init) => {
    const sent = JSON.parse(String(init?.body)) as {
      model: string;
      state: unknown;
      questions: Record<string, SystemOneQuestion>;
    };
    const ask: WireAsk = {
      model: sent.model,
      input: typeof sent.state === "string" ? sent.state : JSON.stringify(sent.state),
      questions: sent.questions,
    };
    const wire = protocol.request(ask);
    const response = await base(spec.url, {
      method: "POST",
      headers: {
        Authorization: new Headers(init?.headers).get("Authorization") ?? "",
        "Content-Type": "application/json",
        ...wire.headers,
        ...spec.headers,
      },
      body: JSON.stringify(wire.body),
      signal: init?.signal,
    });
    if (!response.ok) return response;
    const answered = protocol.reply(await response.json(), ask);
    return json(200, {
      model: answered.model ?? sent.model,
      answers: answered.answers,
      usage: answered.usage,
    });
  };
}
