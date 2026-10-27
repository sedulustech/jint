/**
 * The recorded request file, read for the run view. Two forms exist on disk and one view model
 * leaves this module:
 *
 * - Legacy: a System One-shaped `request` ({state, questions: {id: {type, instructions, criteria}}})
 *   and `response` ({answers: {id: ...}}), with the bytes sent to the network beside them in
 *   `wire`.
 * - Decisions: the real exchange, `request` and `response` being the bodies of POST /v1/decisions (a
 *   `questions` ARRAY, an `answers` ARRAY matched by name), plus `questionIds` naming each question
 *   by position.
 * - Decision-model: the real exchange with the AI gateway's native endpoint: `request` holds
 *   `stateParts` (text parts) and `questions` keyed by wire name, `response.answers` is keyed the
 *   same, with `questionIds` naming each question by position.
 *
 * The forms tell apart by the request: `stateParts` marks decision-model, a `questions` ARRAY the
 * decisions form, anything else legacy.
 */

import { asDecisions, type NativeReply } from "../core/provider/decision-model.ts";
import { fromDecisions, NONE, type DecisionsAnswer } from "../core/provider/reading.ts";
import type { SystemOneQuestion } from "../core/provider/protocol.ts";

/**
 * The view model of one recorded classifier request file, as served by this module: one stable
 * shape over both recorded forms (see normalizeRequestFile).
 */
export interface RequestFile {
  ts?: string;
  url?: string;
  /** The state's id, recorded beside the request; older records carry it in request.state. */
  id?: string;
  /** Wire duration recorded by the sdk recorder; absent on records written before it existed. */
  durationMs?: number;
  status?: number;
  /**
   * The call as it reached the network (url redacted, no headers); absent on records written before
   * wire capture. For a call made through a provider's own client it is the record's own request
   * and response. `request` stays the System One-shaped view the run view reads.
   */
  wire?: { url?: string; body?: unknown; status?: number; response?: unknown };
  request?: {
    state?: Record<string, unknown>;
    questions?: Record<
      string,
      {
        type?: string;
        instructions?: string;
        criteria?:
          | { true?: string; false?: string }
          | Readonly<Record<string, string>>
          | readonly string[];
      }
    >;
    model?: string;
  };
  response?: {
    model?: string;
    answers?: Record<
      string,
      {
        type?: string;
        noul?: number;
        score?: number;
        legend?: Record<string, string>;
        probabilities?: Record<string, number>;
        choice?: string;
      }
    >;
    usage?: Record<string, number>;
  };
}

type DecisionsQuestion = {
  type?: string;
  name?: string;
  instructions?: string;
  levels?: { description?: string }[];
  choices?: { value?: unknown; description?: string }[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The state a decisions request judged: its input_json part, or a string input holding JSON. */
function stateOf(input: unknown): Obj {
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      return isObj(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!Array.isArray(input)) return {};
  for (const message of input) {
    const content = isObj(message) ? message.content : undefined;
    for (const part of Array.isArray(content) ? content : []) {
      if (isObj(part) && part.type === "input_json" && isObj(part.data)) return part.data;
    }
  }
  return {};
}

/** The System One-shaped question the run view reads for one decisions question. */
function questionOf(q: DecisionsQuestion): SystemOneQuestion {
  if (q.type === "score") {
    return {
      type: "score",
      instructions: q.instructions,
      criteria: (q.levels ?? []).map((l) => l.description ?? ""),
    };
  }
  if (q.type === "choice") {
    const options = (q.choices ?? []).filter((c) => c.value !== NONE);
    return {
      type: "choice",
      instructions: q.instructions,
      criteria: Object.fromEntries(options.map((c) => [String(c.value), c.description ?? ""])),
    };
  }
  // a predicate's Yes/No meaning is already folded into its instructions
  return { type: "noul", instructions: q.instructions };
}

type NativeQuestion = {
  type?: string;
  instructions?: string;
  criteria?: readonly string[] | Readonly<Record<string, string>>;
};

/** The state a decision-model request judged: its text parts, JSON joined back. */
function nativeState(parts: unknown): Obj {
  const text = (Array.isArray(parts) ? parts : [])
    .map((p) => (isObj(p) && typeof p.text === "string" ? p.text : ""))
    .join("");
  return stateOf(text);
}

/** The decision-model form to the view model: the questions and answers keyed by question id. */
function normalizeNative(raw: Obj, request: Obj): RequestFile {
  const response = isObj(raw.response) ? raw.response : {};
  const ids = Array.isArray(raw.questionIds) ? (raw.questionIds as string[]) : [];
  const received = isObj(response.answers) ? response.answers : {};
  const questions: Record<string, SystemOneQuestion> = {};
  const answers: Record<string, unknown> = {};
  Object.entries(isObj(request.questions) ? request.questions : {}).forEach(([wire, q], i) => {
    const asked = q as NativeQuestion;
    const key = ids[i] ?? wire;
    const question: SystemOneQuestion =
      asked.type === "score"
        ? { type: "score", instructions: asked.instructions, criteria: asked.criteria }
        : asked.type === "choice"
          ? {
              type: "choice",
              instructions: asked.instructions,
              criteria: Object.fromEntries(
                Object.entries(asked.criteria ?? {}).filter(([value]) => value !== NONE),
              ),
            }
          : { type: "noul", instructions: asked.instructions };
    questions[key] = question;
    const answer = received[wire] as NonNullable<NativeReply["answers"]>[string] | undefined;
    if (answer === undefined) return;
    answers[key] =
      answer.type === "refusal"
        ? { type: "refusal" }
        : fromDecisions(question, asDecisions(wire, answer));
  });
  const usage = isObj(response.usage) ? response.usage : undefined;
  const provider = (response as NativeReply).providerMetadata?.openai?.usage;
  return {
    ts: raw.ts as string | undefined,
    url: raw.url as string | undefined,
    id: raw.id as string | undefined,
    durationMs: raw.durationMs as number | undefined,
    status: raw.status as number | undefined,
    wire: {
      url: raw.url as string | undefined,
      body: raw.request,
      status: raw.status as number | undefined,
      response: raw.response,
    },
    request: {
      state: nativeState(request.stateParts),
      questions: questions as NonNullable<RequestFile["request"]>["questions"],
      model: undefined,
    },
    response: {
      model: response.model as string | undefined,
      answers: answers as NonNullable<RequestFile["response"]>["answers"],
      usage:
        usage === undefined && provider === undefined
          ? undefined
          : {
              input_tokens: Number(usage?.inputTokens ?? provider?.input_tokens ?? 0),
              output_tokens: Number(usage?.outputTokens ?? 0),
              cached_input_tokens: Number(provider?.input_tokens_details?.cached_tokens ?? 0),
            },
    },
  };
}

/** One recorded file of any form to the view model; anything unrecognized passes as legacy. */
export function normalizeRequestFile(raw: unknown): RequestFile {
  if (isObj(raw) && isObj(raw.request) && Array.isArray(raw.request.stateParts)) {
    return normalizeNative(raw, raw.request);
  }
  if (!isObj(raw) || !isObj(raw.request) || !Array.isArray(raw.request.questions)) {
    return raw as RequestFile;
  }
  const request = raw.request;
  const response = isObj(raw.response) ? raw.response : {};
  const asked = request.questions as DecisionsQuestion[];
  const ids = Array.isArray(raw.questionIds) ? (raw.questionIds as string[]) : [];
  const keyOf = (q: DecisionsQuestion, i: number): string => ids[i] ?? q.name ?? `q${i}`;
  const received = (Array.isArray(response.answers) ? response.answers : []) as DecisionsAnswer[];
  const questions: Record<string, SystemOneQuestion> = {};
  const answers: Record<string, unknown> = {};
  asked.forEach((q, i) => {
    const key = keyOf(q, i);
    const question = questionOf(q);
    questions[key] = question;
    const answer = received.find((a) => a.name === q.name);
    if (answer === undefined) return;
    answers[key] =
      answer.type === "refusal" ? { type: "refusal" } : fromDecisions(question, answer);
  });
  const usage = isObj(response.usage) ? response.usage : undefined;
  const details = isObj(usage?.input_tokens_details) ? usage.input_tokens_details : undefined;
  return {
    ts: raw.ts as string | undefined,
    url: raw.url as string | undefined,
    id: raw.id as string | undefined,
    durationMs: raw.durationMs as number | undefined,
    status: raw.status as number | undefined,
    wire: {
      url: raw.url as string | undefined,
      body: raw.request,
      status: raw.status as number | undefined,
      response: raw.response,
    },
    request: {
      state: stateOf(request.input),
      questions: questions as NonNullable<RequestFile["request"]>["questions"],
      model: request.model as string | undefined,
    },
    response: {
      model: response.model as string | undefined,
      answers: answers as NonNullable<RequestFile["response"]>["answers"],
      usage:
        usage === undefined
          ? undefined
          : {
              input_tokens: Number(usage.input_tokens ?? 0),
              output_tokens: Number(usage.output_tokens ?? 0),
              cached_input_tokens: Number(details?.cached_tokens ?? 0),
            },
    },
  };
}
