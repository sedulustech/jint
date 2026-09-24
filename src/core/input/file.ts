import { stat } from "node:fs/promises";
import { elementWireId } from "../sensors/classify.ts";
import { SetupError, type Unit } from "../types.ts";
import { languageOf } from "./decompose.ts";

export async function fileUnit(path: string): Promise<Unit> {
  const info = await stat(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") {
      throw new SetupError("ENTRYPOINT_NOT_FOUND", `file not found: ${path}`);
    }
    throw new SetupError("ENTRYPOINT_UNREADABLE", `cannot read file: ${path}: ${e.message}`, {
      cause: e,
    });
  });
  if (info.isDirectory()) {
    throw new SetupError("ENTRYPOINT_NOT_FOUND", `not a file: ${path} is a directory (use --dir)`);
  }
  // explicit path: the user asked for THIS file, so silence would read as "nothing wrong" —
  // say plainly that it is not measurable (walker skips non-source silently; explicit does not)
  if (languageOf(path) === null) {
    throw new SetupError(
      "NOT_SOURCE",
      `not measurable: ${path} has no source-language grammar (use --dir to walk sources, or pipe content with --language)`,
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
