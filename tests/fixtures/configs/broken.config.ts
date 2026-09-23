import { defineConfig } from "../../../src/config/define.ts";
export default defineConfig({
  input: "tests/fixtures/sample-file.ts",
  // @ts-expect-error intentionally invalid: rules must be an array or record
  rules: "invalid",
  exclude: [],
});
