import { describe, expect, test } from "bun:test";
import { matchesTarget } from "../rules/classify.ts";
import { knownLanguages } from "./grammars.ts";
import { decompose } from "./walk.ts";

// The comment-target PAIR split, verified over ALL TEN embedded grammars: `comments` and
// `loose-comments` must be disjoint and jointly exhaustive over comment text - every comment a
// grammar extracts is measured under exactly one target, owned ones through their definition's
// pair frame, unowned ones as loose elements. A comment shape in neither bucket is a bug.
// Markdown captures no comments at all (the design's WAITING ledger) - recorded absence,
// asserted explicitly rather than skipped.

const SOURCES: Record<string, string> = {
  c: "// c doc\nint add(int a, int b) {\n  // inline note\n  return a + b;\n}\n\n// c loose\n",
  cpp: "// cpp doc\nint add(int a, int b) {\n  // inline note\n  return a + b;\n}\n\n// cpp loose\n",
  css: "/* css doc, no definitions in css */\nbody { color: red; }\n\n/* css loose */\n",
  go: "package p\n\n// go doc\nfunc Add(a int) int {\n  // inline note\n  return a\n}\n\n// go loose\n",
  markdown: "# Title\n\nSome prose. Markdown has no comment capture (WAITING ledger).\n",
  php: "<?php\n// php doc\nfunction add($a) {\n  // inline note\n  return $a;\n}\n\n// php loose\n",
  python:
    '# py doc\ndef add(a):\n    """Adds a."""\n    # inline note\n    return a\n\n# py loose\n',
  tsx: "// tsx doc\nexport function add(a: number): number {\n  // inline note\n  return a;\n}\n\n// tsx loose\n",
  typescript:
    "// ts doc\nexport function add(a: number): number {\n  // inline note\n  return a;\n}\n\n// ts loose\n",
  verilog:
    "// vl doc\nmodule add(input a, output b);\n  // inline note\n  assign b = a;\nendmodule\n\n// vl loose\n",
};

describe("comment-target pair split across all ten grammars", () => {
  test("every grammar is registered with a probe source", () => {
    expect(Object.keys(SOURCES).sort()).toEqual([...knownLanguages()].sort());
  });

  for (const language of knownLanguages()) {
    test(language + ": disjoint and jointly exhaustive over comment text", async () => {
      const inv = await decompose(SOURCES[language]!, language);
      const elements = [...inv.definitions, ...inv.comments, ...inv.imports];
      const commentsPicks = elements.filter((e) => matchesTarget("comments", e));
      const loosePicks = elements.filter((e) => matchesTarget("loose-comments", e));

      // DISJOINT: no element serves both buckets
      for (const e of elements) {
        expect(matchesTarget("comments", e) && matchesTarget("loose-comments", e)).toBe(false);
      }

      // JOINTLY EXHAUSTIVE over comment text: each extracted comment text is covered exactly
      // once - inside exactly one pair frame (attachedComment or the frame's own source), or as
      // exactly one loose element.
      const texts = inv.comments.map((c) => c.content);
      for (const text of texts) {
        const inFrame = commentsPicks.filter(
          (e) => e.attachedComment?.includes(text) || e.content.includes(text),
        ).length;
        const loose = loosePicks.filter((e) => e.content === text).length;
        expect(inFrame + loose, "comment not covered exactly once: " + text).toBe(1);
      }

      // the trailing standalone comment is loose in every grammar that extracts comments
      const looseSuffix = SOURCES[language]!.split("\n").at(-2);
      if (texts.length > 0) {
        expect(
          loosePicks.some((e) => e.content === looseSuffix),
          language + ": the standalone comment must be loose",
        ).toBe(true);
      }
    });

    test(
      language + ": a documented definition draws the pair frame ONCE (no double fire)",
      async () => {
        if (language === "css" || language === "markdown") return; // no definitions / no comments
        const inv = await decompose(SOURCES[language]!, language);
        const elements = [...inv.definitions, ...inv.comments, ...inv.imports];
        // the leading doc comment text appears in exactly one comments-target frame
        const docText = inv.comments[0]!.content;
        const frames = elements.filter(
          (e) => matchesTarget("comments", e) && (e.attachedComment?.includes(docText) ?? false),
        );
        // and no owned comment element is a separate comments match
        const elementDouble = elements.filter(
          (e) =>
            e.capture === "comment" &&
            e.docstringOf !== undefined &&
            e.docstringOf.kind !== "module" &&
            matchesTarget("comments", e),
        );
        expect(frames).toHaveLength(1);
        expect(elementDouble).toHaveLength(0);
      },
    );
  }

  test("markdown: no comment capture - recorded absence, nothing escapes into either bucket", async () => {
    const inv = await decompose(SOURCES.markdown!, "markdown");
    expect(inv.comments).toHaveLength(0);
  });

  test("css: no definitions, so every extracted comment is loose", async () => {
    const inv = await decompose(SOURCES.css!, "css");
    const elements = [...inv.definitions, ...inv.comments, ...inv.imports];
    expect(inv.definitions).toHaveLength(0);
    expect(inv.comments.length).toBeGreaterThan(0);
    for (const e of elements) {
      expect(matchesTarget("loose-comments", e)).toBe(true);
      expect(matchesTarget("comments", e)).toBe(false);
    }
  });
});
