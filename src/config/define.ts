/**
 * DefineConfig — the config author's constructor. Takes the user-shaped config (see
 * tmp/jint.config.v2.example.ts), normalizes sensors into a flat list, and freezes the result:
 * definitions are data.
 */

import type { InputKind, Sensor } from "../core/types.ts";

/** The normalized shape a config file's default export must have. */
export interface ResolvedConfig {
  readonly input: string;
  readonly inputType?: InputKind;
  readonly sensors: readonly Sensor[];
  readonly exclude: readonly string[];
}

/** The author-facing shape: sensors as the defaults spread plus a disable list, or a plain list. */
export interface UserConfig {
  input: string;
  /** Optional override for ambiguous inputs only — the kind is otherwise inferred. */
  // record form: sensor names -> sensor, plus the special "disable" key
  inputType?: InputKind;
  sensors?: Sensor[] | Record<string, Sensor | string[]>;
  exclude?: readonly string[];
}

export function defineConfig(raw: UserConfig): ResolvedConfig {
  const resolved: ResolvedConfig = {
    input: raw.input,
    sensors: resolveSensors(raw.sensors),
    exclude: Object.freeze([...(raw.exclude ?? [])]),
  };
  if (raw.inputType !== undefined) {
    (resolved as { inputType?: InputKind }).inputType = raw.inputType;
  }
  return Object.freeze(resolved);
}

function resolveSensors(spec: UserConfig["sensors"]): readonly Sensor[] {
  const listed = spec === undefined ? [] : Array.isArray(spec) ? spec : namedToList(spec);
  // Re-declaring a sensor by name overrides the earlier entry (last wins).
  const byName = new Map<string, Sensor>();
  for (const sensor of listed) byName.set(sensor.name, sensor);
  return Object.freeze([...byName.values()].map(freezeSensor));
}

function namedToList(spec: Record<string, Sensor | string[]>): readonly Sensor[] {
  const disabled = new Set(Array.isArray(spec.disable) ? spec.disable : []);
  const listed: Sensor[] = [];
  for (const [name, value] of Object.entries(spec)) {
    if (name === "disable") continue;
    listed.push(value as Sensor);
  }
  return listed.filter((s) => !disabled.has(s.name));
}

function freezeSensor(sensor: Sensor): Sensor {
  return Object.freeze({ ...sensor });
}
