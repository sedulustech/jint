import { stat } from "node:fs/promises";
import { knownLanguages, languageOf, EMBEDDED, type GrammarRegistry } from "../grammars/walk.ts";
import { elementWireId } from "../rules/classify.ts";
import { SetupError, type Unit } from "../types.ts";

export async function fileUnit(
  path: string,
  options: { requireGrammar?: boolean; registry?: GrammarRegistry } = {},
): Promise<Unit> {
  const info = await stat(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") {
      throw new SetupError("ENTRYPOINT_NOT_FOUND", `file not found: ${path}`);
    }
    throw new SetupError("ENTRYPOINT_UNREADABLE", `cannot read file: ${path}: ${e.message}`, {
      cause: e,
    });
  });
  if (info.isDirectory()) {
    throw new SetupError(
      "ENTRYPOINT_NOT_FOUND",
      `not a file: ${path} is a directory - pass the directory itself; its files are walked`,
    );
  }
  // explicit path: the user asked for THIS file, so silence would read as "nothing wrong" —
  // say plainly that it is not classifiable (a dir walk skips unclaimable files with a coverage
  // note; an explicit file fails loud)
  if (languageOf(options.registry ?? EMBEDDED, path) === null && options.requireGrammar !== false) {
    throw new SetupError(
      "MISSING_GRAMMAR",
      `no loaded grammar claims the extension of ${path} - routing comes from each grammar's extensions.json`,
      { detail: { kind: "unknown-language", valid: knownLanguages(options.registry ?? EMBEDDED) } },
    );
  }
  let content: string;
  try {
    content = await Bun.file(path).text();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new SetupError("ENTRYPOINT_UNREADABLE", `cannot read file: ${path}: ${detail}`, {
      cause: e,
    });
  }
  return {
    kind: "file",
    state: {
      path,
      content,
      id: elementWireId({ start: { line: 1 }, end: { line: content.split("\n").length } }),
    },
  };
}
