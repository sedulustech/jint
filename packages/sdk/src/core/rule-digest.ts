import type { CustomRule } from "./rules/custom/schema.ts";
import type { Rule } from "./types.ts";
import type { RuleDigest } from "@jint/contract";

export function ruleDigest(rule: Rule | CustomRule): RuleDigest {
  return {
    name: rule.name,
    instructions: "instructions" in rule ? rule.instructions : undefined,
    criteria: "criteria" in rule ? rule.criteria : null,
    handle: ("handleData" in rule ? rule.handleData : undefined) ?? null,
  };
}
