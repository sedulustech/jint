/**
 * The classifier factory: resolves the provider, builds the adapter for its protocol and wraps it
 * in the run recorder. This is the swappable-backend seam: the lint pipeline accepts any
 * classifier, tests fake it.
 *
 * Transport failures map onto the project's error taxonomy once, in each adapter: auth failures
 * fail loud at the first call (never at import), rejected requests, rate limits and outages surface
 * as unavailability, and a wrong-shaped answer is a response-invalid error.
 *
 * The model classifies: one batched call per state, one structured question per rule, each answer a
 * single calibrated probability.
 */

import { ClassifyError, type Classifier } from "../types.ts";
import { inCall, recordRequests } from "./debug.ts";
import { decisionModelAdapter } from "./decision-model.ts";
import { decisionsAdapter } from "./decisions.ts";
import {
  resolveProvider,
  urlHost,
  type ProviderChoice,
  type ResolvedProvider,
} from "./providers.ts";

export interface ClassifierConfig extends ProviderChoice {
  /**
   * The model id; defaults to $JINT_MODEL, then the selected provider's model. The provider is
   * chosen by `provider`, else $JINT_PROVIDER, else the default (see providers.ts).
   */
  model?: string;
  /** Custom fetch for tests (the transport the provider's client calls). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * The transport log sink (client backoff/warn/error visibility): one UNPREFIXED line per event.
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

/** The classifier for one provider: asked through the adapter its protocol names. */
function makeClassifier(
  config: ClassifierConfig | undefined,
  provider: ResolvedProvider,
  log: (line: string) => void,
  input: string,
): Classifier {
  // A missing key fails here, naming keyEnv, before anything is built or recorded.
  if (provider.apiKey === undefined) throw missingKey(provider, input);
  const route = { provider: provider.name, host: urlHost(provider.spec.url) };
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

const missingKey = (provider: ResolvedProvider, input: string): ClassifyError =>
  new ClassifyError(
    "PROVIDER_AUTH",
    input,
    `provider unavailable at startup: no API key — set ${provider.spec.keyEnv} to a valid key`,
  );
