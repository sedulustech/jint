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
import { cacheDir, fileStore } from "./answer-cache.ts";
import { inCall, inQuestions, recordCacheHit, recordRequests } from "./debug.ts";
import { decisionsAdapter, MODEL } from "./decisions.ts";
import {
  resolveEndpoint,
  urlHost,
  urlIdentity,
  type Endpoint,
  type EndpointChoice,
} from "./endpoint.ts";
import { systemOneAdapter } from "./systemone.ts";

export interface ClassifierConfig extends EndpointChoice {
  /** Custom fetch for tests (the transport the client calls). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * The transport log sink (client backoff/warn/error visibility): one UNPREFIXED line per event.
   * The SDK never writes a tool prefix — that is the client's voice, added at its write site.
   * Default writes bare lines to stderr.
   */
  log?: (line: string) => void;
  /**
   * Whether to serve answers from the answer cache (default true; false asks every question). The
   * store is $JINT_CACHE_DIR, else ~/.jint/cache.
   */
  cache?: boolean;
  /**
   * Whether this classifier starts a recorded run in the run store (default true). A caller that
   * records its own exchanges - the run UI's classifications, filed under the run they edit - turns
   * it off, and the call leaves no run directory of its own.
   */
  record?: boolean;
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

function makeClassifier(
  config: ClassifierConfig | undefined,
  endpoint: Endpoint,
  log: (line: string) => void,
  input: string,
): Classifier {
  if (endpoint.apiKey === undefined && endpoint.keyless !== true) throw missingKey(input, endpoint);
  const systemOne = endpoint.protocol === "systemone";
  const recording = config?.record !== false;
  const send = config?.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const recorded = recording
    ? recordRequests(config, {
        model: endpoint.model ?? (systemOne ? "server default" : MODEL),
        host: urlHost(endpoint.url),
      }).fetch!
    : send;
  const cache =
    config?.cache === false
      ? undefined
      : {
          store: fileStore(cacheDir()),
          endpoint: urlIdentity(endpoint.url),
          scope: inQuestions,
          hit: (names: string[], exchange: { request: unknown; response: unknown }) => {
            if (recording) recordCacheHit(endpoint.url, names, exchange);
          },
        };
  const adapter = systemOne
    ? systemOneAdapter(endpoint, { fetch: recorded, log })
    : decisionsAdapter(endpoint, { fetch: recorded, log, cache });
  return async (state, questions) => {
    const { id: _id, ...judged } = state;
    const asked = await inCall(state, Object.keys(questions), () =>
      adapter.ask({ state: judged, questions }),
    );
    return asked.answers;
  };
}

const missingKey = (input: string, { unusable }: Endpoint): ClassifyError =>
  new ClassifyError("PROVIDER_AUTH", input, `provider unavailable at startup: ${unusable}`);
