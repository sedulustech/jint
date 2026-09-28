/**
 * TS-rule execution (design rules-context/01 §target/ctx, 03 execution): target resolution ONCE per
 * run over the completed walk, then ctx = { targets }, classify(self, ctx) per resolved target, jev
 * called by jint, policy (handle | handleClassification) once, findings bound to the target's
 * span.
 *
 * Mid-run contract: a throwing handler (target fn, classify, handleClassification) is RULE_FAILED —
 * per-unit, non-fatal, streamed, the run continues. A returned Promise from a sync-only handler is
 * the same contract violation. Findings bind to ctx.targets[i]'s span; state is composed freely by
 * the rule (observability is the guarantee — wire dumps capture the exact bytes).
 */

import { MAX_ELEMENT_CHARS } from "../input/walk.ts";
import { elementWireId, matchesTarget } from "../sensors/classify.ts";
import { toClassifyError } from "../sensors/classify.ts";
import { compileHandle } from "../sensors/handle.ts";
import {
  ClassifyError,
  type AnyState,
  type Classifier,
  type Finding,
  type LintEvent,
  type RuleResult,
  type Span,
} from "../types.ts";
import { validateDecision, validateStateSpec, type TsElement, type TsRule } from "./sdk.ts";
import type { InventoryElement } from "../input/walk.ts";

/**
 * One unit's TS-facing element view: the walk inventory materialized for rules. Invariants are
 * carried, not dropped: oversized elements are excluded (the JSON tier never judges them), and a
 * dangling parent label is an inventory inconsistency — it throws, never silently nulls.
 */
export function tsElementsOf(inventory: readonly InventoryElement[], path: string): TsElement[] {
  const byLabel = new Map(inventory.map((e) => [e.label, e]));
  const cache = new Map<string, TsElement>();
  const convert = (e: InventoryElement): TsElement => {
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
    const element: TsElement = {
      id: e.label,
      path,
      role: e.role,
      source: e.content,
      span: {
        start: e.span.start,
        end: e.span.end,
        startByte: e.span.startByte,
        endByte: e.span.endByte,
      },
      ...(e.attachedComment !== undefined && { attachedComment: e.attachedComment }),
      parent: parent ? convert(parent) : null,
    };
    cache.set(e.label, element);
    return element;
  };
  return inventory.filter((e) => e.oversized !== true).map(convert);
}

/** One rule's resolved REQUEST: its slice, or the RULE_FAILED that replaced selection. */
export type ResolvedTsTarget = { targets: readonly TsElement[] } | { error: ClassifyError };
/** Resolution for every rule, in declared order. */
export type ResolvedTsTargets = Map<TsRule, ResolvedTsTarget>;

/**
 * Resolves every rule ONCE per run over the completed walk (design rules-context/01): role strings
 * filter the full inventory; the function form receives the FULL walk inventory — not ctx — and is
 * pure selection. Errors resolve to a RULE_FAILED for that rule.
 */
export function resolveAllTsTargets(
  tsRules: readonly TsRule[],
  inventoryByPath: ReadonlyMap<string, readonly InventoryElement[]>,
): ResolvedTsTargets {
  const elementsByPath = new Map<string, readonly TsElement[]>();
  for (const [path, inventory] of inventoryByPath) {
    elementsByPath.set(path, tsElementsOf(inventory, path));
  }
  const allElements = [...elementsByPath.values()].flat();
  const out: ResolvedTsTargets = new Map();
  for (const rule of tsRules) out.set(rule, resolveTargets(rule, allElements));
  return out;
}

/** Resolves one rule's REQUEST into its slice over the full walk inventory. */
export function resolveTargets(rule: TsRule, allElements: readonly TsElement[]): ResolvedTsTarget {
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
      return { targets: picked };
    } catch (thrown) {
      return { error: ruleFailed("(target)", rule.name, thrownMessage(thrown)) };
    }
  }
  // THE shared target grammar: matchesTarget is the JSON tier's rulesForElement mapping, so the
  // two tiers cannot drift (comments matches comment elements AND code carrying an attachedComment).
  const requested: readonly string[] = Array.isArray(rule.target) ? rule.target : [rule.target];
  return { targets: allElements.filter((e) => requested.some((t) => matchesTarget(t, e))) };
}

function isPromise(v: unknown): v is Promise<unknown> {
  return typeof v === "object" && v !== null && typeof (v as Promise<unknown>).then === "function";
}

function thrownMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** The input id for a judged element: path#wire (same shape as the JSON element tier). */
function inputOf(element: TsElement): string {
  return element.path + "#" + elementWireId(element.span);
}

function ruleFailed(input: string, ruleName: string, message: string): ClassifyError {
  return new ClassifyError("RULE_FAILED", input, 'ts rule "' + ruleName + '": ' + message);
}

export interface TsRulePhase {
  /** Events in stream order: measurements, findings, errors, degradation notes. */
  events: LintEvent[];
  /** True when a JEV_AUTH came through — the run aborts like the JSON tier. */
  fatal: boolean;
}

/**
 * Runs the loaded TS rules over the completed walk: resolve, fan out classify per target, call the
 * classifier per compiled spec, then policy once per rule. Sized state parts are backstopped per
 * part (over MAX_ELEMENT_CHARS: noted, skipped — ordinary state can never crash the request).
 */
export async function runTsRules(
  tsRules: readonly TsRule[],
  resolved: ResolvedTsTargets,
  classifier: Classifier,
  isAborted: () => boolean,
): Promise<TsRulePhase> {
  const events: LintEvent[] = [];
  let fatal = false;
  for (const rule of tsRules) {
    if (isAborted() || fatal) break;
    const resolvedRule = resolved.get(rule);
    if (resolvedRule === undefined) {
      // resolveAllTsTargets sets an entry for EVERY rule — this is impossible state, and a silent
      // skip here would be invisible data loss (a declared rule producing zero measurements).
      throw new Error('no resolution entry for ts rule "' + rule.name + '" (engine bug)');
    }
    if ("error" in resolvedRule) {
      events.push({ type: "error", error: resolvedRule.error });
      continue;
    }
    const targets = resolvedRule.targets;
    const ctx = { targets };
    const results: RuleResult[] = [];
    const aligned: TsElement[] = [];
    for (const self of targets) {
      if (isAborted() || fatal) break;
      const input = inputOf(self);
      let spec;
      try {
        spec = rule.classify(self, ctx);
        if (isPromise(spec)) {
          throw new Error("classify returned a Promise — handlers are sync-only in v1");
        }
        spec = validateStateSpec(spec, rule.name, input);
      } catch (thrown) {
        events.push({ type: "error", error: ruleFailed(input, rule.name, thrownMessage(thrown)) });
        continue;
      }
      // Per-part size backstop: any string state part over the bound skips the element (noted),
      // mirroring the walk's oversized-element behavior — ordinary state never crashes jev.
      const oversized = Object.entries(spec.state).find(
        ([, part]) => typeof part === "string" && part.length > MAX_ELEMENT_CHARS,
      );
      if (oversized !== undefined) {
        events.push({
          type: "note",
          note:
            'ts rule "' +
            rule.name +
            '": state part "' +
            oversized[0] +
            '" for ' +
            input +
            " exceeds " +
            MAX_ELEMENT_CHARS +
            " chars - skipped",
        });
        continue;
      }
      let value: number;
      try {
        const answers = await classifier(spec.state as unknown as AnyState, {
          [rule.name]: { type: "noul", instructions: spec.instructions, criteria: spec.criteria },
        });
        const noul = answers[rule.name];
        if (typeof noul !== "number" || !Number.isFinite(noul)) {
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
        value = noul;
      } catch (thrown) {
        const error = toClassifyError(input, thrown);
        events.push({ type: "error", error });
        if (error.code === "JEV_AUTH") fatal = true;
        continue;
      }
      results.push({ type: "noul", noul: value });
      aligned.push(self);
      events.push({
        type: "measurement",
        measurement: { rule: rule.name, input, value, stage: "element" },
      });
    }
    // POLICY, once: exactly one per rule, enforced at load. Findings bind to the target's span.
    if (rule.handleClassification !== undefined) {
      try {
        const decisions = rule.handleClassification(results, ctx);
        if (isPromise(decisions)) {
          throw new Error("handleClassification returned a Promise — handlers are sync-only in v1");
        }
        if (!Array.isArray(decisions) || decisions.length !== results.length) {
          throw new Error(
            "handleClassification must return one decision per result (" +
              String(results.length) +
              " expected, got " +
              String(decisions?.length) +
              ")",
          );
        }
        for (let i = 0; i < decisions.length; i++) {
          const decision = validateDecision(decisions[i], rule.name, i);
          const finding = tsFinding(rule.name, aligned[i]!, results[i]!, decision);
          if (finding !== null) events.push({ type: "finding", finding });
        }
      } catch (thrown) {
        events.push({
          type: "error",
          error: ruleFailed("(policy)", rule.name, thrownMessage(thrown)),
        });
      }
    } else if (rule.handle !== undefined) {
      const handle = compileHandle(rule.handle);
      for (let i = 0; i < results.length; i++) {
        const value = (results[i] as { noul: number }).noul;
        const severity = handle(value);
        const finding = tsFinding(rule.name, aligned[i]!, results[i]!, { severity });
        if (finding !== null) events.push({ type: "finding", finding });
      }
    }
  }
  return { events, fatal };
}

/** A policy decision becomes a finding bound to the target's span; null severity stays silent. */
function tsFinding(
  ruleName: string,
  target: TsElement,
  result: RuleResult,
  decision: { severity: "error" | "warn" | null; message?: string; data?: Record<string, unknown> },
): Finding | null {
  if (decision.severity === null) return null;
  const value = result.type === "noul" ? result.noul : (result as { score: number }).score;
  const span: Span = {
    start: target.span.start,
    end: target.span.end,
    startByte: target.span.startByte,
    endByte: target.span.endByte,
  };
  return {
    rule: ruleName,
    input: inputOf(target),
    value,
    severity: decision.severity,
    ...(decision.message !== undefined && { message: decision.message }),
    ...(decision.data !== undefined && { data: decision.data }),
    location: { input: target.path, span },
  };
}
