/**
 * DefineConfig — the config author's constructor. Takes the user-shaped config (see
 * tmp/jint.config.v2.example.ts), normalizes rules into a flat list, and freezes the result:
 * definitions are data.
 */

import type { InputKind, Rule } from "../core/types.ts";

/** The normalized shape a config file's default export must have. */
export interface ResolvedConfig {
  readonly input: string;
  readonly inputType?: InputKind;
  readonly rules: readonly Rule[];
  readonly exclude: readonly string[];
}

/** The author-facing shape: rules as the defaults spread plus a disable list, or a plain list. */
export interface UserConfig {
  input: string;
  /** Optional override for ambiguous inputs only — the kind is otherwise inferred. */
  // record form: rule names -> rule, plus the special "disable" key
  inputType?: InputKind;
  rules?: Rule[] | Record<string, Rule | string[]>;
  exclude?: readonly string[];
}

export function defineConfig(raw: UserConfig): ResolvedConfig {
  const resolved: ResolvedConfig = {
    input: raw.input,
    rules: resolveRules(raw.rules),
    exclude: Object.freeze([...(raw.exclude ?? [])]),
  };
  if (raw.inputType !== undefined) {
    (resolved as { inputType?: InputKind }).inputType = raw.inputType;
  }
  return Object.freeze(resolved);
}

function resolveRules(spec: UserConfig["rules"]): readonly Rule[] {
  const listed = spec === undefined ? [] : Array.isArray(spec) ? spec : namedToList(spec);
  // Re-declaring a rule by name overrides the earlier entry (last wins).
  const byName = new Map<string, Rule>();
  for (const rule of listed) byName.set(rule.name, rule);
  return Object.freeze([...byName.values()].map(freezeRule));
}

function namedToList(spec: Record<string, Rule | string[]>): readonly Rule[] {
  const disabled = new Set(Array.isArray(spec.disable) ? spec.disable : []);
  const listed: Rule[] = [];
  for (const [name, value] of Object.entries(spec)) {
    if (name === "disable") continue;
    listed.push(value as Rule);
  }
  return listed.filter((s) => !disabled.has(s.name));
}

function freezeRule(rule: Rule): Rule {
  // kind defaults to "noul": existing rules and configs predate the field.
  return Object.freeze({ ...rule, kind: rule.kind ?? "noul" }) as Rule;
}
