import { BRANCH } from "./consts.ts";

export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/sedulustech/jint/${BRANCH}/install.sh | bash`;

export const INSTALL_PROMPT = `Install jint, a semantic linter, and set it up in this repository.

1. Install it: ${INSTALL_COMMAND}
2. Read its docs before you configure anything: run \`jint docs what-is-jint\`, \`jint docs install\` and \`jint docs how-to-use\`. \`jint docs\` lists the rest.
3. jint needs JINT_API_KEY or OPENAI_API_KEY in the environment. If neither is set, ask me for one.`;
