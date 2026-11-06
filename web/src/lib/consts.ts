/** The branch the docs and binaries ship from (the decisions model, ahead of main). */
export const BRANCH = "feat/decisions-model";

const REPO = "https://github.com/sedulustech/jint";

/** The repository page on the shipping branch, for the header link. */
export const REPO_TREE = `${REPO}/tree/${BRANCH}`;

/** The prefix of a repo file's page on the shipping branch. */
export const REPO_BLOB = `${REPO}/blob/${BRANCH}/`;
