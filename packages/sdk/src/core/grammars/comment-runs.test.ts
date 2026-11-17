import { describe, expect, test } from "bun:test";
import { decompose } from "./walk.ts";

// One table, every embedded grammar with comments: consecutive comment rows are one element, and a
// run ends at a blank row, at code between two comments, and at a comment that shares its row with
// code (a trailing comment never joins the comment on the next row).
const LANGUAGES: readonly {
  language: string;
  comment: (text: string) => string;
  code: string;
  prefix?: string;
}[] = [
  { language: "typescript", comment: (t) => `// ${t}`, code: "const a = 1;" },
  { language: "tsx", comment: (t) => `// ${t}`, code: "const a = <b />;" },
  { language: "c", comment: (t) => `// ${t}`, code: "int a = 1;" },
  { language: "cpp", comment: (t) => `// ${t}`, code: "int a = 1;" },
  { language: "go", comment: (t) => `// ${t}`, code: "var a = 1", prefix: "package main\n\n" },
  { language: "php", comment: (t) => `// ${t}`, code: "$a = 1;", prefix: "<?php\n" },
  { language: "json", comment: (t) => `// ${t}`, code: '{"a": 1}' },
  { language: "css", comment: (t) => `/* ${t} */`, code: "a { color: red; }" },
  { language: "python", comment: (t) => `# ${t}`, code: "a = 1" },
  { language: "bash", comment: (t) => `# ${t}`, code: "a=1" },
  { language: "yaml", comment: (t) => `# ${t}`, code: "a: 1" },
  { language: "toml", comment: (t) => `# ${t}`, code: "a = 1" },
];

describe("comment runs: consecutive comment rows are one element in every grammar", () => {
  for (const { language, comment, code, prefix = "" } of LANGUAGES) {
    test(language, async () => {
      const source = [
        prefix + comment("one"),
        comment("two"),
        "",
        comment("alone"),
        `${code} ${comment("trailing")}`,
        comment("after"),
        "",
      ].join("\n");
      const inventory = await decompose(source, language);
      expect(inventory.comments.map((c) => c.content)).toEqual([
        `${comment("one")}\n${comment("two")}`,
        comment("alone"),
        comment("trailing"),
        comment("after"),
      ]);
    });
  }
});
