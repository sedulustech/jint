import { resolveInput } from "../input/infer.ts";
import { SetupError } from "../types.ts";
import { languageOf, registerAdhocGrammar } from "./grammars.ts";
import { decompose, projectElement } from "./walk.ts";
import type { Element } from "@jint/contract";

/**
 * One extracted element: the contract Element EXTENDED with its provenance - which input file it
 * came from and which grammar extracted it. Nothing redeclared: span/label/parent/kind/name ride on
 * Element untouched.
 */
export type CapturedElement = Element & {
  readonly input: string;
  readonly grammar: string;
};

/**
 * Capture (verb) - run extraction over an input under a chosen grammar and query set, yielding
 * elements; the classifier stays unplugged. It is lint's pipeline with the classifier unplugged:
 * input resolution, grammar registration, walk, inventory - no rules, no jev, no config, no
 * handles. The CLI verb `jint capture` is a thin print of this function (one word, two layers: the
 * SDK function and the CLI verb share the name by design).
 *
 * - TargetPath: a file or dir, through the SAME input resolution lint uses - no new input logic.
 * - QueryPath: an .scm FILE that becomes the extraction source, ALWAYS through the full loud compile
 *   checks (vocabulary, #set! directives, pattern-order conflicts). When both are given, the query
 *   file WINS; grammarPath's own queries.scm is ignored for extraction (grammarPath is still
 *   validated for routing and wasm).
 * - GrammarPath: a grammar DIRECTORY (wasm + extensions.json [+ queries.scm]) registered ad hoc for
 *   this call - id from the dir name, wasm tree_sitter_<id> cross-check, extensions.json routing,
 *   every BYOG loud validation. Nothing is installed.
 *
 * Grammar resolution precedence: grammarPath (ad hoc) > registered (embedded + JINT_GRAMMAR_DIR)
 *
 * > The extension of each resolved file (loud routing error when nothing claims it).
 *
 * No filters, no options bag, no signal: callers filter the returned array.
 */
export async function capture(
  targetPath: string,
  queryPath?: string,
  grammarPath?: string,
): Promise<CapturedElement[]> {
  if (grammarPath !== undefined) {
    // the query file, when present, replaces the dir's own .scm for extraction - registration
    // still requires routing + wasm, but may skip its queries.scm
    await registerAdhocGrammar(grammarPath, { queriesOptional: queryPath !== undefined });
  }
  const queries =
    queryPath !== undefined
      ? await Bun.file(queryPath)
          .text()
          .catch(() => {
            throw new SetupError(
              "CONFIG_INVALID",
              `query file ${queryPath} is unreadable - capture() extracts with an .scm file or no override`,
            );
          })
      : undefined;
  const captured: CapturedElement[] = [];
  for await (const unit of resolveInput({ input: targetPath })) {
    // file units only: capture() takes a file or a dir - str/diff forms are lint's callers
    if (unit.kind !== "file") continue;
    const language = languageOf(unit.state.path);
    if (language === null) {
      throw new SetupError(
        "MISSING_GRAMMAR",
        `unknown extension, missing grammar - no registered grammar claims ${unit.state.path}` +
          (grammarPath === undefined
            ? " (pass a grammar dir to extract with your own grammar)"
            : ""),
      );
    }
    const inventory = await decompose(unit.state.content, language, { queries });
    for (const bucket of [inventory.definitions, inventory.comments, inventory.imports]) {
      for (const element of bucket) {
        captured.push({
          ...projectElement(element),
          input: unit.state.path,
          grammar: language,
        });
      }
    }
  }
  return captured;
}
