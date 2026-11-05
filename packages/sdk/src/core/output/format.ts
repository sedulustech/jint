/**
 * The finding-line column grammar - ONE place decides how columns align. Alignment is a property of
 * the FORMAT, not of the content: widths are fixed, so every line is byte-predictable and
 * vertically identical across runs, files, and terminals. Parsing stays whitespace-split safe
 * (LINE_SCHEMA); nothing here knows about a CLI, colors, or prefixes.
 *
 * Grammar (two-space separators, matching LINE_SCHEMA): <path 36> <rule 29> <severity 5> <score 4>
 */

/** Column widths - consts, not computed per run: cross-run stability is the point. */
export const PATH_WIDTH = 36;
export const RULE_WIDTH = 31;
export const SEVERITY_WIDTH = 5;

const ELLIPSIS = "...";

/**
 * Right-align a cell, keeping its TAIL when it overflows: a path's filename (what identifies the
 * unit) survives, the shared prefix collapses. The leading ellipsis is the only truncation marker
 * and always means "characters were dropped here".
 */
export function tailCell(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text.padStart(width);
  if (width <= ELLIPSIS.length) return text.slice(-width);
  return ELLIPSIS + text.slice(-(width - ELLIPSIS.length));
}

/** Left-align a cell, keeping its HEAD on overflow (a rule name's identifying prefix survives). */
export function headCell(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text.padEnd(width);
  if (width <= ELLIPSIS.length) return text.slice(0, width);
  return text.slice(0, width - ELLIPSIS.length) + ELLIPSIS;
}

/** A fixed-width column row: cells joined by two spaces, exactly as LINE_SCHEMA parses. */
export function row(...cells: readonly string[]): string {
  return cells.join("  ");
}
