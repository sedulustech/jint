/**
 * The two-stage measurement funnel (tmp/design.md §7.7).
 *
 * Stage 1 — sweep: one file maps into ONE systemOne call whose state is an array of blocks
 * (definitions with their attached comments, standalone comment groups), plus the files-target
 * sensors' own whole-content call (they are relational and have no leaf form). Sweep questions use
 * ids "<sensor> in block-N" and append the FROZEN scoping sentence to the instructions — it is part
 * of the sweep regime's calibration text; changing it is a re-calibration event. Ids are never sent
 * to the model: a parallel attribution map (built at question-construction time) attributes each
 * answer to its (sensor, block).
 *
 * Sweep readings are candidates, never verdicts: a reading crossing the sensor's sweep threshold
 * makes its block a candidate, and sweep measurements are stage-tagged so lint never runs a handle
 * on them. Sweep thresholds are set generously for recall (see SWEEP_THRESHOLDS for the derivation)
 * and are PROVISIONAL pending a sweep-regime calibration pass.
 *
 * Stage 2 — confirm: each candidate leaf is re-measured ISOLATED (leaf content as the whole state,
 * all its sensors batched in one call) using the existing handles and thresholds unchanged, so the
 * confirm regime inherits today's calibration exactly.
 *
 * Aggregation is never a mean (design §7.3): among a file's confirmed leaf readings for one sensor,
 * high=bad sensors take the max leaf, high=good the min — one signal per (file, sensor), located at
 * the extreme leaf.
 *
 * Fallback: a file with no leaves (empty, unparseable), an unmapped language, or a failing
 * decomposition falls back to the legacy whole-file measurement for that file.
 */

import { decompose, type UnitLeaf } from "../input/decompose.ts";
import {
  AppError,
  type AnyState,
  type Diagnostic,
  type Judge,
  type Measurement,
} from "../types.ts";
import { compileSensorQuestions, type QuestionAttribution } from "./measure.ts";
import type { QuestionSpec, Sensor, Span, SweepBlock, Unit } from "../types.ts";

/** Which regime produced an event; sweep measurements are candidates and never run handles. */
export type FunnelStage = "file" | "sweep" | "confirm";

/**
 * Sweep (stage-1) candidate thresholds per sensor, keyed by sensor name. A sweeping
 * (non-files-target) sensor without an entry never sweeps (and so never confirms) — deliberately
 * conservative for custom sensors until they are calibrated for the array regime.
 *
 * Derivation — start at the sensor's error threshold pulled 0.15 toward the healthy side (the array
 * regime dampens flagged blocks by -0.1..-0.2 relative to isolated, design §7.6), then clamp at
 * least 0.1 beyond the healthy band so healthy blocks cannot become candidates:
 *
 * | sensor                          | error | -0.15 | healthy band        | sweep |
 * | ------------------------------- | ----- | ----- | ------------------- | ----- |
 * | will_comment_drift (high=bad)   | >0.70 | 0.55  | <=0.50 (A/B)        | 0.60  |
 * | is_comment_narration (high=bad) | >0.45 | 0.30  | <=0.40 (A/B)        | 0.50  |
 * | is_comment_patching_readability | >0.55 | 0.40  | <=0.40 (warn bound) | 0.50  |
 * | is_cognitively_complex (hi=bad) | >0.60 | 0.45  | <=0.45 (warn bound) | 0.55  |
 * | is_name_purposeful (high=good)  | <0.50 | 0.65  | >=0.60 (warn bound) | 0.50  |
 * | is_naming_convention_consistent | <0.65 | 0.80  | >=0.85 (warn bound) | 0.75  |
 *
 * The healthy bands for drift and narration are the measured A/B ceilings (granularity-ab.md:
 * healthy client.ts blocks read <=0.5 drift, <=0.4 narration in the array regime); elsewhere the
 * handle's warn boundary stands in. Note the narration clamp: the flagged A/B blocks read
 * 0.43-0.49, so the 0.50 cut trades recall for zero healthy-band overlap — provisional, to be
 * re-calibrated by a sweep-regime calibration pass.
 */
const SWEEP_THRESHOLDS: Record<string, number> = {
  will_comment_drift: 0.6,
  is_comment_narration: 0.5,
  is_comment_patching_readability: 0.5,
  is_cognitively_complex: 0.55,
  is_name_purposeful: 0.5,
  is_naming_convention_consistent: 0.75,
};

/** High=good sensors error below their threshold; the extreme leaf reading is their minimum. */
const HIGH_GOOD: ReadonlySet<string> = new Set([
  "is_name_purposeful",
  "is_vocabulary_consistent",
  "is_naming_convention_consistent",
  "is_greppable",
]);

export const isHighGood = (sensorName: string): boolean => HIGH_GOOD.has(sensorName);

/** One sweep candidate: the flagged leaf, ready for isolated confirmation. */
interface Candidate {
  readonly leaf: UnitLeaf;
  readonly blockId: string;
}

/**
 * Every sweeping sensor (target other than "files") sweeps every block-leaf (design section 7.7):
 * comment-family sensors read definition-attached docblocks too - drift-prone artifact pinning
 * lives there, and the A/B probes (design section 7.6) measured exactly these blocks with the
 * comment family.
 */
const blockSensors = (sensors: readonly Sensor[]): Sensor[] =>
  sensors.filter((s) => s.target !== "files");

/** A confirmed (stage-2) reading, awaiting per-file aggregation in lint. */
export interface ConfirmedReading {
  readonly sensor: string;
  readonly value: number;
  /** The block-scoped measurement input, "path#block-N". */
  readonly input: string;
  readonly span: Span;
}

/** One streamed event plus the regime that produced it. */
export interface FunnelEvent {
  readonly event: Measurement | Diagnostic;
  readonly stage: FunnelStage;
}

export interface FunnelResult {
  readonly events: FunnelEvent[];
  readonly confirmed: ConfirmedReading[];
  /** A JEV_AUTH diagnostic aborts the whole run (same contract as the legacy path). */
  readonly fatal: boolean;
}

/**
 * Measure one file unit through the funnel; falls back to the legacy whole-file behavior when the
 * file cannot be decomposed into leaves. isAborted lets an in-flight file stop before further judge
 * calls once the run is aborting (JEV_AUTH elsewhere in the wave).
 */
export async function measureFile(
  unit: Unit,
  sensors: readonly Sensor[],
  judge: Judge,
  isAborted: () => boolean = () => false,
): Promise<FunnelResult> {
  const state = unit.state;
  const content =
    "content" in state && typeof state.content === "string"
      ? state.content
      : String((state as unknown as Record<string, unknown>).diff ?? "");

  // Decomposition is best-effort: an unmapped or uncuttable file degrades to the coarsest
  // target - one whole-content leaf - with a warn diagnostic. It is not a legacy path;
  // it is the same funnel run over a single leaf (design section 7.2).
  let leaves: UnitLeaf[] = [];
  let degraded: string | null = null;
  if (unit.kind !== "file") {
    degraded = "non-file unit";
  } else {
    const language = languageOf(state.path);
    if (language === null) {
      degraded = "no grammar mapping for extension";
    } else {
      try {
        const inventory = await decompose(content, language);
        leaves = [...inventory.definitions, ...inventory.comments];
        if (leaves.length === 0) degraded = "no definitions or comments found";
      } catch {
        degraded = "parse failed";
      }
    }
  }
  if (degraded !== null) {
    const lines = content.split("\n").length;
    leaves = [
      {
        label: "block-0",
        span: {
          start: { line: 1, column: 0 },
          end: { line: lines, column: 0 },
          startByte: 0,
          endByte: content.length,
        },
        content,
        nodeType: "whole-file",
        internalCommentCount: 0,
      },
    ];
  }

  const events: FunnelEvent[] = [];
  const confirmed: ConfirmedReading[] = [];
  const push = (event: Measurement | Diagnostic, stage: FunnelStage): void => {
    events.push({ event, stage });
  };

  // Files-target sensors: relational claims, their own whole-content call, handles as today.
  const fileSensors = sensors.filter((s) => s.target === "files");
  if (fileSensors.length > 0) {
    const file = await call(
      state,
      compileSensorQuestions(fileSensors).questions,
      judge,
      state.path,
    );
    collect(
      push,
      "file",
      file,
      fileSensors.map((s) => s.name),
      state.path,
    );
    if (fatalIn(events)) return { events, confirmed, fatal: true };
  }

  if (degraded !== null) {
    push(
      {
        input: state.path,
        code: "DECOMPOSITION_DEGRADED",
        severity: "warn",
        message: `measured whole: ${degraded}`,
      },
      "file",
    );
  }

  // Stage 1: the array state, one question per (block-leaf, sweeping sensor).
  const blocks: SweepBlock[] = [];
  const questions: Record<string, QuestionSpec> = {};
  const blockById = new Map<string, UnitLeaf>();
  const sweepAttribution = new Map<string, QuestionAttribution>();
  let n = 0;
  for (const leaf of leaves) {
    const granSensors = blockSensors(sensors);
    if (granSensors.length === 0) continue;
    const blockId = `block-${n++}`;
    blocks.push({ id: blockId, content: leafContent(leaf) });
    blockById.set(blockId, leaf);
    const batch = compileSensorQuestions(granSensors, blockId);
    Object.assign(questions, batch.questions);
    for (const [key, attr] of batch.attribution) sweepAttribution.set(key, attr);
  }
  if (blocks.length === 0 || isAborted()) return { events, confirmed, fatal: false };

  const sweep = await call({ path: state.path, blocks }, questions, judge, state.path);
  if (sweep.error !== null) push(sweep.error, "sweep");
  for (const [key, value] of Object.entries(sweep.answers)) {
    const attr = sweepAttribution.get(key);
    if (attr === undefined) {
      push(invalidAnswer(state.path, key), "sweep");
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      push(invalidAnswer(state.path, attr.sensor), "sweep");
      continue;
    }
    push({ sensor: attr.sensor, input: `${state.path}#${attr.blockId}`, value }, "sweep");
  }
  if (fatalIn(events)) return { events, confirmed, fatal: true };

  // Candidates: sweep readings crossing the generous sweep threshold — recall, not verdicts.
  const candidates = new Map<string, Candidate>();
  for (const [key, value] of Object.entries(sweep.answers)) {
    const attr = sweepAttribution.get(key);
    if (attr === undefined || attr.blockId === null) continue;
    const threshold = SWEEP_THRESHOLDS[attr.sensor];
    if (threshold === undefined) continue;
    const crosses = HIGH_GOOD.has(attr.sensor) ? value < threshold : value > threshold;
    const leaf = blockById.get(attr.blockId);
    if (crosses && leaf && !candidates.has(attr.blockId)) {
      candidates.set(attr.blockId, { leaf, blockId: attr.blockId });
    }
  }

  // Stage 2: confirm flagged leaves isolated — sensors batched per leaf, handles unchanged.
  for (const { leaf, blockId } of candidates.values()) {
    if (isAborted()) break;
    const granSensors = blockSensors(sensors);
    const input = `${state.path}#${blockId}`;
    const isolated = await call(
      { path: state.path, content: leafContent(leaf) },
      compileSensorQuestions(granSensors).questions,
      judge,
      input,
    );
    collect(
      push,
      "confirm",
      isolated,
      granSensors.map((s) => s.name),
      input,
    );
    for (const sensor of granSensors) {
      const value = isolated.answers[sensor.name];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      confirmed.push({ sensor: sensor.name, value, input, span: leaf.span });
    }
  }

  return { events, confirmed, fatal: false };
}

/** A definition's attached docblock is consumed into the leaf (design §7.2) — it reads as written. */
function leafContent(leaf: UnitLeaf): string {
  return [...(leaf.attachedComment ?? []), leaf.content].join("\n");
}

interface CallResult {
  readonly answers: Record<string, number>;
  readonly error: Diagnostic | null;
}

async function call(
  state: AnyState,
  questions: Record<string, QuestionSpec>,
  judge: Judge,
  input: string,
): Promise<CallResult> {
  try {
    return { answers: await judge(state, questions), error: null };
  } catch (thrown) {
    return { answers: {}, error: toDiagnostic(input, thrown) };
  }
}

/** Distribute one call's answers as measurements keyed by the given question names. */
function collect(
  push: (event: Measurement | Diagnostic, stage: FunnelStage) => void,
  stage: FunnelStage,
  result: CallResult,
  questionNames: readonly string[],
  input: string,
): void {
  if (result.error !== null) {
    push(result.error, stage);
    return;
  }
  for (const name of questionNames) {
    const value = result.answers[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      push(invalidAnswer(input, name), stage);
      continue;
    }
    push({ sensor: name, input, value }, stage);
  }
}

function invalidAnswer(input: string, sensorName: string): Diagnostic {
  return {
    input,
    code: "JEV_RESPONSE_INVALID",
    message: `answer for '${sensorName}' is missing or not a finite number`,
  };
}

function fatalIn(events: FunnelEvent[]): boolean {
  return events.some((e) => "code" in e.event && e.event.code === "JEV_AUTH");
}

function toDiagnostic(input: string, thrown: unknown): Diagnostic {
  if (thrown instanceof AppError) {
    return { input, code: thrown.code, message: thrown.message };
  }
  if (thrown instanceof Error) return { input, code: "INTERNAL", message: thrown.message };
  return { input, code: "INTERNAL", message: String(thrown) };
}

/** The funnel's languages: the tree-sitter grammars actually mapped by decompose (design §7.2). */
export function languageOf(path: string): string | null {
  return /\.(m|c)?tsx?$/.test(path) ? "typescript" : null;
}
