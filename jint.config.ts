import { defaultRuleSpecs } from "@jint/defaults";
import { defineConfig } from "jint:sdk";

// the default package's rules, imported directly - the workspace-consumer path (design
// config-composition/03): the version is the workspace dependency, not the CLI baseline. The
// jint:defaults virtual module exists for external users and compiled binaries; this repo is
// neither. Test files are excluded: the rules calibrate on production code; structural test
// selectors are not their domain.
export default defineConfig({
  rules: Object.values(defaultRuleSpecs),
  exclude: ["**/*.test.ts", "**/*.test-browser.tsx", "tests/**"],
});
