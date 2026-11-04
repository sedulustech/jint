import { rules as docs } from "./rules/docs.ts";
import { rules as opengraph } from "./rules/opengraph.ts";

// The site's own rules: the Open Graph domain over the pages' source (run web/src), and the docs
// rules over the docs themselves (run docs).
export default {
  rules: {
    use: [...opengraph, ...docs],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
};
