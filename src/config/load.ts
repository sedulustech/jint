/**
 * Config loading. jint.config.ts is the default; --config names any other (multiple configurations
 * = multiple files, one per purpose).
 *
 * TypeBox validates the config file boundary; validation failure maps to CONFIG_INVALID with joined
 * error messages (design §3.5).
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { sensorDefaults } from "../core/sensors/defaults.ts";
import { SetupError } from "../core/types.ts";
import { defineConfig, type ResolvedConfig } from "./define.ts";

export const DEFAULT_CONFIG_PATH = "jint.config.ts";

const KIND_SCHEMA = Type.Union([Type.Literal("file"), Type.Literal("dir"), Type.Literal("diff")]);

const SENSOR_SCHEMA = Type.Object({
  name: Type.String(),
  criteria: Type.Object({ true: Type.String(), false: Type.String() }),
  target: Type.Union([
    Type.Literal("files"),
    Type.Literal("functions"),
    Type.Literal("definitions"),
    Type.Literal("comments"),
    Type.Literal("imports"),
    Type.Literal("diffs"),
  ]),
  handle: Type.Unknown(),
});

/** Schema of a config file's default export — the normalized defineConfig() shape. */
const CONFIG_SCHEMA = Type.Object({
  input: Type.String(),
  inputType: Type.Optional(KIND_SCHEMA),
  sensors: Type.Array(SENSOR_SCHEMA),
  exclude: Type.Array(Type.String()),
});

/** The built-in config used when no config file exists: no input, all default sensors. */
export function defaultConfig(): ResolvedConfig {
  return defineConfig({
    input: "",
    sensors: Object.values(sensorDefaults),
    exclude: ["**/fixtures/**"],
  });
}

export async function loadConfig(path = DEFAULT_CONFIG_PATH): Promise<ResolvedConfig> {
  const abs = resolve(path);
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (e) {
    if (isModuleNotFound(e)) {
      throw new SetupError("CONFIG_INVALID", `config file not found: ${path}`, { cause: e });
    }
    const detail = e instanceof Error ? e.message : String(e);
    throw new SetupError("CONFIG_INVALID", `config file failed to load: ${path}: ${detail}`, {
      cause: e,
    });
  }
  const raw = (mod as { default?: unknown } | null)?.default;
  if (raw === undefined) {
    throw new SetupError(
      "CONFIG_INVALID",
      `config file has no default export: ${path} (export default defineConfig({...}))`,
    );
  }
  return validateConfig(raw, path);
}

/** Validates the boundary shape; static types derive from the same schema. */
export function validateConfig(raw: unknown, source: string): ResolvedConfig {
  if (!Value.Check(CONFIG_SCHEMA, raw)) {
    const messages = [...Value.Errors(CONFIG_SCHEMA, raw)]
      .map((err) => `${err.path === "" ? "/" : err.path} ${err.message}`)
      .join("; ");
    throw new SetupError("CONFIG_INVALID", `invalid config ${source}: ${messages}`);
  }
  const parsed = raw as Static<typeof CONFIG_SCHEMA>;
  for (const sensor of parsed.sensors) {
    if (typeof sensor.handle !== "function") {
      throw new SetupError(
        "CONFIG_INVALID",
        `invalid config ${source}: sensor '${sensor.name}' handle must be a function`,
      );
    }
  }
  return parsed as ResolvedConfig;
}

function isModuleNotFound(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "ENOENT" || code === "MODULE_NOT_FOUND";
}
