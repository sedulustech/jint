import { expect, test } from "bun:test";
import pkg from "../../package.json";
import { renderJson } from "./output/json.ts";
import { VERSION } from "./version.ts";

test("a source run names the package version, in the report as everywhere", () => {
  expect(VERSION).toBe(pkg.version);
  const report = { classifications: [], findings: [], errors: [], notes: [], rules: [] };
  expect(JSON.parse(renderJson(report as never)).version).toBe(VERSION);
});
