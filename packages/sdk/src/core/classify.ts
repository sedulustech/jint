/**
 * Classify — the one-shot, one-state measurement door (SDK surface, design §2): call jint with ANY
 * str and ANY rules, get measurements. No files, no config.
 *
 * The state IS the thing judged: the whole source is one unit, and the REGRESSION BAN holds here
 * exactly as in classifyFile — the array/matrix state (many elements x many questions in one call)
 * is forbidden, because jev answers every question from the file's average, not the element. One
 * element per call, that element's rules batched inside the call.
 *
 * This is the MEASUREMENT-ONLY door: handles are never applied here. Interpretation — thresholds,
 * severities, findings — is lint's job (design §4.5); classify() returns raw readings and in-band
 * ClassifyErrors, and never throws for per-unit failures.
 *
 * Shares classifyFile's single code path: question construction, inventory derivation via
 * decompose, and per-element fan-out are the same code lint runs — nothing duplicated here.
 */

import { createClassifier } from "./jev/client.ts";
import {
  checkRunKnobs,
  createRpsPacer,
  DEFAULT_CONCURRENCY,
  DEFAULT_RPS_BUDGET,
  DEFAULT_TIMEOUT,
  withLimit,
  withPacer,
  withTimeout,
} from "./jev/pacer.ts";
import { classifyFile, elementWireId } from "./sensors/classify.ts";
import {
  SetupError,
  ClassifyError,
  type Classifier,
  type Measurement,
  type Rule,
  type Unit,
} from "./types.ts";
import type { Inventory } from "./input/walk.ts";

/** Options for the one-shot classify door. */
export interface ClassifyOptions {
  /** Identity + grammar detection; default "input". */
  readonly path?: string;
  /** Explicit tree-sitter grammar (e.g. "typescript") for extensionless sources. */
  readonly language?: string;
  /** Swappable classifier; defaults to the TypeSafe System One adapter (same seam as lint). */
  readonly classifier?: Classifier;
  /** Cap on in-flight per-element classifier calls (default DEFAULT_CONCURRENCY). */
  readonly concurrency?: number;
  /** Client-side request-start budget, requests/second (default DEFAULT_RPS_BUDGET). */
  readonly rps_budget?: number;
  /** Per-call timeout in seconds (default DEFAULT_TIMEOUT): a hung call becomes JEV_TIMEOUT. */
  readonly timeout?: number;
}

/** The raw outcome of one classify() call: readings and per-unit errors, never handles. */
export interface ClassifyOutcome {
  readonly measurements: Measurement[];
  readonly errors: ClassifyError[];
  /** The derived inventory, when the source parsed into elements; absent otherwise. */
  readonly inventory?: Inventory;
  /** Elements skipped as oversized (over MAX_ELEMENT_CHARS): never judged, reported in-band. */
  readonly oversized: number;
}

/**
 * Classify one str against rules: unit-scoped rules judge the whole str in one call;
 * inventory-scoped rules have the inventory derived internally (via decompose, shared with
 * classifyFile) and judge each element in its own one-element call.
 *
 * Decompose failure (no language resolvable, unparseable) is an in-band WALK_FAILED ClassifyError
 * in errors — never thrown — and inventory is omitted; unit-scoped rules still classify.
 */
export async function classify(
  str: string,
  rules: readonly Rule[],
  options: ClassifyOptions = {},
): Promise<ClassifyOutcome> {
  if (str === "") {
    throw new SetupError("CONFIG_INVALID", "classify: str must be a non-empty string");
  }
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const rpsBudget = options.rps_budget ?? DEFAULT_RPS_BUDGET;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const knobProblem = checkRunKnobs({ concurrency, rps_budget: rpsBudget, timeout });
  if (knobProblem !== null) throw new SetupError("CONFIG_INVALID", knobProblem);
  const path = options.path ?? "input";
  const unit: Unit = {
    kind: "file",
    state: {
      path,
      content: str,
      id: elementWireId({ start: { line: 1 }, end: { line: str.split("\n").length } }),
    },
  };
  const result = await classifyFile(
    unit,
    rules,
    withLimit(
      withPacer(
        withTimeout(options.classifier ?? createClassifier(), timeout),
        createRpsPacer(rpsBudget, concurrency),
      ),
      concurrency,
    ),
    () => false,
    { language: options.language },
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
    ...(result.inventory !== undefined && { inventory: result.inventory }),
  };
}
