import { describe, expect, test } from "bun:test";
import { extendQueries, isExtension } from "./extends.ts";
import { BASE_MARKER, validatePatternOrder } from "./query.ts";

describe("isExtension", () => {
  test("the first non-blank line is the comment `; extends`", () => {
    expect(isExtension("; extends\n(a) @function")).toBe(true);
    expect(isExtension("\n\n;; extends  \n(a) @function")).toBe(true);
    expect(isExtension("; extends")).toBe(true);
  });

  test("anything else replaces: a later mention, another comment, a pattern first", () => {
    expect(isExtension("; python\n; extends\n(a) @function")).toBe(false);
    expect(isExtension("(a) @function\n; extends")).toBe(false);
    expect(isExtension("; extends the grammar\n(a) @function")).toBe(false);
  });
});

describe("extendQueries", () => {
  const base =
    '(function_definition) @function\n((import_statement) @import (#set! "capture.import.merge" "contiguous"))\n';

  test("the extension comes first, so its patterns win, then the grammar's own", () => {
    const merged = extendQueries("python", "; extends\n(x) @binding\n", base);
    expect(merged.indexOf("(x) @binding")).toBeLessThan(merged.indexOf(BASE_MARKER));
    expect(merged.indexOf(BASE_MARKER)).toBeLessThan(merged.indexOf("(function_definition)"));
  });

  test("a directive the extension sets replaces the same directive in the base", () => {
    const merged = extendQueries(
      "python",
      '; extends\n((import_statement) @import (#set! "capture.import.merge" "adjacent"))\n',
      base,
    );
    expect(merged).not.toContain('"contiguous"');
    expect(merged).toContain('"adjacent"');
  });

  test("a directive the extension leaves alone stays in the base", () => {
    expect(extendQueries("python", "; extends\n(x) @binding\n", base)).toContain('"contiguous"');
  });

  test("nothing to extend is an error naming the grammar", () => {
    expect(() => extendQueries("zz", "; extends\n(x) @function\n", "")).toThrow(/grammar zz/);
  });
});

describe("pattern order across an extension", () => {
  test("an extension may override a capture the base gives the same root node", () => {
    const merged = extendQueries(
      "python",
      "; extends\n(function_definition) @binding ; @priority\n",
      "(function_definition) @function\n(function_definition name: (identifier)) @function\n",
    );
    expect(() => validatePatternOrder("python", merged)).not.toThrow();
  });

  test("an unstated clash inside the extension itself still fails", () => {
    const merged = extendQueries(
      "python",
      "; extends\n(function_definition) @binding\n(function_definition) @class\n",
      "(import_statement) @import\n",
    );
    expect(() => validatePatternOrder("python", merged)).toThrow(/@priority/);
  });
});
