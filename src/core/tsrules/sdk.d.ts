/**
 * Editor DX for the virtual module "jint:sdk" — the runtime does NOT typecheck; this file exists so
 * rule files get completions and checking in the editor. Reference it from the rule project:
 *
 * /// <reference path="./node_modules/jint/src/core/tsrules/sdk.d.ts" />
 *
 * (jint ships src/; see the README's TS-rules section.)
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
    };
    readonly parent: TsElement | null;
  }

  /** The rule's environment, assembled after target resolution (v1: targets only). */
  export interface RuleContext {
    readonly targets: readonly TsElement[];
  }

  /** One compiled judgment: question, criteria, and the freely composed state jev judges. */
  export interface StateSpec {
    readonly instructions: string;
    readonly criteria: { readonly true: string; readonly false: string };
    readonly state: Record<string, unknown>;
  }

  /** Declarative policy thresholds; polarity inferred from their ordering (same as JSON rules). */
  export interface TsHandleData {
    readonly warn_at: number;
    readonly error_at: number;
  }

  /** The jev answer type for the rule's kind (noul-only in v1). */
  export type NoulResult = { readonly type: "noul"; readonly noul: number };
  export type ScoreResult = { readonly type: "score"; readonly score: number };
  export type RuleResult = NoulResult | ScoreResult;

  /** One policy decision, aligned by index with ctx.targets; null severity = silent. */
  export interface TsDecision {
    readonly severity: "error" | "warn" | null;
    readonly message?: string;
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
