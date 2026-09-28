/**
 * Per-rule include/exclude scoping (issue 008): a rule can be scoped to a subset of the walk's
 * paths instead of firing on every element. Semantics, in order:
 *
 * - Include filters FIRST (absent = the rule applies to all paths);
 * - Exclude subtracts LAST (always wins over include, even the same pattern in both).
 *
 * Patterns reuse the repo's ONE glob engine - compilePattern from input/dir.ts, the same
 * gitignore-flavored semantics the global exclude uses (anchored when the pattern contains a slash,
 * double-star-prefixed otherwise). Negated globs ("!pattern") are NOT supported in scope lists: the
 * global exclude ignores them, and silently ignoring a negation inside a scoping list reads as a
 * bug, so a `!`-leading pattern is rejected at load, naming the field.
 *
 * Scoping filters at element selection, before rule resolution: a scoped-out element costs zero jev
 * calls. Scoping matches the element's FILE path as the walk yields it (relative for dir inputs,
 * as-given for file inputs); it is not span-granular.
 */

import { compilePattern, type IgnoreRule } from "./input/dir.ts";

export interface ScopeKeys {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

/** Validates both scope keys; the error names the exact field (shared by both tiers). */
export function checkRuleScope(keys: ScopeKeys): string | null {
  for (const field of ["include", "exclude"] as const) {
    const list = keys[field];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length === 0) {
      return `${field}: must be a non-empty array of glob strings`;
    }
    for (const pattern of list) {
      if (typeof pattern !== "string" || pattern.trim() === "") {
        return `${field}: every entry must be a non-empty glob string`;
      }
      if (pattern.startsWith("!")) {
        return `${field}: negated globs (!pattern) are not supported in scope lists - use exclude for subtraction`;
      }
    }
  }
  return null;
}

export interface CompiledScope {
  /** The scope predicate over a walk path. */
  matches(path: string): boolean;
  /** True when exclude cancels include entirely (same pattern in both lists): measures nothing. */
  readonly measuresNothing: boolean;
}

/** Compiles the scope lists once; undefined = unscoped (the rule applies everywhere). */
export function compileRuleScope(keys: ScopeKeys): CompiledScope | undefined {
  const { include, exclude } = keys;
  if (include === undefined && exclude === undefined) return undefined;
  const includeRules: readonly IgnoreRule[] = (include ?? []).map(compilePattern);
  const excludeRules: readonly IgnoreRule[] = (exclude ?? []).map(compilePattern);
  const matches = (path: string): boolean => {
    if (includeRules.length > 0 && !includeRules.some((r) => r.re.test(path))) return false;
    return !excludeRules.some((r) => r.re.test(path));
  };
  // exclude fully cancels include when every include pattern is also an exclude pattern (exact
  // string match - the conservative, checkable case; overlapping-but-not-equal globs stay legal).
  const measuresNothing =
    include !== undefined &&
    include.length > 0 &&
    exclude !== undefined &&
    include.every((p) => (exclude as readonly string[]).includes(p));
  return { matches, measuresNothing };
}

const scopeCache = new WeakMap<object, CompiledScope | undefined>();

/**
 * The per-rule predicate, compiled once per rule object (rules are frozen data; the cache rides on
 * object identity). Unscoped rules compile to undefined and always pass.
 */
export function ruleInScope(rule: ScopeKeys, path: string): boolean {
  let scope = scopeCache.get(rule);
  if (scope === undefined && !scopeCache.has(rule)) {
    scope = compileRuleScope(rule);
    scopeCache.set(rule, scope);
  }
  return scope === undefined ? true : scope.matches(path);
}

/** True when the rule's exclude list cancels its include list (legal; notes, never errors). */
export function ruleMeasuresNothing(rule: ScopeKeys): boolean {
  return compileRuleScope(rule)?.measuresNothing ?? false;
}
