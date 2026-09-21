import { defineConfig } from "../../../src/config/define.ts";
export default defineConfig({
  input: "tests/fixtures/sample-file.ts",
  sensors: { disable: ["naming_consistency"] },
  exclude: [],
});
