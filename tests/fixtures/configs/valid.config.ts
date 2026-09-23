import { defineConfig, defaultRules } from "../../../src/index.ts";

export default defineConfig({
  input: "tests/fixtures/sample-dir",
  rules: { ...defaultRules, disable: ["will_comment_drift"] },
  exclude: ["**/more.ts"],
});
