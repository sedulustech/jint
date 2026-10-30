import type {
  ChoiceHandlerData,
  NoulHandlerData,
  RuleTarget,
  ScoreHandlerData,
} from "./handlers.ts";

/**
 * HANDLERS ARE TYPED DATA: every default handle is a NoulHandler (each threshold names its own
 * direction and ceiling — see handle.ts) or, for score rules, a ScoreHandler (one map level per
 * criterion), compiled to the internal function form at module init. Recalibration is now editing
 * numbers in one place — and paste-able into jint.config.json. The declarative config surface
 * requires a real handle; probing is measuring - read the --json measurements and discard findings
 * (the handle only decides when readings surface), never a null handle.
 */

/** A binary-claim rule: the {true, false} criteria compile straight into the noul question. */
export interface NoulRuleSchema {
  readonly name: string;
  readonly kind?: "noul";
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
  readonly target: RuleTarget | readonly RuleTarget[];
  readonly handle: NoulHandlerData;
  /** Per-rule scope (issue 008): glob lists over the walk's paths; unset = all in-scope paths. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  /**
   * True: replaces an earlier rule of the same name in a config; a repeated name is otherwise an
   * error.
   */
  readonly override?: boolean;
}

/** A graded rule: the ordered rubric is indexed by score 0..N; the handle is a score map. */
export interface ScoreRuleSchema {
  readonly name: string;
  readonly kind: "score";
  readonly instructions: string;
  readonly criteria: readonly string[];
  readonly target: RuleTarget | readonly RuleTarget[];
  readonly handle: ScoreHandlerData;
  /** Per-rule scope (issue 008): glob lists over the walk's paths; unset = all in-scope paths. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  /**
   * True: replaces an earlier rule of the same name in a config; a repeated name is otherwise an
   * error.
   */
  readonly override?: boolean;
}

/** A choice rule: the model selects one named option; the handle maps each option label to a tier. */
export interface ChoiceRuleSchema {
  readonly name: string;
  readonly kind: "choice";
  readonly instructions: string;
  /** Option label -> what selecting it means; at least two options. */
  readonly criteria: Readonly<Record<string, string>>;
  readonly target: RuleTarget | readonly RuleTarget[];
  readonly handle: ChoiceHandlerData;
  /** Per-rule scope (issue 008): glob lists over the walk's paths; unset = all in-scope paths. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  /**
   * True: replaces an earlier rule of the same name in a config; a repeated name is otherwise an
   * error.
   */
  readonly override?: boolean;
}

/** A declarative rule: exactly one of the three kinds. */
export type RuleSchema = NoulRuleSchema | ScoreRuleSchema | ChoiceRuleSchema;
