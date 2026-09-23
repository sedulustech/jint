import { defineConfig } from "../../../src/config/define.ts";
export default defineConfig({
  input: "tests/fixtures/sample-file.ts",
  rules: { disable: ["is_vocabulary_consistent"] },
  exclude: [],
});
