/** Severity palette. Hues saturated enough to survive on #0a0a0a. */

/** Triage palette. Severity hues saturated enough to survive on #0a0a0a; bands tints, not fills. */
export const SEVERITY = {
  error: { dot: "bg-red-500", text: "text-red-400", row: "bg-red-500/[0.07]" },
  warn: { dot: "bg-amber-400", text: "text-amber-300", row: "bg-amber-400/[0.07]" },
} as const;
