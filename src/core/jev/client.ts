/**
 * The jev adapter — the only file that imports the vendor SDK. This is the swappable-backend seam:
 * the lint pipeline accepts any judge, tests fake it.
 *
 * Vendor transport failures map onto the project's error taxonomy exactly once, here: auth failures
 * fail loud at the first call (never at import), rejected requests, rate limits and outages surface
 * as unavailability, and a wrong-shaped answer is a response-invalid error. No vendor error type
 * escapes past this seam.
 *
 * Vendor nomenclature stays at the boundary: one batched call per state, one structured question
 * per sensor, each answer a single calibrated probability.
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
  type EntryType,
  type NoulQuestion,
  type SystemOneResult,
  type Questions,
} from "@typesafe-ai/sdk";
import { RequestError, type Judge, type QuestionSpec } from "../types.ts";
import { requestDebug } from "./debug.ts";

/** The answer boundary: exactly one calibrated probability per question. */
const ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("noul"),
  noul: Type.Number({ minimum: 0, maximum: 1 }),
});

export interface JudgeConfig {
  /** Overrides the environment key; tests inject a fake transport instead. */
  apiKey?: string;
  baseURL?: string;
  /** Custom fetch for tests (structurally the vendor client's fetch). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export function createJudge(config?: JudgeConfig): Judge {
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

function makeClient(config: JudgeConfig | undefined, input: string): TypeSafeClient {
  try {
    return new TypeSafeClient({
      ...(config?.apiKey !== undefined && { apiKey: config.apiKey }),
      ...(config?.baseURL !== undefined && { baseURL: config.baseURL }),
      ...(config?.fetch !== undefined && { fetch: config.fetch }),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new RequestError(
      "JEV_AUTH",
      input,
      `jev unavailable at startup: ${detail} — set TYPESAFE_API_KEY to a valid key`,
      { cause: e },
    );
  }
}

function compileQuestions(questions: Record<string, QuestionSpec>): Questions {
  const out: Record<string, NoulQuestion> = {};
  for (const [name, spec] of Object.entries(questions)) {
    // instructions is the {unitId: task} map; the SDK's EntryType accepts JSON objects.
    out[name] = noul(spec.instructions, spec.criteria);
  }
  return out;
}

function extractAnswers(
  result: SystemOneResult<Questions>,
  questions: Record<string, QuestionSpec>,
  input: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(questions)) {
    const answer: unknown = result.answers[name];
    if (!Value.Check(ANSWER_SCHEMA, answer)) {
      throw new RequestError(
        "JEV_RESPONSE_INVALID",
        input,
        `jev answer '${name}' failed shape validation: expected { type: "noul", noul: number 0..1 }, got ${JSON.stringify(answer)}`,
      );
    }
    out[name] = (answer as Static<typeof ANSWER_SCHEMA>).noul;
  }
  return out;
}

function mapTransportError(e: unknown, input: string): RequestError {
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
    return new RequestError("JEV_AUTH", input, `jev rejected the API key: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof BadRequestError || e instanceof UnprocessableEntityError) {
    return new RequestError(
      "JEV_REQUEST_INVALID",
      input,
      `jev rejected the request: ${e.message}`,
      {
        cause: e,
      },
    );
  }
  if (e instanceof RateLimitError || e instanceof InternalServerError || e instanceof APIError) {
    return new RequestError("JEV_UNAVAILABLE", input, `jev unavailable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof APIConnectionError) {
    return new RequestError("JEV_UNAVAILABLE", input, `jev unreachable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof TypeSafeError) {
    return new RequestError("JEV_UNAVAILABLE", input, `jev call failed: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof Error) {
    return new RequestError("INTERNAL", input, `unexpected jev transport error: ${e.message}`, {
      cause: e,
    });
  }
  return new RequestError("INTERNAL", input, `unexpected jev transport error: ${String(e)}`, {
    cause: e,
  });
}
