import { posix } from "node:path";
import { defineMdastPlugin } from "satteri";

// the branch the docs and binaries ship from (the decisions model, ahead of main)
const BRANCH = "feat/decisions-model";
const REPO_BLOB = `https://github.com/sedulustech/jint/blob/${BRANCH}/`;
const DOCS_DIR = "docs";

/**
 * Where a link written in docs/*.md should point on the site. A link to another doc becomes its
 * page; any other relative link points at the file on GitHub (the repo is the source of those);
 * absolute links, anchors and mail links pass through. Docs stay plain markdown that works on
 * GitHub as written - the site adapts at build time.
 */
export function docLink(url: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return url;
  const hashAt = url.indexOf("#");
  const target = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? "" : url.slice(hashAt);
  const resolved = posix.normalize(posix.join(DOCS_DIR, target));
  const sibling = posix.relative(DOCS_DIR, resolved);
  if (resolved.startsWith(`${DOCS_DIR}/`) && sibling.endsWith(".md") && !sibling.includes("/")) {
    return `/docs/${sibling.slice(0, -".md".length)}/${fragment}`;
  }
  return `${REPO_BLOB}${resolved}${fragment}`;
}

/** A Sätteri mdast plugin: every link in a doc goes through docLink. */
export const docLinksPlugin = defineMdastPlugin({
  name: "doc-links",
  link(node, context) {
    context.setProperty(node, "url", docLink(node.url));
  },
});
