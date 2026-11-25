import { assertCaptureAddress } from "../../grammars/query.ts";
import { nameOrKey } from "../../grammars/walk.ts";
import { matchesTarget } from "../classify.ts";
import type { GrammarRegistry } from "../../grammars/grammars.ts";
import type { CustomElement, ElementSelection } from "./schema.ts";

/** Selects among `within` by what a rule's target takes: a kind of element, or a capture's address. */
export function selectionOf(
  within: readonly CustomElement[],
  place: string,
  registry: GrammarRegistry | undefined,
): ElementSelection {
  const getElements = (target?: string): readonly CustomElement[] => {
    if (target === undefined) return within;
    if (target === "files")
      throw new Error(`${place} holds elements, and a file is not one of them`);
    if (registry !== undefined) assertCaptureAddress(target, registry);
    // a target judges a comment through the definition it belongs to; here it is an element like any other
    if (target === "comments") return within.filter(({ capture }) => capture === "comment");
    return within.filter((element) => matchesTarget(target, element));
  };
  const getElement = (target: string, name?: string): CustomElement => {
    const found = getElements(target).filter((e) => name === undefined || nameOrKey(e) === name);
    if (found.length === 1) return found[0]!;
    const wanted = name === undefined ? target : `${target} named "${name}"`;
    throw new Error(`${place} has ${found.length === 0 ? "no" : found.length} ${wanted}`);
  };
  return { getElement, getElements };
}
