import { defaultRuleSpecs } from "jint:defaults";
import { defineConfig } from "jint:sdk";

// the default package's rules, imported through the jint:defaults virtual module - the config
// names what it measures, it never silently inherits a rule set. Test files are excluded: the
// rules calibrate on production code; structural test selectors are not their domain.
export default defineConfig({
  rules: Object.values(defaultRuleSpecs),
  exclude: ["**/*.test.ts", "**/*.test-browser.tsx", "tests/**"],
});
