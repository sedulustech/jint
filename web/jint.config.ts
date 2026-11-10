import { rules as docs } from "./rules/docs.ts";
import { rules as opengraph } from "./rules/opengraph.ts";
import { rules as style } from "./rules/style.ts";

// The site's own rules: the Open Graph and style rules over the site's source (run web/src), and
// the docs rules over the docs themselves (run ./docs).
export default {
  rules: {
    use: [...opengraph, ...style, ...docs],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
};
