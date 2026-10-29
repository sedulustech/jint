/**
 * Where jint asks its questions: one Decisions endpoint (POST /v1/decisions) and the key that opens
 * it. The key you export picks the destination, and a key only ever goes to the host it is paired
 * with: a run never sends one service's key to another service's url.
 *
 * Selection (config > environment), an empty variable is unset:
 *
 * - Config `apiKey` / `url` win for the run; a config key with no url asks DEFAULT_URL.
 * - Else the first DESTINATIONS row whose key variable is set picks the key (and its own url);
 *   $JINT_API_URL moves the url, and then only a row without a fixed url (the Jint row) may send.
 */

import { SetupError } from "../types.ts";

/** The endpoint asked when nothing names another one. */
export const DEFAULT_URL = "https://api.openai.com/v1/decisions";

/**
 * Where each key variable's key may go, in precedence order (the deliberate `JINT_` variable beats
 * an ambient one). A row with a `url` sends only there; a row without one sends to $JINT_API_URL.
 */
const DESTINATIONS: readonly { keyVar: string; url?: string }[] = [
  { keyVar: "JINT_API_KEY" },
  { keyVar: "OPENAI_API_KEY", url: DEFAULT_URL },
];

const URL_VAR = "JINT_API_URL";

/** What a caller says about the endpoint: every field optional, the environment fills the rest. */
export interface EndpointChoice {
  url?: string;
  apiKey?: string;
}

export interface Endpoint {
  url: string;
  /** Undefined when no key may go to the url; `unusable` then says why. */
  apiKey: string | undefined;
  /** Why the run has no usable key, set exactly when `apiKey` is undefined. */
  unusable?: string;
  /**
   * Run notes naming where the settings came from (never a key's value): a url moved off the
   * default, a key read from the environment. Empty when nothing is overridden.
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

/**
 * Which endpoint a url names, for the answer-cache key: scheme, host and path. Userinfo and query
 * stay out (they can carry a credential), but the path stays in: one host can route to different
 * backends by path, and an answer is only the same where the backend is.
 */
export function urlIdentity(url: string): string {
  try {
    const { protocol, host, pathname } = new URL(url);
    return `${protocol}//${host}${pathname}`;
  } catch {
    return "unparseable";
  }
}

const keyVars = DESTINATIONS.map((d) => d.keyVar).join(" or ");

const notes = (url: string, keyVar?: string): string[] => [
  ...(url !== DEFAULT_URL ? [`url overridden, host ${urlHost(url)}`] : []),
  ...(keyVar !== undefined ? [`key from ${keyVar}`] : []),
];

/** Resolves the url and key a run asks. */
export function resolveEndpoint(choice: EndpointChoice = {}, env: Env = process.env): Endpoint {
  const configUrl = choice.url === "" ? undefined : choice.url;
  const configKey = choice.apiKey === "" ? undefined : choice.apiKey;
  const urlOverride = configUrl ?? fromEnv(env, URL_VAR);
  if (configKey !== undefined) {
    const url = urlOverride ?? DEFAULT_URL;
    return { url, apiKey: configKey, notes: notes(url) };
  }
  const chosen = DESTINATIONS.find((d) => fromEnv(env, d.keyVar) !== undefined);
  if (chosen === undefined) {
    const url = urlOverride ?? DEFAULT_URL;
    const unusable = `no API key set - export ${keyVars} (override per run: --config with apiKey)`;
    return { url, apiKey: undefined, unusable, notes: notes(url) };
  }
  const url = urlOverride ?? chosen.url ?? DEFAULT_URL;
  const withheld = (unusable: string): Endpoint => ({
    url,
    apiKey: undefined,
    unusable,
    notes: notes(url),
  });
  if (chosen.url === undefined && urlOverride === undefined) {
    return withheld(
      `${chosen.keyVar} is set but no url - set ${URL_VAR} (or config url) to the endpoint it opens`,
    );
  }
  if (chosen.url !== undefined && url !== chosen.url) {
    return withheld(
      `${URL_VAR} or config url points at ${urlHost(url)}, and ${chosen.keyVar} only goes to ${urlHost(chosen.url)} - set JINT_API_KEY for this url`,
    );
  }
  return { url, apiKey: fromEnv(env, chosen.keyVar), notes: notes(url, chosen.keyVar) };
}

/** Fails the run at setup when it has no usable key. */
export function assertEndpointKey(choice: EndpointChoice): void {
  const { apiKey, unusable } = resolveEndpoint(choice);
  if (apiKey === undefined) throw new SetupError("CONFIG_INVALID", unusable!);
}
