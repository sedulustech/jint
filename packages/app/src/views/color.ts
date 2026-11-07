/**
 * Triage palette: pass, warn and error each have ONE color, the --sev-* tokens in index.css, used
 * for text, dots, bars and washes alike (amber-700/red-700/emerald-700 light, amber-300/red-400/
 * emerald-400 dark, chosen so text clears 4.5:1 on its own surface). Nothing else in the app names
 * a red, amber or green.
 */
export const SEVERITY = {
  error: { dot: "bg-sev-error", text: "text-sev-error", row: "bg-sev-error/[0.07]" },
  warn: { dot: "bg-sev-warn", text: "text-sev-warn", row: "bg-sev-warn/[0.07]" },
} as const;

/**
 * A choice option's tier: the bar color of the options that make up a tier read's verdict - the
 * theme's --sev-* tokens, the same colors as the verdict text.
 */
export const TIER = { pass: "bg-sev-clean", warn: "bg-sev-warn", error: "bg-sev-error" } as const;

/** A handler tier's text: the same --sev-* tokens as the verdicts. */
export const TIER_TEXT = {
  pass: "text-sev-clean",
  warn: "text-sev-warn",
  error: "text-sev-error",
} as const;
