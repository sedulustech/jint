import { createCn } from "cn/config";

// The type scale in index.css's @theme (--text-caption, --text-body, --text-emphasis) is font
// sizes. Unregistered, the merge reads text-body as a text color and drops it beside any color
// class, so a component's size silently falls back to whatever its container inherits.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["caption", "body", "emphasis"] }] } },
});
