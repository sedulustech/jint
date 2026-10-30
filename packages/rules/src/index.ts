import { rules as comments } from "@jint/rules-comments";
import { rules as complexity } from "@jint/rules-complexity";
import { rules as errors } from "@jint/rules-errors";
import { rules as naming } from "@jint/rules-naming";
import type { RuleSchema } from "@jint/contract";

export type { RuleSchema };

/**
 * Every domain, by the path a config imports it from: `jint:rules/<key>`. The one place that names
 * the domains - a new domain package is added here and nowhere else.
 */
export const domains: Readonly<Record<string, readonly RuleSchema[]>> = Object.freeze({
  comments,
  complexity,
  errors,
  naming,
});

/** Every rule of every domain, in domain order. */
export const allRules: readonly RuleSchema[] = Object.freeze(Object.values(domains).flat());
