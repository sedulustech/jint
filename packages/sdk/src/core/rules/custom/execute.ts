/**
 * TS-rule execution: the engine resolves every rule's elements ONCE over the completed walk, the
 * rule compiles a question per element, jint calls the classifier, and the rule's policy decides
 * once per rule — findings bind to the judged element's span.
 *
 * Mid-run contract: a throwing handler fails that unit only — non-fatal, streamed, the run
 * continues; a returned Promise from a sync-only handler is the same contract violation. State is
 * composed freely by the rule (observability is the guarantee — wire dumps capture the exact
 * bytes).
 */

import { charsToTokens, MAX_ELEMENT_TOKENS } from "../../input/walk.ts";
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
import { toClassifyError } from "../classify.ts";
import { compileNoulHandler } from "../handle.ts";
import {
  validateDecision,
  validateStateSpec,
  type CustomElement,
  type CustomRule,
} from "./schema.ts";
import type { InventoryElement } from "../../input/walk.ts";

/**
 * One unit's TS-facing element view: the walk inventory materialized for rules. Invariants are
 * carried, not dropped: oversized elements are excluded (the JSON tier never judges them), and a
 * dangling parent label is an inventory inconsistency — it throws, never silently nulls.
 */
export function tsElementsOf(
  inventory: readonly InventoryElement[],
  path: string,
): CustomElement[] {
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
      id: e.label,
      path,
      capture: e.capture,
      source: e.content,
      span: {
        start: e.span.start,
        end: e.span.end,
        startByte: e.span.startByte,
        endByte: e.span.endByte,
      },
      attachedComment: e.attachedComment,
      internalCommentCount: e.internalCommentCount,
      docstringCount: e.docstringCount,
      docstringOf: e.docstringOf,
      parent: parent ? convert(parent) : null,
    };
    cache.set(e.label, element);
    return element;
  };
  return inventory.filter((e) => e.oversized !== true).map(convert);
}

/**
 * One rule's resolved REQUEST: its slice plus how many requested elements scoping removed, or the
 * RULE_FAILED that replaced selection. scopedOut is SIGNAL (review 396888e finding 3): the custom
 * tier notes skipped elements at run level exactly like the JSON tier notes per unit.
 */
export type ResolvedCustomTarget =
  | { targets: readonly CustomElement[]; scopedOut: number }
  | { error: ClassifyError };
/** Resolution for every rule, in declared order. */
export type ResolvedCustomTargets = Map<CustomRule, ResolvedCustomTarget>;

/**
 * Resolves every rule ONCE per run over the completed walk: capture strings filter the full
 * inventory; the function form receives the FULL walk inventory — not the rule's context — and is
 * pure selection. Errors resolve to a per-unit failure for that rule.
 */
export function resolveAllCustomTargets(
  customRules: readonly CustomRule[],
  inventoryByPath: ReadonlyMap<string, readonly InventoryElement[]>,
): ResolvedCustomTargets {
  const elementsByPath = new Map<string, readonly CustomElement[]>();
  for (const [path, inventory] of inventoryByPath) {
    elementsByPath.set(path, tsElementsOf(inventory, path));
  }
  const allElements = [...elementsByPath.values()].flat();
  const out: ResolvedCustomTargets = new Map();
  for (const rule of customRules) out.set(rule, resolveTargets(rule, allElements));
  return out;
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
      // zero jev calls regardless of how it was requested.
      const filtered = picked.filter((e) => ruleInScope(rule, e.path));
      return { targets: filtered, scopedOut: picked.length - filtered.length };
    } catch (thrown) {
      return { error: ruleFailed("(target)", rule.name, thrownMessage(thrown)) };
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

/**
 * The input id for a judged element: the file path plus a freshly minted uuid, the same scheme as
 * the declarative tier — identity is minted once per element per run and shared by the measurement
 * and the finding location. The positional label stays the projection label only; line-span ids
 * remain whole-file unit ids.
 */
type ElementInputIds = WeakMap<CustomElement, string>;
function inputOf(element: CustomElement, inputIds: ElementInputIds): string {
  const minted = inputIds.get(element);
  if (minted !== undefined) return minted;
  const input = element.path + "#" + crypto.randomUUID();
  inputIds.set(element, input);
  return input;
}

function ruleFailed(input: string, ruleName: string, message: string): ClassifyError {
  return new ClassifyError("RULE_FAILED", input, 'custom rule "' + ruleName + '": ' + message);
}

export interface CustomRulePhase {
  /** Everything the phase produced, in stream order. */
  events: LintEvent[];
  /** An authorization failure aborts the whole run, not just the unit. */
  fatal: boolean;
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
): Promise<CustomRulePhase> {
  const events: LintEvent[] = [];
  let fatal = false;
  const inputIds: ElementInputIds = new WeakMap();
  for (const rule of customRules) {
    if (isAborted() || fatal) break;
    const resolvedRule = resolved.get(rule);
    if (resolvedRule === undefined) {
      // resolveAllCustomTargets sets an entry for EVERY rule — this is impossible state, and a silent
      // skip here would be invisible data loss (a declared rule producing zero measurements).
      throw new Error('no resolution entry for custom rule "' + rule.name + '" (engine bug)');
    }
    if ("error" in resolvedRule) {
      events.push({ type: "error", error: resolvedRule.error });
      continue;
    }
    // Scoped-out requested elements are signal, never silence: one run-level note per rule says
    // how many its scope removed (the custom tier resolves once per run, so run level IS its unit).
    if ("scopedOut" in resolvedRule && resolvedRule.scopedOut > 0) {
      events.push({
        type: "note",
        note: `custom rule "${rule.name}": scope excluded ${resolvedRule.scopedOut} element(s)`,
      });
    }
    const targets = resolvedRule.targets;
    const ctx = { targets };
    const results: RuleResult[] = [];
    const readings: number[] = [];
    const measuredTargets: CustomElement[] = [];
    for (const element of targets) {
      if (isAborted() || fatal) break;
      const input = inputOf(element, inputIds);
      let stateSpec;
      try {
        stateSpec = rule.classify(element, ctx);
        if (isPromise(stateSpec)) {
          throw new Error("classify returned a Promise — handlers are sync-only in v1");
        }
        stateSpec = validateStateSpec(stateSpec, rule.name, input);
      } catch (thrown) {
        events.push({ type: "error", error: ruleFailed(input, rule.name, thrownMessage(thrown)) });
        continue;
      }
      // Per-part size backstop: any string state part over the bound skips the element (noted),
      // mirroring the walk's oversized-element behavior — ordinary state never crashes jev.
      const oversized = Object.entries(stateSpec.state).find(
        ([, part]) => typeof part === "string" && charsToTokens(part.length) > MAX_ELEMENT_TOKENS,
      );
      if (oversized !== undefined) {
        events.push({
          type: "note",
          note:
            'custom rule "' +
            rule.name +
            '": state part "' +
            oversized[0] +
            '" for ' +
            input +
            " exceeds " +
            MAX_ELEMENT_TOKENS +
            " tokens - skipped",
        });
        continue;
      }
      let value: number;
      try {
        const answers = await classifier(stateSpec.state as unknown as AnyState, {
          [rule.name]: {
            type: "noul",
            instructions: stateSpec.instructions,
            criteria: stateSpec.criteria,
          },
        });
        const noul = answers[rule.name];
        if (noul === undefined || typeof noul.value !== "number" || !Number.isFinite(noul.value)) {
          events.push({
            type: "error",
            error: new ClassifyError(
              "JEV_RESPONSE_INVALID",
              input,
              "answer for '" + rule.name + "' is missing or not a finite number",
            ),
          });
          continue;
        }
        value = noul.value;
      } catch (thrown) {
        const error = toClassifyError(input, thrown);
        events.push({ type: "error", error });
        if (error.code === "JEV_AUTH") fatal = true;
        continue;
      }
      results.push({ type: "noul", noul: value });
      readings.push(value);
      measuredTargets.push(element);
      events.push({
        type: "measurement",
        measurement: {
          rule: rule.name,
          input,
          value,
          element: {
            kind: element.capture as Element["kind"],
            span: element.span,
            label: element.id,
            parent: element.parent !== null ? element.parent.id : undefined,
          },
        },
      });
    }
    // POLICY, once: handle is every rule's policy — data or a function, one required union field
    // (enforced at load). Findings bind to the target's span.
    const handle = rule.handle;
    if (typeof handle === "function") {
      try {
        const decisions = handle(results, ctx);
        if (isPromise(decisions)) {
          throw new Error("handle returned a Promise — handlers are sync-only in v1");
        }
        if (!Array.isArray(decisions) || decisions.length !== results.length) {
          throw new Error(
            "handle must return one decision per result (" +
              String(results.length) +
              " expected, got " +
              String(decisions?.length) +
              ")",
          );
        }
        for (let i = 0; i < decisions.length; i++) {
          const decision = validateDecision(decisions[i], rule.name, i);
          const finding = tsFinding(
            rule.name,
            measuredTargets[i]!,
            results[i]!,
            decision,
            inputIds,
          );
          if (finding !== null) events.push({ type: "finding", finding });
        }
      } catch (thrown) {
        events.push({
          type: "error",
          error: ruleFailed("(policy)", rule.name, thrownMessage(thrown)),
        });
      }
    } else {
      const compiled = compileNoulHandler(handle);
      for (let i = 0; i < readings.length; i++) {
        const outcome = compiled({ value: readings[i]! });
        if (outcome === null) continue;
        const finding = tsFinding(rule.name, measuredTargets[i]!, results[i]!, outcome, inputIds);
        if (finding !== null) events.push({ type: "finding", finding });
      }
    }
  }
  return { events, fatal };
}

function tsFinding(
  ruleName: string,
  target: CustomElement,
  result: RuleResult,
  decision: { severity: "error" | "warn" | null; message?: string },
  inputIds: ElementInputIds,
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
    input: inputOf(target, inputIds),
    value,
    severity: decision.severity,
    message: decision.message !== undefined ? decision.message : undefined,
    location: { input: inputOf(target, inputIds), span },
  };
}
