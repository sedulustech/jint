/**
 * The classifier factory: resolves the endpoint, builds the Decisions adapter and wraps it in the
 * run recorder. This is the swappable-backend seam: the lint pipeline accepts any classifier, tests
 * fake it.
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
import { decisionsAdapter, MODEL } from "./decisions.ts";
import { resolveEndpoint, urlHost, type Endpoint, type EndpointChoice } from "./endpoint.ts";

export interface ClassifierConfig extends EndpointChoice {
  /** Custom fetch for tests (the transport the client calls). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * The transport log sink (client backoff/warn/error visibility): one UNPREFIXED line per event.
   * The SDK never writes a tool prefix — that is the client's voice, added at its write site.
   * Default writes bare lines to stderr.
   */
  log?: (line: string) => void;
}

export function createClassifier(config?: ClassifierConfig): Classifier {
  const endpoint = resolveEndpoint(config);
  const log = config?.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  let classifier: Classifier | null = null;
  return async (state, questions) => {
    classifier ??= makeClassifier(config, endpoint, log, state.path);
    return classifier(state, questions);
  };
}

/** The classifier for the endpoint, asked through the Decisions adapter. */
function makeClassifier(
  config: ClassifierConfig | undefined,
  endpoint: Endpoint,
  log: (line: string) => void,
  input: string,
): Classifier {
  // A missing key fails here, before anything is built or recorded.
  if (endpoint.apiKey === undefined) throw missingKey(input);
  const recorded = recordRequests(config, { model: MODEL, host: urlHost(endpoint.url) });
  const adapter = decisionsAdapter(endpoint, { fetch: recorded.fetch!, log });
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

const missingKey = (input: string): ClassifyError =>
  new ClassifyError(
    "PROVIDER_AUTH",
    input,
    "provider unavailable at startup: no API key — set JINT_PROVIDER_KEY to a valid key",
  );
