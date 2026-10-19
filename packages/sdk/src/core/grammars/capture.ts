import { resolveInput } from "../input/infer.ts";
import { SetupError } from "../types.ts";
import {
  grammar,
  knownLanguages,
  languageOf,
  registerCustomGrammar,
  unclaimedExtension,
} from "./grammars.ts";
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
  /**
   * The element's own source (the span sliced from the file), TRUNCATED: first 200 chars then one
   * ellipsis when longer. The span stays the authority for the full content.
   */
  readonly text: string;
};

/**
 * Read the .scm override, loud on a blank path (quoted, never a double space) or an unreadable
 * file.
 */
async function loadQueryFile(queryPath: string): Promise<string> {
  if (queryPath.trim() === "") {
    throw new SetupError(
      "CONFIG_INVALID",
      `queryPath must be a path to an .scm file, got "${queryPath}"`,
    );
  }
  return Bun.file(queryPath)
    .text()
    .catch(() => {
      throw new SetupError(
        "CONFIG_INVALID",
        `query file "${queryPath}" is unreadable - capture() extracts with an .scm file or no override`,
      );
    });
}

/**
 * The colliding half of the cross-grammar guard: compileQuery's vocabulary check cannot catch an
 * .scm whose node types all exist in the routed grammar - css's comments-only mapping compiles
 * clean over typescript. Identity can: a query file byte-equal to a registered grammar's OWN
 * queries.scm IS that grammar's mapping, and handing it to another language is a setup error naming
 * both, before extraction. (A grammar whose own .scm is passed back - or a sibling with an
 * identical .scm, ts/tsx - extracts as itself and stays legal.)
 */
function assertQueriesAuthoredFor(queries: string, queryPath: string, language: string): void {
  const owners = knownLanguages().filter((id) => grammar(id).queries === queries);
  if (owners.length > 0 && !owners.includes(language)) {
    throw new SetupError(
      "CONFIG_INVALID",
      `query file "${queryPath}" is the queries.scm of ${owners.join(", ")} - it maps ${owners.join(", ")} nodes, not ${language}; pass an .scm authored for ${language}`,
    );
  }
}

/**
 * Capture (verb) - run extraction over an input under a chosen grammar and query set, yielding
 * elements; the classifier stays unplugged. It is lint's pipeline with the classifier unplugged:
 * input resolution, grammar registration, walk, inventory - no rules, no jev, no config, no
 * handles. The CLI verb `jint capture` is a thin print of this function (one word, two layers: the
 * SDK function and the CLI verb share the name by design).
 *
 * - TargetPath: a file or dir, through the SAME input resolution lint uses - no new input logic. An
 *   explicit FILE no grammar claims fails loud at resolution (fileUnit); a DIR's unclaimable files
 *   are skipped under lint's sweep-coverage policy, and each skip is ONE onSkip event carrying the
 *   file and its extension token - raw events, no aggregate (what parses is derivable from the
 *   returned elements; the caller folds the events into its own reporting).
 * - QueryPath: an .scm FILE that becomes the extraction source, ALWAYS through the full loud compile
 *   checks (vocabulary, #set! directives, pattern-order conflicts) plus the cross-grammar guard
 *   (unknown node types fail compileQuery; a byte-equal foreign queries.scm fails here). When both
 *   are given, the query file WINS; grammarPath's own queries.scm is ignored for extraction
 *   (grammarPath is still validated for routing and wasm).
 * - GrammarPath: a grammar DIRECTORY (wasm + extensions.json [+ queries.scm]) registered custom for
 *   this call - id from the dir name, wasm tree_sitter_<id> cross-check, extensions.json routing,
 *   every BYOG loud validation. Nothing is installed.
 *
 * Grammar resolution precedence: grammarPath (custom) > registered (embedded + JINT_GRAMMAR_DIR)
 *
 * No filters, no options bag: callers filter the returned array.
 */
export async function capture(
  targetPath: string,
  queryPath?: string,
  grammarPath?: string,
  onSkip?: (skip: { readonly file: string; readonly extension: string }) => void,
): Promise<CapturedElement[]> {
  if (grammarPath !== undefined) {
    // the query file, when present, replaces the dir's own .scm for extraction - registration
    // still requires routing + wasm, but may skip its queries.scm
    await registerCustomGrammar(grammarPath, { queriesOptional: queryPath !== undefined });
  }
  const queries = queryPath !== undefined ? await loadQueryFile(queryPath) : undefined;
  const captured: CapturedElement[] = [];
  for await (const unit of resolveInput({ input: targetPath })) {
    // file units only: capture() takes a file or a dir - str/diff forms are lint's callers
    if (unit.kind !== "file") continue;
    const language = languageOf(unit.state.path);
    if (language === null) {
      // a dir-walked file no grammar claims: lint's sweep-coverage policy (shared, not repeated) -
      // skip it and emit ONE event carrying the file and its extension token (".json", or
      // "(extensionless)"); an explicit file never reaches here (fileUnit already failed it loud)
      onSkip?.({ file: unit.state.path, extension: unclaimedExtension(unit.state.path) });
      continue;
    }
    if (queries !== undefined) assertQueriesAuthoredFor(queries, queryPath!, language);
    const inventory = await decompose(unit.state.content, language, { queries });
    for (const bucket of [inventory.definitions, inventory.comments, inventory.imports]) {
      for (const element of bucket) {
        const text =
          element.content.length > 200 ? element.content.slice(0, 200) + "…" : element.content;
        captured.push({
          ...projectElement(element),
          input: unit.state.path,
          grammar: language,
          text,
        });
      }
    }
  }
  return captured;
}
