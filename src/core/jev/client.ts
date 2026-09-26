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
  noul,
  score,
  type EntryType,
  type NoulQuestion,
  type ScoreQuestion,
  type SystemOneResult,
  type Questions,
} from "@typesafe-ai/sdk";
import { ClassifyError, type Classifier, type QuestionSpec } from "../types.ts";
import { requestDebug } from "./debug.ts";

/** The noul answer boundary: exactly one calibrated probability per question. */
const NOUL_ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("noul"),
  noul: Type.Number({ minimum: 0, maximum: 1 }),
});

/** The score answer boundary: the expected score of the ordered rubric (may fall between levels). */
const SCORE_ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("score"),
  score: Type.Number(),
});

export interface ClassifierConfig {
  /** Overrides the environment key; tests inject a fake transport instead. */
  apiKey?: string;
  baseURL?: string;
  /** Custom fetch for tests (structurally the vendor client's fetch). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createClassifier(config?: ClassifierConfig): Classifier {
  let client: TypeSafeClient | null = null;
  return async (state, questions) => {
    if (client === null) client = makeClient(requestDebug(config), state.path);
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

function makeClient(config: ClassifierConfig | undefined, input: string): TypeSafeClient {
  try {
    return new TypeSafeClient({
      ...(config?.apiKey !== undefined && { apiKey: config.apiKey }),
      ...(config?.baseURL !== undefined && { baseURL: config.baseURL }),
      ...(config?.fetch !== undefined && { fetch: config.fetch }),
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

function compileQuestions(questions: Record<string, QuestionSpec>): Questions {
  const out: Record<string, NoulQuestion | ScoreQuestion> = {};
  for (const [name, spec] of Object.entries(questions)) {
    // instructions is the {unitId: task} map; the SDK's EntryType accepts JSON objects.
    out[name] =
      spec.type === "score"
        ? score(spec.instructions, spec.criteria)
        : noul(spec.instructions, spec.criteria);
  }
  return out;
}

function extractAnswers(
  result: SystemOneResult<Questions>,
  questions: Record<string, QuestionSpec>,
  input: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, spec] of Object.entries(questions)) {
    const answer: unknown = result.answers[name];
    const schema = spec.type === "score" ? SCORE_ANSWER_SCHEMA : NOUL_ANSWER_SCHEMA;
    if (!Value.Check(schema, answer)) {
      throw new ClassifyError(
        "JEV_RESPONSE_INVALID",
        input,
        `jev answer '${name}' failed shape validation: expected ${schema === SCORE_ANSWER_SCHEMA ? '{ type: "score", score: number }' : '{ type: "noul", noul: number 0..1 }'}, got ${JSON.stringify(answer)}`,
      );
    }
    out[name] =
      spec.type === "score"
        ? (answer as Static<typeof SCORE_ANSWER_SCHEMA>).score
        : (answer as Static<typeof NOUL_ANSWER_SCHEMA>).noul;
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
