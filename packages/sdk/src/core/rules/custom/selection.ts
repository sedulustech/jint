import { assertCaptureAddress } from "../../grammars/query.ts";
import { matchesTarget } from "../classify.ts";
import type { GrammarRegistry } from "../../grammars/grammars.ts";
import type { CustomElement, ElementSelection } from "./schema.ts";

/** Selects among `within` by what a rule's target takes: a kind of element, or a capture's address. */
export function selectionOf(
  within: readonly CustomElement[],
  place: string,
  registry: GrammarRegistry | undefined,
): ElementSelection {
  const elements = (target?: string): readonly CustomElement[] => {
    if (target === undefined) return within;
    if (registry !== undefined) assertCaptureAddress(target, registry);
    return within.filter((element) => matchesTarget(target, element));
  };
  const element = (target: string, name?: string): CustomElement => {
    const found = elements(target).filter((e) => name === undefined || e.name === name);
    if (found.length === 1) return found[0]!;
    const wanted = name === undefined ? target : `${target} named "${name}"`;
    throw new Error(`${place} has ${found.length === 0 ? "no" : found.length} ${wanted}`);
  };
  return { element, elements };
}
