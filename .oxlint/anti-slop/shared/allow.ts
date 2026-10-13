import type { Context, ESTree } from "@oxlint/plugins";

/**
 * Anti-slop rules’ escape-hatch mark, mirroring the unused-exports-allow convention: a `//
 * anti-slop-allow: <reason>` comment exempts the declaration it documents, either on the
 * declaration’s last line or on a comment line directly above it (a mark above the declaration’s
 * JSDoc counts — the JSDoc belongs to the declaration). The above form must attach to the
 * declaration’s outermost wrapper (`export`, `const`, object property) with only whitespace and
 * comments in between — no blank line — so adjacent unrelated comments are not swallowed.
 */

const ALLOW_MARK = /anti-slop-allow:\s*\S/;

type SourceCode = Context["sourceCode"];
type Comment = Awaited<ReturnType<SourceCode["getCommentsBefore"]>>[number] & {
  range: [number, number];
};
type AnchoredNode = ESTree.Node & { parent?: ESTree.Node | undefined; range: [number, number] };

const ANCHOR_PARENTS = new Set([
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "VariableDeclaration",
  "VariableDeclarator",
  "Property",
  "PropertyDefinition",
  "MethodDefinition",
]);

/** Climb from the function node to the declaration wrapper the mark documents. */
function anchorOf(node: AnchoredNode): AnchoredNode {
  let anchor = node;
  while (anchor.parent !== undefined && ANCHOR_PARENTS.has(anchor.parent.type)) {
    anchor = anchor.parent as AnchoredNode;
  }
  return anchor;
}

/** True when the mark sits on the same line that ends `anchor` (the trailing-comment form). */
function hasTrailingMark(sourceCode: SourceCode, anchor: AnchoredNode): boolean {
  const tail = sourceCode.text.slice(
    anchor.range[1],
    sourceCode.text.indexOf("\n", anchor.range[1]),
  );
  return ALLOW_MARK.test(tail);
}

/**
 * True when a `// anti-slop-allow: <reason>` comment documents `node`’s declaration, on its last
 * line or in the comment block directly attached above it (no blank line and no code between the
 * block and the declaration).
 */
export function hasAntiSlopAllow(sourceCode: SourceCode, node: AnchoredNode): boolean {
  const anchor = anchorOf(node);
  if (hasTrailingMark(sourceCode, anchor)) return true;
  const before = sourceCode.getCommentsBefore(anchor);
  let end = anchor.range[0];
  for (let i = before.length - 1; i >= 0; i--) {
    const c = before[i] as Comment;
    if (!c.range) break;
    const gap = sourceCode.text.slice(c.range[1], end);
    if (/\S/.test(gap) || /\n\s*\n/.test(gap.replace(/\r\n/g, "\n"))) break;
    if (ALLOW_MARK.test(c.value)) return true;
    end = c.range[0];
  }
  return false;
}
