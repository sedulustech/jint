/**
 * OpenAI's Decisions API behind the System One client. The vendor SDK speaks System One only, so
 * this fetch translates each request into the Decisions format and each response back: the rest of
 * the adapter, the recorder and every reading stay in System One's shape.
 *
 * A noul is asked as a choice between its criteria, which is how System One reads one. A choice
 * gets a fallback option the API needs when none fits; its mass is dropped and the rest
 * renormalized. A score level is labelled by its index.
 */

/** Models served by the Decisions API rather than System One. */
export const isDecisionsModel = (model: string): boolean => model.startsWith("gpt-");

export const DECISIONS_URL = "https://api.openai.com/v1/decisions";

const NONE = "none_of_these";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type SystemOneQuestion = {
  type: "noul" | "choice" | "score";
  instructions: unknown;
  criteria?: Record<string, string> | string[];
};
type DecisionsAnswer = {
  type: string;
  name: string;
  choice?: string;
  probability?: number;
  probabilities?: { value: string; probability: number }[];
};

/** The Decisions question for one System One question, under a wire-safe name. */
function toDecisions(name: string, q: SystemOneQuestion): Record<string, unknown> {
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
    if (q.criteria === undefined) return { type: "predicate", name, instructions };
    const c = q.criteria as Record<string, string>;
    return {
      type: "choice",
      name,
      instructions,
      choices: [
        { value: "true", description: c.true ?? "true" },
        { value: "false", description: c.false ?? "false" },
      ],
    };
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
function fromDecisions(q: SystemOneQuestion, a: DecisionsAnswer): unknown {
  const shares: Record<string, number> = Object.fromEntries(
    (a.probabilities ?? []).map((o) => [o.value, o.probability]),
  );
  if (q.type === "noul")
    return { type: "noul", noul: a.type === "predicate" ? a.probability : (shares.true ?? 0) };
  if (q.type === "score") {
    const score = Object.entries(shares).reduce((sum, [level, p]) => sum + Number(level) * p, 0);
    return {
      type: "score",
      score,
      probabilities: shares,
      confidence: Math.max(...Object.values(shares)),
    };
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
  return { type: "choice", choice, probabilities: spread, confidence: spread[choice] };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that takes System One requests and answers them through the Decisions API. */
export function decisionsFetch(base: Fetch = (input, init) => fetch(input, init)): Fetch {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      model: string;
      state: unknown;
      questions: Record<string, SystemOneQuestion>;
    };
    // Rule question names carry spaces and ranges ("rule in L1-L9"); the wire gets positional names.
    const names = Object.keys(request.questions);
    const body = {
      model: request.model,
      input: typeof request.state === "string" ? request.state : JSON.stringify(request.state),
      questions: names.map((name, i) => toDecisions(`q${i}`, request.questions[name]!)),
    };
    const headers = new Headers(init?.headers);
    const response = await base(DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: headers.get("Authorization") ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: init?.signal,
    });
    // Errors pass through with their status, so the vendor client retries and maps them as usual.
    if (!response.ok) return response;
    const reply = (await response.json()) as {
      model?: string;
      answers?: DecisionsAnswer[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
    };
    const byName = new Map((reply.answers ?? []).map((a) => [a.name, a]));
    // A refused question keeps its place as a refusal, so only its own rule loses the reading: the
    // model refuses a score none of whose levels fits (complexity of a plain data object).
    const answers = Object.fromEntries(
      names.map((name, i) => {
        const a = byName.get(`q${i}`);
        if (a?.type === "refusal") return [name, { type: "refusal" }];
        return [name, a === undefined ? undefined : fromDecisions(request.questions[name]!, a)];
      }),
    );
    return json(200, {
      model: reply.model ?? request.model,
      answers,
      usage: {
        input_tokens: reply.usage?.input_tokens ?? 0,
        output_tokens: reply.usage?.output_tokens ?? 0,
        cached_input_tokens: reply.usage?.input_tokens_details?.cached_tokens ?? 0,
      },
    });
  };
}
