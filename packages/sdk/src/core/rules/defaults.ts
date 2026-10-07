/**
 * The compiled baseline of the default rule set: the twelve default rules, each shipping a visible,
 * overridable handle; one rule classifies one attribute. The rules' single source of truth is the
 * DECLARATIVE spec package @jint/defaults — every entry there is the exact shape a jint.config.json
 * rule entry takes — and this module compiles those specs to the internal function form at module
 * init, through the same declarative-compile seam the JSON config tier uses (compileDataHandle,
 * moved here from the loader: one seam for both tiers). Editing a spec is a recalibration event;
 * calibration comments live with the specs.
 */

import { defaultRuleSpecs, type RuleSpec } from "@jint/defaults";
import { compileDataHandle } from "./handle.ts";
import type { Rule } from "../types.ts";

/**
 * HANDLERS ARE TYPED DATA: every default handle is a NoulHandler or a ScoreHandler; the compiled
 * Rule carries both the function and the declarative data it was compiled from (handleData), so a
 * default is paste-able into jint.config.json verbatim. The declarative config surface requires a
 * real handle; probing is measuring — never a null handle.
 */
function compileSpec(spec: RuleSpec): Rule {
  const isChoice = spec.kind === "choice";
  const handle = compileDataHandle(
    spec.handle,
    spec.name,
    "@jint/defaults (built-in spec)",
    isChoice,
    isChoice ? spec.criteria : [],
  );
  if (isChoice) {
    return {
      name: spec.name,
      kind: "choice",
      instructions: spec.instructions,
      criteria: spec.criteria as [string, string, ...string[]],
      target: spec.target,
      handle,
      handleData: spec.handle,
    };
  }
  return {
    name: spec.name,
    instructions: spec.instructions,
    criteria: spec.criteria,
    target: spec.target,
    handle,
    handleData: spec.handle,
  };
}

/** One compiled Rule per declarative spec — same names, same order, identical behavior. */
export const isNamePurposeful: Rule = compileSpec(defaultRuleSpecs.is_name_purposeful!);
export const isFunctionSrp: Rule = compileSpec(defaultRuleSpecs.is_function_srp!);
export const willErrorLoseCause: Rule = compileSpec(defaultRuleSpecs.will_error_lose_cause!);
export const isVocabularyConsistent: Rule = compileSpec(defaultRuleSpecs.is_vocabulary_consistent!);
export const isNamingConventionConsistent: Rule = compileSpec(
  defaultRuleSpecs.is_naming_convention_consistent!,
);
export const isFilenameFitting: Rule = compileSpec(defaultRuleSpecs.is_filename_fitting!);
export const isGreppable: Rule = compileSpec(defaultRuleSpecs.is_greppable!);
export const is_comment_narration: Rule = compileSpec(defaultRuleSpecs.is_comment_narration!);
export const is_comment_patching_readability: Rule = compileSpec(
  defaultRuleSpecs.is_comment_patching_readability!,
);
export const will_comment_drift: Rule = compileSpec(defaultRuleSpecs.will_comment_drift!);
export const isCognitivelyComplex: Rule = compileSpec(defaultRuleSpecs.is_cognitively_complex!);

/** All default rules by name — the `rules.defaults` record of the config surface. */
export const defaultRules: Record<string, Rule> = Object.freeze({
  is_name_purposeful: isNamePurposeful,
  is_vocabulary_consistent: isVocabularyConsistent,
  is_naming_convention_consistent: isNamingConventionConsistent,
  is_greppable: isGreppable,
  is_filename_fitting: isFilenameFitting,
  is_comment_narration,
  is_comment_patching_readability,
  will_comment_drift,
  will_error_lose_cause: willErrorLoseCause,
  is_cognitively_complex: isCognitivelyComplex,
  is_function_srp: isFunctionSrp,
});
