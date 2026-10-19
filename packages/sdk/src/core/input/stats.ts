/**
 * The run's input accounting: how many files the walk saw, and why not all of them were measured.
 * One summary per run (run.input in the report; the human line on stderr), fed by the dir walker
 * (per-file scopes) and the capture walk (MISSING_GRAMMAR).
 *
 * The scopes, and what they count:
 *
 * - Excluded[]: config/CLI exclude GLOBS, first-match attribution - a dropped file counts against the
 *   FIRST glob that drops it; a glob that dropped nothing is omitted. A glob that prunes a
 *   DIRECTORY counts the directory once - its files were never discovered, so they are nowhere.
 * - Skipped[]: walk-time drops keyed by reason. Reasons are the walk's own vocabulary: NOT_IN_INCLUDE
 *   (include patterns exist and none matched), BINARY, DENYLIST (incl. PEM), GITIGNORE,
 *   MISSING_GRAMMAR (the capture walk; lint measures such files as raw source).
 * - Discovered counts files the walker saw; .gitignore files and pruned directory trees (denylist,
 *   DEFAULT_SKIP_DIRS) are outside the universe - never discovered. included + every
 *   excluded/skipped count decomposes discovered, except where a directory prune swallowed a tree
 *   (counted once as above).
 */

import type { OwnedScope } from "./dir.ts";

/** One exclude glob and how many drops it owns (first-match attribution). */
export interface ExcludeTally {
  readonly glob: string;
  readonly count: number;
}

/** One walk-time skip reason and how many files it dropped. */
export interface SkipTally {
  readonly reason: string;
  readonly count: number;
}

/**
 * One admission scope and how many files it admitted (first-match attribution: a file counts
 * against the FIRST scope that admits it - the config scope ahead of every rule scope, so a rule
 * scope's count is exactly the files ONLY it claims). `by` is "config" or "rule:<name>".
 */
export interface AdmitTally {
  readonly by: string;
  readonly count: number;
}

/** The decided report shape (run.input): flat, every key at one level. */
export interface InputSummary {
  readonly discovered: number;
  readonly included: number;
  readonly excluded: readonly ExcludeTally[];
  readonly skipped: readonly SkipTally[];
  /** Which scope admitted each included file (decomposes `included`; walk-union). */
  readonly admitted: readonly AdmitTally[];
}

/** The mutable accumulator the walker feeds; summary() freezes it into the report shape. */
export interface InputStats {
  markDiscovered(): void;
  markIncluded(): void;
  /**
   * Take back one inclusion: the walker counts a yielded unit as included, and a scope that drops
   * the unit AFTER the walk (capture's no-grammar skip) retracts it - `included` means MEASURED by
   * this scope, not merely yielded by the walker.
   */
  retractIncluded(): void;
  tallyExclude(glob: string): void;
  tallySkip(reason: string): void;
  /** Attribute one admitted file to its scope ("config" or "rule:<name>"). */
  tallyAdmit(by: string): void;
  summary(): InputSummary;
}

/** Create the accumulator; zero-count entries never reach the summary. */
export function inputStats(): InputStats {
  let discovered = 0;
  let included = 0;
  const excluded = new Map<string, number>();
  const skipped = new Map<string, number>();
  const admitted = new Map<string, number>();
  return {
    markDiscovered: () => {
      discovered += 1;
    },
    markIncluded: () => {
      included += 1;
    },
    retractIncluded: () => {
      included -= 1;
    },
    tallyExclude: (glob) => {
      excluded.set(glob, (excluded.get(glob) ?? 0) + 1);
    },
    tallySkip: (reason) => {
      skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
    },
    tallyAdmit: (by) => {
      admitted.set(by, (admitted.get(by) ?? 0) + 1);
    },
    summary: () => ({
      discovered,
      included,
      excluded: [...excluded.entries()].map(([glob, count]) => ({ glob, count })),
      skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
      // deterministic order: the config scope first, then rule scopes alphabetically
      // (insertion order would be walk order - a readdir accident, not a contract)
      admitted: [...admitted.entries()]
        .sort((x, y) => (x[0] === "config" ? -1 : y[0] === "config" ? 1 : x[0].localeCompare(y[0])))
        .map(([by, count]) => ({ by, count })),
    }),
  };
}

/** The skip reason strings (one home, no drift between walker and capture walk). */
export const SKIP_REASONS = {
  notInInclude: "NOT_IN_INCLUDE",
  binary: "BINARY",
  denylist: "DENYLIST",
  gitignore: "GITIGNORE",
  missingGrammar: "MISSING_GRAMMAR",
} as const;

/** Scope list for the naming line: config patterns plain, rule scopes attributed. */
function scopesLabel(scopes: readonly OwnedScope[]): string {
  const parts: string[] = [];
  for (const scope of scopes) {
    if (scope.by === "config") {
      if (scope.patterns.length > 0) parts.push(scope.patterns.join(", "));
    } else {
      parts.push(scope.patterns.join(", ") + " (" + scope.by + ")");
    }
  }
  return parts.join("; ");
}

/**
 * The human mirror, 1-2 stderr lines. Prints ONLY when something was dropped - the same policy for
 * run and capture: a clean walk adds no line, a dropped-file walk never reads as clean. Line one is
 * the ruling's shape ("34 of 120 files (...)"); line two exists only when NOTHING was measured and
 * names the scope that dropped everything.
 */
export function renderInputSummary(summary: InputSummary, scopes: readonly OwnedScope[]): string[] {
  const excludedTotal = summary.excluded.reduce((n, e) => n + e.count, 0);
  const skippedDetail = [...summary.skipped]
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .map((s) => s.reason + " " + String(s.count));
  const ruleAdmitted = summary.admitted.filter((t) => t.by !== "config");
  const ruleAdmittedTotal = ruleAdmitted.reduce((n, t) => n + t.count, 0);
  const parts: string[] = [];
  if (ruleAdmittedTotal > 0) parts.push(String(ruleAdmittedTotal) + " admitted by rule include");
  if (excludedTotal > 0) parts.push(String(excludedTotal) + " excluded by config");
  if (skippedDetail.length > 0) parts.push("skipped: " + skippedDetail.join(", "));
  const dropped = excludedTotal + summary.skipped.reduce((n, s) => n + s.count, 0);
  if (dropped === 0) return [];
  const head =
    "input: " +
    String(summary.included) +
    " of " +
    String(summary.discovered) +
    " files" +
    (parts.length > 0 ? " (" + parts.join(", ") + ")" : "");
  if (summary.included > 0 || summary.discovered === 0) return [head];
  const notIncluded = summary.skipped.find(
    (s) => s.reason === SKIP_REASONS.notInInclude && s.count >= summary.discovered - excludedTotal,
  );
  if (notIncluded !== undefined && scopes.length > 0) {
    return [
      head,
      "input: every discovered file fell outside every scope [" +
        scopesLabel(scopes) +
        "] - widen the include patterns or point the walk at files they cover",
    ];
  }
  return [head, "input: nothing was measured - every discovered file was excluded or skipped"];
}
