/**
 * The provider table: where and how jint asks its questions, as DATA. A provider's specifics (url,
 * key variable, model id, headers, limits) change often and live in one table entry each; only the
 * wire format a provider speaks is code (one adapter per protocol, named here by `protocol`).
 *
 * Selection (config > environment > table): the provider name from config `provider`, else
 * $JINT_PROVIDER, else DEFAULT_PROVIDER; the model from config `model`, else $JINT_MODEL, else the
 * provider's own; the key from config `apiKey`, else the variable the provider's `keyEnv` names.
 * Config `providers` overrides a table entry field by field, or adds a provider.
 */

import { SetupError } from "../types.ts";

/** The wire formats with an adapter. `systemone` is the vendor SDK's own format (no translation). */
export const PROTOCOLS = ["decisions", "decision-model", "systemone"] as const;
export type ProtocolName = (typeof PROTOCOLS)[number];

export interface ProviderSpec {
  /** The wire format this provider speaks. */
  protocol: ProtocolName;
  /** The endpoint the questions are posted to (the API root for `systemone`). */
  url: string;
  /** The environment variable holding the provider's API key. */
  keyEnv: string;
  /** The model id asked when neither config nor $JINT_MODEL names one. */
  model: string;
  /** Extra request headers, sent with every call. */
  headers?: Record<string, string>;
  limits?: {
    /** The provider's input-token budget per minute; the run paces its calls under it. */
    tokensPerMinute?: number;
  };
}

/**
 * The pinned System One model. Its `jev-latest` alias moves when a release ships, so readings, and
 * every threshold calibrated against them, would change without a change here.
 */
export const DEFAULT_MODEL = "jev-1.13.0";

export const PROVIDERS: Readonly<Record<string, ProviderSpec>> = {
  openai: {
    protocol: "decisions",
    url: "https://api.openai.com/v1/decisions",
    keyEnv: "JINT_OPENAI_API_KEY",
    model: "gpt-6-luna",
    limits: { tokensPerMinute: 10_000_000 },
  },
  vercel: {
    protocol: "decision-model",
    url: "https://ai-gateway.vercel.sh/v4/ai/decision-model",
    keyEnv: "JINT_AI_GATEWAY_API_KEY",
    model: "openai/gpt-6-luna-decisions",
  },
  systemone: {
    protocol: "systemone",
    url: "https://api.typesafe.ai",
    keyEnv: "JINT_TYPESAFE_API_KEY",
    model: DEFAULT_MODEL,
  },
};

export const DEFAULT_PROVIDER = "openai";

/** What a caller says about the provider: every field optional, the table fills the rest. */
export interface ProviderChoice {
  provider?: string;
  model?: string;
  apiKey?: string;
  /** Per-name overrides of table entries (or whole new entries): merged field by field. */
  providers?: Record<string, Partial<ProviderSpec>>;
}

export interface ResolvedProvider {
  name: string;
  spec: ProviderSpec;
  model: string;
  /** Undefined when neither config nor the environment holds a key. */
  apiKey: string | undefined;
}

type Env = Record<string, string | undefined>;

/** An empty variable counts as unset. */
const fromEnv = (env: Env, name: string): string | undefined =>
  env[name] === "" ? undefined : env[name];

/** The known provider names: the table plus any the config adds. */
export function providerNames(choice: ProviderChoice): string[] {
  return [...new Set([...Object.keys(PROVIDERS), ...Object.keys(choice.providers ?? {})])];
}

/**
 * Resolves the provider, model and key a run asks; a setup error for an unknown or incomplete
 * provider.
 */
export function resolveProvider(
  choice: ProviderChoice = {},
  env: Env = process.env,
): ResolvedProvider {
  const name = choice.provider ?? fromEnv(env, "JINT_PROVIDER") ?? DEFAULT_PROVIDER;
  const base = PROVIDERS[name];
  const override = choice.providers?.[name];
  if (base === undefined && override === undefined) {
    throw new SetupError(
      "CONFIG_INVALID",
      `unknown provider '${name}' - known providers: ${providerNames(choice).join(", ")}`,
    );
  }
  const spec = {
    ...base,
    ...override,
    limits: { ...base?.limits, ...override?.limits },
  } as Partial<ProviderSpec>;
  const missing = (["protocol", "url", "keyEnv", "model"] as const).filter(
    (field) => spec[field] === undefined,
  );
  if (missing.length > 0) {
    throw new SetupError(
      "CONFIG_INVALID",
      `provider '${name}' is incomplete: set ${missing.join(", ")} in config providers`,
    );
  }
  if (!PROTOCOLS.includes(spec.protocol!)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `provider '${name}' names unknown protocol '${spec.protocol}' - known protocols: ${PROTOCOLS.join(", ")}`,
    );
  }
  const full = spec as ProviderSpec;
  return {
    name,
    spec: full,
    model: choice.model ?? fromEnv(env, "JINT_MODEL") ?? full.model,
    apiKey: (choice.apiKey === "" ? undefined : choice.apiKey) ?? fromEnv(env, full.keyEnv),
  };
}

/** The setup message for a run with no key: names the selected provider's key variable. */
export function missingKeyMessage(provider: ResolvedProvider): string {
  return `no ${provider.spec.keyEnv} set - measurements need a valid key (override per run: --config with apiKey)`;
}

/** Fails the run at setup when the selected provider has no key. */
export function assertProviderKey(choice: ProviderChoice): void {
  const provider = resolveProvider(choice);
  if (provider.apiKey === undefined) {
    throw new SetupError("CONFIG_INVALID", missingKeyMessage(provider));
  }
}
