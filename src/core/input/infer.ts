/**
 * Input inference and resolution (design §3, §4): the kind is inferred by path shape, never by
 * content —
 *
 * On-disk directory -> dir (walked into file units); on-disk file -> file (even a patch file: a
 * file is just a file — jint never parses a VCS; a non-source extension fails NOT_SOURCE in the
 * file unit); missing path -> ENTRYPOINT_NOT_FOUND
 *
 * The only input whose kind cannot be inferred is piped stdin; the CLI declares it with the str
 * noun (jint str -) or as the changed-file list (jint -). Both the CLI and the SDK go through
 * resolveInput — no drift. Jint never shells out and never parses a VCS: the caller owns the VCS
 * (their pipeline pipes the changed list: git diff --name-only HEAD~1 | jint -).
 */

import { stat } from "node:fs/promises";
import { SetupError, type InputKind, type Unit } from "../types.ts";
import { walkDir } from "./dir.ts";
import { fileUnit } from "./file.ts";

export interface ResolveOptions {
  input: string | string[];
  inputType?: InputKind;
  /** Extra input exclusions (config exclude + CLI --exclude union). */
  exclude?: readonly string[];
}

/** Path-shape inference only: directory -> dir, file -> file, anything else is not found. */
export async function inferKind(input: string): Promise<InputKind> {
  const info = await stat(input).catch(() => null);
  if (info?.isDirectory()) return "dir";
  if (info?.isFile()) return "file";
  throw new SetupError("ENTRYPOINT_NOT_FOUND", `input not found: ${input}`);
}

export function resolveInput(options: ResolveOptions): AsyncIterable<Unit> {
  const { input, inputType, exclude } = options;
  return (async function* () {
    // explicit file paths bypass exclude
    if (Array.isArray(input)) {
      for (const path of input) yield await fileUnit(path);
      return;
    }
    const kind = inputType ?? (await inferKind(input));
    if (kind === "file") {
      yield await fileUnit(input);
      return;
    }
    if (kind === "dir") {
      yield* walkDir(input, exclude);
      return;
    }
    // Unreachable by the type; a guard against a future kind, not a branch.
    throw new SetupError("NOT_SOURCE", `not a source-language file: ${input}`);
  })();
}
