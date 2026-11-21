/** The branch the docs and binaries ship from (the decisions model, ahead of main). */
export const BRANCH = "feat/decisions-model";

/** The company that makes jint, for the footer link. */
export const COMPANY_URL = "https://sedulus.tech";

const REPO = "https://github.com/sedulustech/jint";

/** The repository page on the shipping branch, for the header link. */
export const REPO_TREE = `${REPO}/tree/${BRANCH}`;

/** The prefix of a repo file's page on the shipping branch. */
export const REPO_BLOB = `${REPO}/blob/${BRANCH}/`;

/**
 * Code highlighting, for markdown blocks and the <Code> component alike: both palettes ship as CSS
 * variables (--shiki-light / --shiki-dark), and the page's color scheme picks one.
 */
export const CODE_HIGHLIGHT = {
  themes: { light: "github-light", dark: "github-dark" },
  defaultColor: false,
} as const;
