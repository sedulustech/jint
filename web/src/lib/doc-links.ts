import { posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineMdastPlugin } from "satteri";

// the branch the docs and binaries ship from (the decisions model, ahead of main)
const BRANCH = "feat/decisions-model";
const REPO_BLOB = `https://github.com/sedulustech/jint/blob/${BRANCH}/`;
const DOCS_DIR = "docs";
const DOCS_ROOT = fileURLToPath(new URL("../../../docs/", import.meta.url));
// the docs the site renders: the top-level ones and the use cases, nested by technology; docs/designs
// and the rest stay on GitHub
const PAGE = /^(?:[^/]+|use-cases\/.+)\.md$/;

/**
 * Where a link written in docs/*.md should point on the site. A link to another doc becomes its
 * page; any other relative link points at the file on GitHub (the repo is the source of those);
 * absolute links, anchors and mail links pass through. Docs stay plain markdown that works on
 * GitHub as written - the site adapts at build time. `fromDir` is the directory of the linking doc,
 * relative to docs/: a use case links to its siblings and to the docs above it as written.
 */
export function docLink(url: string, fromDir = ""): string {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return url;
  const hashAt = url.indexOf("#");
  const target = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? "" : url.slice(hashAt);
  const resolved = posix.normalize(posix.join(DOCS_DIR, fromDir, target));
  const page = posix.relative(DOCS_DIR, resolved);
  if (resolved.startsWith(`${DOCS_DIR}/`) && PAGE.test(page)) {
    return `/docs/${page.slice(0, -".md".length)}/${fragment}`;
  }
  return `${REPO_BLOB}${resolved}${fragment}`;
}

/** A Sätteri mdast plugin: every link in a doc goes through docLink. */
export const docLinksPlugin = defineMdastPlugin({
  name: "doc-links",
  link(node, context) {
    // the linking doc's directory under docs/; a doc with no known file is read as top-level
    const from =
      context.fileURL === undefined
        ? ""
        : posix.dirname(relative(DOCS_ROOT, fileURLToPath(context.fileURL)).split("\\").join("/"));
    context.setProperty(node, "url", docLink(node.url, from === "." ? "" : from));
  },
});
