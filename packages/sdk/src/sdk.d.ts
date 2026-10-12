/**
 * Editor DX for the virtual module "jint:sdk" — the runtime does NOT typecheck; this file exists so
 * rule files get completions and checking in the editor. Reference it from the rule project:
 *
 * /// <reference path="./node_modules/@jint/sdk/src/sdk.d.ts" />
 *
 * (jint ships src/; see the README's SDK section.)
 *
 * MIRROR GUARD: this declaration must stay type-identical to custom/schema.ts —
 * schema.types.test.ts enforces that at typecheck time. Edit them together.
 */

declare module "jint:sdk" {
  /**
   * The element a rule sees: identity, role, source, span, and its parent (hierarchy rides on the
   * element).
   */
  export interface CustomElement {
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
    readonly parent: CustomElement | null;
  }

  /** The rule's environment, assembled after target resolution. */
  export interface RuleContext {
    readonly targets: readonly CustomElement[];
  }

  /** One compiled judgment: question, criteria, and the freely composed state jev judges. */
  export interface StateSchema {
    readonly instructions: string;
    readonly criteria: { readonly true: string; readonly false: string };
    readonly state: Record<string, unknown>;
  }

  /** Declarative policy: the typed noul handler (same shape as JSON noul rules). */
  export type CustomHandleData = import("@jint/contract").NoulHandlerData;

  /** The jev answer type for the rule's kind (noul-only in v1). */
  export type NoulResult = { readonly type: "noul"; readonly noul: number };
  export type ScoreResult = { readonly type: "score"; readonly score: number };
  export type RuleResult = NoulResult | ScoreResult;

  /** One policy decision, aligned by index with ctx.targets; null severity = silent. */
  export interface CustomDecision {
    readonly severity: "error" | "warn" | null;
    readonly data?: Record<string, unknown>;
  }

  /** A custom rule: request (target), per-element compiler (classify), and exactly one policy. */
  export interface CustomRule {
    readonly name: string;
    readonly kind?: "noul";
    readonly target:
      | "functions"
      | "definitions"
      | "comments"
      | "imports"
      | readonly string[]
      | ((elements: readonly CustomElement[]) => readonly CustomElement[]);
    readonly classify: (self: CustomElement, ctx: RuleContext) => StateSchema;
    /** Per-rule scoping (issue 008): glob list; absent = the rule applies to all paths. */
    readonly include?: readonly string[];
    /** Per-rule scoping: glob list; ALWAYS wins over include. */
    readonly exclude?: readonly string[];
    readonly handle?: CustomHandleData;
    readonly handleClassification?: (
      results: readonly RuleResult[],
      ctx: RuleContext,
    ) => readonly CustomDecision[];
  }

  /**
   * A TS config: the same keys a top-level config takes, minus customRules. Entries in rules
   * compose last-wins by name: declarative specs (jint:defaults exports and their
   * spread-and-overrides) or inline callback CustomRules.
   */
  export interface TsConfig {
    readonly $schema?: string;
    readonly input?: string;
    readonly inputType?: "file" | "dir";
    readonly rules?: ReadonlyArray<string | CustomRule | ({ readonly name: string } & object)>;
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly disable?: readonly string[];
    readonly apiKey?: string;
    readonly concurrency?: number;
    readonly timeout?: number;
  }

  /** The typed TS-config entry. */
  export function defineConfig(config: TsConfig): TsConfig;
}
