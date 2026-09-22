import { readFileSync } from "node:fs";
import { isVocabularyConsistent } from "../../../src/core/sensors/defaults.ts";
import type { Sensor } from "../../../src/core/types.ts";

/** Doc for thing. */
export const thing: Sensor = isVocabularyConsistent;

export function load(p: string): string {
  return readFileSync(p, "utf8");
}
