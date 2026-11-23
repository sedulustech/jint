/**
 * The recorded request file, read for the run view. Two forms exist on disk and one view model
 * leaves this module:
 *
 * - Legacy: a System One-shaped `request` ({state, questions: {id: {type, instructions, criteria}}})
 *   and `response` ({answers: {id: ...}}), with the request body as sent beside them in `sent`
 *   (`wire` in runs recorded before the rename).
 * - Decisions: the real exchange, `request` and `response` being the bodies of POST /v1/decisions (a
 *   `questions` ARRAY, an `answers` ARRAY matched by name), plus `questionIds` naming each question
 *   by position.
 * - Decision-model: the real exchange with the AI gateway's native endpoint: `request` holds
 *   `stateParts` (text parts) and `questions` keyed by question key, `response.answers` is keyed
 *   the same, with `questionIds` naming each question by position.
 *
 * The forms tell apart by the request: `stateParts` marks decision-model, a `questions` ARRAY the
 * decisions form, anything else legacy.
 */

import { unfoldCriteria, type QuestionSpec } from "../core/provider/protocol.ts";
import {
  fromDecisions,
  NONE,
  upstreamUsage,
  type DecisionsAnswer,
} from "../core/provider/reading.ts";

/** A recorded reply of the gateway's decision-model shape (old recordings only; no live adapter). */
type NativeReply = {
  model?: string;
  answers?: Record<
    string,
    { type: string; choice?: string; probability?: number; probabilities?: Record<string, number> }
  >;
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: {
    gateway?: { cost?: string | number };
    [modelProvider: string]: unknown;
  };
};

/** A native answer in the Decisions shape: the probabilities map becomes a value/probability list. */
const asDecisions = (
  name: string,
  a: NonNullable<NativeReply["answers"]>[string],
): DecisionsAnswer => ({
  ...a,
  name,
  probabilities: Object.entries(a.probabilities ?? {}).map(([value, probability]) => ({
    value,
    probability,
  })),
});

/**
 * The view model of one recorded classifier request file, as served by this module: one stable
 * shape over both recorded forms (see normalizeRequestFile).
 */
export interface RequestFile {
  ts?: string;
  url?: string;
  /** The state's id, recorded beside the request; older records carry it in request.state. */
  id?: string;
  /**
   * The file the call judged, recorded beside the request: the request body carries a path only for
   * a rule that includes it, and the run view joins requests to readings by path.
   */
  path?: string;
  /** Whether the call judged elements or files; absent on records written before it was recorded. */
  kind?: "elements" | "files";
  /** Latency recorded by the sdk recorder; absent on records written before it existed. */
  durationMs?: number;
  status?: number;
  /**
   * The call as it reached the network (url redacted, no headers); absent on records written before
   * request bodies were captured. For a call made through a provider's own client it is the
   * record's own request and response. `request` stays the System One-shaped view the run view
   * reads.
   */
  sent?: { url?: string; body?: unknown; status?: number; response?: unknown };
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
        confidence?: number;
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
function questionOf(q: DecisionsQuestion): QuestionSpec {
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
  return noulOf(q.instructions);
}

/**
 * The view model's yes/no question for a predicate's text in the request body: its Yes/No meaning
 * is folded into its instructions in the request body (both forms), and the view shows the two
 * apart.
 */
function noulOf(text: string | undefined): QuestionSpec {
  const { instructions, criteria } = unfoldCriteria(text ?? "");
  return criteria === undefined
    ? { type: "noul", instructions }
    : { type: "noul", instructions, criteria };
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
  const questions: Record<string, QuestionSpec> = {};
  const answers: Record<string, unknown> = {};
  Object.entries(isObj(request.questions) ? request.questions : {}).forEach(([key, q], i) => {
    const asked = q as NativeQuestion;
    const id = ids[i] ?? key;
    const question: QuestionSpec =
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
          : noulOf(asked.instructions);
    questions[id] = question;
    const answer = received[key] as NonNullable<NativeReply["answers"]>[string] | undefined;
    if (answer === undefined) return;
    answers[id] =
      answer.type === "refusal"
        ? { type: "refusal" }
        : fromDecisions(question, asDecisions(key, answer));
  });
  const usage = isObj(response.usage) ? response.usage : undefined;
  const provider = upstreamUsage((response as NativeReply).providerMetadata);
  return {
    ...recordedFacts(raw),
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

/** A run file's request body as sent, under `sent`: the key `wire` is an alias that reads the same. */
export function withSentBody<T>(raw: T): T {
  if (!isObj(raw) || !("wire" in raw) || "sent" in raw) return raw;
  const { wire, ...rest } = raw;
  return { ...rest, sent: wire } as T;
}

/** A file in neither the decision-model nor the decisions form is read as legacy. */
export function normalizeRequestFile(raw: unknown): RequestFile {
  if (isObj(raw) && isObj(raw.request) && Array.isArray(raw.request.stateParts)) {
    return normalizeNative(raw, raw.request);
  }
  if (isObj(raw) && isObj(raw.request) && Array.isArray(raw.request.questions)) {
    return normalizeDecisions(raw, raw.request);
  }
  return withSentBody(raw) as RequestFile;
}

function recordedFacts(raw: Record<string, unknown>): Omit<RequestFile, "request" | "response"> {
  const url = raw.url as string | undefined;
  const status = raw.status as number | undefined;
  return {
    ts: raw.ts as string | undefined,
    url,
    id: raw.id as string | undefined,
    path: raw.path as string | undefined,
    kind: raw.kind as RequestFile["kind"],
    durationMs: raw.durationMs as number | undefined,
    status,
    sent: { url, body: raw.request, status, response: raw.response },
  };
}

/** The questions a decisions request asked and the answers it got, both keyed by question id. */
function decisionsReadings(
  asked: DecisionsQuestion[],
  received: DecisionsAnswer[],
  ids: string[],
): { questions: Record<string, QuestionSpec>; answers: Record<string, unknown> } {
  const questions: Record<string, QuestionSpec> = {};
  const answers: Record<string, unknown> = {};
  asked.forEach((q, i) => {
    const key = ids[i] ?? q.name ?? `q${i}`;
    const question = questionOf(q);
    questions[key] = question;
    const answer = received.find((a) => a.name === q.name);
    if (answer === undefined) return;
    answers[key] =
      answer.type === "refusal" ? { type: "refusal" } : fromDecisions(question, answer);
  });
  return { questions, answers };
}

function decisionsUsage(usage: unknown): NonNullable<RequestFile["response"]>["usage"] {
  if (!isObj(usage)) return undefined;
  const details = isObj(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
  return {
    input_tokens: Number(usage.input_tokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? 0),
    cached_input_tokens: Number(details?.cached_tokens ?? 0),
  };
}

function normalizeDecisions(
  raw: Record<string, unknown>,
  request: Record<string, unknown>,
): RequestFile {
  const response = isObj(raw.response) ? raw.response : {};
  const { questions, answers } = decisionsReadings(
    request.questions as DecisionsQuestion[],
    (Array.isArray(response.answers) ? response.answers : []) as DecisionsAnswer[],
    Array.isArray(raw.questionIds) ? (raw.questionIds as string[]) : [],
  );
  return {
    ...recordedFacts(raw),
    request: {
      state: stateOf(request.input),
      questions: questions as NonNullable<RequestFile["request"]>["questions"],
      model: request.model as string | undefined,
    },
    response: {
      model: response.model as string | undefined,
      answers: answers as NonNullable<RequestFile["response"]>["answers"],
      usage: decisionsUsage(response.usage),
    },
  };
}
