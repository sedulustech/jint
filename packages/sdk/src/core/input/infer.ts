/**
 * Input inference and resolution (design §3, §4): the kind is inferred by path shape, never by
 * content —
 *
 * On-disk directory -> dir (walked into file units); on-disk file -> file (even a patch file: a
 * file is just a file — jint never parses a VCS; a non-source extension fails MISSING_GRAMMAR in
 * the file unit); missing path -> ENTRYPOINT_NOT_FOUND
 *
 * The only input whose kind cannot be inferred is piped stdin; the CLI declares it with a noun
 * (jint str - for source, jint paths - for a path list). Both the CLI and the SDK go through
 * resolveInput — no drift. Jint never shells out and never parses a VCS: the caller owns the VCS
 * (their pipeline pipes the path list: git diff --name-only HEAD~1 | jint paths -).
 */

import { stat } from "node:fs/promises";
import { knownLanguages } from "../grammars/walk.ts";
import { SetupError, type InputKind, type Unit } from "../types.ts";
import { walkDir } from "./dir.ts";
import { fileUnit } from "./file.ts";

export interface InputOptions {
  input: string | string[];
  inputType?: InputKind;
  /** Extra input exclusions (config exclude + CLI --exclude union). */
  exclude?: readonly string[];
  /** Config-level include: only matching paths yield (empty = everything not excluded). */
  include?: readonly string[];
  /** Config-scope basis: the input's path relative to the config dir (walkDir pathPrefix). */
  scopeBase?: string;
  /** The walk's secret-shaped denylist (config secretDenylist; default = SECRET_DENYLIST). */
  secretDenylist?: readonly string[];
  /** Walk coverage notes (the denylist's one-note-per-class skips); absent = silent. */
  onNote?: (note: string) => void;
  /**
   * Whether a file needs a grammar to be measured (an element-target rule is in scope for it).
   * Absent = every file requires a grammar. A grammar-less file with requireGrammar false measures
   * as raw source; with requireGrammar true it fails MISSING_GRAMMAR, naming the grammars.
   */
  requireGrammarFor?: (path: string) => boolean;
}

/** Path-shape inference only: directory -> dir, file -> file, anything else is not found. */
export async function inferKind(input: string): Promise<InputKind> {
  const info = await stat(input).catch(() => null);
  if (info?.isDirectory()) return "dir";
  if (info?.isFile()) return "file";
  throw new SetupError("ENTRYPOINT_NOT_FOUND", `input not found: ${input}`);
}

export function resolveInput(options: InputOptions): AsyncIterable<Unit> {
  const { input, inputType, exclude, include } = options;
  return (async function* () {
    // explicit file paths bypass exclude
    if (Array.isArray(input)) {
      for (const path of input) {
        yield await fileUnit(path, { requireGrammar: options.requireGrammarFor?.(path) ?? true });
      }
      return;
    }
    const kind = inputType ?? (await inferKind(input));
    if (kind === "file") {
      yield await fileUnit(input, {
        requireGrammar: options.requireGrammarFor?.(input) ?? true,
      });
      return;
    }
    if (kind === "dir") {
      yield* walkDir(
        input,
        exclude,
        options.scopeBase,
        include,
        options.secretDenylist,
        options.onNote,
      );
      return;
    }
    // Unreachable by the type; a guard against a future kind, not a branch.
    throw new SetupError("MISSING_GRAMMAR", `not a source-language file: ${input}`, {
      detail: { kind: "unknown-language", valid: knownLanguages() },
    });
  })();
}
