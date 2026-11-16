import { readFileSync } from "node:fs";
import { posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineMdastPlugin } from "satteri";

const DOCS_ROOT = fileURLToPath(new URL("../../../docs/", import.meta.url));
const FIGURE = /^figures\/[a-z0-9-]+\.svg$/;

/**
 * The docs/figures/ path an image written in docs/*.md points at, or null for any other image.
 * `fromDir` is the directory of the doc, relative to docs/.
 */
export function figurePath(url: string, fromDir = ""): string | null {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return null;
  const path = posix.normalize(posix.join(fromDir, url));
  return FIGURE.test(path) ? path : null;
}

/**
 * A Sätteri mdast plugin: a paragraph that holds only an image of a docs/figures/ SVG renders as a
 * <figure> holding the SVG itself, so the figure's var(--token) styles follow the page's palette
 * and theme (an <img> cannot see them) and the layout sets its spacing. The markdown keeps a plain
 * image reference, which GitHub and `jint docs` show as written.
 */
export const figuresPlugin = defineMdastPlugin({
  name: "figures",
  paragraph(node, context) {
    const [image] = node.children;
    if (node.children.length !== 1 || image?.type !== "image") return;
    const from =
      context.fileURL === undefined
        ? ""
        : posix.dirname(relative(DOCS_ROOT, fileURLToPath(context.fileURL)).split("\\").join("/"));
    const path = figurePath(image.url, from === "." ? "" : from);
    if (path === null) return;
    const svg = readFileSync(DOCS_ROOT + path, "utf8").trim();
    context.replaceNode(node, { rawHtml: `<figure>${svg}</figure>` });
  },
});
