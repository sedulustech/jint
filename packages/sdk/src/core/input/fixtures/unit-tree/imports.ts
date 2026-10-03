import { readFileSync } from "node:fs";
import { isVocabularyConsistent } from "../../../rules/defaults.ts";
import type { Rule } from "../../../types.ts";

/** Doc for thing. */
export const thing: Rule = isVocabularyConsistent;

export function load(p: string): string {
  return readFileSync(p, "utf8");
}
