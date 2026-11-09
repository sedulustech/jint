import { docLink } from "./doc-links";

/** A piece of a description: plain text, a code span or a link. */
export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

/**
 * A description's inline markdown as parts: the reference data holds the same text the markdown
 * view prints, so the component reads backtick spans and links from it instead of raw HTML.
 * `fromDir` is the directory of the page under docs/, for a link written as it is on GitHub.
 */
export function inline(text: string, fromDir = ""): Inline[] {
  const parts: Inline[] = [];
  for (const piece of text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/)) {
    if (piece === "") continue;
    const link = piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link !== null)
      parts.push({ kind: "link", text: link[1]!, href: docLink(link[2]!, fromDir) });
    else if (piece.startsWith("`")) parts.push({ kind: "code", text: piece.slice(1, -1) });
    else parts.push({ kind: "text", text: piece });
  }
  return parts;
}
