/**
 * Jint's public barrel — the SDK surface (design §2):
 *
 * Import { defineConfig, sensors, lint } from "jint";
 *
 * The CLI resolves input through the same code path lint() uses — no drift between `jint --dir x`
 * and `lint({ input: "x" })`.
 */

import { sensorDefaults } from "./core/sensors/defaults.ts";

export { defineConfig, type ResolvedConfig, type UserConfig } from "./config/define.ts";
export { loadConfig, defaultConfig, validateConfig, DEFAULT_CONFIG_PATH } from "./config/load.ts";
export { lint, collectReport, type LintOptions, type LintReport } from "./core/lint.ts";
export { sensorDefaults } from "./core/sensors/defaults.ts";
export {
  AppError,
  type ErrorCode,
  type Sensor,
  type Measurement,
  type Signal,
  type Severity,
  type Diagnostic,
  type InputKind,
  type Unit,
  type UnitState,
  type Judge,
  type LintEvent,
} from "./core/types.ts";

/** The config surface: sensors.defaults spread + disable list. */
export const sensors = { defaults: sensorDefaults };
