/**
 * Extending a grammar's own queries.scm. A user queries.scm whose first line is the comment `;
 * extends` (the convention neovim's tree-sitter queries use) adds to the grammar's own patterns
 * instead of replacing them. The extension goes FIRST: tree-sitter lets the earlier pattern win
 * when two match one node, so an extension may add a capture and may override one. A directive the
 * extension sets replaces the same directive in the base, because a directive is one name, one
 * value per file.
 */

import { SetupError } from "../types.ts";
import { BASE_MARKER, scmDirectives } from "./query.ts";

/** The first non-blank line of an extension: `; extends`, any number of semicolons and spaces. */
const HEADER = /^(?:[ \t]*\r?\n)*[ \t]*;+[ \t]*extends[ \t]*(?:\r?\n|$)/;

/** Whether this queries.scm extends the grammar's own instead of replacing it. */
export function isExtension(scm: string): boolean {
  return HEADER.test(scm);
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `base` without any `(#set! "<name>" ...)` form for a name the extension sets itself. */
function withoutOverriddenDirectives(base: string, extension: string): string {
  let result = base;
  for (const name of new Set(scmDirectives(extension).map((d) => d.name))) {
    result = result.replace(
      new RegExp(`\\(#set!\\s+"${escape(name)}"(?:\\s+"(?:[^"\\\\]|\\\\.)*")?\\s*\\)`, "g"),
      "",
    );
  }
  return result;
}

/** The extension's patterns, then the grammar's own, as one queries.scm. */
export function extendQueries(language: string, extension: string, base: string): string {
  if (base.trim() === "") {
    throw new SetupError(
      "CONFIG_INVALID",
      `grammar ${language}: queries.scm starts with "; extends", but there is no embedded queries.scm of that id to extend - drop the line, or write the whole file`,
    );
  }
  return `${extension.trimEnd()}\n\n${BASE_MARKER}\n${withoutOverriddenDirectives(base, extension)}`;
}
