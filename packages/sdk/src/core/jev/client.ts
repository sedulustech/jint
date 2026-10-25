/**
 * The jev adapter — the only file that imports the vendor SDK. This is the swappable-backend seam:
 * the lint pipeline accepts any classifier, tests fake it.
 *
 * Vendor transport failures map onto the project's error taxonomy exactly once, here: auth failures
 * fail loud at the first call (never at import), rejected requests, rate limits and outages surface
 * as unavailability, and a wrong-shaped answer is a response-invalid error. No vendor error type
 * escapes past this seam.
 *
 * The model classifies: one batched call per state, one structured question per rule, each answer a
 * single calibrated probability.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  UnprocessableEntityError,
  choice,
  noul,
  score,
  type ChoiceQuestion,
  type EntryType,
  type NoulQuestion,
  type ScoreQuestion,
  type SystemOneResult,
  type Questions,
} from "@typesafe-ai/sdk";
import { ClassifyError, type Classifier, type QuestionSchema } from "../types.ts";
import { recordRequests } from "./debug.ts";
import { decisionsFetch, isDecisionsModel } from "./decisions.ts";
import type { ClassifiedAnswer } from "@jint/contract";

/** The noul answer boundary: exactly one calibrated probability per question. */
const NOUL_ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("noul"),
  noul: Type.Number({ minimum: 0, maximum: 1 }),
});

/**
 * The score answer boundary: the expected score of the ordered rubric (may fall between levels),
 * plus the distribution it summarizes — every Score answer carries per-level probabilities and a
 * confidence (docs.typesafe.ai/primitives/score.md), required on the wire.
 */
const SCORE_ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("score"),
  score: Type.Number(),
  probabilities: Type.Record(Type.String(), Type.Number()),
  confidence: Type.Number(),
});

/**
 * The choice answer boundary: the selected option's label, its confidence, and the probability of
 * every option (keyed by label) - required on the wire.
 */
const CHOICE_ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("choice"),
  choice: Type.String(),
  probabilities: Type.Record(Type.String(), Type.Number()),
  confidence: Type.Number(),
});

/** The expected answer shape per question type, named in a shape-validation error. */
const ANSWER_SHAPES = {
  noul: { schema: NOUL_ANSWER_SCHEMA, text: '{ type: "noul", noul: number 0..1 }' },
  score: {
    schema: SCORE_ANSWER_SCHEMA,
    text: '{ type: "score", score, probabilities, confidence }',
  },
  choice: {
    schema: CHOICE_ANSWER_SCHEMA,
    text: '{ type: "choice", choice, probabilities, confidence }',
  },
} as const;

export interface ClassifierConfig {
  /** Overrides the environment key; tests inject a fake transport instead. */
  apiKey?: string;
  baseURL?: string;
  /**
   * The model id; defaults to $JINT_MODEL, then the pinned jev release. A Decisions model (gpt-*)
   * is asked through OpenAI's Decisions API with $OPENAI_API_KEY.
   */
  model?: string;
  /** Custom fetch for tests (structurally the vendor client's fetch). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * The transport log sink (vendor backoff/warn/error visibility): one UNPREFIXED line per event.
   * The SDK never writes a tool prefix — that is the client's voice, added at its write site.
   * Default writes bare lines to stderr.
   */
  log?: (line: string) => void;
}

export function createClassifier(config?: ClassifierConfig): Classifier {
  let client: TypeSafeClient | null = null;
  return async (state, questions) => {
    if (client === null) client = makeClient(recordRequests(routeModel(config)), state.path);
    const sdkQuestions = compileQuestions(questions);
    let result: SystemOneResult<typeof sdkQuestions>;
    try {
      result = await client.systemOne({
        state: state as unknown as EntryType,
        questions: sdkQuestions,
      });
    } catch (e) {
      throw mapTransportError(e, state.path);
    }
    return extractAnswers(result, questions, state.path);
  };
}

/**
 * The pinned jev release. The `jev-latest` alias moves when a new release ships, so readings, and
 * every threshold calibrated against them, would change without a change here.
 */
export const JEV_MODEL = "jev-1.13.0";

/** The model a run asks: the config's, else $JINT_MODEL, else the pinned jev release. */
export const resolveModel = (model?: string): string =>
  model ?? process.env.JINT_MODEL ?? JEV_MODEL;

/** A Decisions model swaps in the translating fetch and OpenAI's key; System One goes as is. */
function routeModel(config: ClassifierConfig | undefined): ClassifierConfig {
  const model = resolveModel(config?.model);
  if (!isDecisionsModel(model)) return { ...config, model };
  return {
    ...config,
    model,
    apiKey: config?.apiKey ?? process.env.OPENAI_API_KEY,
    fetch: decisionsFetch(config?.fetch),
  };
}

function makeClient(config: ClassifierConfig | undefined, input: string): TypeSafeClient {
  const writeLog = config?.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  try {
    return new TypeSafeClient({
      apiKey: config?.apiKey,
      baseURL: config?.baseURL,
      defaultModel: config?.model ?? JEV_MODEL,
      fetch: config?.fetch,
      // Surface the vendor retry layer: the SDK logs "retrying in Xms (retry n/N) after reason"
      // at info, invisible under its warn default. Route those lines to the log sink so a 429
      // backoff is visible in the CLI (one line per retry; nothing when the API is healthy).
      // Lines are UNPREFIXED - the sink's owner adds the tool prefix.
      logLevel: "info",
      logger: {
        debug: () => {},
        info: (message, ...args) => {
          if (message.includes("retrying in")) {
            writeLog(`jev backoff: ${message} ${args.join(" ")}`);
          }
        },
        warn: (message, ...args) => writeLog(`jev warn: ${message} ${args.join(" ")}`),
        error: (message, ...args) => writeLog(`jev error: ${message} ${args.join(" ")}`),
      },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ClassifyError(
      "JEV_AUTH",
      input,
      `jev unavailable at startup: ${detail} — set TYPESAFE_API_KEY to a valid key`,
      { cause: e },
    );
  }
}

function compileQuestions(questions: Record<string, QuestionSchema>): Questions {
  const out: Record<string, NoulQuestion | ScoreQuestion | ChoiceQuestion> = {};
  for (const [name, spec] of Object.entries(questions)) {
    // instructions is the {unitId: task} map; the SDK's EntryType accepts JSON objects.
    if (spec.type === "score") out[name] = score(spec.instructions, spec.criteria);
    else if (spec.type === "choice") out[name] = choice(spec.instructions, spec.criteria);
    else out[name] = noul(spec.instructions, spec.criteria);
  }
  return out;
}

function extractAnswers(
  result: SystemOneResult<Questions>,
  questions: Record<string, QuestionSchema>,
  input: string,
): Record<string, ClassifiedAnswer> {
  const out: Record<string, ClassifiedAnswer> = {};
  for (const [name, spec] of Object.entries(questions)) {
    const answer: unknown = result.answers[name];
    const shape = ANSWER_SHAPES[spec.type];
    if (!Value.Check(shape.schema, answer)) {
      throw new ClassifyError(
        "JEV_RESPONSE_INVALID",
        input,
        `jev answer '${name}' failed shape validation: expected ${shape.text}, got ${JSON.stringify(answer)}`,
      );
    }
    if (spec.type === "score") {
      const s = answer as Static<typeof SCORE_ANSWER_SCHEMA>;
      out[name] = { value: s.score, probabilities: s.probabilities, confidence: s.confidence };
    } else if (spec.type === "choice") {
      // the value is the selected option's probability; the label carries the verdict
      const c = answer as Static<typeof CHOICE_ANSWER_SCHEMA>;
      out[name] = {
        value: c.probabilities[c.choice] ?? c.confidence,
        choice: c.choice,
        probabilities: c.probabilities,
        confidence: c.confidence,
      };
    } else {
      out[name] = { value: (answer as Static<typeof NOUL_ANSWER_SCHEMA>).noul };
    }
  }
  return out;
}

function mapTransportError(e: unknown, input: string): ClassifyError {
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
    return new ClassifyError("JEV_AUTH", input, `jev rejected the API key: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof BadRequestError || e instanceof UnprocessableEntityError) {
    return new ClassifyError(
      "JEV_REQUEST_INVALID",
      input,
      `jev rejected the request: ${e.message}`,
      {
        cause: e,
      },
    );
  }
  if (e instanceof RateLimitError || e instanceof InternalServerError || e instanceof APIError) {
    return new ClassifyError("JEV_UNAVAILABLE", input, `jev unavailable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof APIConnectionError) {
    return new ClassifyError("JEV_UNAVAILABLE", input, `jev unreachable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof TypeSafeError) {
    return new ClassifyError("JEV_UNAVAILABLE", input, `jev call failed: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof Error) {
    return new ClassifyError("INTERNAL", input, `unexpected jev transport error: ${e.message}`, {
      cause: e,
    });
  }
  return new ClassifyError("INTERNAL", input, `unexpected jev transport error: ${String(e)}`, {
    cause: e,
  });
}
