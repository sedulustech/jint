/**
 * The handler contract: the typed handle taxonomy and the pure evaluation functions both the engine
 * and the classification UI consume. Zero dependencies, runtime-free - data and functions only, no
 * I/O, no engine types.
 *
 * Noul direction is DECLARED PER THRESHOLD: warn/error each carry one comparison operator ({
 * greater_than: x } or { less_than: x }). There is no defect pole and no flip - the operator IS the
 * pole. A noul handle declares at least one tier - warn, error, or both. When both are present,
 * warn fires the wider region and error the strictly narrower one (same direction), so error
 * implies warn; an error-only handle fires error past its threshold and stays silent otherwise. A
 * silent_band suppresses raw-p classifications inside [lo, hi] (inclusive) before any threshold is
 * consulted - the two-sided suppression window that single comparison operators cannot express.
 */

import type {
  ChoiceHandlerData,
  HandlerData,
  HandlerLevel,
  NoulHandlerData,
  ScoreHandlerData,
  ScoreTier,
  ThresholdCondition,
} from "./schema.ts";

export type {
  ChoiceHandlerData,
  HandlerData,
  HandlerLevel,
  NoulHandlerData,
  ScoreHandlerData,
  ScoreTier,
  ThresholdCondition,
} from "./schema.ts";

export function asTier(entry: HandlerLevel | ScoreTier): ScoreTier {
  return typeof entry === "string" ? { level: entry } : entry;
}

/**
 * Which unit instances a rule judges: mapping an acquired file to units yields one whole-file
 * slice, N definition elements, M standalone comment elements and 1 merged import element, and the
 * target selects which of them the rule's question runs over.
 */
export const RULE_TARGETS = [
  "files",
  "functions",
  "classes",
  "methods",
  "types",
  "bindings",
  "definitions",
  "comments",
  "loose-comments",
  "imports",
] as const;

export type SharedRuleTarget = (typeof RULE_TARGETS)[number];

/** A grammar-local target, {grammar}:{capture}, validated against the grammar's captures at startup. */
export type QualifiedRuleTarget = `${string}:${string}`;

export type RuleTarget = SharedRuleTarget | QualifiedRuleTarget;

/** Severity is the only verdict vocabulary: a finding fires error or warn, or stays silent. */
export type Severity = "error" | "warn";

/**
 * The handler forms differ by key: a score handler holds `map`, a choice handler `choices`, a noul
 * handler neither.
 */
export function isScoreHandler(handlerData: HandlerData): handlerData is ScoreHandlerData {
  return "map" in handlerData;
}

/** `choices` is the key the config file uses for a choice handler. */
export function isChoiceHandler(handlerData: HandlerData): handlerData is ChoiceHandlerData {
  return "choices" in handlerData;
}

/** Does one threshold condition fire at this value? Strict on the firing side. */
export function conditionFires(value: number, condition: ThresholdCondition): boolean {
  if (condition.greater_than !== undefined) return value > condition.greater_than;
  if (condition.less_than !== undefined) return value < condition.less_than;
  // validated upstream: a condition carries exactly one operator
  return false;
}

/**
 * Pure handle evaluation: value -> severity, or null (silent). The single semantics both the
 * engine's compiled handle and the UI's severity projection share, so the two cannot drift.
 *
 * Noul: a silent_band hit (inclusive) suppresses before any threshold is consulted; warn and error
 * conditions are evaluated on the RAW value - direction lives in the operators, so no polarity
 * interpretation happens here at all. Error implies warn by validation (narrower) when both are
 * declared; an absent tier never fires.
 *
 * Score: the value indexes the criteria map (rounded). Out-of-range is an impossible state the
 * ENGINE fails loud on before this evaluator runs; here it degrades to silent (null), never a
 * fabricated verdict.
 *
 * Choice: the option probabilities, grouped by tier, pick the verdict (see readChoice); without
 * probabilities the selected option's label picks its tier. A missing or unknown label degrades to
 * silent.
 */
export function handleSeverity(
  value: number,
  handlerData: HandlerData,
  choice?: string,
  probabilities?: Readonly<Record<string, number>>,
): Severity | null {
  return handleTier(value, handlerData, choice, probabilities)?.severity ?? null;
}

/** The fired tier: a severity, the author's message, and whether the classification was undecided. */
export interface FiredTier {
  readonly severity: Severity;
  readonly message?: string;
  readonly undecided?: true;
}

const TIER_ORDER: readonly HandlerLevel[] = ["pass", "warn", "error"];

export function choiceTierMass(
  handlerData: ChoiceHandlerData,
  probabilities: Readonly<Record<string, number>>,
): Record<HandlerLevel, number> {
  const mass: Record<HandlerLevel, number> = { pass: 0, warn: 0, error: 0 };
  for (const [label, entry] of Object.entries(handlerData.choices)) {
    mass[asTier(entry).level] += probabilities[label] ?? 0;
  }
  return mass;
}

/**
 * The choice read: probability mass per tier level. The top tier is the verdict (a tie goes to the
 * selected option's tier); its most probable option supplies the message. With an undecided tier
 * declared, a top tier leading the runner-up's mass by less than `margin` fires the undecided tier
 * instead. Null = pass.
 */
export function readChoice(
  handlerData: ChoiceHandlerData,
  choice: string | undefined,
  probabilities: Readonly<Record<string, number>>,
): FiredTier | null {
  const mass = choiceTierMass(handlerData, probabilities);
  const selectedLevel =
    choice !== undefined && handlerData.choices[choice] !== undefined
      ? asTier(handlerData.choices[choice]).level
      : undefined;
  const ranked = [...TIER_ORDER].sort(
    (a, b) => mass[b] - mass[a] || Number(b === selectedLevel) - Number(a === selectedLevel),
  );
  const [top, second] = [ranked[0]!, ranked[1]!];
  if (
    handlerData.undecided !== undefined &&
    mass[top] - mass[second] < handlerData.undecided.margin
  ) {
    const tier = handlerData.undecided;
    return tier.level === "pass"
      ? null
      : { severity: tier.level, message: tier.message, undecided: true };
  }
  if (top === "pass") return null;
  // the message: the most probable option within the winning tier
  const options = Object.entries(handlerData.choices).filter(([, e]) => asTier(e).level === top);
  const [, entry] = options.reduce((best, cur) =>
    (probabilities[cur[0]] ?? 0) > (probabilities[best[0]] ?? 0) ? cur : best,
  );
  return { severity: top, message: asTier(entry).message };
}

/**
 * Pure handle evaluation: value -> {severity, message?} for the FIRED tier, or null (silent). The
 * message is the rule author's feedback attached at the tier (a threshold condition or a score-map
 * tier); absent = a bare finding. The single semantics both the engine's compiled handle and the
 * UI's severity projection share, so the two cannot drift.
 */
export function handleTier(
  value: number,
  handlerData: HandlerData,
  choice?: string,
  probabilities?: Readonly<Record<string, number>>,
): FiredTier | null {
  if (isChoiceHandler(handlerData)) {
    if (probabilities !== undefined) return readChoice(handlerData, choice, probabilities);
    const entry = choice === undefined ? undefined : handlerData.choices[choice];
    if (entry === undefined) return null;
    const tier = asTier(entry);
    return tier.level === "pass" ? null : { severity: tier.level, message: tier.message };
  }
  if (isScoreHandler(handlerData)) {
    const index = Math.round(value);
    if (!Number.isInteger(index) || index < 0 || index >= handlerData.map.length) return null;
    // bounds checked above guarantee the tier
    const tier = asTier(handlerData.map[index]!);
    return tier.level === "pass" ? null : { severity: tier.level, message: tier.message };
  }
  const band = handlerData.silent_band;
  if (band !== undefined && value >= band[0] && value <= band[1]) return null;
  if (handlerData.error !== undefined && conditionFires(value, handlerData.error))
    return { severity: "error", message: handlerData.error.message };
  if (handlerData.warn !== undefined && conditionFires(value, handlerData.warn))
    return { severity: "warn", message: handlerData.warn.message };
  return null;
}

/**
 * Score resolution: the full answer -> severity. DEFAULT read (the only one that ships) is
 * round-to-nearest-level — the docs-blessed projection; probabilities are carried for future reads
 * but no rule consumes them yet (distribution-aware reads land only when a rule's calibration
 * demands them). Delegates to the level-index logic of handleSeverity.
 */
export function resolveScore(
  value: number,
  probabilities: Record<string, number> | undefined,
  handlerData: ScoreHandlerData,
): Severity | null {
  void probabilities;
  return handleSeverity(value, handlerData);
}

/**
 * Score resolution to the FIRED TIER: the same DEFAULT read, carrying the tier's author message
 * (the finding's note). Absent message = a bare finding; null = silent.
 */
export function resolveScoreTier(
  value: number,
  probabilities: Record<string, number> | undefined,
  handlerData: ScoreHandlerData,
): { readonly severity: Severity; readonly message?: string } | null {
  void probabilities;
  return handleTier(value, handlerData);
}

/**
 * The choice-handler invariant check: one tier per option label, no more, no fewer, and at least
 * one non-pass tier. Null when valid, otherwise the field name + problem.
 */
export function checkChoiceHandler(
  handlerData: ChoiceHandlerData,
  labels: readonly string[],
): string | null {
  const declared = Object.keys(handlerData.choices);
  const missing = labels.filter((label) => !declared.includes(label));
  if (missing.length > 0) return `handle.choices: no tier for option(s) ${missing.join(", ")}`;
  const unknown = declared.filter((label) => !labels.includes(label));
  if (unknown.length > 0) return `handle.choices: ${unknown.join(", ")} is not an option label`;
  if (Object.values(handlerData.choices).every((entry) => asTier(entry).level === "pass")) {
    return "handle.choices: at least one tier must be non-pass";
  }
  if (
    handlerData.undecided !== undefined &&
    !(handlerData.undecided.margin > 0 && handlerData.undecided.margin < 1)
  ) {
    return `handle.undecided.margin: must be between 0 and 1 (the top tier's lead over the runner-up, in probability), got ${handlerData.undecided.margin}`;
  }
  return null;
}

/** One condition carries exactly one operator: null when valid, else the problem. */
export function checkCondition(condition: ThresholdCondition, field: string): string | null {
  const ops = [condition.greater_than !== undefined, condition.less_than !== undefined].filter(
    Boolean,
  ).length;
  if (ops === 0) return `${field}: must declare one operator (greater_than or less_than)`;
  if (ops > 1) return `${field}: declare exactly one operator, got both greater_than and less_than`;
  const value = (condition.greater_than ?? condition.less_than)!;
  if (value <= 0 || value >= 1) {
    return `${field}: threshold must be within (0, 1), got ${value}`;
  }
  return null;
}

/**
 * The shared noul-handler invariant check: null when valid, otherwise the field name + problem (the
 * caller prefixes rule id and source). Used by the JSON loader and the TS-rule loader so the two
 * tiers cannot drift.
 */
export function checkNoulHandler(handlerData: NoulHandlerData): string | null {
  if (handlerData.warn === undefined && handlerData.error === undefined) {
    return "handle: must declare at least one tier (warn, error, or both)";
  }
  if (handlerData.warn !== undefined) {
    const warnProblem = checkCondition(handlerData.warn, "handle.warn");
    if (warnProblem !== null) return warnProblem;
  }
  if (handlerData.error !== undefined) {
    const errorProblem = checkCondition(handlerData.error, "handle.error");
    if (errorProblem !== null) return errorProblem;
  }
  if (handlerData.warn !== undefined && handlerData.error !== undefined) {
    // both tiers: error must be the narrower region - same direction, ordered toward the defect
    if (
      handlerData.warn.greater_than !== undefined &&
      handlerData.error.greater_than !== undefined
    ) {
      if (handlerData.warn.greater_than >= handlerData.error.greater_than) {
        return `handle.warn/error: greater_than thresholds must be ordered warn < error (error is the narrower region), got ${handlerData.warn.greater_than} >= ${handlerData.error.greater_than}`;
      }
    }
    if (handlerData.warn.less_than !== undefined && handlerData.error.less_than !== undefined) {
      if (handlerData.warn.less_than <= handlerData.error.less_than) {
        return `handle.warn/error: less_than thresholds must be ordered warn > error (error is the narrower region), got ${handlerData.warn.less_than} <= ${handlerData.error.less_than}`;
      }
    }
  }
  if (handlerData.silent_band !== undefined) {
    const [lo, hi] = handlerData.silent_band;
    if (lo >= hi) {
      return `handle.silent_band: must be ordered [lower, upper], got [${lo}, ${hi}]`;
    }
    // A band covering the whole scale would silence every classification; a band containing a
    // threshold value would swallow exactly the classifications that threshold exists to catch.
    if (lo <= 0 && hi >= 1) {
      return "handle.silent_band: must not cover the whole scale (got [0, 1]) - everything would be silent";
    }
    for (const [field, condition] of [
      ["warn", handlerData.warn],
      ["error", handlerData.error],
    ] as const) {
      if (condition === undefined) continue;
      const at = condition.greater_than ?? condition.less_than;
      if (at !== undefined && lo <= at && at <= hi) {
        return `handle.silent_band: [${lo}, ${hi}] contains the ${field} threshold (${at}) - a band must not contain the thresholds it sits against`;
      }
    }
  }
  return null;
}
