/**
 * The jev adapter — the ONLY file that imports @typesafe-ai/sdk (design §4.5).
 * This is the swappable-backend seam: lint() accepts any Judge, tests fake it.
 *
 * Error mapping (once, here):
 *   missing TYPESAFE_API_KEY / 401 / 403  -> JEV_AUTH (fails loud at first call, never at import)
 *   400 / 422                             -> JEV_REQUEST_INVALID
 *   429 / 5xx / connection failures       -> JEV_UNAVAILABLE
 *   answer failing shape validation       -> JEV_RESPONSE_INVALID (TypeBox, design §3.5)
 *
 * Nomenclature matches TypeSafe exactly: the call is systemOne(); the model is
 * jev-latest; a sensor compiles to a Noul question; the request parts are
 * state / questions; the response parts are answers with .noul probability.
 */

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
  type EntryType,
  type NoulQuestion,
  type SystemOneResult,
  type Questions,
} from "@typesafe-ai/sdk";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AppError, type Judge, type QuestionSpec } from "../types.ts";

/** The answer boundary: a noul answer is { type: "noul", noul: number 0..1 }. */
const AnswerSchema = Type.Object({
  type: Type.Literal("noul"),
  noul: Type.Number({ minimum: 0, maximum: 1 }),
});

export interface JudgeConfig {
  /** Overrides TYPESAFE_API_KEY; tests inject a fake transport instead. */
  apiKey?: string;
  baseURL?: string;
  /** Custom fetch for tests (structurally the SDK's Fetch). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createJudge(config?: JudgeConfig): Judge {
  let client: TypeSafeClient | null = null;
  return async (state, questions) => {
    if (client === null) client = makeClient(config);
    const sdkQuestions = compileQuestions(questions);
    let result: SystemOneResult<typeof sdkQuestions>;
    try {
      result = await client.systemOne({ state: state as unknown as EntryType, questions: sdkQuestions });
    } catch (e) {
      throw mapTransportError(e);
    }
    return extractAnswers(result, questions);
  };
}

function makeClient(config: JudgeConfig | undefined): TypeSafeClient {
  try {
    return new TypeSafeClient({
      ...(config?.apiKey !== undefined && { apiKey: config.apiKey }),
      ...(config?.baseURL !== undefined && { baseURL: config.baseURL }),
      ...(config?.fetch !== undefined && { fetch: config.fetch }),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new AppError(
      "JEV_AUTH",
      `jev unavailable at startup: ${detail} — set TYPESAFE_API_KEY to a valid key`,
      { cause: e },
    );
  }
}

function compileQuestions(questions: Record<string, QuestionSpec>): Questions {
  const out: Record<string, NoulQuestion> = {};
  for (const [name, spec] of Object.entries(questions)) {
    out[name] = noul(spec.instructions);
  }
  return out;
}

function extractAnswers(
  result: SystemOneResult<Questions>,
  questions: Record<string, QuestionSpec>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(questions)) {
    const answer: unknown = result.answers[name];
    if (!Value.Check(AnswerSchema, answer)) {
      throw new AppError(
        "JEV_RESPONSE_INVALID",
        `jev answer '${name}' failed shape validation: expected { type: "noul", noul: number 0..1 }, got ${JSON.stringify(answer)}`,
      );
    }
    out[name] = (answer as Static<typeof AnswerSchema>).noul;
  }
  return out;
}

function mapTransportError(e: unknown): AppError {
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
    return new AppError("JEV_AUTH", `jev rejected the API key: ${e.message}`, { cause: e });
  }
  if (e instanceof BadRequestError || e instanceof UnprocessableEntityError) {
    return new AppError("JEV_REQUEST_INVALID", `jev rejected the request: ${e.message}`, { cause: e });
  }
  if (e instanceof RateLimitError || e instanceof InternalServerError || e instanceof APIError) {
    return new AppError("JEV_UNAVAILABLE", `jev unavailable: ${e.message}`, { cause: e });
  }
  if (e instanceof APIConnectionError) {
    return new AppError("JEV_UNAVAILABLE", `jev unreachable: ${e.message}`, { cause: e });
  }
  if (e instanceof TypeSafeError) {
    return new AppError("JEV_UNAVAILABLE", `jev call failed: ${e.message}`, { cause: e });
  }
  if (e instanceof Error) {
    return new AppError("INTERNAL", `unexpected jev transport error: ${e.message}`, { cause: e });
  }
  return new AppError("INTERNAL", `unexpected jev transport error: ${String(e)}`, { cause: e });
}
