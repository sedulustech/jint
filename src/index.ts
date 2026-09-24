/**
 * Jint's public barrel — the SDK surface (design §2):
 *
 * Import { defineConfig, rules, lint } from "jint";
 *
 * The CLI resolves input through the same code path lint() uses — no drift between `jint --dir x`
 * and `lint({ input: "x" })`.
 */

import { defaultRules } from "./core/sensors/defaults.ts";

export { defineConfig, type ResolvedConfig, type UserConfig } from "./config/define.ts";
export { loadConfig, defaultConfig, validateConfig, DEFAULT_CONFIG_PATH } from "./config/load.ts";
export { lint, collectReport, type LintOptions, type LintReport } from "./core/lint.ts";
export { classify, type ClassifyOptions, type ClassifyOutcome } from "./core/classify.ts";
export type { Inventory, InventoryElement, NodeRole } from "./core/input/decompose.ts";
export { defaultRules } from "./core/sensors/defaults.ts";
export {
  MeasureError,
  SetupError,
  type MeasureErrorCode,
  type SetupErrorCode,
  type Rule,
  type NoulRule,
  type ChoiceRule,
  type ChoiceRubric,
  type RuleKind,
  type RuleTarget,
  type HandleResult,
  type QuestionSpec,
  type Measurement,
  type Signal,
  type Severity,
  type InputKind,
  type Unit,
  type UnitState,
  type AnyState,
  type Classifier,
  type LintEvent,
} from "./core/types.ts";

/** The config surface: rules.defaults spread + disable list. */
export const rules = { defaults: defaultRules };
