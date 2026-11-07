/**
 * Where jint asks its questions: one endpoint and the key that opens it. The url's last segment
 * names the wire: `/decisions` is the OpenAI Decisions API (the default, gpt-6-luna) and
 * `/systemone` is the System One shape that TypeSafe and Lemonade serve. The key you export picks
 * the destination, and a key only ever goes to the host it is paired with: a run never sends one
 * service's key to another service's url.
 *
 * Selection, an empty variable is unset. A config file names neither: a key does not belong in a
 * file that gets committed. A caller of the SDK may pass both to `createClassifier`, which then
 * win.
 *
 * - A caller's `apiKey` / `url` / `model` win for the run; $JINT_API_MODEL names the model otherwise.
 * - A `/systemone` url on this machine (localhost, 127.0.0.1, ::1) may go without a key: a local
 *   server has none unless its owner set one. Any other host needs a key.
 * - Else the first DESTINATIONS row whose key variable is set picks the key (and its own url);
 *   $JINT_API_URL moves the url, and then only a row without a fixed url (the Jint row) may send.
 */

import { SetupError } from "../types.ts";

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
const MODEL_VAR = "JINT_API_MODEL";

/** The wire an endpoint speaks, from the last segment of its url. */
export type Protocol = "decisions" | "systemone";

export const protocolOf = (url: string): Protocol =>
  url.replace(/\/+$/, "").endsWith("/systemone") ? "systemone" : "decisions";

/** Whether the url names this machine, the only place a key may be left out. */
const isLocal = (url: string): boolean => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** What a caller says about the endpoint: every field optional, the environment fills the rest. */
export interface EndpointChoice {
  url?: string;
  apiKey?: string;
  /** The model to ask; absent asks the default of the wire (gpt-6-luna) or of the server. */
  model?: string;
}

export interface Endpoint {
  url: string;
  /** The wire the url speaks. */
  protocol: Protocol;
  /** The model the caller or $JINT_API_MODEL named; undefined leaves the choice to the wire. */
  model: string | undefined;
  /** Undefined when no key may go to the url; `unusable` then says why. */
  apiKey: string | undefined;
  /** True when the run goes without a key on purpose: a /systemone url on this machine. */
  keyless?: boolean;
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

type Resolved = Pick<Endpoint, "url" | "apiKey" | "unusable" | "notes">;

function resolveKey(choice: EndpointChoice, env: Env): Resolved {
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
    const unusable = `no API key set - export ${keyVars}`;
    return { url, apiKey: undefined, unusable, notes: notes(url) };
  }
  const url = urlOverride ?? chosen.url ?? DEFAULT_URL;
  const withheld = (unusable: string): Resolved => ({
    url,
    apiKey: undefined,
    unusable,
    notes: notes(url),
  });
  if (chosen.url === undefined && urlOverride === undefined) {
    return withheld(`${chosen.keyVar} is set but no url - set ${URL_VAR} to the endpoint it opens`);
  }
  if (chosen.url !== undefined && url !== chosen.url) {
    return withheld(
      `${URL_VAR} points at ${urlHost(url)}, and ${chosen.keyVar} only goes to ${urlHost(chosen.url)} - set JINT_API_KEY for this url`,
    );
  }
  return { url, apiKey: fromEnv(env, chosen.keyVar), notes: notes(url, chosen.keyVar) };
}

/** The endpoint a run asks: its url and wire, the model if named, and the key that may go there. */
export function resolveEndpoint(choice: EndpointChoice = {}, env: Env = process.env): Endpoint {
  const resolved = resolveKey(choice, env);
  const protocol = protocolOf(resolved.url);
  const model = (choice.model === "" ? undefined : choice.model) ?? fromEnv(env, MODEL_VAR);
  const endpoint: Endpoint = { ...resolved, protocol, model };
  if (resolved.apiKey === undefined && protocol === "systemone" && isLocal(resolved.url)) {
    delete endpoint.unusable;
    endpoint.keyless = true;
  }
  return endpoint;
}

export function assertEndpointKey(choice: EndpointChoice = {}): void {
  const { apiKey, keyless, unusable } = resolveEndpoint(choice);
  if (apiKey === undefined && keyless !== true) throw new SetupError("CONFIG_INVALID", unusable!);
}
