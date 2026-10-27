/**
 * The provider adapter — the only file that imports the vendor SDK. This is the swappable-backend
 * seam: the lint pipeline accepts any classifier, tests fake it.
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
import { ADAPTERS } from "./adapters.ts";
import { ID_HEADER, inCall, recordRequests, tapWire } from "./debug.ts";
import { decisionModelAdapter } from "./decision-model.ts";
import { decisionsAdapter } from "./decisions.ts";
import { protocolFetch } from "./protocol.ts";
import {
  PROVIDERS,
  resolveProvider,
  urlHost,
  type ProviderChoice,
  type ResolvedProvider,
} from "./providers.ts";
import type { ClassifiedAnswer, Refusal } from "@jint/contract";

/** The noul answer boundary: exactly one calibrated probability per question. */
const NOUL_ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("noul"),
  noul: Type.Number({ minimum: 0, maximum: 1 }),
});

/**
 * The score answer boundary: the expected score of the ordered rubric (may fall between levels),
 * plus the distribution it summarizes — every Score answer carries per-level probabilities
 * (docs.typesafe.ai/primitives/score.md), required on the wire.
 */
const SCORE_ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("score"),
  score: Type.Number(),
  probabilities: Type.Record(Type.String(), Type.Number()),
  // System One echoes each level's text; a model that drops it fails here, not as a blank card
  legend: Type.Record(Type.String(), Type.String()),
});

/**
 * The choice answer boundary: the selected option's label and the probability of every option
 * (keyed by label) - required on the wire.
 */
const CHOICE_ANSWER_SCHEMA = Type.Object({
  type: Type.Literal("choice"),
  choice: Type.String(),
  probabilities: Type.Record(Type.String(), Type.Number()),
});

/** A refusal, the answer boundary every question kind shares: the model gave no answer. */
const REFUSAL_ANSWER_SCHEMA = Type.Object({ type: Type.Literal("refusal") });

/** The expected answer shape per question type, named in a shape-validation error. */
const ANSWER_SHAPES = {
  noul: { schema: NOUL_ANSWER_SCHEMA, text: '{ type: "noul", noul: number 0..1 }' },
  score: {
    schema: SCORE_ANSWER_SCHEMA,
    text: '{ type: "score", score, probabilities }',
  },
  choice: {
    schema: CHOICE_ANSWER_SCHEMA,
    text: '{ type: "choice", choice, probabilities }',
  },
} as const;

export interface ClassifierConfig extends ProviderChoice {
  /**
   * The model id; defaults to $JINT_MODEL, then the selected provider's model. The provider is
   * chosen by `provider`, else $JINT_PROVIDER, else the default (see providers.ts).
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
  const provider = resolveProvider(config);
  const log = config?.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  let classifier: Classifier | null = null;
  return async (state, questions) => {
    classifier ??= makeClassifier(config, provider, log, state.path);
    return classifier(state, questions);
  };
}

/**
 * The classifier for one provider. A provider whose protocol has an adapter of its own
 * (`decisions`) is asked through it, its client called directly; the others go through the vendor
 * client in System One's shape, a translating fetch beneath it where the protocol is not System
 * One.
 */
function makeClassifier(
  config: ClassifierConfig | undefined,
  provider: ResolvedProvider,
  log: (line: string) => void,
  input: string,
): Classifier {
  const route = { provider: provider.name, host: urlHost(provider.spec.url) };
  if (provider.spec.protocol === "decisions" || provider.spec.protocol === "decision-model") {
    // A missing key fails here, naming keyEnv, before anything is built or recorded.
    if (provider.apiKey === undefined) throw missingKey(provider, input);
    const recorded = recordRequests({ ...config, model: provider.model }, route);
    const transport = { fetch: recorded.fetch!, log };
    const adapter =
      provider.spec.protocol === "decisions"
        ? decisionsAdapter(provider, transport)
        : decisionModelAdapter(provider, transport);
    return async (state, questions) => {
      // The id is jint's handle, not something to judge: a fresh id each run would make identical
      // code a different request (luna's readings moved by up to 0.55 on unchanged code). It stays
      // out of the request and reaches the recorder through the call.
      const { id: _id, ...judged } = state;
      const asked = await inCall(state, Object.keys(questions), () =>
        adapter.ask({ state: judged, questions }),
      );
      return asked.answers;
    };
  }
  const client = makeClient(
    recordRequests(routeProvider(config, provider), route),
    provider,
    input,
  );
  return async (state, questions) => {
    const sdkQuestions = compileQuestions(questions);
    const { id, ...judged } = state;
    let result: SystemOneResult<typeof sdkQuestions>;
    try {
      result = await client.systemOne(
        { state: judged as unknown as EntryType, questions: sdkQuestions },
        { headers: { [ID_HEADER]: id } },
      );
    } catch (e) {
      throw mapTransportError(e, state.path);
    }
    return extractAnswers(result, questions, state.path);
  };
}

const missingKey = (provider: ResolvedProvider, input: string): ClassifyError =>
  new ClassifyError(
    "PROVIDER_AUTH",
    input,
    `provider unavailable at startup: no API key — set ${provider.spec.keyEnv} to a valid key`,
  );

/**
 * The classifier config the recorder and the client run on: the resolved model, the provider's key,
 * and, for a protocol with a translating adapter, the translating fetch. System One goes as is.
 */
function routeProvider(
  config: ClassifierConfig | undefined,
  provider: ResolvedProvider,
): ClassifierConfig {
  const routed = { ...config, model: provider.model, apiKey: provider.apiKey };
  const adapter = ADAPTERS[provider.spec.protocol];
  // The wire tap sits at the lowest fetch: what it sees is what goes to the network.
  const wire = tapWire(config?.fetch);
  if (adapter === undefined) return { ...routed, fetch: wire };
  return { ...routed, fetch: protocolFetch(adapter, provider.spec, wire) };
}

function makeClient(
  config: ClassifierConfig | undefined,
  provider: ResolvedProvider,
  input: string,
): TypeSafeClient {
  const writeLog = config?.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  // The vendor client falls back to its own TYPESAFE_API_KEY when given none: a key the provider's
  // keyEnv does not name must never be picked up, so a missing key fails here, naming keyEnv.
  if (config?.apiKey === undefined) throw missingKey(provider, input);
  try {
    return new TypeSafeClient({
      apiKey: config.apiKey,
      // A translated protocol is still asked in System One's shape beneath the translating fetch
      baseURL:
        provider.spec.protocol === "systemone" ? provider.spec.url : PROVIDERS.systemone!.url,
      defaultModel: provider.model,
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
            writeLog(`provider backoff: ${message} ${args.join(" ")}`);
          }
        },
        warn: (message, ...args) => writeLog(`provider warn: ${message} ${args.join(" ")}`),
        error: (message, ...args) => writeLog(`provider error: ${message} ${args.join(" ")}`),
      },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ClassifyError(
      "PROVIDER_AUTH",
      input,
      `provider unavailable at startup: ${detail} — set ${provider.spec.keyEnv} to a valid key`,
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
): Record<string, ClassifiedAnswer | Refusal> {
  const out: Record<string, ClassifiedAnswer | Refusal> = {};
  for (const [name, spec] of Object.entries(questions)) {
    const answer: unknown = result.answers[name];
    // A refused question is a valid answer for any question kind: it passes through as a refusal.
    if (Value.Check(REFUSAL_ANSWER_SCHEMA, answer)) {
      out[name] = { refused: true };
      continue;
    }
    const shape = ANSWER_SHAPES[spec.type];
    if (!Value.Check(shape.schema, answer)) {
      throw new ClassifyError(
        "PROVIDER_RESPONSE_INVALID",
        input,
        `provider answer '${name}' failed shape validation: expected ${shape.text}, got ${JSON.stringify(answer)}`,
      );
    }
    if (spec.type === "score") {
      const s = answer as Static<typeof SCORE_ANSWER_SCHEMA>;
      out[name] = { value: s.score, probabilities: s.probabilities };
    } else if (spec.type === "choice") {
      // the value is the selected option's probability; the label carries the verdict
      const c = answer as Static<typeof CHOICE_ANSWER_SCHEMA>;
      out[name] = {
        value: c.probabilities[c.choice] ?? 0,
        choice: c.choice,
        probabilities: c.probabilities,
      };
    } else {
      out[name] = { value: (answer as Static<typeof NOUL_ANSWER_SCHEMA>).noul };
    }
  }
  return out;
}

function mapTransportError(e: unknown, input: string): ClassifyError {
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
    return new ClassifyError(
      "PROVIDER_AUTH",
      input,
      `provider rejected the API key: ${e.message}`,
      {
        cause: e,
      },
    );
  }
  if (e instanceof BadRequestError || e instanceof UnprocessableEntityError) {
    return new ClassifyError(
      "PROVIDER_REQUEST_INVALID",
      input,
      `provider rejected the request: ${e.message}`,
      {
        cause: e,
      },
    );
  }
  if (e instanceof RateLimitError || e instanceof InternalServerError || e instanceof APIError) {
    return new ClassifyError("PROVIDER_UNAVAILABLE", input, `provider unavailable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof APIConnectionError) {
    return new ClassifyError("PROVIDER_UNAVAILABLE", input, `provider unreachable: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof TypeSafeError) {
    return new ClassifyError("PROVIDER_UNAVAILABLE", input, `provider call failed: ${e.message}`, {
      cause: e,
    });
  }
  if (e instanceof Error) {
    return new ClassifyError(
      "INTERNAL",
      input,
      `unexpected provider transport error: ${e.message}`,
      {
        cause: e,
      },
    );
  }
  return new ClassifyError("INTERNAL", input, `unexpected provider transport error: ${String(e)}`, {
    cause: e,
  });
}
