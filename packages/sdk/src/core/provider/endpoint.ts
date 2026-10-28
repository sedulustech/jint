/**
 * Where jint asks its questions: one Decisions endpoint (OpenAI-style POST /v1/decisions) and the
 * key that opens it. The url is the selector: pointing jint elsewhere is a different url, never a
 * different mode.
 *
 * Selection (config > environment > default), each axis on its own; an empty variable is unset:
 * url: config `url` > $JINT_PROVIDER_URL > DEFAULT_URL; key: config `apiKey` > $JINT_PROVIDER_KEY.
 */

import { SetupError } from "../types.ts";

/** The endpoint asked when neither config nor $JINT_PROVIDER_URL names one. */
export const DEFAULT_URL = "https://api.openai.com/v1/decisions";

/** What a caller says about the endpoint: every field optional, the defaults fill the rest. */
export interface EndpointChoice {
  url?: string;
  apiKey?: string;
}

export interface Endpoint {
  url: string;
  /** Undefined when neither config nor the environment holds a key. */
  apiKey: string | undefined;
  /**
   * Run notes naming an override (never a key's value): a url moved off the default, a key read
   * from $JINT_PROVIDER_KEY. Empty when nothing is overridden.
   */
  notes: string[];
}

type Env = Record<string, string | undefined>;

/** An empty variable counts as unset. */
const fromEnv = (env: Env, name: string): string | undefined =>
  env[name] === "" ? undefined : env[name];

/** The host of a url (no userinfo, path or query), for notes and the manifest. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

/** Resolves the url and key a run asks. */
export function resolveEndpoint(choice: EndpointChoice = {}, env: Env = process.env): Endpoint {
  const configUrl = choice.url === "" ? undefined : choice.url;
  const configKey = choice.apiKey === "" ? undefined : choice.apiKey;
  const url = configUrl ?? fromEnv(env, "JINT_PROVIDER_URL") ?? DEFAULT_URL;
  const envKey = configKey === undefined ? fromEnv(env, "JINT_PROVIDER_KEY") : undefined;
  const notes: string[] = [];
  if (url !== DEFAULT_URL) notes.push(`url overridden, host ${urlHost(url)}`);
  if (envKey !== undefined) notes.push("key from JINT_PROVIDER_KEY");
  return { url, apiKey: configKey ?? envKey, notes };
}

/** The setup message for a run with no key. */
export const MISSING_KEY_MESSAGE =
  "no JINT_PROVIDER_KEY set - measurements need a valid key (override per run: --config with apiKey)";

/** Fails the run at setup when it has no key. */
export function assertEndpointKey(choice: EndpointChoice): void {
  if (resolveEndpoint(choice).apiKey === undefined) {
    throw new SetupError("CONFIG_INVALID", MISSING_KEY_MESSAGE);
  }
}
