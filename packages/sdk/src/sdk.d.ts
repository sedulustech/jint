/**
 * Editor DX for the jint:sdk virtual module: the runtime does NOT typecheck; this file exists so
 * rule files get completions and checking in the editor. Rule projects reference it with a
 * triple-slash path into the installed package's sources.
 *
 * The types are the runtime's own, through inline imports.
 */

declare module "jint:sdk" {
  export type CustomElement = import("./core/rules/custom/schema.ts").CustomElement;
  export type RuleContext = import("./core/rules/custom/schema.ts").RuleContext;
  export type CustomFile = import("./core/rules/custom/schema.ts").CustomFile;
  export type StateSchema = import("./core/rules/custom/schema.ts").StateSchema;
  export type CustomHandleData = import("./core/rules/custom/schema.ts").CustomHandleData;
  export type CustomDecision = import("./core/rules/custom/schema.ts").CustomDecision;
  export type ComposeState = import("./core/rules/custom/schema.ts").ComposeState;
  export type ComposedQuestion = import("./core/rules/custom/schema.ts").ComposedQuestion;
  export type ClassifiedQuestion = import("./core/rules/custom/schema.ts").ClassifiedQuestion;
  export type CustomRule = import("./core/rules/custom/schema.ts").CustomRule;
  export type TsConfig = import("./core/rules/custom/schema.ts").TsConfig;
  export type NoulResult = import("./core/types.ts").NoulResult;
  export type ScoreResult = import("./core/types.ts").ScoreResult;
  export type RuleResult = import("./core/types.ts").RuleResult;

  /** A declarative rule spec - what a jint:rules/<domain> export is, and what a config entry takes. */
  export type RuleSchema = import("@jint/contract").RuleSchema;

  /** The typed TS-config entry. */
  export function defineConfig(config: TsConfig): TsConfig;

  /**
   * One extracted element: the contract Element extended with input + grammar provenance - NOT
   * redeclared (the runtime type is Element & { input, grammar }, so completions show exactly what
   * capture() returns). The contract type rides on an inline import(): a top-level import would
   * make this FILE a module, and `declare module "jint:sdk"` an augmentation that does not declare
   * the virtual module ("Cannot find module 'jint:sdk'").
   */
  export type CapturedElement = import("@jint/contract").Element & {
    /** Which input file the element was extracted from. */
    readonly input: string;
    /** The grammar (by id) that extracted the element. */
    readonly grammar: string;
    /** The element's own source: the file sliced by the element's span, whole. */
    readonly text: string;
  };

  /**
   * Capture (verb) - run extraction over an input under a chosen grammar and query set, yielding
   * elements; the classifier stays unplugged. Precedence: grammarDir (custom) > embedded >
   * extension routing. queryPath, when given, replaces the grammar's own .scm for extraction (full
   * loud checks apply). A dir's unclaimable files never fail the call: each skip is one onSkip
   * event carrying the file and its extension token (".json", or "(extensionless)").
   */
  export function capture(
    targetPath: string,
    queryPath?: string,
    grammarPath?: string,
    onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
  ): Promise<CapturedElement[]>;
}
