/**
 * Classify — the one-shot, one-state measurement scope (SDK surface, design §2): call jint with ANY
 * str and ANY rules, get measurements. No files, no config.
 *
 * The state IS the thing judged: the whole source is one unit, and the REGRESSION BAN holds here
 * exactly as in classifyFile — the array/matrix state (many elements x many questions in one call)
 * is forbidden, because the provider answers every question from the file's average, not the
 * element. One element per call, that element's rules batched inside the call.
 *
 * This is the MEASUREMENT-ONLY lane: handles are never applied here. Interpretation — thresholds,
 * severities, findings — is lint's job (design §4.5); classify() returns raw readings and in-band
 * ClassifyErrors, and never throws for per-unit failures.
 *
 * Shares classifyFile's single code path: question construction, inventory derivation via
 * decompose, and per-element fan-out are the same code lint runs — nothing duplicated here.
 */

import { knownLanguages, languageOf, EMBEDDED } from "./grammars/walk.ts";
import { createClassifier } from "./provider/client.ts";
import {
  checkRunKnobs,
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT,
  withLimit,
  withTimeout,
} from "./provider/pacer.ts";
import { classifiedState, classifyFile, type OversizedElement } from "./rules/classify.ts";
import {
  SetupError,
  ClassifyError,
  type Classifier,
  type Measurement,
  type Rule,
  type Unit,
} from "./types.ts";
import type { Inventory } from "./grammars/walk.ts";

/** Options for the one-shot classify scope. */
export interface ClassifyOptions {
  /** Identity + grammar detection; default "input". */
  readonly path?: string;
  /** Explicit tree-sitter grammar (e.g. "typescript") for extensionless sources. */
  readonly language?: string;
  /** Swappable classifier; defaults to the configured provider's adapter. */
  readonly classifier?: Classifier;
  /** Cap on in-flight per-element classifier calls (default 16, the shared run-wide ceiling). */
  readonly concurrency?: number;
  /** Per-call timeout in seconds (default 30): a hung call becomes PROVIDER_TIMEOUT. */
  readonly timeout?: number;
}

/** The raw outcome of one classify() call: readings and per-unit errors, never handles. */
export interface ClassifyOutcome {
  readonly measurements: Measurement[];
  readonly errors: ClassifyError[];
  /** The derived inventory, when the source parsed into elements; absent otherwise. */
  readonly inventory?: Inventory;
  /** Elements skipped as oversized (over the size backstop): never judged; each named in-band. */
  readonly oversized: readonly OversizedElement[];
}

export async function classify(
  str: string,
  rules: readonly Rule[],
  options: ClassifyOptions = {},
): Promise<ClassifyOutcome> {
  if (str === "") {
    throw new SetupError("CONFIG_INVALID", "classify: str must be a non-empty string");
  }
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const knobProblem = checkRunKnobs({ concurrency, timeout });
  if (knobProblem !== null) throw new SetupError("CONFIG_INVALID", knobProblem);
  const path = options.path ?? "input";
  const registry = EMBEDDED;
  if (
    options.language === undefined &&
    languageOf(registry, path) === null &&
    rules.some(
      (rule) => !(Array.isArray(rule.target) ? rule.target : [rule.target]).includes("files"),
    )
  ) {
    throw new SetupError(
      "MISSING_GRAMMAR",
      "cannot infer a grammar for the given source - declare it with the language option",
      { detail: { kind: "unknown-language", valid: knownLanguages(registry) } },
    );
  }
  const unit: Unit = {
    kind: "file",
    state: classifiedState({ path, content: str }),
  };
  const result = await classifyFile(
    unit,
    rules,
    withLimit(withTimeout(options.classifier ?? createClassifier(), timeout), concurrency),
    () => false,
    { language: options.language, registry },
  );
  const measurements: Measurement[] = [];
  const errors: ClassifyError[] = [];
  for (const { event, element } of result.events) {
    if (event instanceof ClassifyError) errors.push(event);
    else measurements.push({ ...event, element });
  }
  return {
    measurements,
    errors,
    oversized: result.oversized,
    inventory: result.inventory,
  };
}
