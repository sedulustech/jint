import { stat } from "node:fs/promises";
import { AppError, type Unit } from "../types.ts";

export async function fileUnit(path: string): Promise<Unit> {
  const info = await stat(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") {
      throw new AppError("ENTRYPOINT_NOT_FOUND", `file not found: ${path}`);
    }
    throw new AppError("ENTRYPOINT_UNREADABLE", `cannot read file: ${path}: ${e.message}`, { cause: e });
  });
  if (info.isDirectory()) {
    throw new AppError("ENTRYPOINT_NOT_FOUND", `not a file: ${path} is a directory (use --dir)`);
  }
  let content: string;
  try {
    content = await Bun.file(path).text();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new AppError("ENTRYPOINT_UNREADABLE", `cannot read file: ${path}: ${detail}`, { cause: e });
  }
  return { kind: "file", state: { path, content } };
}
