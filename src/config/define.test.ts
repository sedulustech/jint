import { describe, test, expect } from "bun:test";
import { sensorDefaults } from "../core/sensors/defaults.ts";
import { defineConfig } from "./define.ts";
import type { Sensor } from "../core/types.ts";

describe("defineConfig", () => {
  test("defaults spread + disable removes sensors by name (set membership)", () => {
    const config = defineConfig({
      input: "src/",
      sensors: { ...sensorDefaults, disable: ["will_comment_drift"] },
      exclude: [],
    });
    const names = config.sensors.map((s) => s.name);
    expect(names).toHaveLength(8);
    expect(names).not.toContain("will_comment_drift");
  });

  test("re-declaring a sensor by name overrides the default (last wins)", () => {
    const overridden: Sensor = { ...sensorDefaults.is_name_purposeful!, handle: () => "error" };
    const config = defineConfig({
      input: "src/",
      sensors: { ...sensorDefaults, is_name_purposeful: overridden, disable: [] },
    });
    const sensor = config.sensors.find((s) => s.name === "is_name_purposeful");
    expect(sensor?.handle(0.9)).toBe("error");
  });

  test("plain array form is accepted", () => {
    const sensor: Sensor = {
      name: "custom",
      criteria: { true: "when the claim holds", false: "otherwise" },
      target: "files",
      handle: () => null,
    };
    const config = defineConfig({ input: "a.ts", sensors: [sensor] });
    expect(config.sensors).toEqual([sensor]);
  });

  test("resolved config is frozen data", () => {
    const config = defineConfig({ input: "src/", sensors: { ...sensorDefaults, disable: [] } });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.sensors)).toBe(true);
  });

  test("exclude and inputType round-trip", () => {
    const config = defineConfig({ input: "x.patch", inputType: "diff", exclude: ["*.lock"] });
    expect(config.inputType).toBe("diff");
    expect(config.exclude).toEqual(["*.lock"]);
  });

  test("default sensors all declare a valid target", () => {
    const targets = new Set(["files", "definitions", "comments", "imports", "diffs"]);
    for (const sensor of Object.values(sensorDefaults)) {
      expect(targets.has(sensor.target)).toBe(true);
    }
  });
});
