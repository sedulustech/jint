import { defineConfig, sensors } from "../../../src/index.ts";

export default defineConfig({
  input: "tests/fixtures/sample-dir",
  sensors: { ...sensors.defaults, disable: ["excessive_comments"] },
  exclude: ["**/more.ts"],
});
