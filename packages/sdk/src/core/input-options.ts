import { configScopeAdmits, walkScopes } from "./scope.ts";
import type { ResolvedConfig } from "../config/load.ts";
import type { InputOptions } from "./input/infer.ts";
import type { InputStats } from "./input/stats.ts";
import type { CustomRule } from "./rules/custom/schema.ts";
import type { Rule } from "./types.ts";

export interface WalkInputSource {
  readonly config: Pick<ResolvedConfig, "include" | "exclude" | "secretDenylist">;
  /** Every rule that may open a scope: built-in and custom, in config order. */
  readonly rules: readonly (Rule | CustomRule)[];
  /** Run-level exclusions (--exclude), added to the config exclude. */
  readonly exclude?: readonly string[];
  readonly scopeBase?: string;
  readonly onNote?: (note: string) => void;
  readonly stats?: InputStats;
}

/**
 * The input-walk options every entry point shares (lint and capture): one place that unions the
 * excludes, opens the walk scopes, and carries the denylist, so a run and a capture of the same
 * config walk the same population. `configAdmits` is the config-scope admission test over the same
 * excludes, for callers that attribute or filter by it. The caller adds input, registry and
 * requireGrammarFor.
 */
export function walkInputOptions(source: WalkInputSource): {
  readonly options: Pick<
    InputOptions,
    "exclude" | "include" | "scopeBase" | "secretDenylist" | "onNote" | "stats"
  >;
  readonly configAdmits: (path: string) => boolean;
} {
  const exclude = [...source.config.exclude, ...(source.exclude ?? [])];
  return {
    options: {
      exclude,
      include: walkScopes(source.config.include, source.rules),
      scopeBase: source.scopeBase,
      secretDenylist: source.config.secretDenylist,
      onNote: source.onNote,
      stats: source.stats,
    },
    configAdmits: configScopeAdmits(source.config.include, exclude),
  };
}
