/**
 * Input inference and resolution (design §3, §4): the kind is inferred by path shape, never by
 * content —
 *
 * On-disk directory -> dir (walked into file units) On-disk file -> file (even a patch file:
 * declare it with the diff noun to judge it as a diff) missing path -> ENTRYPOINT_NOT_FOUND
 *
 * The only input whose kind cannot be inferred is piped stdin; the CLI declares it with the noun
 * commands (jint str - / jint diff -). Both the CLI and the SDK go through resolveInput — no drift.
 * Jint never shells to git: the caller owns the VCS (pipe `git diff | jint diff -`).
 */

import { stat } from "node:fs/promises";
import { SetupError, type InputKind, type Unit } from "../types.ts";
import { readDiffSource, decomposeDiff } from "./diff.ts";
import { walkDir } from "./dir.ts";
import { fileUnit } from "./file.ts";

export interface ResolveOptions {
  input: string | string[];
  inputType?: InputKind;
  /** Extra input exclusions (config exclude + CLI --exclude union). */
  exclude?: readonly string[];
  /**
   * The input is in-memory text (piped stdin), not a path or spec: with inputType "diff" it is
   * decomposed as a diff directly, never path-resolved.
   */
  inputText?: boolean;
}

/** Path-shape inference only: directory -> dir, file -> file, anything else is not found. */
export async function inferKind(input: string): Promise<InputKind> {
  const info = await stat(input).catch(() => null);
  if (info?.isDirectory()) return "dir";
  if (info?.isFile()) return "file";
  throw new SetupError("ENTRYPOINT_NOT_FOUND", `input not found: ${input}`);
}

export function resolveInput(options: ResolveOptions): AsyncIterable<Unit> {
  const { input, inputType, exclude, inputText } = options;
  return (async function* () {
    if (inputText === true) {
      // in-memory text (piped stdin); only diff is meaningful here — the CLI carries str text
      // separately (lint's str option)
      const text = Array.isArray(input) ? input.join("") : input;
      yield* decomposeDiff(text, null, exclude);
      return;
    }
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
    const source = await readDiffSource(input);
    yield* decomposeDiff(source.text, source.commitMessage, exclude);
  })();
}
