import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

// One table, every embedded grammar with comments: the comment run that opens a file documents the
// file (docstringOf module), and a later comment does not. A blank row separates the header from the
// first definition: a comment directly above one documents that definition (the last test).
const LANGUAGES: readonly { language: string; header: string; source: string }[] = [
  {
    language: "typescript",
    header: "// h1\n// h2",
    source: "\n\nfunction f() {}\n// later\nconst a = 1;\n",
  },
  {
    language: "tsx",
    header: "// h1\n// h2",
    source: "\n\nfunction f() {}\n// later\nconst a = 1;\n",
  },
  {
    language: "c",
    header: "// h1\n// h2",
    source: "\n\nint f(void) { return 0; }\n// later\nint a = 1;\n",
  },
  {
    language: "cpp",
    header: "// h1\n// h2",
    source: "\n\nint f() { return 0; }\n// later\nint a = 1;\n",
  },
  {
    language: "go",
    header: "// h1\n// h2",
    source: "\npackage main\n\nfunc f() {}\n// later\nvar a = 1\n",
  },
  { language: "php", header: "// h1\n// h2", source: "\n\nfunction f() {}\n// later\n$a = 1;\n" },
  { language: "python", header: "# h1\n# h2", source: "\n\ndef f():\n    pass\n# later\na = 1\n" },
  { language: "bash", header: "#!/bin/bash\n# h2", source: "\n\nf() { :; }\n# later\na=1\n" },
  {
    language: "css",
    header: "/* h1 */\n/* h2 */",
    source: "\n\na { color: red; }\n/* later */\nb {}\n",
  },
  { language: "json", header: "// h1\n// h2", source: '\n\n{\n// later\n"a": 1}\n' },
  { language: "yaml", header: "# h1\n# h2", source: "\n\na: 1\n# later\nb: 2\n" },
  { language: "toml", header: "# h1\n# h2", source: "\n\na = 1\n# later\nb = 2\n" },
];

describe("module comments: the comment run opening a file documents the file in every grammar", () => {
  for (const { language, header, source } of LANGUAGES) {
    test(language, async () => {
      const prefix = language === "php" ? "<?php\n" : "";
      const inventory = await decompose(prefix + header + source, language);
      const [first, ...rest] = inventory.comments;
      expect(first?.content).toBe(header);
      expect(first?.docstringOf).toEqual({ kind: "module", name: "" });
      expect(rest.map((c) => c.docstringOf?.kind)).not.toContain("module");
      const below = inventory.definitions.find((d) => d.name === "f");
      expect(below?.attachedComment).toBeUndefined();
    });
  }
});

test("a comment directly above a file's first definition documents that definition", async () => {
  const inventory = await decompose("/** adds */\nexport function add() {}\n", "typescript");
  expect(inventory.comments[0]?.docstringOf).toEqual({ kind: "function", name: "add" });
  expect(inventory.definitions[0]?.attachedComment).toEqual(["/** adds */"]);
});

test("a header above a blank row stays the module's when the first definition has its own doc", async () => {
  const inventory = await decompose(
    "// h1\n// h2\n\n/** adds */\nexport function add() {}\n",
    "typescript",
  );
  expect(inventory.comments.map((c) => c.docstringOf)).toEqual([
    { kind: "module", name: "" },
    { kind: "function", name: "add" },
  ]);
  expect(inventory.definitions[0]?.attachedComment).toEqual(["/** adds */"]);
});
