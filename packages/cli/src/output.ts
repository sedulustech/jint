/**
 * The CLI's single output module: the stderr/stdout write sites, and the one writer of the `jint: `
 * prefix (emit). The SDK's strings arrive unprefixed - the prefix is the CLI's voice, so it is
 * written here and nowhere else. (The SDK keeps its own core/output renderers, unprefixed; this
 * module is where they meet the terminal.)
 */

import { describeRules, type Rule } from "@jint/sdk";

/**
 * The one stderr emitter: every stderr line jint prints routes through here, and the `jint: `
 * prefix is written only here — the SDK's strings arrive unprefixed (the prefix is the client's
 * voice, never the SDK's). The message leads; an optional code trails in brackets; the note kind
 * adds its voice word. Error and info exist for the severity story, not for different shapes: a
 * code-less error renders like a bare message.
 */
export function emit(line: {
  message: string;
  code?: string;
  kind?: "note" | "error" | "info";
}): void {
  const voice = line.kind === "note" ? "note: " : "";
  const code = line.code !== undefined ? ` [${line.code}]` : "";
  process.stderr.write(`jint: ${voice}${line.message}${code}\n`);
}

/** The tool prefix, owned by emit; only stdout payloads that quote it (dry-run's header) reuse it. */
const JINT_PREFIX = "jint: ";

/** The run's transport log (vendor backoff/warn/error): unprefixed lines through the emitter. */
export function jevLog(line: string): void {
  emit({ message: line, kind: "info" });
}

/** Multi-line stderr text from the SDK (renderLines' blob): one emit per non-blank line. */
export function emitLines(text: string): void {
  for (const line of text.split("\n")) if (line !== "") emit({ message: line });
}

/** The run's rubric header line (unprefixed): how many rules and the custom-tier note. */
function measuringLine(effective: readonly Rule[], customCount: number): string {
  const tsNote =
    customCount > 0
      ? ` + ${customCount} custom rule${customCount === 1 ? "" : "s"} (declared inline)`
      : "";
  return `measuring with ${effective.length} rule${effective.length === 1 ? "" : "s"}${tsNote}`;
}

/**
 * The stderr rules pre-print: header + full-prose rule descriptions (SDK describeRules) + a ts-rule
 * count note when the config declares custom-tier rules (their names load at run time, so only the
 * count prints here — never claim fewer rules than the run uses). The block is the rubric in the
 * consumer's context BEFORE the findings; stdout stays untouched. The CLI owns this function's
 * voice; the SDK owns describeRules (same block, neutral).
 */
export function printRules(effective: readonly Rule[], customCount: number): void {
  emit({ message: measuringLine(effective, customCount) });
  process.stderr.write("\n" + describeRules(effective));
}

/** --dry-run's payload: the same block, but stdout - the flag's whole product, pipe-able. */
export function printRulesStdout(effective: readonly Rule[], customCount: number): void {
  process.stdout.write(
    `${JINT_PREFIX}${measuringLine(effective, customCount)}\n\n` + describeRules(effective),
  );
}

/**
 * --dry-run --json's payload: the effective rule set as ONE JSON document on stdout (the rules'
 * declared shape - name, kind, target, criteria, handle - what the run WILL load), byte-clean for
 * the documented --json promise; the banner stays on stderr.
 */
export function printRulesJson(effective: readonly Rule[], customCount: number): void {
  emit({ message: measuringLine(effective, customCount) });
  process.stdout.write(JSON.stringify({ rules: effective, customRules: customCount }, null, 2));
}

/** A usage error: the emitter's bare-error shape (message leads, no code - nothing to code yet). */
export function usageError(usageMessage: string): void {
  emit({ message: usageMessage, kind: "error" });
}
