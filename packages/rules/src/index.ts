import { rules as comments } from "@jint/rules-comments";
import { rules as complexity } from "@jint/rules-complexity";
import { rules as errors } from "@jint/rules-errors";
import { rules as naming } from "@jint/rules-naming";
import { rules as reactHooks } from "@jint/rules-react/hooks";
import { rules as security } from "@jint/rules-security";
import { rules as seo } from "@jint/rules-seo";
import type { RuleSchema } from "@jint/contract";

export type { RuleSchema };

/**
 * Every domain, by the path a config imports it from: `jint:rules/<key>`. The one place that names
 * the domains - a new domain package is added here and nowhere else.
 */
export const domains: Readonly<Record<string, readonly RuleSchema[]>> = {
  comments,
  complexity,
  errors,
  naming,
  security,
  seo,
  // a subdomain is a subpath of its parent's package; the key is the import path under jint:rules/
  "react/hooks": reactHooks,
};

/** Every rule of every domain, in domain order. */
export const allRules: readonly RuleSchema[] = Object.values(domains).flat();
