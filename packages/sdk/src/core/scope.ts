/**
 * Per-rule include/exclude scoping (issue 008): a rule can be scoped to a subset of the walk's
 * paths instead of firing on every element. Semantics, in order:
 *
 * - Include filters FIRST (absent = the rule applies to all paths);
 * - Exclude subtracts LAST (always wins over include, even the same pattern in both).
 *
 * Patterns reuse the repo's ONE glob engine - compilePattern from input/dir.ts, the same
 * gitignore-flavored semantics the global exclude uses (anchored when the pattern contains a slash,
 * double-star-prefixed otherwise) INCLUDING dirOnly: a trailing-slash pattern ("tests/") names a
 * directory, so it matches a file path when any ancestor directory of that path matches - exactly
 * what the global exclude's tree-pruning produces, so "tests/" scopes out the whole subtree in
 * every context (review 396888e finding 2: reusing the regex without the semantics made "tests/"
 * match nothing in rule scopes while pruning everything in the global exclude). Negated globs
 * ("!pattern") are NOT supported in scope lists: the global exclude ignores them, and silently
 * ignoring a negation inside a scoping list reads as a bug, so a `!`-leading pattern is rejected at
 * load, naming the field.
 *
 * Scoping filters at element selection, before rule resolution: a scoped-out element costs zero jev
 * calls. Scoping matches the element's FILE path as the walk yields it (relative for dir inputs,
 * as-given for file inputs); it is not span-granular.
 */

import { compilePattern, type IgnoreRule } from "./input/dir.ts";
import type { Rule, UnitKind } from "./types.ts";

/**
 * Whether one compiled pattern matches a FILE path, honoring dirOnly exactly as the global exclude
 * does at its call sites: a non-dirOnly pattern tests the path itself; a dirOnly pattern names a
 * directory, so it matches when ANY ancestor directory of the path satisfies the pattern's regex
 * (the walk prunes that directory, so in the global exclude no file under it is ever yielded).
 */
function patternMatchesFile(rule: IgnoreRule, path: string): boolean {
  if (!rule.dirOnly) return rule.re.test(path);
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (rule.re.test(parts.slice(0, i).join("/"))) return true;
  }
  return false;
}

/**
 * Whether a rule judges the WHOLE unit in one call (its target routes the unit itself, not
 * inventory elements) versus element-by-element. Shared by the classify funnel's quick path and the
 * scope-note accounting so the two cannot drift (review 396888e finding 4: the predicate was
 * written twice in classify.ts).
 */
export function judgesWholeUnit(rule: Pick<Rule, "target">, unitKind: UnitKind): boolean {
  const targets = Array.isArray(rule.target) ? rule.target : [rule.target];
  return unitKind === "str" || targets.includes("files");
}

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
    if (includeRules.length > 0 && !includeRules.some((r) => patternMatchesFile(r, path)))
      return false;
    return !excludeRules.some((r) => patternMatchesFile(r, path));
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
