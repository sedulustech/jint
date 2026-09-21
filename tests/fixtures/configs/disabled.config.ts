import { defineConfig } from "../../../src/config/define.ts";
export default defineConfig({
  input: "tests/fixtures/sample-file.ts",
  sensors: { disable: ["is_vocabulary_consistent"] },
  exclude: [],
});
