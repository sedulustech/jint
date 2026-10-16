/**
 * DescribeRules — full-prose render of the active rule set for the agent's context.
 *
 * Printed to stderr BEFORE classification so the rubric is in the consumer's context when the
 * findings arrive. Findings carry rule names; this block is the only place their meaning lives
 * in-band. Full prose by design: the failure mode is missing criteria, not long criteria. No
 * summary, no truncation, no "..." — each rule is complete and self-contained.
 */
import type { Rule } from "../types.ts";

function opText(c: { greater_than?: number; less_than?: number }): string {
  if (c.greater_than !== undefined) return "> " + c.greater_than;
  if (c.less_than !== undefined) return "< " + c.less_than;
  return "?";
}

/** The single-line threshold summary for one rule's handle data. */
function handleLine(rule: Rule): string {
  const h = rule.handleData;
  if (h === undefined) return "no handle (measurement only)";
  if ("map" in h) {
    return "level map: " + h.map.join(" / ");
  }
  const parts = ["warn " + opText(h.warn)];
  if (h.error !== undefined) parts.push("error " + opText(h.error));
  if (h.silent_band !== undefined) parts.push("silent [" + h.silent_band.join(", ") + "]");
  return parts.join(" · ");
}

/**
 * Describe one rule in full prose. Every field that defines what the rule measures is present:
 * target (what it judges), instructions (the question), criteria (the boundary), handle (when it
 * fires).
 */
export function describeRule(rule: Rule): string {
  const lines: string[] = [];
  lines.push(
    rule.name + "  [" + (Array.isArray(rule.target) ? rule.target.join(",") : rule.target) + "]",
  );
  const h = handleLine(rule);
  lines.push("  " + h);
  if ("instructions" in rule && rule.instructions !== undefined) {
    lines.push("  asks: " + rule.instructions);
  }
  if ("criteria" in rule) {
    const c = rule.criteria;
    if ("true" in c && "false" in c) {
      lines.push("  1  " + c.true);
      lines.push("  0  " + c.false);
    } else if (Array.isArray(c)) {
      // choice rubric: one line per level
      c.forEach((level, i) => lines.push("  " + i + "  " + level));
    }
  }
  return lines.join("\n");
}

/**
 * The full pre-classification block: one empty-line-separated rule per entry. Deterministic order
 * (rules arrive in config/default order). Ends with a blank line.
 */
export function describeRules(rules: readonly Rule[]): string {
  return rules.map(describeRule).join("\n\n") + "\n";
}
