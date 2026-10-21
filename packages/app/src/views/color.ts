/**
 * Triage palette. Dots keep saturated hues (fine as 3:1 marks in both themes); TEXT uses theme
 * tokens so labels clear 4.5:1 on their own surfaces (amber-700/red-700 light, amber-300/ red-400
 * dark). --sev-* defined in index.css.
 */
export const SEVERITY = {
  error: { dot: "bg-red-500", text: "text-sev-error", row: "bg-red-500/[0.07]" },
  warn: { dot: "bg-amber-400", text: "text-sev-warn", row: "bg-amber-400/[0.07]" },
} as const;

/** A choice option's tier: the bar color of the options that make up a tier read's verdict. */
export const TIER = { pass: "bg-emerald-500", warn: "bg-amber-400", error: "bg-red-500" } as const;
