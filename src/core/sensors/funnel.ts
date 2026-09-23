/**
 * The two-stage measurement funnel (tmp/design.md §7.7).
 *
 * Stage 1 — sweep: one file maps into ONE systemOne call whose state is an array of elements
 * (definitions with their attached comments, standalone comment groups), plus the files-target
 * rules' own whole-content call (they are relational and have no element form). Sweep questions are
 * keyed "<rule> in <unitId>" (unitId = LOC interval); question keys never reach the model — a
 * parallel attribution map (built at question-construction time) attributes each answer to its
 * (rule, unit).
 *
 * Sweep readings are candidates, never verdicts: a reading crossing the rule's sweep threshold
 * makes its block a candidate, and sweep measurements are stage-tagged so lint never runs a handle
 * on them. Sweep thresholds are set generously for recall (see SWEEP_THRESHOLDS for the derivation)
 * and are PROVISIONAL pending a sweep-regime calibration pass.
 *
 * Stage 2 — confirm: each candidate element is re-measured ISOLATED (element content as the whole
 * state, all its rules batched in one call) using the existing handles and thresholds unchanged, so
 * the confirm regime inherits today's calibration exactly.
 *
 * Aggregation is never a mean (design §7.3): among a file's confirmed element readings for one
 * rule, high=bad rules take the max element, high=good the min — one signal per (file, rule),
 * located at the extreme element.
 *
 * No fallback: a file with no elements (empty, unparseable), an unmapped language, or a failure to
 * derive units yields no elements and nothing is swept — there is no whole-file element judgment.
 * Only the whole-unit rules' own whole-content call still runs for such a file.
 */

import { decompose, type InventoryElement } from "../input/decompose.ts";
import { MeasureError, type AnyState, type Classifier, type Measurement } from "../types.ts";
import {
  contentHash,
  elementWireId,
  compileRuleQuestions,
  invalidAnswerError,
  questionKey,
  toMeasureError,
  type QuestionAttribution,
} from "./classify.ts";
import type { QuestionSpec, Rule, Span, ElementState, Unit } from "../types.ts";

/** Which regime produced an event; sweep measurements are candidates and never run handles. */
export type FunnelStage = "file" | "sweep" | "confirm";

/**
 * Sweep (stage-1) candidate thresholds per rule, keyed by rule name. A sweeping (non-files-target)
 * rule without an entry never sweeps (and so never confirms) — deliberately conservative for custom
 * rules until they are calibrated for the array regime.
 *
 * Derivation — start at the rule's error threshold pulled 0.15 toward the healthy side (the array
 * regime dampens flagged elements by -0.1..-0.2 relative to isolated, design §7.6), then clamp at
 * least 0.1 beyond the healthy band so healthy elements cannot become candidates. Each block-rule
 * threshold is then shifted up by +0.05 from the pre-criteria-rule derivation — the measured mean
 * uplift from the criteria-as-rule probe (will_comment_drift 0.770 -> 0.820, batch-of-4, 4 draws),
 * applied uniformly to all six block rules.
 *
 * PROVISIONAL: these are the pre-recalibration values plus that flat +0.05; a sweep-regime
 * calibration pass on the criteria-as-rule form must re-derive them.
 *
 * | rule                            | error | -0.15 | healthy band        | sweep |
 * | ------------------------------- | ----- | ----- | ------------------- | ----- |
 * | will_comment_drift (high=bad)   | >0.70 | 0.55  | <=0.50 (A/B)        | 0.65  |
 * | is_comment_narration (high=bad) | >0.45 | 0.30  | <=0.40 (A/B)        | 0.55  |
 * | is_comment_patching_readability | >0.55 | 0.40  | <=0.40 (warn bound) | 0.55  |
 * | is_cognitively_complex (hi=bad) | >0.60 | 0.45  | <=0.45 (warn bound) | 0.60  |
 * | is_name_purposeful (high=good)  | <0.50 | 0.65  | >=0.60 (warn bound) | 0.55  |
 * | is_naming_convention_consistent | <0.65 | 0.80  | >=0.85 (warn bound) | 0.80  |
 *
 * The healthy bands for drift and narration are the measured A/B ceilings (granularity-ab.md:
 * healthy client.ts elements read <=0.5 drift, <=0.4 narration in the array regime); elsewhere the
 * handle's warn boundary stands in. Note the narration clamp: flagged A/B elements read 0.43-0.49,
 * so the cut trades recall for zero healthy-band overlap — provisional, see above.
 */
export const SWEEP_THRESHOLDS: Record<string, number> = {
  will_comment_drift: 0.65,
  is_comment_narration: 0.55,
  is_comment_patching_readability: 0.55,
  is_cognitively_complex: 0.6,
  is_name_purposeful: 0.55,
  is_naming_convention_consistent: 0.8,
  // provisional anchor, high = SRP holds
  is_function_srp: 0.55,
};

/** High=good rules error below their threshold; the extreme element reading is their minimum. */
export const HIGH_GOOD: ReadonlySet<string> = new Set([
  "is_name_purposeful",
  "is_vocabulary_consistent",
  "is_naming_convention_consistent",
  "is_function_srp",
  "is_greppable",
]);

export const isHighGood = (ruleName: string): boolean => HIGH_GOOD.has(ruleName);

/** Content-addressed wire id for diff-element content (re-export; defined in classify.ts). */
export { contentHash };

/** One sweep candidate: the flagged element, ready for isolated confirmation. */
interface Candidate {
  readonly element: InventoryElement;
  readonly blockId: string;
  readonly rules: readonly Rule[];
}

/**
 * Sensors whose target matches a element's kind. "definitions" rules take definition elements;
 * "comments" rules take standalone comment elements and definitions carrying attached docblocks
 * (drift-prone artifact pinning lives there). Files-target rules never sweep.
 */
const sensorsForElement = (rules: readonly Rule[], element: InventoryElement): Rule[] => {
  const commentElement = element.role === "comment";
  const carriesComment = commentElement || (element.attachedComment?.length ?? 0) > 0;
  return rules.filter((s) =>
    s.target === "comments"
      ? carriesComment
      : s.target === "functions"
        ? !commentElement && element.role === "function"
        : s.target === "definitions"
          ? !commentElement
          : false,
  );
};

/** A confirmed (stage-2) reading, awaiting per-file aggregation in lint. */
export interface ConfirmedReading {
  readonly rule: string;
  readonly value: number;
  /** The block-scoped measurement input, "path#L19-L28". */
  readonly input: string;
  readonly span: Span;
}

/** One streamed event plus the regime that produced it. */
export interface FunnelEvent {
  readonly event: Measurement | MeasureError;
  readonly stage: FunnelStage;
}

export interface FunnelResult {
  readonly events: FunnelEvent[];
  readonly confirmed: ConfirmedReading[];
  /** A JEV_AUTH error aborts the whole run (same contract as the legacy path). */
  readonly fatal: boolean;
}

/**
 * Measure one file unit through the funnel; a file that maps to no element units yields no sweep at
 * all (no whole-file judgment). isAborted lets an in-flight file stop before further classifier
 * calls once the run is aborting (JEV_AUTH elsewhere in the wave).
 */
export async function classifyFile(
  unit: Unit,
  rules: readonly Rule[],
  classifier: Classifier,
  isAborted: () => boolean = () => false,
): Promise<FunnelResult> {
  const state = unit.state;
  const content =
    "content" in state && typeof state.content === "string"
      ? state.content
      : String((state as unknown as Record<string, unknown>).diff ?? "");

  // Mapping a file to elements is best-effort: an unmapped or unparseable file maps to no
  // elements, so nothing is swept and its inventory-scoped rules fail with a per-unit error
  // (no whole-file judgment, no fallback). Whole-unit rules keep their own whole-content call
  // below; their target never needed parsing, so they proceed untouched.
  let inventory: InventoryElement[] = [];
  let degraded: string | null = null;
  if (unit.kind !== "file") {
    degraded = "non-file unit";
  } else {
    const language = languageOf(state.path);
    if (language === null) {
      degraded = "no grammar mapping for extension";
    } else {
      try {
        const parsed = await decompose(content, language);
        inventory = [...parsed.definitions, ...parsed.comments];
        if (inventory.length === 0) degraded = "no definitions or comments found";
      } catch {
        degraded = "parse failed";
      }
    }
  }
  const events: FunnelEvent[] = [];
  const confirmed: ConfirmedReading[] = [];
  const push = (event: Measurement | MeasureError, stage: FunnelStage): void => {
    events.push({ event, stage });
  };

  // Whole-unit rules: files-target rules are relational claims judged over the whole unit;
  // on a diff unit the diffs-target rules join, judging the raw diff string as one unit
  // (quick path: verbatim, no parsing, no per-unit ids - design §4 Diff units).
  const wholeRules = rules.filter(
    (s) => s.target === "files" || (s.target === "diffs" && unit.kind === "diff"),
  );
  const fileId = "id" in state ? state.id : contentHash(state.diff);
  if (wholeRules.length > 0) {
    const file = await call(
      state,
      compileRuleQuestions(wholeRules, fileId).questions,
      classifier,
      state.path,
    );
    collect(
      push,
      "file",
      file,
      wholeRules.map((s) => questionKey(s.name, fileId)),
      state.path,
    );
    if (fatalIn(events)) return { events, confirmed, fatal: true };
  }

  // No-fallback policy: the unit could not be mapped to elements, so every inventory-scoped
  // rule fails for it with one per-unit error. Unit-scoped rules (files/diffs) proceed above —
  // their target never needed parsing; that is not a fallback.
  if (degraded !== null && unit.kind === "file") {
    push(
      new MeasureError("MAPPING_FAILED", state.path, `cannot map to elements: ${degraded}`),
      "file",
    );
  }

  // Stage 1: the array state, one question per (element, sweeping rule).
  const sweepElements: ElementState[] = [];
  const questions: Record<string, QuestionSpec> = {};
  const elementById = new Map<string, InventoryElement>();
  const sweepAttribution = new Map<string, QuestionAttribution>();
  // Wire ids are LOC intervals (treesitter spans, disjoint per file); reports keep block-N labels.
  const wireLabels = new Map<string, string>();
  let n = 0;
  for (const element of inventory) {
    const granSensors = sensorsForElement(rules, element);
    if (granSensors.length === 0) continue;
    const humanLabel = `element-${n++}`;
    const content = elementContent(element);
    const wireId = elementWireId(element.span);
    wireLabels.set(wireId, humanLabel);
    sweepElements.push({ id: wireId, content });
    elementById.set(wireId, element);
    const batch = compileRuleQuestions(granSensors, wireId);
    Object.assign(questions, batch.questions);
    for (const [key, attr] of batch.attribution) sweepAttribution.set(key, attr);
  }
  if (sweepElements.length === 0 || isAborted()) return { events, confirmed, fatal: false };

  // Chunked fan-out: a single response serializes answers past ~20-50 questions (~0.12s each),
  // so the sweep splits into <=50-question calls run concurrently (measured: 207 answers in
  // 26s unchunked vs 3.2s chunked; answers stable at mean |delta| 0.02 across shapes).
  const sweepAnswers: Record<string, number> = {};
  const sweepErrors: MeasureError[] = [];
  const sweepKeys = Object.keys(questions);
  const SWEEP_CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < sweepKeys.length; i += SWEEP_CHUNK)
    chunks.push(sweepKeys.slice(i, i + SWEEP_CHUNK));
  await Promise.all(
    chunks.map(async (chunkKeys) => {
      const chunkQuestions = Object.fromEntries(chunkKeys.map((k) => [k, questions[k]!]));
      const result = await call(
        { path: state.path, elements: sweepElements },
        chunkQuestions,
        classifier,
        state.path,
      );
      if (result.error !== null) sweepErrors.push(result.error);
      Object.assign(sweepAnswers, result.answers);
    }),
  );
  for (const err of sweepErrors) push(err, "sweep");
  const sweep = { answers: sweepAnswers };
  for (const [key, value] of Object.entries(sweep.answers)) {
    const attr = sweepAttribution.get(key);
    if (attr === undefined) {
      push(invalidAnswerError(state.path, key), "sweep");
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      push(invalidAnswerError(state.path, attr.rule), "sweep");
      continue;
    }
    push(
      // sweep attribution is always block-scoped; reports address the block by its LOC id
      {
        rule: attr.rule,
        input: `${state.path}#${attr.blockId}`,
        value,
      },
      "sweep",
    );
  }
  if (fatalIn(events)) return { events, confirmed, fatal: true };

  // Candidates: sweep readings crossing the generous sweep threshold — recall, not verdicts.
  const candidates = new Map<string, Candidate>();
  for (const [key, value] of Object.entries(sweep.answers)) {
    const attr = sweepAttribution.get(key);
    if (attr === undefined || attr.blockId === null) continue;
    const threshold = SWEEP_THRESHOLDS[attr.rule];
    if (threshold === undefined) continue;
    const crosses = HIGH_GOOD.has(attr.rule) ? value < threshold : value > threshold;
    const element = elementById.get(attr.blockId);
    if (crosses && element && !candidates.has(attr.blockId)) {
      candidates.set(attr.blockId, {
        element,
        blockId: attr.blockId,
        rules: sensorsForElement(rules, element),
      });
    }
  }

  // Stage 2: confirm flagged elements isolated — rules batched per element, handles unchanged.
  for (const { element, blockId, rules: granSensors } of candidates.values()) {
    if (isAborted()) break;
    const input = `${state.path}#${blockId}`;
    const isolated = await call(
      { path: state.path, content: elementContent(element), id: blockId },
      compileRuleQuestions(granSensors, blockId).questions,
      classifier,
      input,
    );
    collect(
      push,
      "confirm",
      isolated,
      granSensors.map((s) => questionKey(s.name, blockId)),
      input,
    );
    for (const rule of granSensors) {
      const value = isolated.answers[questionKey(rule.name, blockId)];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      confirmed.push({ rule: rule.name, value, input, span: element.span });
    }
  }

  return { events, confirmed, fatal: false };
}

/**
 * A definition's attached docblock is consumed into the element (design §7.2) — it reads as
 * written.
 */
function elementContent(element: InventoryElement): string {
  return [...(element.attachedComment ?? []), element.content].join("\n");
}

interface CallResult {
  readonly answers: Record<string, number>;
  readonly error: MeasureError | null;
}

async function call(
  state: AnyState,
  questions: Record<string, QuestionSpec>,
  classifier: Classifier,
  input: string,
): Promise<CallResult> {
  try {
    return { answers: await classifier(state, questions), error: null };
  } catch (thrown) {
    return { answers: {}, error: toMeasureError(input, thrown) };
  }
}

/** Distribute one call's answers as measurements keyed by the given question names. */
function collect(
  push: (event: Measurement | MeasureError, stage: FunnelStage) => void,
  stage: FunnelStage,
  result: CallResult,
  questionNames: readonly string[],
  input: string,
): void {
  if (result.error !== null) {
    push(result.error, stage);
    return;
  }
  for (const key of questionNames) {
    const value = result.answers[key];
    // question keys are "<rule> in <unitId>"; the rule is the part before the unit id
    const rule = key.slice(0, key.indexOf(" in "));
    if (typeof value !== "number" || !Number.isFinite(value)) {
      push(invalidAnswerError(input, rule), stage);
      continue;
    }
    push({ rule, input, value }, stage);
  }
}

function fatalIn(events: FunnelEvent[]): boolean {
  return events.some((e) => e.event instanceof MeasureError && e.event.code === "JEV_AUTH");
}

/** The funnel's languages: the tree-sitter grammars actually mapped by decompose (design §7.2). */
export function languageOf(path: string): string | null {
  return /\.(m|c)?tsx?$/.test(path) ? "typescript" : null;
}
