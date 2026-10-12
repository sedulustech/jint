/**
 * Jint's public barrel — the SDK surface (design §2):
 *
 * Import { loadConfig, rules, lint } from "jint";
 *
 * The CLI resolves input through the same code path lint() uses — no drift between `jint src/` and
 * `lint({ input: "x" })`.
 */

export {
  findConfigFile,
  loadConfig,
  validateConfig,
  DEFAULT_CONFIG_PATH,
  CONFIG_SCHEMA,
  type ResolvedConfig,
} from "./config/load.ts";
export { lint, collectReport, type LintOptions, type LintReport } from "./core/lint.ts";
export { knownLanguages } from "./core/input/walk.ts";
export {
  recordSummary,
  recordRunManifest,
  recordRunReport,
  type RequestRecordSummary,
} from "./core/jev/debug.ts";
export { checkRunKnobs } from "./core/jev/pacer.ts";
export { runsBase } from "./core/jev/debug.ts";
export {
  serveApiRequest,
  requestsRoot,
  type ApiOptions,
  type ApiCell,
  type RequestFile,
} from "./ui/api.ts";
export {
  startUi,
  compress,
  resolveDistDir,
  type UiServer,
  type StartUiOptions,
} from "./ui/serve.ts";
export { renderJson } from "./core/output/json.ts";
export { renderLines } from "./core/output/lines.ts";
export { selectionEcho } from "./core/output/echo.ts";
export { REPORT_SCHEMA, LINE_SCHEMA } from "./core/output/report-schema.ts";
export { describeRule, describeRules } from "./core/output/rules.ts";
export { compileRule } from "./config/load.ts";
export { registerCustomRuleLoader } from "./core/rules/custom/loader.ts";
export { selectRules } from "./core/lint.ts";
export { validateCustomRule } from "./core/rules/custom/schema.ts";
export { createClassifier, type ClassifierConfig } from "./core/jev/client.ts";
export { classify, type ClassifyOptions, type ClassifyOutcome } from "./core/classify.ts";
export type { Inventory, WalkElement, NodeRole } from "./core/input/walk.ts";
export type {
  Element,
  FileElement,
  FunctionElement,
  TypeElement,
  BindingElement,
  ImportElement,
  CommentElement,
  DocstringOwner,
  Span,
  ClassifiedAnswer,
} from "@jint/contract";
export {
  ClassifyError,
  SetupError,
  type ClassifyErrorCode,
  type SetupErrorCode,
  type Rule,
  type NoulRule,
  type ChoiceRule,
  type ChoiceRubric,
  type RuleKind,
  type RuleTarget,
  type HandleResult,
  type QuestionSchema,
  type Measurement,
  type Finding,
  type Severity,
  type InputKind,
  type Unit,
  type UnitState,
  type AnyState,
  type Classifier,
  type LintEvent,
} from "./core/types.ts";

/** The default rule surface: select by name in jint.config.json, spread programmatically. */
