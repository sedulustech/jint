import { defaultRules } from "@jint/defaults";
import { defineConfig } from "jint:sdk";

// the default package's rules, imported directly - the workspace-consumer path (design
// config-composition/03): the version is the workspace dependency, not the CLI baseline. The
// jint:defaults virtual module exists for external users and compiled binaries; this repo is
// neither. Test files are excluded: the rules calibrate on production code; structural test
// selectors are not their domain.
//
// Composition surface: defaultRules is the whole set; individual rules export under their own
// names for pick-and-override ({ ...is_greppable, include: ["src/**"] }).
export default defineConfig({
  rules: defaultRules,
  exclude: ["**/*.test.ts", "**/*.test-browser.tsx", "tests/**"],
});
