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

import {
  compilePattern,
  patternMatchesFile,
  type OwnedScope,
  type IgnoreRule,
} from "./input/dir.ts";

export type { OwnedScope };
import type { Rule, UnitKind } from "./types.ts";

// patternMatchesFile lives in the dir walker (the walk-union collapse: ONE matcher, both consumers
// - the walker's scopes here and the per-rule scoping below). Import, never re-derive.

/**
 * Whether a rule judges the WHOLE unit in one call (its target routes the unit itself, not
 * inventory elements) versus element-by-element. Shared by the classify funnel's quick path and the
 * scope-note accounting so the two cannot drift (a review finding: the predicate was once written
 * in two places).
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

/**
 * The walk's scopes (walk-union): the config scope PLUS one scope per rule that declares an include
 * - a rule that names a file claims jurisdiction over it even where the config exclude would drop
 * it. Rules WITHOUT an include never open a scope: they follow the config scope (an unscoped rule
 * measuring everything would make the config include meaningless). Order is attribution: config
 * first, then rules in config order (first admitting scope owns the file).
 */
export function walkScopes(
  configInclude: readonly string[],
  rules: readonly {
    readonly name: string;
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  }[],
): readonly OwnedScope[] {
  const scopes: OwnedScope[] = [{ by: "config", patterns: configInclude }];
  for (const rule of rules) {
    if (rule.include === undefined || rule.include.length === 0) continue;
    scopes.push({ by: "rule:" + rule.name, patterns: rule.include, exclude: rule.exclude });
  }
  return scopes;
}

/**
 * THE rule-scope claim test (one semantics, both consumers - walk admission and the file-operand
 * scope check): a rule scope claims a file when one of its include patterns matches AND its own
 * exclude does not subtract it. A rule that excludes a file from its scope does not claim it - the
 * include naming the file is not a claim when the rule's own exclude says otherwise (the operand
 * note 'no rule include names it' must never lie about a rule that names-and-drops).
 */
export function ruleScopeClaims(scope: OwnedScope, path: string): boolean {
  if (scope.by === "config" || !includePatternsMatch(scope, path)) return false;
  const exclude = scope.exclude ?? [];
  return exclude.length === 0 || !exclude.some((p) => patternMatchesFile(compilePattern(p), path));
}

function includePatternsMatch(scope: OwnedScope, path: string): boolean {
  return scope.patterns.some((p) => patternMatchesFile(compilePattern(p), path));
}

/**
 * THE config-scope admission test (one logic, every input kind - the walk-union contract): a path
 * is behind the config scope when the include whitelist admits it (an empty list admits everything)
 * AND no exclude pattern drops it. Dir walks enforce the same scopes inside the walker, file
 * operands evaluate the same predicate on the named path - never a second definition. Rule scopes
 * are not consulted here: a rule that names a file claims it across the config exclude (that
 * composition lives in rule selection, once, at every consumer: ruleInScope(rule, path) &&
 * (rule.include !== undefined || configScopeAdmits(path))).
 */
export function configScopeAdmits(
  configInclude: readonly string[],
  exclude: readonly string[],
): (path: string) => boolean {
  const includeRules = configInclude.map(compilePattern);
  const excludeRules = exclude.map(compilePattern);
  return (path) =>
    (includeRules.length === 0 || includeRules.some((r) => patternMatchesFile(r, path))) &&
    !excludeRules.some((r) => patternMatchesFile(r, path));
}
