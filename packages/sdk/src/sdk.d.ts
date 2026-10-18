/**
 * Editor DX for the jint:sdk virtual module: the runtime does NOT typecheck; this file exists so
 * rule files get completions and checking in the editor. Rule projects reference it with a
 * triple-slash path into the installed package's sources.
 *
 * MIRROR GUARD: this declaration must stay type-identical to the runtime schema — a typecheck-time
 * mirror test enforces that. Edit them together.
 */

declare module "jint:sdk" {
  /**
   * The element a rule sees: identity, capture, source, span, and its parent (hierarchy rides on
   * the element).
   */
  export interface CustomElement {
    readonly id: string;
    readonly path: string;
    readonly grammar: string;
    readonly capture:
      | "function"
      | "method"
      | "class"
      | "type"
      | "binding"
      | "import"
      | "comment"
      | "section"
      | "paragraph";
    readonly source: string;
    readonly span: {
      readonly start: { readonly line: number; readonly column: number };
      readonly end: { readonly line: number; readonly column: number };
      readonly startByte: number;
      readonly endByte: number;
    };
    /** The comment node(s) consumed into this element's leading run (target grammar: "comments"). */
    readonly attachedComment?: readonly string[];
    /** Non-empty comments inside this element's body (target grammar: "comments"). */
    readonly internalCommentCount?: number;
    /** Docstrings this definition owns (the pair split): documentation the frame carries. */
    readonly docstringCount?: number;
    /**
     * For a comment element a definition owns (a docstring): who it documents. Its presence is what
     * makes the comment DOCUMENTATION (target grammar: "comments") rather than loose.
     */
    readonly docstringOf?: {
      readonly kind: "module" | "function" | "class" | "method" | "type" | "binding";
      readonly name: string;
    };
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
    /**
     * An instruction to the caller fixing the finding (typically an LLM doing the fix); severity
     * says whether, message says how. Rendered beneath the finding line.
     */
    readonly message?: string;
  }

  /** A custom rule: request (target), per-element compiler (classify), and exactly one policy. */
  export interface CustomRule {
    readonly name: string;
    readonly kind?: "noul";
    readonly target:
      | "functions"
      | "classes"
      | "methods"
      | "types"
      | "bindings"
      | "definitions"
      | "comments"
      | "loose-comments"
      | "imports"
      | readonly string[]
      | ((elements: readonly CustomElement[]) => readonly CustomElement[]);
    readonly classify: (self: CustomElement, ctx: RuleContext) => StateSchema;
    /** Per-rule scoping (issue 008): glob list; absent = the rule applies to all paths. */
    readonly include?: readonly string[];
    /** Per-rule scoping: glob list; ALWAYS wins over include. */
    readonly exclude?: readonly string[];
    /**
     * The rule's policy — REQUIRED, exactly one per rule, in one of two encodings: data is the
     * declarative form (JSON-expressible noul handler); a function is the TS-only escape hatch,
     * called ONCE after all classifications (results[i] <-> ctx.targets[i]) and returns one
     * decision per result, aligned by index. The field either is data or is a function, never both;
     * a measurement-only rule returns [] (or all-null severities) from the function form.
     */
    readonly handle:
      | CustomHandleData
      | ((results: readonly RuleResult[], ctx: RuleContext) => readonly CustomDecision[]);
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

  /** One extracted element: the contract Element extended with input + grammar provenance. */
  export interface CapturedElement {
    readonly id: string;
    readonly path: string;
    readonly grammar: string;
    readonly capture: CustomElement["capture"];
    readonly source: string;
    readonly span: CustomElement["span"];
    readonly label: string;
    readonly parent: string | undefined;
    readonly name?: string | undefined;
    readonly kind: CustomElement["kind"] | "file";
    /** Which input file the element was extracted from. */
    readonly input: string;
    /**
     * The element's own source (span-sliced), truncated at 200 chars with one ellipsis when longer;
     * the span stays the authority for the full content.
     */
    readonly text: string;
  }

  /**
   * Capture (verb) - run extraction over an input under a chosen grammar and query set, yielding
   * elements; the classifier stays unplugged. Precedence: grammarDir (ad hoc) > registered >
   * extension routing. queryPath, when given, replaces the grammar's own .scm for extraction (full
   * loud checks apply).
   */
  export function capture(
    targetPath: string,
    queryPath?: string,
    grammarPath?: string,
  ): Promise<CapturedElement[]>;
}
