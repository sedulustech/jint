/**
 * Editor DX for the virtual module "jint:sdk" — the runtime does NOT typecheck; this file exists so
 * rule files get completions and checking in the editor. Reference it from the rule project:
 *
 * /// <reference path="./node_modules/jint/src/core/tsrules/sdk.d.ts" />
 *
 * (jint ships src/; see the README's TS-rules section.)
 *
 * MIRROR GUARD: this declaration must stay type-identical to sdk.ts — sdk.types.test.ts enforces
 * that at typecheck time. Edit them together.
 */

declare module "jint:sdk" {
  /**
   * The element a rule sees: identity, role, source, span, and its parent (hierarchy rides on the
   * element).
   */
  export interface TsElement {
    readonly id: string;
    readonly path: string;
    readonly role: "function" | "type" | "binding" | "import" | "comment";
    readonly source: string;
    readonly span: {
      readonly start: { readonly line: number; readonly column: number };
      readonly end: { readonly line: number; readonly column: number };
      readonly startByte: number;
      readonly endByte: number;
    };
    /** The comment node(s) consumed into this element's leading run (target grammar: "comments"). */
    readonly attachedComment?: readonly string[];
    readonly parent: TsElement | null;
  }

  /**
   * The ctx.diff lens: knowledge about the judged things, never the judged things. Present ONLY
   * when a changed-file list was given (jint - / --changed); defined with an EMPTY paths list when
   * the list was empty or matched nothing (loud, never silent — see the seed rule). Each key
   * mirrors the target grammar as the changed subset: ctx.targets.<kind> filtered to elements whose
   * input path is in paths.
   */
  export interface DiffLens {
    /** The changed-file list, verbatim (deduplicated, walked entries only). */
    readonly paths: readonly string[];
    /** Every element of a changed path (any role). */
    readonly file: readonly TsElement[];
    readonly functions: readonly TsElement[];
    readonly definitions: readonly TsElement[];
    readonly comments: readonly TsElement[];
    readonly imports: readonly TsElement[];
  }

  /** The rule's environment, assembled after target resolution. */
  export interface RuleContext {
    readonly targets: readonly TsElement[];
    /** The ctx.diff lens, present iff a changed list was given (undefined otherwise). */
    readonly diff?: DiffLens;
  }

  /** One compiled judgment: question, criteria, and the freely composed state jev judges. */
  export interface StateSpec {
    readonly instructions: string;
    readonly criteria: { readonly true: string; readonly false: string };
    readonly state: Record<string, unknown>;
  }

  /** Declarative policy: the typed noul handler (same shape as JSON noul rules). */
  export type TsHandleData = import("@jint/contract").NoulHandlerData;

  /** The jev answer type for the rule's kind (noul-only in v1). */
  export type NoulResult = { readonly type: "noul"; readonly noul: number };
  export type ScoreResult = { readonly type: "score"; readonly score: number };
  export type RuleResult = NoulResult | ScoreResult;

  /** One policy decision, aligned by index with ctx.targets; null severity = silent. */
  export interface TsDecision {
    readonly severity: "error" | "warn" | null;
    readonly data?: Record<string, unknown>;
  }

  /** A TS rule: request (target), per-element compiler (classify), and exactly one policy. */
  export interface TsRule {
    readonly name: string;
    readonly kind?: "noul";
    readonly target:
      | "functions"
      | "definitions"
      | "comments"
      | "imports"
      | readonly string[]
      | ((elements: readonly TsElement[]) => readonly TsElement[]);
    readonly classify: (self: TsElement, ctx: RuleContext) => StateSpec;
    /** Per-rule scoping (issue 008): glob list; absent = the rule applies to all paths. */
    readonly include?: readonly string[];
    /** Per-rule scoping: glob list; ALWAYS wins over include. */
    readonly exclude?: readonly string[];
    readonly handle?: TsHandleData;
    readonly handleClassification?: (
      results: readonly RuleResult[],
      ctx: RuleContext,
    ) => readonly TsDecision[];
  }

  /** A TS config fragment: contributes rules ONLY (run-level keys stay in jint.config.json). */
  export interface TsConfigFragment {
    readonly rules: readonly TsRule[];
  }

  /** Declares a fragment; takes one fragment or an array of them. */
  export function defineConfig(
    fragment: TsConfigFragment | readonly TsConfigFragment[],
  ): TsConfigFragment;
}
