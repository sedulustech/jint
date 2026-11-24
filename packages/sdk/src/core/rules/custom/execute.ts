/**
 * TS-rule execution: the engine resolves every rule's elements ONCE over the completed walk, the
 * rule compiles a question per element, jint calls the classifier, and the rule's policy decides
 * once per rule — findings bind to the judged element's span.
 *
 * Mid-run contract: a throwing handler fails that unit only — non-fatal, streamed, the run
 * continues; a returned Promise from a sync-only handler is the same contract violation. State is
 * composed freely by the rule (observability is the guarantee — recorded requests hold the exact
 * bytes).
 */

import { charsToTokens, MAX_ELEMENT_TOKENS } from "../../grammars/walk.ts";
import { inCall } from "../../provider/debug.ts";
import { DEFAULT_CHARS_PER_TOKEN } from "../../provider/pacer.ts";
import { ruleInScope } from "../../scope.ts";
import {
  ClassifyError,
  type AnyState,
  type Classifier,
  type Element,
  type Finding,
  type LintEvent,
  type RuleResult,
  type Span,
} from "../../types.ts";
import { matchesTarget } from "../classify.ts";
import { isRefusal, toClassifyError } from "../classify.ts";
import { compileNoulHandler } from "../handle.ts";
import {
  validateDecision,
  validateStateSpec,
  type ClassifyContext,
  type CustomElement,
  type CustomFile,
  type CustomRule,
} from "./schema.ts";
import type { InventoryElement } from "../../grammars/walk.ts";

/**
 * One file's elements for rules, in file order. A dangling parent label is an inventory
 * inconsistency: it throws, never silently nulls.
 */
function fileElementsOf(inventory: readonly InventoryElement[], path: string): CustomElement[] {
  const byLabel = new Map(inventory.map((e) => [e.label, e]));
  const cache = new Map<string, CustomElement>();
  const convert = (e: InventoryElement): CustomElement => {
    const cached = cache.get(e.label);
    if (cached) return cached;
    const parentLabel = e.parent;
    const parent = parentLabel !== undefined ? byLabel.get(parentLabel) : undefined;
    if (parentLabel !== undefined && parent === undefined) {
      throw new Error(
        "inventory inconsistency: element " +
          e.label +
          " names parent " +
          parentLabel +
          ", which does not exist",
      );
    }
    const element: CustomElement = {
      id: e.id,
      label: e.label,
      path,
      capture: e.capture,
      grammar: e.grammar,
      name: e.name,
      source: e.content,
      span: {
        start: e.span.start,
        end: e.span.end,
        startByte: e.span.startByte,
        endByte: e.span.endByte,
      },
      signature: e.signature,
      attachedComment: e.attachedComment,
      internalCommentCount: e.internalCommentCount,
      docstringCount: e.docstringCount,
      docstringOf: e.docstringOf,
      parent: parent ? convert(parent) : null,
      children: [],
    };
    // an element reaches its parent, so a listed child would make it a cycle that JSON refuses
    Object.defineProperty(element, "children", { enumerable: false });
    cache.set(e.label, element);
    return element;
  };
  const elements = [...inventory]
    .sort((a, b) => a.span.startByte - b.span.startByte || b.span.endByte - a.span.endByte)
    .map(convert);
  for (const element of elements) {
    (element.parent?.children as CustomElement[] | undefined)?.push(element);
  }
  return elements;
}

/** The elements of one file a rule may target: an oversized one is never judged. */
export function tsElementsOf(
  inventory: readonly InventoryElement[],
  path: string,
): CustomElement[] {
  return judgeable(inventory, fileElementsOf(inventory, path));
}

function judgeable(
  inventory: readonly InventoryElement[],
  elements: readonly CustomElement[],
): CustomElement[] {
  const byLabel = new Map(elements.map((e) => [e.label, e]));
  return inventory.filter((e) => e.oversized !== true).map((e) => byLabel.get(e.label)!);
}

export type ResolvedCustomTarget =
  | { targets: readonly CustomElement[]; scopedOut: number }
  | { error: ClassifyError };
/** Every rule's resolution, plus the file of each path a target sits in (the classify ctx.file). */
export type ResolvedCustomTargets = Map<CustomRule, ResolvedCustomTarget> & {
  readonly files: ReadonlyMap<string, CustomFile>;
};

/**
 * Resolves every rule ONCE per run over the completed walk: capture strings filter the full
 * inventory; the function form receives the FULL walk inventory — not the rule's context — and is
 * pure selection. Errors resolve to a per-unit failure for that rule.
 */
export function resolveAllCustomTargets(
  customRules: readonly CustomRule[],
  inventoryByPath: ReadonlyMap<string, readonly InventoryElement[]>,
  sourceByPath: ReadonlyMap<string, string> = new Map(),
): ResolvedCustomTargets {
  const elementsByPath = new Map<string, readonly CustomElement[]>();
  const fileElements = new Map<string, readonly CustomElement[]>();
  for (const [path, inventory] of inventoryByPath) {
    const elements = fileElementsOf(inventory, path);
    fileElements.set(path, elements);
    elementsByPath.set(path, judgeable(inventory, elements));
  }
  const allElements = [...elementsByPath.values()].flat();
  const rules = new Map<CustomRule, ResolvedCustomTarget>();
  for (const rule of customRules) rules.set(rule, resolveTargets(rule, allElements));
  // only a file a target sits in gets one: the run drops the text of every other file
  const files = new Map<string, CustomFile>();
  for (const resolved of rules.values()) {
    if (!("targets" in resolved)) continue;
    for (const { path } of resolved.targets) {
      if (!files.has(path)) {
        files.set(
          path,
          customFileOf(
            path,
            sourceByPath.get(path) ?? "",
            elementsByPath.get(path)!,
            fileElements.get(path)!,
          ),
        );
      }
    }
  }
  return Object.assign(rules, { files });
}

function customFileOf(
  path: string,
  source: string,
  elements: readonly CustomElement[],
  all: readonly CustomElement[] = elements,
): CustomFile {
  return {
    path,
    source,
    definitions: elements.filter((e) => e.capture !== "comment" && e.capture !== "import"),
    comments: elements.filter((e) => e.capture === "comment"),
    imports: elements.filter((e) => e.capture === "import"),
    elements: all,
  };
}

/** Resolves one rule's REQUEST into its slice over the full walk inventory. */
export function resolveTargets(
  rule: CustomRule,
  allElements: readonly CustomElement[],
): ResolvedCustomTarget {
  if (typeof rule.target === "function") {
    try {
      const picked = rule.target(allElements);
      if (isPromise(picked)) {
        return {
          error: ruleFailed(
            "(target)",
            rule.name,
            "target function returned a Promise — handlers are sync-only in v1",
          ),
        };
      }
      // Per-rule scoping applies to selection-function picks too: a scoped-out element costs
      // zero provider calls regardless of how it was requested.
      const filtered = picked.filter((e) => ruleInScope(rule, e.path));
      return { targets: filtered, scopedOut: picked.length - filtered.length };
    } catch (thrown) {
      return { error: ruleFailed("(target)", rule.name, thrownMessage(thrown), thrown) };
    }
  }
  // THE shared target grammar: selection here is the same per-element mapping the declarative
  // tier uses, so the two tiers cannot drift (a comments target matches comment elements AND code
  // carrying an attachedComment).
  const requested: readonly string[] = Array.isArray(rule.target) ? rule.target : [rule.target];
  const filtered = allElements.filter(
    (e) => requested.some((t) => matchesTarget(t, e)) && ruleInScope(rule, e.path),
  );
  const scopedOut =
    allElements.filter((e) => requested.some((t) => matchesTarget(t, e))).length - filtered.length;
  return { targets: filtered, scopedOut };
}

function isPromise(v: unknown): v is Promise<unknown> {
  return typeof v === "object" && v !== null && typeof (v as Promise<unknown>).then === "function";
}

function thrownMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

const inputOf = (element: CustomElement): string => element.path + "#" + element.id;

function ruleFailed(
  input: string,
  ruleName: string,
  message: string,
  cause?: unknown,
): ClassifyError {
  return new ClassifyError("RULE_FAILED", input, 'custom rule "' + ruleName + '": ' + message, {
    cause,
  });
}

export interface CustomRulePhase {
  /** Everything the phase produced, in stream order. */
  events: LintEvent[];
  /** An authorization failure aborts the whole run, not just the unit. */
  fatal: boolean;
}

interface StateLimits {
  readonly partLimit: number;
  readonly partTokens: (chars: number) => number;
}

/** One element's judgment: the events it produced, and its reading when it got one. */
interface Measured {
  readonly events: LintEvent[];
  readonly value?: number;
  readonly fatal?: boolean;
  readonly state?: object;
}

function elementOf(element: CustomElement): Element {
  return {
    kind: element.capture as Element["kind"],
    span: element.span,
    label: element.label,
    parent: element.parent !== null ? element.parent.label : undefined,
  };
}

function classificationEvent(
  rule: CustomRule,
  element: CustomElement,
  reading: { value: number } | { refused: true },
): LintEvent {
  return {
    type: "classification",
    classification: {
      rule: rule.name,
      input: inputOf(element),
      ...reading,
      element: elementOf(element),
    },
  };
}

function questionOf(rule: CustomRule, element: CustomElement, ctx: ClassifyContext): unknown {
  if (rule.classify !== undefined) return rule.classify(element, ctx);
  const { instructions, criteria } = rule;
  const state = rule.state(element, ctx);
  if (isPromise(state)) throw new Error("state returned a Promise — handlers are sync-only in v1");
  return { instructions, criteria, state };
}

/** The rule's state for one element, or the error that says why it has none. */
function stateFor(
  rule: CustomRule,
  element: CustomElement,
  ctx: ClassifyContext,
): ReturnType<typeof validateStateSpec> {
  const input = inputOf(element);
  try {
    const spec = questionOf(rule, element, ctx);
    if (isPromise(spec)) {
      throw new Error("classify returned a Promise — handlers are sync-only in v1");
    }
    return validateStateSpec(spec, rule.name, input);
  } catch (thrown) {
    throw ruleFailed(input, rule.name, thrownMessage(thrown), thrown);
  }
}

/**
 * The first string state part over the bound, which skips the element: ordinary state never crashes
 * the provider.
 */
function oversizedPart(state: object, limits: StateLimits): string | undefined {
  return Object.entries(state).find(
    ([, part]) => typeof part === "string" && limits.partTokens(part.length) > limits.partLimit,
  )?.[0];
}

async function measure(
  rule: CustomRule,
  element: CustomElement,
  ctx: ClassifyContext,
  classifier: Classifier,
  limits: StateLimits,
): Promise<Measured> {
  const input = inputOf(element);
  let stateSpec: ReturnType<typeof validateStateSpec>;
  try {
    stateSpec = stateFor(rule, element, ctx);
  } catch (thrown) {
    return { events: [{ type: "error", error: thrown as ClassifyError }] };
  }
  const part = oversizedPart(stateSpec.state, limits);
  if (part !== undefined) {
    const note = `custom rule "${rule.name}": state part "${part}" for ${input} exceeds ${limits.partLimit} tokens - skipped`;
    return { events: [{ type: "note", note }] };
  }
  const result: Measured = await answered(rule, element, stateSpec, classifier).catch(
    (thrown: unknown) => {
      const error = toClassifyError(input, thrown);
      return { events: [{ type: "error", error }], fatal: error.code === "PROVIDER_AUTH" };
    },
  );
  return { ...result, state: stateSpec.state };
}

/** The rule's one question asked of the state it composed, and the reading that came back. */
async function answered(
  rule: CustomRule,
  element: CustomElement,
  stateSpec: ReturnType<typeof validateStateSpec>,
  classifier: Classifier,
): Promise<Measured> {
  // the state is the rule's own: the element says where its answer is recorded
  const answers = await inCall(element, [rule.name], () =>
    classifier(stateSpec.state as unknown as AnyState, {
      [rule.name]: {
        type: "noul",
        instructions: stateSpec.instructions,
        criteria: stateSpec.criteria,
      },
    }),
  );
  const noul = answers[rule.name];
  if (isRefusal(noul)) {
    return { events: [classificationEvent(rule, element, { refused: true })] };
  }
  if (noul === undefined || typeof noul.value !== "number" || !Number.isFinite(noul.value)) {
    throw new ClassifyError(
      "PROVIDER_RESPONSE_INVALID",
      inputOf(element),
      "answer for '" + rule.name + "' is missing or not a finite number",
    );
  }
  return {
    events: [classificationEvent(rule, element, { value: noul.value })],
    value: noul.value,
  };
}

/** The rule's policy over its readings, once: data or a function, bound to each target's span. */
function policyEvents(
  rule: CustomRule,
  ctx: { readonly targets: readonly CustomElement[] },
  measured: readonly { readonly element: CustomElement; readonly value: number }[],
): LintEvent[] {
  const results: RuleResult[] = measured.map((m) => ({ type: "noul", noul: m.value }));
  const events: LintEvent[] = [];
  const handle = rule.handle;
  if (typeof handle !== "function") {
    const compiled = compileNoulHandler(handle);
    measured.forEach((m, i) => {
      const outcome = compiled({ value: m.value });
      const finding =
        outcome === null ? null : tsFinding(rule.name, m.element, results[i]!, outcome);
      if (finding !== null) events.push({ type: "finding", finding });
    });
    return events;
  }
  try {
    const decisions = handle(results, ctx);
    if (isPromise(decisions)) {
      throw new Error("handle returned a Promise — handlers are sync-only in v1");
    }
    if (!Array.isArray(decisions) || decisions.length !== results.length) {
      throw new Error(
        `handle must return one decision per result (${results.length} expected, got ${decisions?.length})`,
      );
    }
    decisions.forEach((raw, i) => {
      const decision = validateDecision(raw, rule.name, i);
      const finding = tsFinding(rule.name, measured[i]!.element, results[i]!, decision);
      if (finding !== null) events.push({ type: "finding", finding });
    });
  } catch (thrown) {
    events.push({
      type: "error",
      error: ruleFailed("(policy)", rule.name, thrownMessage(thrown), thrown),
    });
  }
  return events;
}

/**
 * Why a rule has no targets to judge, as events: its resolution error, or a note on what its scope
 * removed.
 */
function resolutionEvents(rule: CustomRule, resolved: ResolvedCustomTarget): LintEvent[] {
  if ("error" in resolved) return [{ type: "error", error: resolved.error }];
  if (resolved.scopedOut === 0) return [];
  return [
    {
      type: "note",
      note: `custom rule "${rule.name}": scope excluded ${resolved.scopedOut} element(s)`,
    },
  ];
}

interface ComposedState {
  readonly element: CustomElement;
  readonly state: object;
}

function isEmptyPart(part: unknown): boolean {
  if (typeof part === "string") return part.trim() === "";
  return part === undefined || part === null || (Array.isArray(part) && part.length === 0);
}

/** One note for each part of a rule's state that was empty, per capture it was composed for. */
function emptyPartNotes(rule: CustomRule, states: readonly ComposedState[]): LintEvent[] {
  const events: LintEvent[] = [];
  for (const [capture, composed] of Map.groupBy(states, (s) => s.element.capture)) {
    const parts = new Set(composed.flatMap((s) => Object.keys(s.state)));
    for (const part of parts) {
      const empty = composed.filter((s) => isEmptyPart(Reflect.get(s.state, part))).length;
      if (empty === 0) continue;
      const note = `custom rule "${rule.name}": ${part}: empty in ${empty} of ${composed.length} ${capture}`;
      events.push({ type: "note", note });
    }
  }
  return events;
}

/** Judges one rule's targets in order, then applies its policy; stops at an abort or a fatal error. */
async function runRule(
  rule: CustomRule,
  targets: readonly CustomElement[],
  files: ReadonlyMap<string, CustomFile>,
  classifier: Classifier,
  isAborted: () => boolean,
  limits: StateLimits,
): Promise<{ events: LintEvent[]; fatal: boolean }> {
  const ctx = { targets };
  const fileOf = (element: CustomElement): CustomFile =>
    files.get(element.path) ?? customFileOf(element.path, "", [element]);
  const events: LintEvent[] = [];
  const measured: { element: CustomElement; value: number }[] = [];
  const states: ComposedState[] = [];
  let fatal = false;
  for (const element of targets) {
    if (isAborted() || fatal) break;
    const result = await measure(
      rule,
      element,
      { targets, file: fileOf(element) },
      classifier,
      limits,
    );
    events.push(...result.events);
    fatal = result.fatal === true;
    if (result.state !== undefined) states.push({ element, state: result.state });
    if (result.value !== undefined) measured.push({ element, value: result.value });
  }
  events.push(...emptyPartNotes(rule, states), ...policyEvents(rule, ctx, measured));
  return { events, fatal };
}

/**
 * Sized state parts are backstopped per part (over the element token bound: noted, skipped —
 * ordinary state can never crash the request).
 */
export async function runCustomRules(
  customRules: readonly CustomRule[],
  resolved: ResolvedCustomTargets,
  classifier: Classifier,
  isAborted: () => boolean,
  maxInputTokens?: number,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): Promise<CustomRulePhase> {
  const limits: StateLimits = {
    partLimit: maxInputTokens ?? MAX_ELEMENT_TOKENS,
    partTokens: (chars) =>
      maxInputTokens === undefined ? charsToTokens(chars) : Math.ceil(chars / charsPerToken),
  };
  const events: LintEvent[] = [];
  let fatal = false;
  for (const rule of customRules) {
    if (isAborted() || fatal) break;
    const resolvedRule = resolved.get(rule);
    if (resolvedRule === undefined) {
      throw new Error('no resolution entry for custom rule "' + rule.name + '" (engine bug)');
    }
    events.push(...resolutionEvents(rule, resolvedRule));
    if ("error" in resolvedRule) continue;
    const ran = await runRule(
      rule,
      resolvedRule.targets,
      resolved.files,
      classifier,
      isAborted,
      limits,
    );
    events.push(...ran.events);
    fatal = ran.fatal;
  }
  return { events, fatal };
}

function tsFinding(
  ruleName: string,
  target: CustomElement,
  result: RuleResult,
  decision: { severity: "error" | "warn" | null; message?: string },
): Finding | null {
  if (decision.severity === null) return null;
  const value = result.type === "noul" ? result.noul : (result as { score: number }).score;
  const span: Span = {
    start: target.span.start,
    end: target.span.end,
    startByte: target.span.startByte,
    endByte: target.span.endByte,
  };
  // Literal ternary branch, NOT a conditional spread: the declared Finding return type puts this
  // literal under excess-property checking — an undeclared decision field is a compile error.
  return {
    rule: ruleName,
    input: inputOf(target),
    value,
    severity: decision.severity,
    message: decision.message !== undefined ? decision.message : undefined,
    location: { input: inputOf(target), span },
  };
}
