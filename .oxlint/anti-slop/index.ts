import { definePlugin } from "@oxlint/plugins";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";

/** Copied from sedulus/mobius (uncommitted extension incl. logical-form check). */
export const antiSlopPlugin = definePlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
  },
});

export default antiSlopPlugin;
