import { defineConfig } from "../../../src/config/define.ts";
export default defineConfig({
  input: "tests/fixtures/sample-file.ts",
  // @ts-expect-error intentionally invalid: sensors must be an array or record
  sensors: "invalid",
  exclude: [],
});
